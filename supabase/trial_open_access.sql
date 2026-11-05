-- =====================================================================
-- โหมดทดลอง: ไม่มี Login (ใช้คู่กับ NO_LOGIN: true ใน js/config.js)
-- รันไฟล์นี้ใน SQL Editor หลังจากรัน schema.sql แล้ว
--
-- ⚠ ใครที่รู้ลิงก์เว็บ อ่าน/แก้/ลบ ข้อมูลได้ทั้งหมด — ใช้ทดลองเท่านั้น ห้ามใส่ข้อมูลลับ
-- เลิกโหมดทดลอง: รัน trial_off.sql แล้วรัน schema.sql ซ้ำ
-- =====================================================================

-- รายชื่อผู้ใช้ในโหมดทดลอง = ตาราง role_presets (เพิ่มชื่อที่แสดง)
alter table public.role_presets add column if not exists full_name text;

-- workflow แบบผ่อนปรน: ไม่ตรวจสิทธิ์ตามบทบาท (หน้าเว็บเป็นผู้ควบคุมปุ่มแทน)
create or replace function public.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'pending_approval';
    if new.technician is null then
      select responsibility into new.technician from public.machines where machine_no = new.machine_no;
    end if;
    return new;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- เปิดสิทธิ์ให้ผู้ใช้ที่ไม่ได้ Login (role anon)
grant select, insert, update, delete on public.role_presets, public.machines, public.requests,
  public.request_logs, public.documents to anon;
grant usage, select on all sequences in schema public to anon;

do $$
declare t text;
begin
  foreach t in array array['role_presets','machines','requests','request_logs','documents'] loop
    execute format('drop policy if exists trial_anon_all on public.%I', t);
    execute format('create policy trial_anon_all on public.%I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

drop policy if exists "trial anon files" on storage.objects;
create policy "trial anon files" on storage.objects for all to anon
  using (bucket_id in ('request-photos','documents'))
  with check (bucket_id in ('request-photos','documents'));
