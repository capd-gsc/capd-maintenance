# ชุดทดสอบ CAPD Maintenance

ทดสอบระบบจริงทั้งชุด โดยไม่แตะ Supabase จริง
- **ฐานข้อมูล:** รันไฟล์ `supabase/*.sql` ชุดเดียวกับที่ใช้จริง บน PostgreSQL ชั่วคราว (กฎสิทธิ์ RLS และ trigger ทำงานเหมือนของจริง)
- **หน้าเว็บ:** เปิด `index.html` จริงใน Chromium
- **ตัวกลาง:** ตัวจำลอง supabase-js (`lib/client.js`) ส่งทุกคำสั่งไปรันในฐานข้อมูลชั่วคราวในนามผู้ใช้ที่ Login อยู่

ข้อมูลทดสอบเป็นข้อมูลสมมติทั้งหมด: ผู้ใช้ `user01@scg.com` ถึง `user21@scg.com` มีบทบาทเหมือนทีมจริง และไฟล์ PDF ก็เป็นไฟล์ปลอม

## สิ่งที่ต้องมี
- Node.js 18 ขึ้นไป
- PostgreSQL 14 ขึ้นไป ที่ผู้ใช้สร้าง/ลบฐานข้อมูลได้ (ระบบจะสร้างฐาน `capd_test` ใหม่ทุกชุด)
- Playwright + Chromium: `npm i -g playwright` แล้ว `npx playwright install chromium`

## วิธีรัน
```bash
cd tests
npm install
PGHOST=localhost PGPORT=5432 PGUSER=postgres node run-all.js
```
รันเฉพาะบางชุด: `node run-all.js quotes` (ใส่บางส่วนของชื่อชุด)

## ชุดทดสอบ
| ชุด | ตรวจอะไร |
|---|---|
| `sql-guard` | ฐานข้อมูลกันการทำข้ามสิทธิ์ 14 กรณี |
| `01-main-flow` | Login, Flow Normal / Special / PM-CAL, หน้าผู้ใช้, นำเข้า Excel, Dashboard เครื่อง |
| `02-trial-login` | โหมดทดลอง และการปิดโหมดทดลอง |
| `03-edit-delete-job` | แก้ไข / ลบใบงาน |
| `04-delete-machine` | ลบเครื่อง หรือเปลี่ยนเป็น Inactive |
| `05-vendor-import-export` | คอลัมน์ Vendor / Supplier, Export แล้วนำเข้ากลับ |
| `06-quotes-memo` | เทียบราคา 3 ใบ, MEMO, อนุมัติตามลำดับ, การล็อกหลังส่ง |
| `07-attachments` | ลบไฟล์แนบตามสิทธิ์ |
| `08-layout` | หน้าตามือถือ / คอมพิวเตอร์, เมนูล่าง, ธีมมืด, ตัวสแกน QR (ทางสำรอง) |
| `09-cancel-backup-refresh` | ยกเลิกใบงาน, สำรองข้อมูล, รีเฟรชอัตโนมัติ |
| `10-notify` | คิวแจ้งเตือนทุกขั้น, ข้อความอีเมล/Teams, สรุปรายวัน, ลิงก์ ?job= |
| `11-flow-hold-downtime` | ค้นหาเครื่อง, เวลาเครื่องหยุด → Downtime, พักงาน (รออะไหล่) และสิทธิ์ |

ผลการรันและภาพหน้าจออยู่ใน `tests/out/` (ไม่ขึ้น GitHub)

## เมื่อแก้ระบบ
1. รัน `node run-all.js` ก่อน push ทุกครั้ง
2. ถ้าเปลี่ยนหน้าตาหรือ Flow จนชุดทดสอบเดิมไม่ตรง ให้แก้ชุดทดสอบให้ตรงกับพฤติกรรมใหม่ ไม่ใช่ลบชุดทดสอบนั้นทิ้ง
3. เพิ่มเลขเวอร์ชันด้วย `sh tools/bump-version.sh` ก่อนขึ้นเว็บ
