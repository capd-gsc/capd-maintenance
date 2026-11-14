-- =====================================================================
-- CAPD Maintenance v3.1 — แก้ไข / ลบใบงานในหน้าเว็บ
-- รันครั้งเดียวใน SQL Editor (สำหรับฐานข้อมูลที่ติดตั้ง setup_v3_trial.sql ไปแล้ว) · รันซ้ำได้
-- =====================================================================
create or replace function public.only_report_fields_changed(o public.requests, n public.requests) returns boolean
language sql immutable as $$
  select (to_jsonb(n) - array['machine_no','symptom','first_fix','urgency','attachments','technician','updated_at'])
       = (to_jsonb(o) - array['machine_no','symptom','first_fix','urgency','attachments','technician','updated_at'])
$$;

create or replace function public.guard_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me  text := public.my_email();
  r   text := coalesce(public.cur_role(), '');
  adm boolean := public.cur_admin();
  sys boolean := coalesce(current_setting('capd.system', true), '') = '1';
  ok  boolean := false;
  step_app text;
begin
  if tg_op = 'INSERT' then
    if sys then return new; end if;                                   -- ใบงาน PM/CAL ที่ระบบเปิดเอง
    if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
    if r = 'manager' and not adm then raise exception 'Manager ไม่ได้เปิดใบงาน'; end if;
    new.reporter := me;
    if new.status = 'closed' then
      if new.job_type is distinct from 'self_fix' then raise exception 'ปิดงานทันทีได้เฉพาะงานแก้ไขเอง'; end if;
      new.closed_by := me; new.end_at := coalesce(new.end_at, now());
    else
      new.status := 'pending_fd'; new.job_type := null;
    end if;
    if new.technician is null then
      select responsibility into new.technician from public.machines where machine_no = new.machine_no;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id or new.reporter is distinct from old.reporter or new.created_at is distinct from old.created_at then
    raise exception 'แก้เลขที่ ผู้เปิด หรือวันที่เปิดใบงานไม่ได้';
  end if;
  new.updated_at := now();
  if sys or adm and new.status = old.status and new.memo_step = old.memo_step then return new; end if;
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  step_app := old.memo_approvers[old.memo_step + 1];

  if new.status = old.status then
    -- อัปเดตข้อมูลโดยไม่เปลี่ยนขั้น
    ok := case old.status
      -- ผู้เปิดใบงานแก้ข้อมูลแจ้งซ่อมได้ จนกว่า FD จะอนุมัติ (ช่องอื่นต้องไม่เปลี่ยน)
      when 'pending_fd'    then me = old.reporter and public.only_report_fields_changed(old, new)
      when 'returned'      then me = old.reporter and public.only_report_fields_changed(old, new)
      when 'memo_approval' then me = step_app and new.memo_step = old.memo_step + 1 and new.memo_step < coalesce(array_length(old.memo_approvers, 1), 0)
      when 'quotation'     then me = old.assignee or r = 'foreman_day'
      when 'memo_rejected' then me = old.assignee or r = 'foreman_day'
      when 'po_vendor'     then (me = old.assignee or public.can_fd(old.machine_no)) and new.po_no is not distinct from old.po_no
      else false end;
    if not ok then raise exception 'ไม่มีสิทธิ์แก้ไขใบงานนี้ในขั้นตอนนี้'; end if;
    return new;
  end if;

  ok := case
    when old.status = 'pending_fd'    and new.status in ('wait_admin','quotation','returned') then public.can_fd(old.machine_no)
    when old.status = 'returned'      and new.status in ('pending_fd','closed')       then me = old.reporter or adm or r in ('foreman_shift','foreman_day')
    when old.status = 'wait_admin'    and new.status = 'ext_repair'                   then adm
    when old.status = 'ext_repair'    and new.status = 'closed'                       then public.can_fd(old.machine_no)
    when old.status in ('quotation','memo_rejected') and new.status = 'memo_approval' then me = old.assignee or adm or r = 'foreman_day'
    when old.status = 'memo_approval' and new.status in ('po_vendor','memo_rejected') then me = step_app
    when old.status = 'po_vendor'     and new.status = 'closed'                       then (me = old.assignee or adm or public.can_fd(old.machine_no)) and coalesce(new.po_no, '') <> ''
    else false end;
  if not ok then raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะจาก % เป็น %', old.status, new.status; end if;

  -- บันทึกผู้ทำรายการจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ
  if old.status = 'pending_fd' and new.status <> 'returned' then new.approved_by := me; new.approved_at := now(); end if;
  if new.status = 'closed' then new.closed_by := me; new.end_at := coalesce(new.end_at, now()); end if;
  if old.status = 'memo_approval' and new.status = 'po_vendor' and old.memo_step + 1 < coalesce(array_length(old.memo_approvers, 1), 0) then
    raise exception 'ยังมีผู้อนุมัติลำดับถัดไป';
  end if;
  return new;
end $$;
drop trigger if exists guard_request on public.requests;
create trigger guard_request before insert or update on public.requests
  for each row execute function public.guard_request();

-- Admin ลบไฟล์แนบของใบงานได้ (ใช้ตอนลบใบงาน)
drop policy if exists "photos delete" on storage.objects;
create policy "photos delete" on storage.objects for delete to authenticated using (bucket_id = 'request-photos' and public.cur_admin());
create or replace function public.trial_is_on() returns boolean language plpgsql stable as $$
begin return coalesce((select value from public.app_settings where key = 'trial_login') = 'on', false);
exception when undefined_table then return false; end $$;
do $$ begin
  if public.trial_is_on() then
    alter policy "photos delete" on storage.objects to anon, authenticated;   -- โหมดทดลองเปิดอยู่
  end if;
end $$;
