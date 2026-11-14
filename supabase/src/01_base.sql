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
