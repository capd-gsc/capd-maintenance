# คำขอตั้งค่า Login ด้วย Microsoft 365 (สำหรับ IT)

ระบบ **CAPD Maintenance** ของแผนก CAPD (GSC · SCGC) ต้องการให้พนักงานเข้าระบบด้วยบัญชี Microsoft 365 ของบริษัท (@scg.com)

| รายการ | ค่า |
|---|---|
| หน้าเว็บ | https://phatphisut2011-svg.github.io/capd-maintenance/ |
| ระบบยืนยันตัวตน | Supabase Auth (Azure provider) |
| ผู้ใช้ | พนักงานแผนก CAPD ประมาณ 20–30 คน ที่ Admin ของระบบเพิ่มรายชื่อไว้ |
| สิทธิ์ที่ขอ | เฉพาะการ Login (`openid`, `email`, `profile`, `User.Read`) ไม่อ่านอีเมล ไฟล์ หรือปฏิทิน |

## ขอให้ IT ทำ (Microsoft Entra ID)

1. **สร้าง App registration**
   - ไปที่ **Microsoft Entra admin center → Applications → App registrations → New registration**
   - Name: `CAPD Maintenance`
   - Supported account types: **Accounts in this organizational directory only (Single tenant)**
   - Redirect URI: เลือก **Web** แล้วใส่
     ```
     https://dymnbigvcbthxumrijsb.supabase.co/auth/v1/callback
     ```
2. **สร้าง Client secret**
   - ไปที่ **Certificates & secrets → New client secret**
   - คัดลอกช่อง **Value** (แสดงครั้งเดียว)
3. **ตั้งค่า Token configuration**
   - ไปที่ **Token configuration → Add optional claim → ID**
   - ติ๊ก `email` และ `xms_edov`
   - Supabase ใช้ `xms_edov` ตรวจว่าอีเมลยืนยันแล้ว
4. **ตั้งค่า API permissions**
   - ตรวจว่ามี **Microsoft Graph (Delegated):** `openid`, `email`, `profile`, `User.Read`
   - กด **Grant admin consent** ถ้านโยบายบริษัทกำหนดให้ต้องทำ
5. **(ถ้าต้องการจำกัดผู้ใช้ที่ฝั่ง IT)**
   - ไปที่ **Enterprise applications → CAPD Maintenance → Properties**
   - ตั้ง **Assignment required = Yes**
   - เพิ่มกลุ่มพนักงาน CAPD ใน **Users and groups**

## ส่งกลับให้ผู้ดูแลระบบ CAPD

| ค่า | ส่งอย่างไร |
|---|---|
| Application (client) ID | ส่งทางอีเมลได้ |
| Directory (tenant) ID | ส่งทางอีเมลได้ |
| Client secret **Value** | **ห้ามส่งทางอีเมลหรือแชท** ให้ IT กรอกเองใน Supabase หรือส่งผ่านช่องทางลับของบริษัท |
| วันหมดอายุของ secret | แจ้งไว้ เพื่อต่ออายุก่อนหมด (หมดแล้ว Login ไม่ได้) |

## ผู้ดูแลระบบ CAPD ทำต่อ (Supabase)

1. **ตั้งค่า Azure provider**
   - ไปที่ **Supabase → Authentication → Sign In / Providers → Azure** แล้วเปิด **Enable**
   - **Application (client) ID** = client ID
   - **Secret Value** = client secret Value
   - **Azure Tenant URL** = `https://login.microsoftonline.com/<Directory (tenant) ID>`
   - กด **Save**
2. **ตั้งค่า URL Configuration**
   - ไปที่ **Authentication → URL Configuration**
   - **Site URL** = `https://phatphisut2011-svg.github.io/capd-maintenance/`
   - **Redirect URLs:** เพิ่ม `https://phatphisut2011-svg.github.io/capd-maintenance/**`
3. **ตั้งค่าการสมัครผู้ใช้**
   - ที่ **Authentication → Sign In / Providers** ต้องเปิด **Allow new users to sign up**
   - ผู้ใช้ Microsoft จะถูกสร้างอัตโนมัติตอน Login ครั้งแรก
   - ฐานข้อมูลยังกันอีเมลที่ไม่ใช่ @scg.com และอีเมลที่ไม่มีในรายชื่อผู้ใช้ของระบบ
4. **ทดสอบ:** เปิดหน้าเว็บ กด **เข้าสู่ระบบด้วย Microsoft 365** แล้ว Login ด้วยบัญชีที่อยู่ในรายชื่อผู้ใช้

## ความปลอดภัย

- **การยืนยันตัวตน:** หน้าเว็บไม่เห็นรหัสผ่าน การ Login ทำที่หน้าของ Microsoft ทั้งหมด
- **การตรวจสิทธิ์:** ฐานข้อมูลตรวจสิทธิ์ทุกครั้ง (Row Level Security และ trigger) แม้มีคนแก้โค้ดหน้าเว็บก็ข้ามขั้นอนุมัติไม่ได้
- **ข้อมูลที่เก็บ:** เฉพาะอีเมล ชื่อ และข้อมูลงานซ่อมบำรุง
