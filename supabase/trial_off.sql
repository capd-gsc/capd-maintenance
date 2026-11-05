-- ปิดโหมดทดลอง (ไม่มี Login) แล้วกลับไปใช้สิทธิ์ตาม Login
-- ขั้นตอน: 1) รันไฟล์นี้  2) รัน schema.sql ซ้ำ (คืนค่าการตรวจ workflow)  3) ตั้ง NO_LOGIN: false ใน js/config.js
do $$
declare t text;
begin
  foreach t in array array['role_presets','machines','requests','request_logs','documents'] loop
    execute format('drop policy if exists trial_anon_all on public.%I', t);
  end loop;
end $$;
drop policy if exists "trial anon files" on storage.objects;
revoke insert, update, delete on public.role_presets, public.machines, public.requests,
  public.request_logs, public.documents from anon;
