// ===== ตั้งค่าการเชื่อมต่อ Supabase =====
// นำค่าจาก Supabase Dashboard → Project Settings → API มาใส่
// anon key ใส่ในหน้าเว็บได้ปลอดภัย เพราะสิทธิ์ถูกควบคุมด้วย Row Level Security ในฐานข้อมูล
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  ALLOWED_DOMAIN: 'scg.com',
  // เปิดปุ่ม "Sign in with Microsoft" เมื่อ IT ทำ App Registration ให้แล้ว (ดู README)
  ENABLE_MICROSOFT_LOGIN: false,
  APP_NAME: 'CAPD Maintenance',
  ORG: 'GSC · SCGC'
};
