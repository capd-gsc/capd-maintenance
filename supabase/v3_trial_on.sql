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
              or (schemaname = 'storage' and tablename = 'objects' and policyname in ('photos read','photos upload','docs read','docs write','docs delete')) loop
    execute format('alter policy %I on %I.%I to anon, authenticated', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
grant select, insert, update, delete on public.app_users, public.machines, public.requests, public.request_logs, public.documents to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on function public.ensure_pmcal_jobs() to anon;
