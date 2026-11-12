-- =====================================================================
-- CAPD Maintenance v2 — Flow ใหม่ (แก้เอง / Normal RMT-FM / Special / PM-CAL)
-- รันใน SQL Editor หลังจาก schema.sql และ trial_open_access.sql (รันซ้ำได้)
-- ⚠ ถ้ารัน schema.sql ซ้ำภายหลัง ต้องรันไฟล์นี้ตามอีกครั้ง
-- =====================================================================

-- ---------- 1. บทบาทใหม่ ----------
do $$ begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'role_presets' and column_name = 'role') <> 'text' then
    alter table public.role_presets alter column role type text using role::text;
  end if;
end $$;
alter table public.role_presets drop constraint if exists role_presets_role_check;
update public.role_presets set role = case role
  when 'approver' then 'foreman_day' when 'tech' then 'member' when 'reporter' then 'member' else role end
  where role in ('approver','tech','reporter');
alter table public.role_presets add constraint role_presets_role_check
  check (role in ('member','foreman_shift','foreman_day','manager','admin'));
alter table public.role_presets add column if not exists full_name text;
alter table public.role_presets add column if not exists memo_approver boolean not null default false;

-- ---------- 2. ใบงาน: คอลัมน์ใหม่ ----------
alter table public.requests
  add column if not exists job_type text,            -- self_fix / normal / special / pmcal
  add column if not exists repair_unit text,         -- RMT / FM (งาน Normal)
  add column if not exists first_fix text,           -- วิธีแก้ไขเบื้องต้น
  add column if not exists assignee text,            -- ผู้รับผิดชอบงาน Special / PM-CAL
  add column if not exists external_ref text,        -- เลขที่ใบแจ้ง SAP / K2
  add column if not exists vendor text,
  add column if not exists quotation_amount numeric(14,2),
  add column if not exists memo_no text,
  add column if not exists memo_approvers text[] not null default '{}',
  add column if not exists memo_step int not null default 0,
  add column if not exists memo_round int not null default 0,
  add column if not exists po_no text,
  add column if not exists vendor_date date,
  add column if not exists pmcal_kind text,          -- PM / CAL
  add column if not exists due_date date,
  add column if not exists action_at timestamptz,    -- Member เริ่มดำเนินการแล้ว (หยุดอีเมลเตือน)
  add column if not exists return_note text,
  add column if not exists closed_by text,
  add column if not exists attachments jsonb not null default '[]';

alter table public.requests drop constraint if exists requests_status_check;
update public.requests set status = case status
  when 'rejected' then 'returned'
  when 'closed' then 'closed'
  else 'pending_fd' end
  where status not in ('pending_fd','returned','wait_admin','ext_repair','quotation','memo_approval',
                       'memo_rejected','po_vendor','closed','cancelled');
alter table public.requests alter column status set default 'pending_fd';
alter table public.requests add constraint requests_status_check check (status in
  ('pending_fd','returned','wait_admin','ext_repair','quotation','memo_approval','memo_rejected','po_vendor','closed','cancelled'));
alter table public.requests drop constraint if exists requests_job_type_check;
alter table public.requests add constraint requests_job_type_check
  check (job_type is null or job_type in ('self_fix','normal','special','pmcal'));

create unique index if not exists requests_pmcal_uniq on public.requests(machine_no, pmcal_kind, due_date)
  where job_type = 'pmcal';

-- ตอนสร้างใบงาน อนุญาตเฉพาะสถานะเริ่มต้นที่ถูกต้อง
create or replace function public.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending_fd','closed','quotation') then new.status := 'pending_fd'; end if;
    if new.technician is null then
      select responsibility into new.technician from public.machines where machine_no = new.machine_no;
    end if;
    return new;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- 3. PM/CAL: เปิดใบงานอัตโนมัติ 3 เดือนก่อนครบกำหนด ----------
create or replace function public.ensure_pmcal_jobs() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  for r in
    select m.machine_no, m.responsibility, k.kind,
           (k.last_date + make_interval(months => k.iv))::date as due
    from public.machines m
    cross join lateral (values ('PM', m.pm_last_date, m.pm_interval_month),
                               ('CAL', m.cal_last_date, m.cal_interval_month)) as k(kind, last_date, iv)
    where m.status <> 'Inactive' and k.last_date is not null and coalesce(k.iv,0) > 0
      and (k.last_date + make_interval(months => k.iv))::date <= today + 90
  loop
    if not exists (select 1 from public.requests q where q.machine_no = r.machine_no
                   and q.job_type = 'pmcal' and q.pmcal_kind = r.kind and q.due_date = r.due) then
      insert into public.requests(machine_no, reporter, symptom, urgency, status, job_type, pmcal_kind, due_date, assignee, technician)
      values (r.machine_no, 'system', r.kind || ' ตามแผน ครบกำหนด ' || to_char(r.due, 'DD/MM/YYYY'),
              case when r.due - today <= 30 then 'High' else 'Normal' end,
              'quotation', 'pmcal', r.kind, r.due, r.responsibility, r.responsibility)
      on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.ensure_pmcal_jobs() to anon, authenticated;

-- ---------- 4. รายชื่อผู้รับอีเมลเตือน PM/CAL (ใช้โดยงานส่งอีเมลรายวัน) ----------
-- ขั้น 1 (≤ 3 เดือน): Member ผู้รับผิดชอบ
-- ขั้น 2 (≤ 2 เดือน): + Foreman Day ทุกคน
-- ขั้น 3 (≤ 1 เดือน): + Manager ทุกคน
-- เตือนทุกวันจนกว่า Member กด "เริ่มดำเนินการ" (action_at)
create or replace view public.pmcal_reminders as
with j as (
  select q.id, q.machine_no, m.machine_name, q.pmcal_kind, q.due_date, q.assignee,
         q.due_date - (now() at time zone 'Asia/Bangkok')::date as days_left
  from public.requests q join public.machines m on m.machine_no = q.machine_no
  where q.job_type = 'pmcal' and q.action_at is null and q.status not in ('closed','cancelled')
)
select j.*,
  case when days_left <= 30 then 3 when days_left <= 60 then 2 else 1 end as tier,
  array_remove(array[j.assignee], null)
  || case when days_left <= 60 then coalesce((select array_agg(email) from public.role_presets where role = 'foreman_day'), '{}') else '{}' end
  || case when days_left <= 30 then coalesce((select array_agg(email) from public.role_presets where role = 'manager'), '{}') else '{}' end
  as recipients
from j;
grant select on public.pmcal_reminders to anon, authenticated;
