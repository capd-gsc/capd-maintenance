-- =====================================================================
-- CAPD Maintenance — ปิดโหมดทดลอง (รันหลังเปิด Login Microsoft 365 แล้ว) · รันซ้ำได้
-- ข้อมูลที่กรอกไว้ระหว่างทดลองยังอยู่ครบ · ตั้ง TRIAL_LOGIN: false ใน js/config.js ด้วย
-- =====================================================================
insert into public.app_settings values ('trial_login', 'off')
  on conflict (key) do update set value = excluded.value;
select public.capd_apply_trial(false) as "สถานะ";
