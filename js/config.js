// ===== ตั้งค่าการเชื่อมต่อ Supabase =====
// นำค่าจาก Supabase Dashboard → Project Settings → API Keys → Publishable key (sb_publishable_...) มาใส่
// Publishable key ใส่ในหน้าเว็บได้ปลอดภัย เพราะสิทธิ์ถูกควบคุมด้วย Row Level Security ในฐานข้อมูล
window.APP_CONFIG = {
  SUPABASE_URL: 'https://dymnbigvcbthxumrijsb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_8UUUlNDvS7-3PB88i0D0vg_nOvhhjJ9',
  ALLOWED_DOMAIN: 'scg.com',
  // โหมดทดลอง: true = พิมพ์อีเมล @scg.com แล้วเข้าได้ทันที ไม่ส่งอีเมลยืนยัน (ไม่ปลอดภัย ใช้ทดลองเท่านั้น)
  //            false = ส่งรหัส/ลิงก์ยืนยันทางอีเมล (ต้องตั้ง SMTP)
  TRIAL_EMAIL_ONLY: true,
  // ไม่มี Login เลย: เลือกชื่อผู้ใช้จากรายการแล้วใช้งานได้ทันที (ต้องรัน supabase/trial_open_access.sql)
  // ⚠ ใครมีลิงก์เว็บ อ่าน/แก้/ลบข้อมูลได้ทั้งหมด ใช้ทดลองเท่านั้น
  NO_LOGIN: true,
  // เปิดปุ่ม "Sign in with Microsoft" เมื่อ IT ทำ App Registration ให้แล้ว (ดู README)
  ENABLE_MICROSOFT_LOGIN: false,
  APP_NAME: 'CAPD Maintenance',
  ORG: 'GSC · SCGC'
};
