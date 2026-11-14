// ===== ตั้งค่าการเชื่อมต่อ Supabase =====
// Publishable key ใส่ในหน้าเว็บได้ (ห้ามใส่ Secret key)
window.APP_CONFIG = {
  SUPABASE_URL: 'https://dymnbigvcbthxumrijsb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_8UUUlNDvS7-3PB88i0D0vg_nOvhhjJ9',
  ALLOWED_DOMAIN: 'scg.com',
  APP_NAME: 'CAPD Maintenance',
  ORG: 'GSC · SCGC',
  // ทางสำรองระหว่างรอ IT ตั้งค่า Microsoft 365: true = แสดงช่อง "รับรหัสทางอีเมล" (ต้องเปิด Email provider + ตั้ง SMTP ใน Supabase)
  EMAIL_OTP: false,
  // โหมดทดลอง: true = เข้าด้วยการกรอกอีเมลอย่างเดียว (ต้องรัน supabase/trial_on.sql) · ใช้จริงแล้วเปลี่ยนเป็น false และรัน trial_off.sql
  TRIAL_LOGIN: true
};
