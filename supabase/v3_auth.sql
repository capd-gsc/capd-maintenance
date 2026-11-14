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

-- รายชื่อผู้ใช้ไม่เก็บใน GitHub (repo เป็น Public)
-- ติดตั้งใหม่: รันไฟล์ users_seed.local.sql ที่ Admin เก็บไว้ หรือเพิ่ม Admin คนแรกด้วยคำสั่งนี้ แล้วนำเข้าผู้ใช้จาก Excel ในหน้าเว็บ
--   insert into public.app_users(email, full_name, role, is_admin) values ('ชื่อ@scg.com', 'ชื่อ นามสกุล', 'member', true);

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
-- ใบเสนอราคาเทียบราคา + ข้อมูลฟอร์ม MEMO (SC-F-0030) ในใบงาน
alter table public.requests
  add column if not exists quotes        jsonb not null default '[]',   -- [{vendor,no,amount,lead,valid,file,chosen}]
  add column if not exists select_reason text,                          -- เหตุผลที่เลือก Vendor
  add column if not exists quote_reason  text,                          -- เหตุผลที่มีใบเสนอราคาน้อยกว่า 3 ใบ
  add column if not exists memo_doc      jsonb;                         -- ข้อมูลในแบบฟอร์ม MEMO
-- v3.5: เวลาเครื่องหยุด + พักงาน (รออะไหล่ / รอ Vendor)
alter table public.requests
  add column if not exists machine_down  boolean not null default false, -- เครื่องหยุดใช้งานหรือไม่ ตอนแจ้ง
  add column if not exists down_since    timestamptz,                    -- เครื่องหยุดตั้งแต่ (ใช้คำนวณ Downtime)
  add column if not exists hold_reason   text,                           -- พักงาน: เหตุผล (ว่าง = ไม่ได้พัก)
  add column if not exists hold_note     text,
  add column if not exists hold_since    timestamptz;                    -- ระบบใส่เวลาให้เอง
alter table public.requests add column if not exists items jsonb;   -- v3.6: รายการในคำขอซื้อ

create or replace function public.only_changed(o public.requests, n public.requests, cols text[]) returns boolean
language sql immutable as $$
  select (to_jsonb(n) - (cols || array['updated_at'])) = (to_jsonb(o) - (cols || array['updated_at']))
$$;
create or replace function public.only_report_fields_changed(o public.requests, n public.requests) returns boolean
language sql immutable as $$
  select public.only_changed(o, n, array['machine_no','symptom','first_fix','urgency','attachments','technician','machine_down','down_since'])
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
      new.status := 'pending_fd';
      new.job_type := case when new.job_type = 'purchase' then 'purchase' else null end;   -- คำขอซื้อ (v3.6)
      if new.job_type = 'purchase' and jsonb_array_length(coalesce(new.items, '[]')) = 0 then raise exception 'คำขอซื้อต้องมีรายการอย่างน้อย 1 รายการ'; end if;
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
  -- พักงาน / กลับมาทำต่อ: เวลาเริ่มพักใส่โดยระบบ · เปลี่ยนขั้นแล้วการพักหายเอง
  if new.hold_reason is distinct from old.hold_reason then new.hold_since := case when new.hold_reason is null then null else now() end; end if;
  if new.status <> old.status then new.hold_reason := null; new.hold_note := null; new.hold_since := null; end if;
  if sys or adm and new.status = old.status and new.memo_step = old.memo_step then return new; end if;
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  step_app := old.memo_approvers[old.memo_step + 1];
  if new.status = old.status and public.only_changed(old, new, array['hold_reason','hold_note','hold_since']) then
    if old.status in ('wait_admin','ext_repair','quotation','memo_rejected','po_vendor')
       and (me = any(public.next_actors(old)) or public.can_fd(old.machine_no)) then return new; end if;
    raise exception 'ไม่มีสิทธิ์พักงานใบงานนี้';
  end if;
  -- ส่ง MEMO แล้ว ใบเสนอราคาและ MEMO ถูกล็อก (แก้ได้อีกเมื่อถูกส่งกลับ หรือโดย Admin)
  if old.status in ('memo_approval','po_vendor','closed') and (
       new.quotes is distinct from old.quotes or new.memo_doc is distinct from old.memo_doc
    or new.vendor is distinct from old.vendor or new.quotation_amount is distinct from old.quotation_amount
    or new.memo_no is distinct from old.memo_no or new.memo_approvers is distinct from old.memo_approvers
    or new.select_reason is distinct from old.select_reason) then
    raise exception 'ใบเสนอราคาและ MEMO ถูกล็อกหลังส่งอนุมัติแล้ว';
  end if;

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
    -- ยกเลิกใบงาน (ต้องมีเหตุผล): Admin ทุกสถานะที่ยังเปิด · ผู้เปิดใบงานเฉพาะก่อน FD อนุมัติ
    when new.status = 'cancelled' and old.status not in ('closed','cancelled')     then coalesce(btrim(new.return_note), '') <> '' and (adm or (me = old.reporter and old.status in ('pending_fd','returned')))
    when old.status = 'po_vendor'     and new.status = 'closed'                       then (me = old.assignee or adm or public.can_fd(old.machine_no)) and coalesce(new.po_no, '') <> ''
    else false end;
  if not ok then raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะจาก % เป็น %', old.status, new.status; end if;

  -- บันทึกผู้ทำรายการจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ
  if old.status = 'pending_fd' and new.status <> 'returned' then new.approved_by := me; new.approved_at := now(); end if;
  if new.status = 'closed' then new.closed_by := me; new.end_at := coalesce(new.end_at, now()); end if;
  if new.status = 'cancelled' then new.closed_by := me; end if;
  -- ส่ง MEMO: Vendor และราคาในใบงานมาจากใบเสนอราคาที่เลือก · ผู้ขออนุมัติและวันที่บันทึกโดยระบบ
  if new.status = 'memo_approval' and old.status <> 'memo_approval' then
    if jsonb_array_length(coalesce(new.quotes, '[]')) > 0 then
      new.vendor := null;
      select x ->> 'vendor', (x ->> 'amount')::numeric into new.vendor, new.quotation_amount
        from jsonb_array_elements(new.quotes) x where coalesce((x ->> 'chosen')::boolean, false) limit 1;
      if new.vendor is null then raise exception 'เลือกใบเสนอราคาที่จะใช้'; end if;
    end if;
    if new.memo_doc is not null then
      new.memo_doc := new.memo_doc || jsonb_build_object('from', me, 'date', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'));
    end if;
  end if;
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
