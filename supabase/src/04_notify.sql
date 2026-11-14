-- ===== 04 notify: คิวแจ้งเตือน Teams / Email =====
alter table public.app_users add column if not exists notify_email boolean not null default true;

create table if not exists public.notify_queue (
  id          bigint generated always as identity primary key,
  request_id  text not null references public.requests(id) on delete cascade,
  event       text not null,                 -- new / step / memo_next / po_ready / closed / cancelled
  status      text not null,                 -- สถานะใบงานตอนเกิดเรื่อง
  recipients  text[] not null default '{}',  -- อีเมลคนที่ต้องทำต่อ (ไม่รวมคนที่กดเอง)
  actor       text,                          -- คนที่ทำให้เกิดเรื่อง ('' = ระบบ)
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text
);
create index if not exists notify_queue_unsent on public.notify_queue(id) where sent_at is null;
alter table public.notify_queue enable row level security;   -- ไม่มี policy: หน้าเว็บอ่าน/เขียนไม่ได้ (Edge Function ใช้ service role)
revoke all on public.notify_queue from anon, authenticated;

-- ใครต้องทำต่อ ตามสถานะใบงาน (ตรงกับ owner() ในหน้าเว็บ)
create or replace function public.next_actors(q public.requests) returns text[]
language sql stable security definer set search_path = public as $$
  with admins as (select coalesce(array_agg(email order by email), '{}') a from public.app_users where active and (role = 'admin' or is_admin))
  select array_remove(case q.status
    when 'pending_fd'    then public.fds_for(q.machine_no)
    when 'ext_repair'    then public.fds_for(q.machine_no)
    when 'returned'      then array[q.reporter]
    when 'wait_admin'    then (select a from admins)
    when 'quotation'     then array[q.assignee]
    when 'memo_rejected' then array[q.assignee]
    when 'memo_approval' then array[q.memo_approvers[q.memo_step + 1]]
    when 'po_vendor'     then case when coalesce(q.po_no, '') = '' then (select a from admins) else array[q.assignee] end
    when 'closed'        then array[q.reporter]
    when 'cancelled'     then array[q.reporter]
    else '{}'::text[] end, null)
$$;

create or replace function public.queue_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; who text[]; me text := public.my_email();
begin
  if tg_op = 'INSERT' then
    ev := case when new.status = 'closed' then null else 'new' end;           -- แก้ไขเองแล้วปิดทันที ไม่ต้องแจ้งใคร
  elsif new.status is distinct from old.status then
    ev := case new.status when 'closed' then 'closed' when 'cancelled' then 'cancelled' else 'step' end;
  elsif new.status = 'memo_approval' and new.memo_step is distinct from old.memo_step then
    ev := 'memo_next';
  elsif new.status = 'po_vendor' and coalesce(old.po_no, '') = '' and coalesce(new.po_no, '') <> '' then
    ev := 'po_ready';
  end if;
  if ev is null then return null; end if;
  who := array(select distinct x from unnest(public.next_actors(new)) x
               where x <> coalesce(me, '') and x <> 'system' and exists (select 1 from public.app_users u where u.email = x and u.active));
  insert into public.notify_queue(request_id, event, status, recipients, actor) values (new.id, ev, new.status, who, coalesce(me, ''));
  return null;
end $$;
drop trigger if exists queue_notify on public.requests;
create trigger queue_notify after insert or update on public.requests for each row execute function public.queue_notify();
-- งานที่ค้างนานเกิน 3 วัน (view stale_jobs) อยู่ใน 05_parts
