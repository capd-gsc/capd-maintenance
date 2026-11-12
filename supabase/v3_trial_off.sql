-- =====================================================================
-- CAPD Maintenance v3 — ปิดโหมดทดลอง (รันหลังเปิด Login Microsoft 365 แล้ว)
-- ข้อมูลที่ทดลองกรอกไว้ยังอยู่ครบ · ถ้าต้องการล้างข้อมูลทดลอง ดู README
-- =====================================================================
create table if not exists public.app_settings (key text primary key, value text);
alter table public.app_settings enable row level security;
insert into public.app_settings values ('trial_login', 'off')
  on conflict (key) do update set value = excluded.value;

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where (schemaname = 'public' and tablename in ('app_users','role_presets','machines','requests','request_logs','documents'))
              or (schemaname = 'storage' and tablename = 'objects' and policyname in ('photos read','photos upload','photos delete','docs read','docs write','docs delete')) loop
    execute format('alter policy %I on %I.%I to authenticated', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;
revoke insert, update, delete on public.app_users, public.machines, public.requests, public.request_logs, public.documents from anon;
revoke select on public.app_users, public.requests, public.request_logs, public.documents from anon;
revoke execute on function public.ensure_pmcal_jobs() from anon;
