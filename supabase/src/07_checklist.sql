-- ===== 07 checklist: ตรวจเครื่องก่อนใช้งานประจำวัน · บทบาท "ผู้ใช้เครื่อง" (operator) =====
-- แบบฟอร์มตรวจ: รายการหัวข้อ [{"t":"ข้อความ","k":"ok"} | {"t":"…","k":"num","u":"bar","min":5,"max":7}]
create table if not exists public.checklist_templates (
  id          text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name        text not null,
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
-- เครื่องที่ต้องตรวจทุกวัน = เครื่องที่ผูกแบบฟอร์มไว้
alter table public.machines add column if not exists checklist_template text references public.checklist_templates(id) on delete set null;

-- ผลตรวจ: เครื่องละ 1 ครั้งต่อวัน (วันตามเวลาไทย)
create table if not exists public.checklist_runs (
  id             bigint generated always as identity primary key,
  machine_no     text not null references public.machines(machine_no) on delete cascade on update cascade,
  run_date       date not null default (now() at time zone 'Asia/Bangkok')::date,
  template_id    text,
  template_name  text,
  results        jsonb not null check (jsonb_typeof(results) = 'array'),   -- [{"t","k","ok":true|false,"v":number,"note"}]
  ng_count       int not null default 0,
  note           text,
  photos         text[] not null default '{}',
  actor          text not null default public.my_email(),
  created_at     timestamptz not null default now(),
  unique (machine_no, run_date)
);
create index if not exists checklist_runs_date on public.checklist_runs(run_date desc);

-- ผู้ตรวจ วันที่ และจำนวน NG มาจากฐานข้อมูลเสมอ (แก้จากหน้าเว็บไม่ได้)
create or replace function public.checklist_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.cur_any() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  if not exists (select 1 from public.machines where machine_no = new.machine_no and status <> 'Inactive') then
    raise exception 'ไม่พบเครื่อง % หรือเครื่องยกเลิกใช้งาน', new.machine_no;
  end if;
  if jsonb_array_length(new.results) = 0 then raise exception 'ต้องมีผลตรวจอย่างน้อย 1 ข้อ'; end if;
  if exists (select 1 from public.checklist_runs where machine_no = new.machine_no and run_date = (now() at time zone 'Asia/Bangkok')::date) then
    raise exception 'เครื่อง % ตรวจแล้ววันนี้', new.machine_no;
  end if;
  select count(*) into n from jsonb_array_elements(new.results) e where e->>'ok' = 'false';
  new.ng_count := n;
  new.actor := public.my_email();
  new.run_date := (now() at time zone 'Asia/Bangkok')::date;
  new.created_at := now();
  if exists (select 1 from unnest(new.photos) p where p not like 'checklists/%') then raise exception 'ที่เก็บรูปไม่ถูกต้อง'; end if;
  return new;
end $$;
drop trigger if exists checklist_guard on public.checklist_runs;
create trigger checklist_guard before insert on public.checklist_runs for each row execute function public.checklist_guard();

create or replace function public.checklist_tpl_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); new.updated_by := public.my_email(); return new; end $$;
drop trigger if exists checklist_tpl_stamp on public.checklist_templates;
create trigger checklist_tpl_stamp before insert or update on public.checklist_templates for each row execute function public.checklist_tpl_stamp();

-- ---------- RLS ----------
alter table public.checklist_templates enable row level security;
alter table public.checklist_runs enable row level security;
drop policy if exists ck_tpl_read on public.checklist_templates;
drop policy if exists ck_tpl_write on public.checklist_templates;
drop policy if exists ck_run_read on public.checklist_runs;
drop policy if exists ck_run_insert on public.checklist_runs;
drop policy if exists ck_run_delete on public.checklist_runs;
create policy ck_tpl_read   on public.checklist_templates for select to authenticated using (public.cur_any());
create policy ck_tpl_write  on public.checklist_templates for all    to authenticated using (public.cur_admin()) with check (public.cur_admin());
create policy ck_run_read   on public.checklist_runs for select to authenticated using (public.cur_any());
create policy ck_run_insert on public.checklist_runs for insert to authenticated with check (public.cur_any());
create policy ck_run_delete on public.checklist_runs for delete to authenticated using (public.cur_admin());
grant select, insert, update, delete on public.checklist_templates to authenticated;
grant select, insert, delete on public.checklist_runs to authenticated;

-- ผู้ใช้เครื่องอ่านรายชื่อเครื่อง รูปเครื่อง และชื่อผู้ใช้ได้ (ไม่เห็นใบงาน อะไหล่ เอกสาร)
drop policy if exists users_read_op on public.app_users;
drop policy if exists machines_read_op on public.machines;
drop policy if exists mphoto_read_op on public.machine_photos;
create policy users_read_op    on public.app_users for select to authenticated using (public.cur_any());
create policy machines_read_op on public.machines for select to authenticated using (public.cur_any());
create policy mphoto_read_op   on public.machine_photos for select to authenticated using (public.cur_any());
-- รูปประกอบผลตรวจ (เก็บที่ checklists/…)
drop policy if exists "checklist photos read" on storage.objects;
drop policy if exists "checklist photos upload" on storage.objects;
create policy "checklist photos read" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and public.cur_any() and (name like 'checklists/%' or name like 'machines/%'));
create policy "checklist photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and public.cur_any() and name like 'checklists/%');

-- ---------- แบบฟอร์มตัวอย่าง (เพิ่มเฉพาะที่ยังไม่มี · Admin แก้ได้ในหน้าเว็บ) ----------
insert into public.checklist_templates(id, name, items) values
('general', 'ทั่วไป', '[
  {"t":"สภาพภายนอกปกติ ไม่มีชิ้นส่วนแตกหักหรือหลวม","k":"ok"},
  {"t":"สายไฟ ปลั๊ก และสวิตช์ ไม่ชำรุด","k":"ok"},
  {"t":"ไม่มีเสียง กลิ่น หรือการสั่นผิดปกติ","k":"ok"},
  {"t":"ป้ายเตือนและอุปกรณ์ความปลอดภัยครบ","k":"ok"},
  {"t":"พื้นที่รอบเครื่องสะอาด ไม่มีสิ่งกีดขวาง","k":"ok"}]'::jsonb),
('extruder', 'เครื่องจักรผลิต (Extruder / Injection)', '[
  {"t":"ปุ่ม Emergency Stop ทำงานปกติ","k":"ok"},
  {"t":"ฝาครอบและการ์ดป้องกันครบ ปิดสนิท","k":"ok"},
  {"t":"ระดับน้ำมันเกียร์ / น้ำมันไฮดรอลิกอยู่ในเกณฑ์","k":"ok"},
  {"t":"แรงดันลม","k":"num","u":"bar","min":5,"max":7},
  {"t":"อุณหภูมิน้ำหล่อเย็น","k":"num","u":"°C","min":10,"max":30},
  {"t":"Heater ทุกโซนขึ้นถึงค่าที่ตั้ง","k":"ok"},
  {"t":"ไม่มีรอยรั่ว น้ำมัน น้ำ หรือลม","k":"ok"},
  {"t":"ไม่มีเสียงหรือการสั่นผิดปกติ","k":"ok"},
  {"t":"Cutter / ใบมีดอยู่ในสภาพดี","k":"ok"},
  {"t":"พื้นที่รอบเครื่องสะอาด ไม่มีสิ่งกีดขวาง","k":"ok"}]'::jsonb),
('testing', 'เครื่องทดสอบ', '[
  {"t":"สติกเกอร์ CAL ยังไม่หมดอายุ","k":"ok"},
  {"t":"ค่าแรงเมื่อไม่มีชิ้นงาน (Zero)","k":"num","u":"N","min":-1,"max":1},
  {"t":"Grip / ฟันจับสะอาด ไม่สึก","k":"ok"},
  {"t":"สายไฟและสายสัญญาณไม่ชำรุด","k":"ok"},
  {"t":"ปุ่ม Emergency Stop และฝาครอบนิรภัยทำงาน","k":"ok"},
  {"t":"โปรแกรมเชื่อมต่อเครื่องได้ปกติ","k":"ok"},
  {"t":"พื้นที่ทดสอบสะอาด","k":"ok"}]'::jsonb),
('aircon', 'แอร์ / Precision Air', '[
  {"t":"อุณหภูมิห้อง","k":"num","u":"°C","min":21,"max":25},
  {"t":"ความชื้นสัมพัทธ์","k":"num","u":"%RH","min":40,"max":60},
  {"t":"ไม่มี Alarm บนหน้าจอ","k":"ok"},
  {"t":"ไม่มีน้ำหยดหรือรั่ว","k":"ok"},
  {"t":"เสียงคอมเพรสเซอร์และพัดลมปกติ","k":"ok"},
  {"t":"แผ่นกรองไม่อุดตัน (ดูด้วยตา)","k":"ok"}]'::jsonb),
('hoist', 'เครน / Hoist', '[
  {"t":"ปุ่มกดทำงานครบทุกทิศทาง และ Emergency Stop ตัดได้","k":"ok"},
  {"t":"Limit switch บน–ล่าง ตัดการทำงานได้","k":"ok"},
  {"t":"ลวดสลิง / โซ่ ไม่ขาด ไม่บิดงอ ไม่เป็นสนิม","k":"ok"},
  {"t":"ตะขอและสลักกันหลุด (Safety latch) ปกติ","k":"ok"},
  {"t":"เบรกหยุดได้ทันที ไม่ไหลลง","k":"ok"},
  {"t":"ป้ายพิกัดยก (SWL) และสติกเกอร์ Load test ยังไม่หมดอายุ","k":"ok"}]'::jsonb)
on conflict (id) do nothing;
