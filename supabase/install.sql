-- =====================================================================
-- CAPD Maintenance — ติดตั้ง / อัปเดตฐานข้อมูล (ไฟล์เดียว รันซ้ำได้)
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
--   * ติดตั้งใหม่: รันไฟล์นี้ แล้วเพิ่มผู้ใช้ (users_seed.local.sql ที่ Admin เก็บไว้)
--     ช่วงทดลองใช้ก่อน IT ตั้งค่า Microsoft 365: รัน trial_on.sql ต่อ
--   * อัปเดตจากรุ่นก่อน: รันไฟล์นี้ไฟล์เดียว ข้อมูลเดิมอยู่ครบ โหมดทดลองคงตามเดิม
--   * รันเสร็จจะเห็นผลบรรทัดสุดท้ายเป็นสถานะโหมดทดลอง
-- ไฟล์นี้สร้างจาก tools/build-sql.sh — อย่าแก้ตรงนี้ ให้แก้ supabase/src/ แล้วรันสคริปต์ใหม่
-- =====================================================================

-- ===== 01 base: ตารางหลัก (เครื่องจักร ใบงาน ประวัติ เอกสาร) =====
-- ---------- 0. ตั้งค่าโดเมนอีเมลที่อนุญาต ----------
create or replace function public.allowed_domain() returns text
language sql immutable as $$ select 'scg.com' $$;

-- ---------- 1. ผู้ใช้ปัจจุบัน ----------
-- ค่าตั้งระบบ (เช่น โหมดทดลอง) · เปิด RLS ไม่มี policy = หน้าเว็บอ่าน/แก้ไม่ได้
create table if not exists public.app_settings (key text primary key, value text);
alter table public.app_settings enable row level security;

-- อีเมลผู้ใช้: จาก Login Microsoft 365 ก่อน · ถ้าเปิดโหมดทดลอง ใช้ header x-capd-user ที่หน้าเว็บส่งมา
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    case when exists (select 1 from public.app_settings where key = 'trial_login' and value = 'on')
         then nullif(current_setting('request.headers', true), '')::json ->> 'x-capd-user' end,
    ''))
$$;

-- ห้ามสมัครด้วยอีเมลนอกโดเมนบริษัท
create or replace function public.enforce_company_domain() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email,'')) not like '%@' || public.allowed_domain() then
    raise exception 'อนุญาตเฉพาะอีเมล @%', public.allowed_domain();
  end if;
  return new;
end $$;
drop trigger if exists enforce_company_domain on auth.users;
create trigger enforce_company_domain before insert on auth.users
  for each row execute function public.enforce_company_domain();

-- ---------- 2. ทะเบียนเครื่องจักร (Machine Master + PM/CAL Master) ----------
create table if not exists public.machines (
  machine_no        text primary key,
  machine_name      text not null,
  model             text,
  serial_number     text,
  machine_type      text,            -- เครื่องจักร / เครื่องทดสอบ / อื่นๆ
  location          text,
  status            text not null default 'Active',      -- Active / Maintenance / Inactive
  priority          text not null default 'Normal',      -- Critical / High / Normal
  maintenance_type  text not null default 'No Plan',     -- PM / CAL / PM & CAL / No Plan
  responsibility    text,            -- อีเมลช่างผู้รับผิดชอบ
  eng_foreman       text,            -- อีเมล Eng/Foreman
  supplier          text,
  contact_person    text,
  phone             text,
  email             text,
  other_contact     text,            -- Line / ช่องทางอื่น
  photo_path        text,
  pm_last_date      date,
  pm_interval_month int,
  cal_last_date     date,
  cal_interval_month int,
  updated_at        timestamptz not null default now()
);

-- ---------- 3. ใบแจ้งซ่อม (Maintenance Requests) ----------
create sequence if not exists public.request_seq;

create table if not exists public.requests (
  id             text primary key
                 default 'MR-' || to_char(now() at time zone 'Asia/Bangkok','YYYY') || '-' ||
                         lpad(nextval('public.request_seq')::text, 4, '0'),
  machine_no     text not null references public.machines(machine_no) on update cascade,
  reporter       text not null default public.my_email(),
  symptom        text not null,
  urgency        text not null default 'High' check (urgency in ('Critical','High','Normal')),
  status         text not null default 'pending_approval'
                 check (status in ('pending_approval','queued','in_progress','waiting_parts',
                                   'testing','waiting_confirm','closed','rejected')),
  technician     text,
  approved_by    text,
  approved_at    timestamptz,
  start_at       timestamptz,
  end_at         timestamptz,
  root_cause     text,
  fix_detail     text,
  parts_used     text,
  downtime_min   int  check (downtime_min >= 0),
  cost_thb       numeric(12,2) check (cost_thb >= 0),
  inspector      text,
  inspect_result text,
  photos         text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists requests_status_idx on public.requests(status);
create index if not exists requests_machine_idx on public.requests(machine_no);

create table if not exists public.request_logs (
  id          bigint generated always as identity primary key,
  request_id  text not null references public.requests(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       text not null default public.my_email(),
  action      text not null
);
create index if not exists request_logs_req_idx on public.request_logs(request_id);

-- ---------- 4. คลังเอกสาร ----------
create table if not exists public.documents (
  id          bigint generated always as identity primary key,
  title       text not null,
  kind        text not null,          -- คู่มือ PDF / SOP/WI / Drawing / วิดีโอ / วิธีแก้ปัญหาเบื้องต้น / Certificate
  machine_no  text references public.machines(machine_no) on update cascade on delete set null,
  tags        text,
  restricted  boolean not null default false,
  file_path   text,                   -- path ใน Storage bucket "documents"
  url         text,                   -- หรือ ลิงก์ภายนอก (เช่น SharePoint / OneDrive)
  uploaded_by text not null default public.my_email(),
  created_at  timestamptz not null default now()
);

-- ---------- 5. Row Level Security (policy อยู่ใน 03_auth) ----------
alter table public.machines      enable row level security;
alter table public.requests      enable row level security;
alter table public.request_logs  enable row level security;
alter table public.documents     enable row level security;

-- ---------- 6. Storage (รูปแจ้งซ่อม + ไฟล์เอกสาร) · policy อยู่ใน 03_auth ----------
insert into storage.buckets (id, name, public) values
  ('request-photos','request-photos', false),
  ('documents','documents', false)
on conflict (id) do nothing;

-- ---------- 7. Realtime (หน้าจอทุกคนอัปเดตทันที) ----------
do $$ begin
  alter publication supabase_realtime add table public.requests;
exception when others then null; end $$;

-- ===== 02 workflow: Flow งานซ่อม / PM-CAL อัตโนมัติ =====
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
  check (job_type is null or job_type in ('self_fix','normal','special','pmcal','purchase'));

create unique index if not exists requests_pmcal_uniq on public.requests(machine_no, pmcal_kind, due_date)
  where job_type = 'pmcal';

-- ===== 03 auth: ผู้ใช้ (app_users) · ตรวจสิทธิ์ทุกขั้นของใบงาน · RLS =====
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
           and tablename in ('app_users','machines','requests','request_logs','documents') loop
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

-- ===== 04 notify: คิวแจ้งเตือน Teams / Email =====
alter table public.app_users add column if not exists notify_email boolean not null default true;

create table if not exists public.notify_queue (
  id          bigint generated always as identity primary key,
  request_id  text not null references public.requests(id) on delete cascade,
  event       text not null,                 -- new / step / memo_next / po_ready / closed / cancelled
  status      text not null,                 -- สถานะใบงานตอนเกิดเรื่อง
  recipients  text[] not null default '{}',  -- อีเมลคนที่ต้องทำต่อ (ไม่รวมคนที่กดเอง)
  actor       text,                          -- คนที่ทำให้เกิดเรื่อง ('' = ระบบ)
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text
);
create index if not exists notify_queue_unsent on public.notify_queue(id) where sent_at is null;
alter table public.notify_queue enable row level security;   -- ไม่มี policy: หน้าเว็บอ่าน/เขียนไม่ได้ (Edge Function ใช้ service role)
revoke all on public.notify_queue from anon, authenticated;

-- ใครต้องทำต่อ ตามสถานะใบงาน (ตรงกับ owner() ในหน้าเว็บ)
create or replace function public.next_actors(q public.requests) returns text[]
language sql stable security definer set search_path = public as $$
  with admins as (select coalesce(array_agg(email order by email), '{}') a from public.app_users where active and (role = 'admin' or is_admin))
  select array_remove(case q.status
    when 'pending_fd'    then public.fds_for(q.machine_no)
    when 'ext_repair'    then public.fds_for(q.machine_no)
    when 'returned'      then array[q.reporter]
    when 'wait_admin'    then (select a from admins)
    when 'quotation'     then array[q.assignee]
    when 'memo_rejected' then array[q.assignee]
    when 'memo_approval' then array[q.memo_approvers[q.memo_step + 1]]
    when 'po_vendor'     then case when coalesce(q.po_no, '') = '' then (select a from admins) else array[q.assignee] end
    when 'closed'        then array[q.reporter]
    when 'cancelled'     then array[q.reporter]
    else '{}'::text[] end, null)
$$;

create or replace function public.queue_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; who text[]; me text := public.my_email();
begin
  if tg_op = 'INSERT' then
    ev := case when new.status = 'closed' then null else 'new' end;           -- แก้ไขเองแล้วปิดทันที ไม่ต้องแจ้งใคร
  elsif new.status is distinct from old.status then
    ev := case new.status when 'closed' then 'closed' when 'cancelled' then 'cancelled' else 'step' end;
  elsif new.status = 'memo_approval' and new.memo_step is distinct from old.memo_step then
    ev := 'memo_next';
  elsif new.status = 'po_vendor' and coalesce(old.po_no, '') = '' and coalesce(new.po_no, '') <> '' then
    ev := 'po_ready';
  end if;
  if ev is null then return null; end if;
  who := array(select distinct x from unnest(public.next_actors(new)) x
               where x <> coalesce(me, '') and x <> 'system' and exists (select 1 from public.app_users u where u.email = x and u.active));
  insert into public.notify_queue(request_id, event, status, recipients, actor) values (new.id, ev, new.status, who, coalesce(me, ''));
  return null;
end $$;
drop trigger if exists queue_notify on public.requests;
create trigger queue_notify after insert or update on public.requests for each row execute function public.queue_notify();
-- งานที่ค้างนานเกิน 3 วัน (view stale_jobs) อยู่ใน 05_parts

-- ===== 05 parts: คลังอะไหล่ · Vendor · คำขอซื้อ · อุปกรณ์ประกอบ =====
-- ---------- ตาราง ----------
create table if not exists public.spare_parts (
  part_no     text primary key,
  name        text not null,
  spec        text,
  unit        text not null default 'ชิ้น',
  stock       numeric not null default 0 check (stock >= 0),
  min_qty     numeric,
  max_qty     numeric,
  location    text,
  unit_price  numeric,
  lead_days   int,
  machines    text[] not null default '{}',   -- ใช้กับเครื่องไหนบ้าง
  vendor      text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create table if not exists public.part_tx (
  id          bigint generated always as identity primary key,
  part_no     text not null references public.spare_parts(part_no) on update cascade,
  qty         numeric not null check (qty <> 0),           -- + รับเข้า · − เบิกออก
  kind        text not null check (kind in ('opening','receive','issue','adjust')),
  request_id  text references public.requests(id) on delete set null,
  unit_price  numeric,
  note        text,
  actor       text not null default public.my_email(),
  at          timestamptz not null default now()
);
create index if not exists part_tx_part on public.part_tx(part_no, at desc);
alter table public.part_tx add column if not exists machine_no text references public.machines(machine_no) on update cascade on delete set null;   -- เบิกใช้กับเครื่องไหน
create table if not exists public.vendors (
  name           text primary key,
  contact_person text, phone text, email text, other_contact text,
  machines       text[] not null default '{}',
  work_type      text, note text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- อุปกรณ์ประกอบของเครื่อง (เช่น ตุ้มน้ำหนักมาตรฐาน / Extensometer ของเครื่องทดสอบ) มีแผน CAL ของตัวเอง
alter table public.machines add column if not exists parent_machine text references public.machines(machine_no) on update cascade on delete set null;
alter table public.machines drop constraint if exists machines_parent_not_self;
alter table public.machines add constraint machines_parent_not_self check (parent_machine is distinct from machine_no);

-- คำขอซื้อ: ไม่จำเป็นต้องผูกกับเครื่อง + รายการที่ขอซื้อ
alter table public.requests alter column machine_no drop not null;
alter table public.requests add column if not exists items jsonb;   -- [{part_no?, name, qty, unit, recv?, stocked?}]
alter table public.requests drop constraint if exists requests_job_type_check;
alter table public.requests add constraint requests_job_type_check
  check (job_type is null or job_type in ('self_fix','normal','special','pmcal','purchase'));

-- ---------- ยอดคงเหลือ ----------
-- แก้ stock ตรงๆ ไม่ได้ (ต้องผ่าน part_tx) · อะไหล่ใหม่เริ่มที่ 0
create or replace function public.part_stock_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('capd.stock', true), '') <> '1' then
    if tg_op = 'INSERT' then new.stock := 0;
    elsif new.stock is distinct from old.stock then raise exception 'แก้ยอดคงเหลือได้ผ่านการรับ / เบิก / ปรับยอดเท่านั้น'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists part_stock_guard on public.spare_parts;
create trigger part_stock_guard before insert or update on public.spare_parts for each row execute function public.part_stock_guard();

create or replace function public.part_tx_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := public.my_email(); r public.requests; left_qty numeric;
begin
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  new.actor := me; new.at := now();
  if new.kind in ('opening', 'adjust') then
    if not (public.cur_admin() or public.cur_role() = 'foreman_day') then raise exception 'ปรับยอดอะไหล่ได้เฉพาะ Admin / Foreman Day'; end if;
  elsif new.kind = 'issue' then
    if new.qty >= 0 then raise exception 'เบิกอะไหล่ต้องเป็นจำนวนติดลบ'; end if;
    -- เบิกจากใบงาน หรือเบิกใช้ทั่วไป (ต้องใส่เหตุผล)
    if new.request_id is null and coalesce(btrim(new.note), '') = '' then raise exception 'เบิกอะไหล่โดยไม่มีใบงาน ต้องใส่เหตุผล'; end if;
    if new.request_id is not null and new.machine_no is null then
      select machine_no into new.machine_no from public.requests where id = new.request_id;
    end if;
  elsif new.kind = 'receive' then
    select * into r from public.requests where id = new.request_id;
    if new.qty <= 0 or r.id is null or r.job_type <> 'purchase' or r.status <> 'po_vendor'
       or not (me = r.assignee or public.cur_admin() or public.cur_role() = 'foreman_day') then
      raise exception 'รับของเข้าคลังได้จากคำขอซื้อที่ออก PO แล้ว โดยผู้รับผิดชอบ / Admin / Foreman Day';
    end if;
  end if;
  new.unit_price := coalesce(new.unit_price, (select unit_price from public.spare_parts where part_no = new.part_no));
  perform set_config('capd.stock', '1', true);
  update public.spare_parts set stock = stock + new.qty where part_no = new.part_no returning stock into left_qty;
  perform set_config('capd.stock', '', true);
  if left_qty is null then raise exception 'ไม่พบอะไหล่ %', new.part_no; end if;
  return new;
exception when check_violation then
  raise exception 'อะไหล่ % คงเหลือไม่พอ', new.part_no;
end $$;
drop trigger if exists part_tx_apply on public.part_tx;
create trigger part_tx_apply before insert on public.part_tx for each row execute function public.part_tx_apply();

create or replace function public.fds_for(p_machine text) returns text[]
language sql stable security definer set search_path = public as $$
  select case when p_machine is null then
    coalesce((select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active), '{}')
  else coalesce(
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type = public.fd_type_of(p_machine)),
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type is null),
    '{}') end
$$;
create or replace function public.can_fd(p_machine text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cur_admin() or exists (
    select 1 from public.app_users u where u.email = public.my_email() and u.active and u.role = 'foreman_day'
      and (u.fd_type is null or p_machine is null or u.fd_type = public.fd_type_of(p_machine)))
$$;

-- งานที่ค้างนานเกิน 3 วัน (ใช้ในสรุปรายวัน) · รวมคำขอซื้อที่ไม่ผูกกับเครื่อง
drop view if exists public.stale_jobs;
create view public.stale_jobs as
select q.id, q.machine_no, m.machine_name, q.status, q.urgency, q.updated_at,
       ((now() at time zone 'Asia/Bangkok')::date - (q.updated_at at time zone 'Asia/Bangkok')::date) as idle_days,
       public.next_actors(q) as waiting_on, q.job_type, q.hold_reason
from public.requests q left join public.machines m on m.machine_no = q.machine_no
where q.status not in ('closed', 'cancelled') and q.updated_at < now() - interval '3 days';
revoke all on public.stale_jobs from anon, authenticated;

-- ---------- สิทธิ์ ----------
alter table public.spare_parts enable row level security;
alter table public.part_tx enable row level security;
alter table public.vendors enable row level security;
drop policy if exists parts_read on public.spare_parts;
drop policy if exists parts_write on public.spare_parts;
drop policy if exists tx_read on public.part_tx;
drop policy if exists tx_insert on public.part_tx;
drop policy if exists vendors_read on public.vendors;
drop policy if exists vendors_insert on public.vendors;
drop policy if exists vendors_write on public.vendors;
create policy parts_read  on public.spare_parts for select to authenticated using (public.cur_member());
create policy parts_write on public.spare_parts for all    to authenticated
  using (public.cur_admin() or public.cur_role() = 'foreman_day') with check (public.cur_admin() or public.cur_role() = 'foreman_day');
create policy tx_read   on public.part_tx for select to authenticated using (public.cur_member());
create policy tx_insert on public.part_tx for insert to authenticated with check (public.cur_member());   -- part_tx_apply ตรวจสิทธิ์ละเอียด
create policy vendors_read   on public.vendors for select to authenticated using (public.cur_member());
create policy vendors_insert on public.vendors for insert to authenticated with check (public.cur_member());   -- ทุกคนเพิ่ม Vendor ได้
create policy vendors_write  on public.vendors for update to authenticated
  using (public.cur_admin() or public.cur_role() = 'foreman_day') with check (public.cur_admin() or public.cur_role() = 'foreman_day');
grant select, insert, update, delete on public.spare_parts, public.vendors to authenticated;
grant select, insert on public.part_tx to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ===== 09 finish: ลบของเก่าที่ไม่ใช้ · คงโหมดทดลองไว้ตามที่ตั้ง =====

-- ---------- ของเก่าจากระบบรุ่นแรก (ผู้ใช้ย้ายไป app_users แล้ว) ----------
do $$
declare t text;
begin
  -- policy เปิดทุกอย่างของโหมดทดลองรุ่นแรก (trial_open_access.sql)
  foreach t in array array['machines','requests','request_logs','documents'] loop
    execute format('drop policy if exists trial_anon_all on public.%I', t);
  end loop;
end $$;
drop policy if exists "trial anon files" on storage.objects;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;           -- พร้อม trigger guard_profile_update
drop table if exists public.role_presets;
drop function if exists public.guard_profile_update();
drop function if exists public.is_member();
drop function if exists public.my_role();
drop type if exists public.app_role;

-- ---------- โหมดทดลอง (เข้าด้วยอีเมลอย่างเดียว ก่อน IT ตั้งค่า Microsoft 365) ----------
create or replace function public.trial_is_on() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'on' from public.app_settings where key = 'trial_login'), false)
$$;

-- เปิด/ปิดสิทธิ์ของผู้ที่ไม่ได้ Login จริง (anon) ให้ตรงกับโหมด · policy ชุดเดียวกับผู้ Login จริง
-- ฐานข้อมูลยังตรวจสิทธิ์ตามบทบาทและ Flow ทุกขั้นเหมือนเดิม (my_email อ่านอีเมลจาก header แทน)
create or replace function public.capd_apply_trial(p_on boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  p record;
  tabs text[] := array['app_users','machines','requests','request_logs','documents','spare_parts','part_tx','vendors'];
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where (schemaname = 'public' and tablename = any(tabs))
              or (schemaname = 'storage' and tablename = 'objects' and policyname in ('photos read','photos upload','photos delete','docs read','docs write','docs delete')) loop
    execute format('alter policy %I on %I.%I to %s', p.policyname, p.schemaname, p.tablename, case when p_on then 'anon, authenticated' else 'authenticated' end);
  end loop;
  if p_on then
    grant select, insert, update, delete on public.app_users, public.machines, public.requests, public.request_logs, public.documents, public.spare_parts, public.vendors to anon;
    grant select, insert on public.part_tx to anon;
    grant usage, select on all sequences in schema public to anon;
    grant execute on function public.ensure_pmcal_jobs() to anon;
  else
    revoke all on public.app_users, public.machines, public.requests, public.request_logs, public.documents, public.spare_parts, public.vendors, public.part_tx from anon;
    revoke usage, select on all sequences in schema public from anon;
    revoke execute on function public.ensure_pmcal_jobs() from anon;
  end if;
  revoke select on public.pmcal_reminders from anon;
  return case when p_on then 'โหมดทดลอง: เปิด' else 'โหมดทดลอง: ปิด (ต้อง Login Microsoft 365)' end;
end $$;
-- เรียกได้เฉพาะใน SQL Editor (หน้าเว็บเรียกไม่ได้)
revoke execute on function public.capd_apply_trial(boolean) from public, anon, authenticated;
revoke execute on function public.trial_is_on() from public, anon, authenticated;

-- ผลลัพธ์: สถานะโหมดทดลอง + จำนวนผู้ใช้ที่เข้าระบบได้
select public.capd_apply_trial(public.trial_is_on()) as "สถานะ",
       (select count(*) from public.app_users where active) as "ผู้ใช้ที่เข้าระบบได้";

