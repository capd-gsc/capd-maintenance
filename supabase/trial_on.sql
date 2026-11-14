-- =====================================================================
-- CAPD Maintenance — เปิดโหมดทดลอง (ก่อน IT ตั้งค่า Microsoft 365) · รันหลัง install.sql · รันซ้ำได้
-- * เข้าระบบด้วยการกรอกอีเมลในรายชื่อผู้ใช้ (ไม่มีรหัสผ่าน) คู่กับ TRIAL_LOGIN: true ใน js/config.js
-- * สิทธิ์และ Flow ทุกขั้นตรวจในฐานข้อมูลเหมือนของจริง
-- * ข้อเสีย: ใครรู้อีเมลคนอื่นก็เข้าในนามคนนั้นได้ ห้ามใส่ข้อมูลลับ
-- ปิดโหมดทดลอง: รัน trial_off.sql
-- =====================================================================
insert into public.app_settings values ('trial_login', 'on')
  on conflict (key) do update set value = excluded.value;
select public.capd_apply_trial(true) as "สถานะ";
