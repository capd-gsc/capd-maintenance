-- =====================================================================
-- CAPD Maintenance (GSC) — Supabase schema
-- วิธีใช้: Supabase Dashboard → SQL Editor → New query → วางทั้งไฟล์ → Run
-- รันซ้ำได้ (idempotent) ยกเว้นข้อมูลที่ผู้ใช้กรอกไว้จะไม่ถูกลบ
-- =====================================================================

-- ---------- 0. ตั้งค่าโดเมนอีเมลที่อนุญาต ----------
create or replace function public.allowed_domain() returns text
language sql immutable as $$ select 'scg.com' $$;

-- ---------- 1. ผู้ใช้และบทบาท ----------
do $$ begin
  create type public.app_role as enum ('reporter','tech','approver','admin');
exception when duplicate_object then null; end $$;

-- รายชื่อที่กำหนดบทบาทไว้ล่วงหน้า (ก่อนผู้ใช้ Login ครั้งแรก)
create table if not exists public.role_presets (
  email text primary key,
  role  public.app_role not null
);
-- รายชื่อผู้ใช้ไม่เก็บใน GitHub · v3 ใช้ตาราง app_users (ดู v3_auth.sql)

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       public.app_role not null default 'reporter',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- helper: อีเมลของผู้ใช้ปัจจุบัน / ตรวจโดเมน / บทบาท
create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_email() like '%@' || public.allowed_domain()
     and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
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

-- สร้างโปรไฟล์อัตโนมัติเมื่อ Login ครั้งแรก
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name, role)
  values (new.id, lower(new.email), split_part(new.email,'@',1),
          coalesce((select role from public.role_presets where email = lower(new.email)), 'reporter'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ผู้ใช้แก้ชื่อตัวเองได้ แต่เปลี่ยนบทบาท/สถานะได้เฉพาะ Admin
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active
      or new.email is distinct from old.email)
     and coalesce(public.my_role()::text,'') <> 'admin' then
    raise exception 'เฉพาะ Admin เท่านั้นที่เปลี่ยนบทบาทได้';
  end if;
  return new;
end $$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

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

-- ตรวจสิทธิ์การเปลี่ยนสถานะ (workflow) ฝั่งฐานข้อมูล
create or replace function public.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r   text := coalesce(public.my_role()::text, '');
  me  text := public.my_email();
  ok  boolean := false;
begin
  if tg_op = 'INSERT' then
    new.reporter := me;
    new.status   := 'pending_approval';
    if new.technician is null then
      select responsibility into new.technician from public.machines where machine_no = new.machine_no;
    end if;
    return new;
  end if;

  new.updated_at := now();
  -- ฟิลด์ที่ห้ามแก้หลังแจ้ง
  if new.reporter is distinct from old.reporter or new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'ไม่สามารถแก้ไขผู้แจ้งหรือเลขที่ใบแจ้งซ่อมได้';
  end if;

  if r = 'admin' then return new; end if;
  if new.status = old.status then
    -- อัปเดตข้อมูลโดยไม่เปลี่ยนสถานะ: ช่างของงาน หรือ ผู้อนุมัติ (ตอนยังไม่อนุมัติ)
    if me = old.technician or (r = 'approver' and old.status = 'pending_approval') then return new; end if;
    raise exception 'ไม่มีสิทธิ์แก้ไขใบแจ้งซ่อมนี้';
  end if;

  ok := case
    when old.status = 'pending_approval' and new.status in ('queued','rejected') then r = 'approver'
    when old.status = 'queued'        and new.status = 'in_progress'               then me = old.technician
    when old.status = 'in_progress'   and new.status in ('waiting_parts','testing') then me = old.technician
    when old.status = 'waiting_parts' and new.status in ('in_progress','testing')   then me = old.technician
    when old.status = 'testing'       and new.status in ('waiting_confirm','in_progress') then me = old.technician
    when old.status = 'waiting_confirm' and new.status in ('closed','in_progress')  then me = old.reporter
    else false end;

  if not ok then
    raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะจาก % เป็น %', old.status, new.status;
  end if;
  if new.technician is distinct from old.technician and r <> 'approver' then
    raise exception 'เฉพาะผู้อนุมัติหรือ Admin ที่มอบหมายช่างได้';
  end if;
  return new;
end $$;

drop trigger if exists guard_request on public.requests;
create trigger guard_request before insert or update on public.requests
  for each row execute function public.guard_request();

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

-- ---------- 5. Row Level Security ----------
alter table public.role_presets  enable row level security;
alter table public.profiles      enable row level security;
alter table public.machines      enable row level security;
alter table public.requests      enable row level security;
alter table public.request_logs  enable row level security;
alter table public.documents     enable row level security;

drop policy if exists presets_admin on public.role_presets;
create policy presets_admin on public.role_presets for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.is_member());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');

drop policy if exists machines_read on public.machines;
create policy machines_read on public.machines for select to authenticated using (public.is_member());
drop policy if exists machines_write on public.machines;
create policy machines_write on public.machines for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated using (public.is_member());
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated with check (public.is_member());
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated using (public.is_member());
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated using (public.my_role() = 'admin');

drop policy if exists logs_read on public.request_logs;
create policy logs_read on public.request_logs for select to authenticated using (public.is_member());
drop policy if exists logs_insert on public.request_logs;
create policy logs_insert on public.request_logs for insert to authenticated
  with check (public.is_member() and actor = public.my_email());

drop policy if exists docs_read on public.documents;
create policy docs_read on public.documents for select to authenticated
  using (public.is_member() and (not restricted or public.my_role() in ('admin','approver')));
drop policy if exists docs_write on public.documents;
create policy docs_write on public.documents for all to authenticated
  using (public.my_role() in ('admin','approver')) with check (public.my_role() in ('admin','approver'));

-- ---------- 6. Storage (รูปแจ้งซ่อม + ไฟล์เอกสาร) ----------
insert into storage.buckets (id, name, public) values
  ('request-photos','request-photos', false),
  ('documents','documents', false)
on conflict (id) do nothing;

drop policy if exists "photos read"  on storage.objects;
create policy "photos read" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and public.is_member());
drop policy if exists "photos upload" on storage.objects;
create policy "photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and public.is_member());

-- ไฟล์ในโฟลเดอร์ restricted/ เปิดได้เฉพาะ Admin / ผู้อนุมัติ
drop policy if exists "docs read" on storage.objects;
create policy "docs read" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member()
         and (name not like 'restricted/%' or public.my_role() in ('admin','approver')));
drop policy if exists "docs write" on storage.objects;
create policy "docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.my_role() in ('admin','approver'));
drop policy if exists "docs delete" on storage.objects;
create policy "docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.my_role() in ('admin','approver'));

-- ---------- 7. Realtime (หน้าจอทุกคนอัปเดตทันที) ----------
do $$ begin
  alter publication supabase_realtime add table public.requests;
exception when others then null; end $$;
