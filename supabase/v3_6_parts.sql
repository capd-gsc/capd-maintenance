-- =====================================================================
-- CAPD Maintenance v3.6 — คลังอะไหล่ + Vendor + คำขอซื้อ
-- รันครั้งเดียวใน SQL Editor หลัง v3_5_flow.sql · รันซ้ำได้
-- * ยอดคงเหลือเปลี่ยนได้ทางเดียว: บันทึกรับ / เบิก / ปรับยอด (part_tx) · ติดลบไม่ได้
-- * คำขอซื้อ = ใบงานประเภท purchase: FD อนุมัติ → ใบเสนอราคา/MEMO → PO → รับของเข้าคลัง → ปิดงาน
-- =====================================================================

-- ---------- ตาราง ----------
create table if not exists public.spare_parts (
  part_no     text primary key,
  name        text not null,
  spec        text,
  unit        text not null default 'ชิ้น',
  stock       numeric not null default 0 check (stock >= 0),
  min_qty     numeric,
  max_qty     numeric,
  location    text,
  unit_price  numeric,
  lead_days   int,
  machines    text[] not null default '{}',   -- ใช้กับเครื่องไหนบ้าง
  vendor      text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create table if not exists public.part_tx (
  id          bigint generated always as identity primary key,
  part_no     text not null references public.spare_parts(part_no) on update cascade,
  qty         numeric not null check (qty <> 0),           -- + รับเข้า · − เบิกออก
  kind        text not null check (kind in ('opening','receive','issue','adjust')),
  request_id  text references public.requests(id) on delete set null,
  unit_price  numeric,
  note        text,
  actor       text not null default public.my_email(),
  at          timestamptz not null default now()
);
create index if not exists part_tx_part on public.part_tx(part_no, at desc);
alter table public.part_tx add column if not exists machine_no text references public.machines(machine_no) on update cascade on delete set null;   -- เบิกใช้กับเครื่องไหน
create table if not exists public.vendors (
  name           text primary key,
  contact_person text, phone text, email text, other_contact text,
  machines       text[] not null default '{}',
  work_type      text, note text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- คำขอซื้อ: ไม่จำเป็นต้องผูกกับเครื่อง + รายการที่ขอซื้อ
alter table public.requests alter column machine_no drop not null;
alter table public.requests add column if not exists items jsonb;   -- [{part_no?, name, qty, unit, recv?, stocked?}]
alter table public.requests drop constraint if exists requests_job_type_check;
alter table public.requests add constraint requests_job_type_check
  check (job_type is null or job_type in ('self_fix','normal','special','pmcal','purchase'));

-- ---------- ยอดคงเหลือ ----------
-- แก้ stock ตรงๆ ไม่ได้ (ต้องผ่าน part_tx) · อะไหล่ใหม่เริ่มที่ 0
create or replace function public.part_stock_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('capd.stock', true), '') <> '1' then
    if tg_op = 'INSERT' then new.stock := 0;
    elsif new.stock is distinct from old.stock then raise exception 'แก้ยอดคงเหลือได้ผ่านการรับ / เบิก / ปรับยอดเท่านั้น'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists part_stock_guard on public.spare_parts;
create trigger part_stock_guard before insert or update on public.spare_parts for each row execute function public.part_stock_guard();

create or replace function public.part_tx_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := public.my_email(); r public.requests; left_qty numeric;
begin
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  new.actor := me; new.at := now();
  if new.kind in ('opening', 'adjust') then
    if not (public.cur_admin() or public.cur_role() = 'foreman_day') then raise exception 'ปรับยอดอะไหล่ได้เฉพาะ Admin / Foreman Day'; end if;
  elsif new.kind = 'issue' then
    if new.qty >= 0 then raise exception 'เบิกอะไหล่ต้องเป็นจำนวนติดลบ'; end if;
    -- เบิกจากใบงาน หรือเบิกใช้ทั่วไป (ต้องใส่เหตุผล)
    if new.request_id is null and coalesce(btrim(new.note), '') = '' then raise exception 'เบิกอะไหล่โดยไม่มีใบงาน ต้องใส่เหตุผล'; end if;
    if new.request_id is not null and new.machine_no is null then
      select machine_no into new.machine_no from public.requests where id = new.request_id;
    end if;
  elsif new.kind = 'receive' then
    select * into r from public.requests where id = new.request_id;
    if new.qty <= 0 or r.id is null or r.job_type <> 'purchase' or r.status <> 'po_vendor'
       or not (me = r.assignee or public.cur_admin() or public.cur_role() = 'foreman_day') then
      raise exception 'รับของเข้าคลังได้จากคำขอซื้อที่ออก PO แล้ว โดยผู้รับผิดชอบ / Admin / Foreman Day';
    end if;
  end if;
  new.unit_price := coalesce(new.unit_price, (select unit_price from public.spare_parts where part_no = new.part_no));
  perform set_config('capd.stock', '1', true);
  update public.spare_parts set stock = stock + new.qty where part_no = new.part_no returning stock into left_qty;
  perform set_config('capd.stock', '', true);
  if left_qty is null then raise exception 'ไม่พบอะไหล่ %', new.part_no; end if;
  return new;
exception when check_violation then
  raise exception 'อะไหล่ % คงเหลือไม่พอ', new.part_no;
end $$;
drop trigger if exists part_tx_apply on public.part_tx;
create trigger part_tx_apply before insert on public.part_tx for each row execute function public.part_tx_apply();

-- ---------- คำขอซื้อในขั้นตอนใบงาน ----------
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
      new.status := 'pending_fd';
      new.job_type := case when new.job_type = 'purchase' then 'purchase' else null end;   -- คำขอซื้อ (v3.6)
      if new.job_type = 'purchase' and jsonb_array_length(coalesce(new.items, '[]')) = 0 then raise exception 'คำขอซื้อต้องมีรายการอย่างน้อย 1 รายการ'; end if;
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
  -- พักงาน / กลับมาทำต่อ: เวลาเริ่มพักใส่โดยระบบ · เปลี่ยนขั้นแล้วการพักหายเอง
  if new.hold_reason is distinct from old.hold_reason then new.hold_since := case when new.hold_reason is null then null else now() end; end if;
  if new.status <> old.status then new.hold_reason := null; new.hold_note := null; new.hold_since := null; end if;
  if sys or adm and new.status = old.status and new.memo_step = old.memo_step then return new; end if;
  if not public.cur_member() then raise exception 'ไม่มีสิทธิ์ใช้งานระบบ'; end if;
  step_app := old.memo_approvers[old.memo_step + 1];
  if new.status = old.status and public.only_changed(old, new, array['hold_reason','hold_note','hold_since']) then
    if old.status in ('wait_admin','ext_repair','quotation','memo_rejected','po_vendor')
       and (me = any(public.next_actors(old)) or public.can_fd(old.machine_no)) then return new; end if;
    raise exception 'ไม่มีสิทธิ์พักงานใบงานนี้';
  end if;
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

-- FD ทุกคนอนุมัติคำขอซื้อที่ไม่ผูกกับเครื่องได้ · แจ้ง FD ทุกคน
create or replace function public.fds_for(p_machine text) returns text[]
language sql stable security definer set search_path = public as $$
  select case when p_machine is null then
    coalesce((select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active), '{}')
  else coalesce(
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type = public.fd_type_of(p_machine)),
    (select array_agg(email order by email) from public.app_users where role = 'foreman_day' and active and fd_type is null),
    '{}') end
$$;
create or replace function public.can_fd(p_machine text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cur_admin() or exists (
    select 1 from public.app_users u where u.email = public.my_email() and u.active and u.role = 'foreman_day'
      and (u.fd_type is null or p_machine is null or u.fd_type = public.fd_type_of(p_machine)))
$$;

-- งานค้าง: รวมคำขอซื้อที่ไม่ผูกกับเครื่อง (left join)
create or replace view public.stale_jobs as
select q.id, q.machine_no, m.machine_name, q.status, q.urgency, q.updated_at,
       ((now() at time zone 'Asia/Bangkok')::date - (q.updated_at at time zone 'Asia/Bangkok')::date) as idle_days,
       public.next_actors(q) as waiting_on, q.job_type, q.hold_reason
from public.requests q left join public.machines m on m.machine_no = q.machine_no
where q.status not in ('closed', 'cancelled') and q.updated_at < now() - interval '3 days';
revoke all on public.stale_jobs from anon, authenticated;

-- ---------- สิทธิ์ ----------
alter table public.spare_parts enable row level security;
alter table public.part_tx enable row level security;
alter table public.vendors enable row level security;
drop policy if exists parts_read on public.spare_parts;
drop policy if exists parts_write on public.spare_parts;
drop policy if exists tx_read on public.part_tx;
drop policy if exists tx_insert on public.part_tx;
drop policy if exists vendors_read on public.vendors;
drop policy if exists vendors_insert on public.vendors;
drop policy if exists vendors_write on public.vendors;
create policy parts_read  on public.spare_parts for select to authenticated using (public.cur_member());
create policy parts_write on public.spare_parts for all    to authenticated
  using (public.cur_admin() or public.cur_role() = 'foreman_day') with check (public.cur_admin() or public.cur_role() = 'foreman_day');
create policy tx_read   on public.part_tx for select to authenticated using (public.cur_member());
create policy tx_insert on public.part_tx for insert to authenticated with check (public.cur_member());   -- part_tx_apply ตรวจสิทธิ์ละเอียด
create policy vendors_read   on public.vendors for select to authenticated using (public.cur_member());
create policy vendors_insert on public.vendors for insert to authenticated with check (public.cur_member());   -- ทุกคนเพิ่ม Vendor ได้
create policy vendors_write  on public.vendors for update to authenticated
  using (public.cur_admin() or public.cur_role() = 'foreman_day') with check (public.cur_admin() or public.cur_role() = 'foreman_day');
grant select, insert, update, delete on public.spare_parts, public.vendors to authenticated;
grant select, insert on public.part_tx to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- โหมดทดลองเปิดอยู่: ให้ policy ใหม่ใช้กับ anon ด้วย (เหมือน v3_trial_on.sql)
create or replace function public.trial_is_on() returns boolean language plpgsql stable as $$
begin return coalesce((select value from public.app_settings where key = 'trial_login') = 'on', false);
exception when undefined_table then return false; end $$;
do $$
declare p record;
begin
  if public.trial_is_on() then
    for p in select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('spare_parts','part_tx','vendors') loop
      execute format('alter policy %I on public.%I to anon, authenticated', p.policyname, p.tablename);
    end loop;
    grant select, insert, update, delete on public.spare_parts, public.vendors to anon;
    grant select, insert on public.part_tx to anon;
    grant usage, select on all sequences in schema public to anon;
  end if;
end $$;
