-- ===== 06 machine photos: รูปเครื่องจักร / อุปกรณ์ (ทุกคนเพิ่มได้ · Admin / Foreman Day ลบหรือเลือกรูปหลัก) =====
create table if not exists public.machine_photos (
  id          bigint generated always as identity primary key,
  machine_no  text not null references public.machines(machine_no) on update cascade on delete cascade,
  path        text not null,                     -- ไฟล์ใน Storage bucket request-photos (machines/<เครื่อง>/...)
  caption     text,
  is_main     boolean not null default false,    -- รูปหลักของเครื่อง (1 รูป)
  uploaded_by text not null default public.my_email(),
  created_at  timestamptz not null default now()
);
create index if not exists machine_photos_machine on public.machine_photos(machine_no, created_at);

-- ผู้เพิ่มรูปบันทึกจากฐานข้อมูล · รูปหลักมีได้ 1 รูปต่อเครื่อง
create or replace function public.machine_photo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := public.my_email(); new.created_at := now();
    if new.is_main and not (public.cur_admin() or public.cur_role() = 'foreman_day') then new.is_main := false; end if;
    if not exists (select 1 from public.machine_photos where machine_no = new.machine_no) then new.is_main := true; end if;
  else
    if new.machine_no is distinct from old.machine_no or new.path is distinct from old.path or new.uploaded_by is distinct from old.uploaded_by then
      raise exception 'แก้ได้เฉพาะคำอธิบายและรูปหลัก';
    end if;
  end if;
  if new.is_main then
    update public.machine_photos set is_main = false where machine_no = new.machine_no and is_main and id is distinct from new.id;
  end if;
  return new;
end $$;
drop trigger if exists machine_photo_guard on public.machine_photos;
create trigger machine_photo_guard before insert or update on public.machine_photos for each row execute function public.machine_photo_guard();

alter table public.machine_photos enable row level security;
drop policy if exists mphoto_read on public.machine_photos;
drop policy if exists mphoto_insert on public.machine_photos;
drop policy if exists mphoto_update on public.machine_photos;
drop policy if exists mphoto_delete on public.machine_photos;
create policy mphoto_read   on public.machine_photos for select to authenticated using (public.cur_member());
create policy mphoto_insert on public.machine_photos for insert to authenticated with check (public.cur_member() and path like 'machines/%');
create policy mphoto_update on public.machine_photos for update to authenticated
  using (public.cur_admin() or public.cur_role() = 'foreman_day') with check (public.cur_admin() or public.cur_role() = 'foreman_day');
create policy mphoto_delete on public.machine_photos for delete to authenticated using (public.cur_admin() or public.cur_role() = 'foreman_day');
grant select, insert, update, delete on public.machine_photos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ไฟล์รูปเครื่อง: Foreman Day ลบได้ด้วย (รูปในใบงานยังลบได้เฉพาะ Admin)
drop policy if exists "photos delete" on storage.objects;
create policy "photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'request-photos' and (public.cur_admin() or (public.cur_role() = 'foreman_day' and name like 'machines/%')));
