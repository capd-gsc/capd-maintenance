-- ============================================================
-- CAPD Maintenance: ติดตั้งระบบ v3 + โหมดทดลอง (ไฟล์เดียว รันซ้ำได้)
-- รวม v2_workflow.sql + v3_auth.sql + v3_trial_on.sql
-- ============================================================

-- >>>>>>>>>> v2_workflow.sql
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
-- ผู้อนุมัติ MEMO ตั้งต้น ตามชีท ตัวเลือก (Manager App)
update public.role_presets set memo_approver = true
  where email in ('user08@scg.com','user01@scg.com') and not memo_approver;

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

-- >>>>>>>>>> v3_auth.sql
-- =====================================================================
-- CAPD Maintenance v3 — ใช้งานจริง: Login ด้วย Microsoft 365 + สิทธิ์ตาม Flow ในฐานข้อมูล
-- รันใน SQL Editor หลังจาก schema.sql, trial_open_access.sql, v2_workflow.sql (รันซ้ำได้)
-- ผลของไฟล์นี้:
--   * ปิดโหมดทดลอง (ผู้ที่ไม่ได้ Login อ่าน/เขียนข้อมูลไม่ได้อีก)
--   * ผู้ใช้ = ตาราง app_users (อีเมล @scg.com ที่ Admin เพิ่มไว้เท่านั้นที่เข้าได้)
--   * ฐานข้อมูลตรวจสิทธิ์ทุกขั้นของใบงาน — แก้โค้ดหน้าเว็บก็ข้ามไม่ได้
-- =====================================================================

-- ---------- 1. ผู้ใช้ ----------
create table if not exists public.app_users (
  email          text primary key check (email = lower(email) and email like '%@' || public.allowed_domain()),
  full_name      text,
  role           text not null check (role in ('member','foreman_shift','foreman_day','manager','admin')),
  fd_type        text check (fd_type is null or fd_type in ('เครื่องจักร','เครื่องทดสอบ')),  -- Foreman Day ดูแลประเภทเครื่อง (ว่าง = สำรองทุกประเภท)
  is_admin       boolean not null default false,   -- สิทธิ์ผู้ดูแลระบบ (เพิ่มจากบทบาทหลักได้ เช่น Member + Admin)
  memo_approver  boolean not null default false,   -- เลือกเป็นผู้อนุมัติ MEMO (App 1–3) ได้
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

insert into public.app_users(email, full_name, role, fd_type, is_admin, memo_approver) values
  ('user01@scg.com','User 01','member',null,true,false),
  ('user02@scg.com','User 02','foreman_day','เครื่องจักร',false,false),
  ('user03@scg.com','User 03','foreman_day','เครื่องทดสอบ',false,false),
  ('user04@scg.com','User 04','foreman_day',null,false,false),
  ('user05@scg.com','User 05','foreman_shift',null,false,false),
  ('user06@scg.com','User 06','foreman_shift',null,false,false),
  ('user07@scg.com','User 07','foreman_shift',null,false,false),
  ('user08@scg.com','User 08','foreman_shift',null,false,false),
  ('user09@scg.com','User 09','manager',null,false,true),
  ('user10@scg.com','User 10','manager',null,false,true),
  ('user11@scg.com','User 11','member',null,false,false),
  ('user12@scg.com','User 12','member',null,false,false),
  ('user13@scg.com','User 13','member',null,false,false),
  ('user14@scg.com','User 14','member',null,false,false),
  ('user15@scg.com','User 15','member',null,false,false),
  ('user16@scg.com','User 16','member',null,false,false),
  ('user17@scg.com','User 17','member',null,false,false),
  ('user18@scg.com','User 18','member',null,false,false),
  ('user19@scg.com','User 19','member',null,false,false),
  ('user20@scg.com','User 20','member',null,false,false),
  ('user21@scg.com','User 21','member',null,false,false)
on conflict (email) do nothing;

-- helpers (security definer: อ่าน app_users ได้แม้ RLS ปิดกั้น)
create or replace function public.cur_user() returns public.app_users
language sql stable security definer set search_path = public as $$
  select * from public.app_users where email = public.my_email() and active
$$;
create or replace function public.cur_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where email = public.my_email() and active)
$$;
create or replace function public.cur_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.app_users where email = public.my_email() and active
$$;
create or replace function public.cur_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or is_admin from public.app_users where email = public.my_email() and active), false)
$$;
-- ประเภทที่ Foreman Day ดูแล: เครื่องทดสอบ → เครื่องทดสอบ, อื่นๆ (เครื่องจักร / Mold / อื่นๆ) → เครื่องจักร
create or replace function public.fd_type_of(p_machine text) returns text
language sql stable security definer set search_path = public as $$
  select case when m.machine_type = 'เครื่องทดสอบ' then 'เครื่องทดสอบ' else 'เครื่องจักร' end
  from public.machines m where m.machine_no = p_machine
$$;
-- Foreman Day ทุกคนที่ดูแลเครื่องนี้ (ถ้าไม่มี ใช้ FD สำรองที่ไม่ระบุประเภท)
create or replace function public.fds_for(p_machine text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type = public.fd_type_of(p_machine)),
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type is null),
    '{}')
$$;
create or replace function public.fd_for(p_machine text) returns text
language sql stable security definer set search_path = public as $$ select (public.fds_for(p_machine))[1] $$;
create or replace function public.can_fd(p_machine text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cur_admin() or exists (
    select 1 from public.app_users u where u.email = public.my_email() and u.active and u.role = 'foreman_day'
      and (u.fd_type is null or u.fd_type = public.fd_type_of(p_machine)))
$$;

-- profiles เดิมไม่ใช้แล้ว: ให้ trigger สมัครสมาชิกไม่ทำอะไร (กันสมัครไม่ผ่านจาก role ที่เปลี่ยนชนิด)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$ begin return new; end $$;

-- ---------- 2. ปิดโหมดทดลอง ----------
do $$
declare t text;
begin
  foreach t in array array['role_presets','machines','requests','request_logs','documents'] loop
    execute format('drop policy if exists trial_anon_all on public.%I', t);
  end loop;
end $$;
drop policy if exists "trial anon files" on storage.objects;
revoke insert, update, delete on public.role_presets, public.machines, public.requests, public.request_logs, public.documents from anon;
revoke select on public.pmcal_reminders from anon;
revoke execute on function public.ensure_pmcal_jobs() from anon;

-- ---------- 3. ตรวจสิทธิ์ทุกขั้นของใบงาน ----------
create or replace function public.only_report_fields_changed(o public.requests, n public.requests) returns boolean
language sql immutable as $$
  select (to_jsonb(n) - array['machine_no','symptom','first_fix','urgency','attachments','technician','updated_at'])
       = (to_jsonb(o) - array['machine_no','symptom','first_fix','urgency','attachments','technician','updated_at'])
$$;

create or replace function public.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me  text := public.my_email();
  r   text := coalesce(public.cur_role(), '');
  adm boolean := public.cur_admin();
  sys boolean := coalesce(current_setting('capd.system', true), '') = '1';
  ok  boolean := false;
  step_app text;
begin
  if tg_op = 'INSERT' then
    if sys then return new; end if;                                   -- ใบงาน PM/CAL ที่ระบบเปิดเอง
    if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
    if r = 'manager' and not adm then raise exception 'Manager ไม่ได้เปิดใบงาน'; end if;
    new.reporter := me;
    if new.status = 'closed' then
      if new.job_type is distinct from 'self_fix' then raise exception 'ปิดงานทันทีได้เฉพาะงานแก้ไขเอง'; end if;
      new.closed_by := me; new.end_at := coalesce(new.end_at, now());
    else
      new.status := 'pending_fd'; new.job_type := null;
    end if;
    if new.technician is null then
      select responsibility into new.technician from public.machines where machine_no = new.machine_no;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id or new.reporter is distinct from old.reporter or new.created_at is distinct from old.created_at then
    raise exception 'แก้เลขที่ ผู้เปิด หรือวันที่เปิดใบงานไม่ได้';
  end if;
  new.updated_at := now();
  if sys or adm and new.status = old.status and new.memo_step = old.memo_step then return new; end if;
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  step_app := old.memo_approvers[old.memo_step + 1];

  if new.status = old.status then
    -- อัปเดตข้อมูลโดยไม่เปลี่ยนขั้น
    ok := case old.status
      -- ผู้เปิดใบงานแก้ข้อมูลแจ้งซ่อมได้ จนกว่า FD จะอนุมัติ (ช่องอื่นต้องไม่เปลี่ยน)
      when 'pending_fd'    then me = old.reporter and public.only_report_fields_changed(old, new)
      when 'returned'      then me = old.reporter and public.only_report_fields_changed(old, new)
      when 'memo_approval' then me = step_app and new.memo_step = old.memo_step + 1 and new.memo_step < coalesce(array_length(old.memo_approvers, 1), 0)
      when 'quotation'     then me = old.assignee or r = 'foreman_day'
      when 'memo_rejected' then me = old.assignee or r = 'foreman_day'
      when 'po_vendor'     then (me = old.assignee or public.can_fd(old.machine_no)) and new.po_no is not distinct from old.po_no
      else false end;
    if not ok then raise exception 'ไม่มีสิทธิ์แก้ไขใบงานนี้ในขั้นตอนนี้'; end if;
    return new;
  end if;

  ok := case
    when old.status = 'pending_fd'    and new.status in ('wait_admin','quotation','returned') then public.can_fd(old.machine_no)
    when old.status = 'returned'      and new.status in ('pending_fd','closed')       then me = old.reporter or adm or r in ('foreman_shift','foreman_day')
    when old.status = 'wait_admin'    and new.status = 'ext_repair'                   then adm
    when old.status = 'ext_repair'    and new.status = 'closed'                       then public.can_fd(old.machine_no)
    when old.status in ('quotation','memo_rejected') and new.status = 'memo_approval' then me = old.assignee or adm or r = 'foreman_day'
    when old.status = 'memo_approval' and new.status in ('po_vendor','memo_rejected') then me = step_app
    when old.status = 'po_vendor'     and new.status = 'closed'                       then (me = old.assignee or adm or public.can_fd(old.machine_no)) and coalesce(new.po_no, '') <> ''
    else false end;
  if not ok then raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะจาก % เป็น %', old.status, new.status; end if;

  -- บันทึกผู้ทำรายการจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ
  if old.status = 'pending_fd' and new.status <> 'returned' then new.approved_by := me; new.approved_at := now(); end if;
  if new.status = 'closed' then new.closed_by := me; new.end_at := coalesce(new.end_at, now()); end if;
  if old.status = 'memo_approval' and new.status = 'po_vendor' and old.memo_step + 1 < coalesce(array_length(old.memo_approvers, 1), 0) then
    raise exception 'ยังมีผู้อนุมัติลำดับถัดไป';
  end if;
  return new;
end $$;
drop trigger if exists guard_request on public.requests;
create trigger guard_request before insert or update on public.requests
  for each row execute function public.guard_request();

-- ปิดงาน PM/CAL แล้วอัปเดตวันที่ทำล่าสุดของเครื่อง (ทำในฐานข้อมูล ผู้ปิดงานไม่ต้องมีสิทธิ์แก้เครื่องจักร)
create or replace function public.pmcal_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'closed' and old.status <> 'closed' and new.job_type = 'pmcal' then
    if new.pmcal_kind = 'CAL' then update public.machines set cal_last_date = coalesce(new.end_at, now())::date where machine_no = new.machine_no;
    else update public.machines set pm_last_date = coalesce(new.end_at, now())::date where machine_no = new.machine_no; end if;
  end if;
  return new;
end $$;
drop trigger if exists pmcal_done on public.requests;
create trigger pmcal_done after update on public.requests for each row execute function public.pmcal_done();

-- เปิดใบงาน PM/CAL อัตโนมัติ (ทำงานในโหมดระบบ)
create or replace function public.ensure_pmcal_jobs() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform set_config('capd.system', '1', true);
  for r in
    select m.machine_no, m.responsibility, k.kind, (k.last_date + make_interval(months => k.iv))::date as due
    from public.machines m
    cross join lateral (values ('PM', m.pm_last_date, m.pm_interval_month), ('CAL', m.cal_last_date, m.cal_interval_month)) as k(kind, last_date, iv)
    where m.status <> 'Inactive' and k.last_date is not null and coalesce(k.iv, 0) > 0
      and (k.last_date + make_interval(months => k.iv))::date <= today + 90
  loop
    if not exists (select 1 from public.requests q where q.machine_no = r.machine_no and q.job_type = 'pmcal' and q.pmcal_kind = r.kind and q.due_date = r.due) then
      insert into public.requests(machine_no, reporter, symptom, urgency, status, job_type, pmcal_kind, due_date, assignee, technician)
      values (r.machine_no, 'system', r.kind || ' ตามแผน ครบกำหนด ' || to_char(r.due, 'DD/MM/YYYY'),
              case when r.due - today <= 30 then 'High' else 'Normal' end, 'quotation', 'pmcal', r.kind, r.due, r.responsibility, r.responsibility)
      on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  perform set_config('capd.system', '', true);
  return n;
end $$;
grant execute on function public.ensure_pmcal_jobs() to authenticated;

-- ผู้รับอีเมลเตือน PM/CAL: ขั้น 2 = Foreman Day ของประเภทเครื่อง, ขั้น 3 = + Manager
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
  || case when days_left <= 60 then public.fds_for(j.machine_no) else '{}' end
  || case when days_left <= 30 then coalesce((select array_agg(email) from public.app_users where role = 'manager' and active), '{}') else '{}' end
  as recipients
from j;
revoke select on public.pmcal_reminders from anon;

-- ---------- 4. Row Level Security ----------
alter table public.app_users enable row level security;
do $$
declare p record;
begin
  -- ลบ policy เดิมทั้งหมดของตารางหลัก แล้วสร้างชุดใหม่
  for p in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('app_users','role_presets','profiles','machines','requests','request_logs','documents') loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy users_read  on public.app_users for select to authenticated using (public.cur_member());
create policy users_admin on public.app_users for all    to authenticated using (public.cur_admin()) with check (public.cur_admin());

create policy machines_read  on public.machines for select to authenticated using (public.cur_member());
create policy machines_admin on public.machines for all    to authenticated using (public.cur_admin()) with check (public.cur_admin());

create policy requests_read   on public.requests for select to authenticated using (public.cur_member());
create policy requests_insert on public.requests for insert to authenticated with check (public.cur_member());
create policy requests_update on public.requests for update to authenticated using (public.cur_member());
create policy requests_delete on public.requests for delete to authenticated using (public.cur_admin());

create policy logs_read   on public.request_logs for select to authenticated using (public.cur_member());
create policy logs_insert on public.request_logs for insert to authenticated with check (public.cur_member() and actor = public.my_email());

create policy docs_read  on public.documents for select to authenticated
  using (public.cur_member() and (not restricted or public.cur_admin() or public.cur_role() in ('foreman_day','manager')));
create policy docs_write on public.documents for all to authenticated
  using (public.cur_admin() or public.cur_role() in ('foreman_day','manager'))
  with check (public.cur_admin() or public.cur_role() in ('foreman_day','manager'));

create policy presets_admin on public.role_presets for all to authenticated using (public.cur_admin()) with check (public.cur_admin());

drop policy if exists "photos read" on storage.objects;
drop policy if exists "photos upload" on storage.objects;
drop policy if exists "photos delete" on storage.objects;
drop policy if exists "docs read" on storage.objects;
drop policy if exists "docs write" on storage.objects;
drop policy if exists "docs delete" on storage.objects;
create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'request-photos' and public.cur_member());
create policy "photos upload" on storage.objects for insert to authenticated with check (bucket_id = 'request-photos' and public.cur_member());
create policy "photos delete" on storage.objects for delete to authenticated using (bucket_id = 'request-photos' and public.cur_admin());
create policy "docs read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.cur_member() and (name not like 'restricted/%' or public.cur_admin() or public.cur_role() in ('foreman_day','manager')));
create policy "docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (public.cur_admin() or public.cur_role() in ('foreman_day','manager')));
create policy "docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (public.cur_admin() or public.cur_role() in ('foreman_day','manager')));

grant select, insert, update, delete on public.app_users, public.machines, public.requests, public.request_logs, public.documents to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.pmcal_reminders to authenticated;

-- >>>>>>>>>> v3_trial_on.sql
-- =====================================================================
-- CAPD Maintenance v3 — โหมดทดลอง (ก่อน IT ตั้งค่า Microsoft 365)
-- รันหลัง v3_auth.sql · รันซ้ำได้
-- * เข้าระบบด้วยการกรอกอีเมลในรายชื่อผู้ใช้ (ไม่มีรหัสผ่าน)
-- * สิทธิ์และ Flow ทุกขั้นตรวจในฐานข้อมูลเหมือนของจริง
-- * ข้อเสีย: ใครรู้อีเมลคนอื่นก็เข้าในนามคนนั้นได้ ห้ามใส่ข้อมูลลับ
-- ปิดโหมดทดลอง: รัน v3_trial_off.sql
-- =====================================================================

create table if not exists public.app_settings (key text primary key, value text);
alter table public.app_settings enable row level security;   -- ไม่มี policy = หน้าเว็บอ่าน/แก้ไม่ได้
insert into public.app_settings values ('trial_login', 'on')
  on conflict (key) do update set value = excluded.value;

-- อีเมลผู้ใช้: จาก Login จริงก่อน ถ้าไม่มีและเปิดโหมดทดลอง ใช้ header x-capd-user ที่หน้าเว็บส่งมา
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    case when exists (select 1 from public.app_settings where key = 'trial_login' and value = 'on')
         then nullif(current_setting('request.headers', true), '')::json ->> 'x-capd-user' end,
    ''))
$$;

-- ให้ policy เดียวกันใช้กับผู้ที่ไม่ได้ Login จริง (anon) ด้วย
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where (schemaname = 'public' and tablename in ('app_users','role_presets','machines','requests','request_logs','documents'))
              or (schemaname = 'storage' and tablename = 'objects' and policyname in ('photos read','photos upload','photos delete','docs read','docs write','docs delete')) loop
    execute format('alter policy %I on %I.%I to anon, authenticated', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
grant select, insert, update, delete on public.app_users, public.machines, public.requests, public.request_logs, public.documents to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on function public.ensure_pmcal_jobs() to anon;
