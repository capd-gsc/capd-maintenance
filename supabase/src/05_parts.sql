-- ===== 05 parts: คลังอะไหล่ · Vendor · คำขอซื้อ · อุปกรณ์ประกอบ =====
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

-- อุปกรณ์ประกอบของเครื่อง (เช่น ตุ้มน้ำหนักมาตรฐาน / Extensometer ของเครื่องทดสอบ) มีแผน CAL ของตัวเอง
alter table public.machines add column if not exists parent_machine text references public.machines(machine_no) on update cascade on delete set null;
alter table public.machines drop constraint if exists machines_parent_not_self;
alter table public.machines add constraint machines_parent_not_self check (parent_machine is distinct from machine_no);

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

-- งานที่ค้างนานเกิน 3 วัน (ใช้ในสรุปรายวัน) · รวมคำขอซื้อที่ไม่ผูกกับเครื่อง
drop view if exists public.stale_jobs;
create view public.stale_jobs as
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
