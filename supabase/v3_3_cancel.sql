-- =====================================================================
-- CAPD Maintenance v3.3 — ยกเลิกใบงาน (เก็บประวัติไว้ แทนการลบ)
-- รันครั้งเดียวใน SQL Editor (ฐานข้อมูลที่ติดตั้งไว้แล้ว) · รันซ้ำได้
-- =====================================================================
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
  -- ส่ง MEMO แล้ว ใบเสนอราคาและ MEMO ถูกล็อก (แก้ได้อีกเมื่อถูกส่งกลับ หรือโดย Admin)
  if old.status in ('memo_approval','po_vendor','closed') and (
       new.quotes is distinct from old.quotes or new.memo_doc is distinct from old.memo_doc
    or new.vendor is distinct from old.vendor or new.quotation_amount is distinct from old.quotation_amount
    or new.memo_no is distinct from old.memo_no or new.memo_approvers is distinct from old.memo_approvers
    or new.select_reason is distinct from old.select_reason) then
    raise exception 'ใบเสนอราคาและ MEMO ถูกล็อกหลังส่งอนุมัติแล้ว';
  end if;

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
    -- ยกเลิกใบงาน (ต้องมีเหตุผล): Admin ทุกสถานะที่ยังเปิด · ผู้เปิดใบงานเฉพาะก่อน FD อนุมัติ
    when new.status = 'cancelled' and old.status not in ('closed','cancelled')     then coalesce(btrim(new.return_note), '') <> '' and (adm or (me = old.reporter and old.status in ('pending_fd','returned')))
    when old.status = 'po_vendor'     and new.status = 'closed'                       then (me = old.assignee or adm or public.can_fd(old.machine_no)) and coalesce(new.po_no, '') <> ''
    else false end;
  if not ok then raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะจาก % เป็น %', old.status, new.status; end if;

  -- บันทึกผู้ทำรายการจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาจากหน้าเว็บ
  if old.status = 'pending_fd' and new.status <> 'returned' then new.approved_by := me; new.approved_at := now(); end if;
  if new.status = 'closed' then new.closed_by := me; new.end_at := coalesce(new.end_at, now()); end if;
  if new.status = 'cancelled' then new.closed_by := me; end if;
  -- ส่ง MEMO: Vendor และราคาในใบงานมาจากใบเสนอราคาที่เลือก · ผู้ขออนุมัติและวันที่บันทึกโดยระบบ
  if new.status = 'memo_approval' and old.status <> 'memo_approval' then
    if jsonb_array_length(coalesce(new.quotes, '[]')) > 0 then
      new.vendor := null;
      select x ->> 'vendor', (x ->> 'amount')::numeric into new.vendor, new.quotation_amount
        from jsonb_array_elements(new.quotes) x where coalesce((x ->> 'chosen')::boolean, false) limit 1;
      if new.vendor is null then raise exception 'เลือกใบเสนอราคาที่จะใช้'; end if;
    end if;
    if new.memo_doc is not null then
      new.memo_doc := new.memo_doc || jsonb_build_object('from', me, 'date', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'));
    end if;
  end if;
  if old.status = 'memo_approval' and new.status = 'po_vendor' and old.memo_step + 1 < coalesce(array_length(old.memo_approvers, 1), 0) then
    raise exception 'ยังมีผู้อนุมัติลำดับถัดไป';
  end if;
  return new;
end $$;
drop trigger if exists guard_request on public.requests;
create trigger guard_request before insert or update on public.requests
  for each row execute function public.guard_request();
