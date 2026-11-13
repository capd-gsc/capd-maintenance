# ตั้งค่าการแจ้งเตือน (อีเมล + Microsoft Teams)

ระบบแจ้งเตือนทำงานอย่างไร
- **ใบงานเปลี่ยนขั้น:** ฐานข้อมูลใส่เรื่องลงคิว พร้อมรายชื่อคนที่ต้องทำต่อ
- **Edge Function `notify`:** ส่งเรื่องในคิวออกไปทุก 1 นาที
  - **อีเมล:** ถึงคนที่ต้องทำต่อแต่ละคน
  - **Teams:** การ์ด 1 ใบต่อเรื่อง แยก 2 channel: งานซ่อม และ PM/CAL
- **ทุกเช้า 08:00 น.:**
  - เตือน PM/CAL ตามขั้น 90/60/30 วัน (อีเมล)
  - channel PM/CAL ได้สรุป PM/CAL และใบงาน PM/CAL ที่ค้างเกิน 3 วัน
  - channel งานซ่อมได้สรุปใบงานซ่อมที่ค้างเกิน 3 วัน

| เหตุการณ์ | แจ้งใคร |
|---|---|
| เปิดใบงานใหม่ | Foreman Day ของประเภทเครื่อง |
| FD ส่งกลับ | ผู้เปิดใบงาน |
| FD อนุมัติ Normal | Admin (แจ้งซ่อม SAP/K2) |
| Admin แจ้งซ่อมแล้ว | Foreman Day (รอสรุปผลและปิดงาน) |
| FD อนุมัติ Special / ระบบเปิดงาน PM/CAL | ผู้รับผิดชอบงาน |
| ส่ง MEMO / App ก่อนหน้าอนุมัติ | ผู้อนุมัติลำดับถัดไป |
| MEMO ถูกส่งกลับ | ผู้รับผิดชอบงาน |
| อนุมัติครบ | Admin (ออก PO) |
| ออก PO แล้ว | ผู้รับผิดชอบงาน (นัด Vendor และปิดงาน) |
| ปิดงาน / ยกเลิก | ผู้เปิดใบงาน (อีเมลอย่างเดียว ไม่โพสต์ Teams) |

- คนที่กดเองไม่ได้รับแจ้งเรื่องของตัวเอง
- Admin เอาติ๊ก **รับอีเมล** ออกให้บางคนได้ในเมนู **ผู้ใช้** (Teams ยังโพสต์ตามปกติ)

## ขั้นที่ 1: ฐานข้อมูล
1. ไปที่ SQL Editor ใน Supabase แล้วรัน `supabase/v3_3_cancel.sql` (ถ้ายังไม่ได้รัน)
2. รัน `supabase/v3_4_notify.sql`

ตั้งแต่ขั้นนี้ ระบบเริ่มเก็บเรื่องเข้าคิวแล้ว แต่ยังไม่ส่งจนกว่าจะทำขั้นที่ 4–5 เสร็จ

## ขั้นที่ 2: Teams (2 channel)
**สร้าง channel (ทำ 2 ครั้ง)**
1. ใน Teams เอาเมาส์ไปที่ Team ของแผนก (เช่น CaPD) แล้วกด **⋯ → Add channel**
2. ตั้งชื่อ เช่น `แจ้งซ่อม CAPD` (ครั้งที่ 2: `Cal Pm CAPD`)
3. ประเภท **Standard** → **Create**

**สร้างลิงก์รับการ์ด (ทำ 2 ครั้ง ครั้งละ channel)**
1. ไปที่ channel นั้น → **⋯ → Workflows**
2. ช่อง **Find templates** พิมพ์ `webhook` แล้วเลือก **Send webhook alerts to a channel** (บางเวอร์ชันชื่อ *Post to a channel when a webhook request is received*)
3. ตรวจว่า **Team** และ **Channel** ตรงกับ channel ที่ต้องการ → **Next / Add workflow**
4. คัดลอก **URL** ที่ได้
   - URL ของ channel งานซ่อม ใส่เป็น `TEAMS_WEBHOOK_URL`
   - URL ของ channel PM/CAL ใส่เป็น `TEAMS_WEBHOOK_URL_PMCAL`
   - **อย่าส่ง URL ในแชทหรืออีเมล** ใครมีก็โพสต์เข้า channel ได้ ถ้าหลุดไป ให้ลบ Workflow แล้วสร้างใหม่

**ข้อควรรู้**
- ถ้าไม่ตั้ง `TEAMS_WEBHOOK_URL_PMCAL` การ์ด PM/CAL จะไปที่ channel งานซ่อม
- การ์ดจะขึ้นในนามคนที่สร้าง Workflow ถ้าคนนั้นย้ายงานหรือถูกลบบัญชี Workflow จะหยุดทำงาน ควรให้บัญชีกลางของแผนกสร้าง
- ถ้าไม่เห็นเมนู Workflows แปลว่าบริษัทอาจปิดไว้ ให้ถาม IT

## ขั้นที่ 3: อีเมล (Brevo ฟรี 300 ฉบับ/วัน)
1. สมัครที่ brevo.com
2. ไปที่ **Senders, Domains & Dedicated IPs → Senders** เพิ่มและยืนยันอีเมลผู้ส่ง
3. ไปที่ **SMTP & API → API Keys** สร้าง API key (เก็บไว้ใส่ในขั้นที่ 4 เท่านั้น)

ข้อควรรู้เรื่องผู้ส่ง
- **ใช้ Gmail ส่วนตัวเป็นผู้ส่ง:** อีเมลมักเข้า Junk หรือถูกระบบอีเมลของบริษัทกันไว้ ให้ลองส่งจริงก่อน
- **ทางที่ดีกว่า:** ขอ IT ให้ส่งในนามโดเมนบริษัท (ยืนยันโดเมนใน Brevo) หรือขอ SMTP ของบริษัท
- **ถ้าอีเมลส่งไม่เข้า:** ใช้ Teams อย่างเดียวไปก่อนได้ ระบบรองรับการตั้งแค่ช่องทางเดียว

## ขั้นที่ 4: Edge Function
1. **สร้างฟังก์ชัน:** ใน Supabase ไปที่ **Edge Functions → Deploy a new function → Via Editor**
   - ตั้งชื่อ `notify`
   - วางโค้ดทั้งหมดจาก `supabase/functions/notify/single-file.ts` แล้วกด **Deploy**
2. **ปิดการตรวจ JWT:** เปิดฟังก์ชัน `notify` → **Details** → ปิด **Verify JWT** แล้วบันทึก
3. **ตั้ง Secrets:** ไปที่ **Edge Functions → Secrets** แล้วเพิ่ม
   | ชื่อ | ค่า |
   |---|---|
   | `CRON_SECRET` | ข้อความสุ่มยาวๆ ที่ตั้งเอง (ใช้อีกครั้งในขั้นที่ 5) |
   | `APP_URL` | `https://capd-gsc.github.io/capd-maintenance/` |
   | `TEAMS_WEBHOOK_URL` | URL ของ channel งานซ่อม (ขั้นที่ 2) |
   | `TEAMS_WEBHOOK_URL_PMCAL` | URL ของ channel PM/CAL (ขั้นที่ 2) |
   | `BREVO_API_KEY` | API key จากขั้นที่ 3 |
   | `MAIL_FROM` | อีเมลผู้ส่งที่ยืนยันแล้วในขั้นที่ 3 |

   ต้องมีอย่างน้อยหนึ่งช่องทาง: Teams อย่างเดียว อีเมลอย่างเดียว หรือทั้งคู่

## ขั้นที่ 5: ตั้งเวลา
1. ไปที่ **Database → Extensions** แล้วเปิด `pg_cron` และ `pg_net`
2. เปิด `supabase/schedule_notify.sql` แทน `<CRON_SECRET>` ทั้ง 2 จุดด้วยค่าเดียวกับขั้นที่ 4 แล้วรันใน SQL Editor
3. **ทดสอบ:** เปิดใบงานซ่อมใหม่ 1 ใบ ภายใน 1–2 นาที Foreman Day ควรได้อีเมล และการ์ดควรขึ้นใน channel งานซ่อม
   - การ์ด PM/CAL จะขึ้นเมื่อระบบเปิดใบงาน PM/CAL ให้ หรือในสรุปตอนเช้า

## ถ้าแจ้งเตือนไม่มา
ดูผลการส่งใน SQL Editor:
```sql
select id, request_id, event, recipients, sent_at, attempts, error from notify_queue order by id desc limit 20;
```
| สิ่งที่เห็น | สาเหตุ |
|---|---|
| `sent_at` ว่าง และ `attempts` = 0 | ฟังก์ชันยังไม่ทำงาน ให้ตรวจขั้นที่ 5 และค่า `CRON_SECRET` ให้ตรงกัน |
| `error` มี `email … 401` | `BREVO_API_KEY` ผิด |
| `error` มี `email … 400` | `MAIL_FROM` ยังไม่ได้ยืนยันใน Brevo |
| `error` มี `teams: 4xx` | URL ของ Workflow ผิดหรือถูกลบ |
| ส่งไม่สำเร็จ 5 ครั้ง | ระบบหยุดส่งเรื่องนั้นและเก็บข้อผิดพลาดไว้ |
