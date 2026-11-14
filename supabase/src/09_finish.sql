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
