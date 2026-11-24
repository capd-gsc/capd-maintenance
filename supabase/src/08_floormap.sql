-- ===== 08 floormap: ผังโรงงาน + ตำแหน่งเครื่องบนผัง (แสดงเครื่องที่ยังไม่ตรวจก่อนใช้งาน) =====
create table if not exists public.floor_plans (
  id          text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
  name        text not null,
  image_path  text check (image_path is null or image_path like 'plans/%'),
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
-- ตำแหน่งบนผัง: สัดส่วน 0–1 ของความกว้าง / สูงของรูป (รูปเปลี่ยนขนาดได้ หมุดยังอยู่ที่เดิม)
alter table public.machines add column if not exists map_plan text references public.floor_plans(id) on delete set null;
alter table public.machines add column if not exists map_x real check (map_x is null or map_x between 0 and 1);
alter table public.machines add column if not exists map_y real check (map_y is null or map_y between 0 and 1);

alter table public.floor_plans enable row level security;
drop policy if exists plan_read on public.floor_plans;
drop policy if exists plan_write on public.floor_plans;
create policy plan_read  on public.floor_plans for select to authenticated using (public.cur_any());
create policy plan_write on public.floor_plans for all    to authenticated using (public.cur_admin()) with check (public.cur_admin());
grant select, insert, update, delete on public.floor_plans to authenticated;

-- รูปผัง: ทุกคนที่เข้าระบบได้ดูได้ (รวมผู้ใช้เครื่อง) · อัปโหลดได้เฉพาะ Admin
drop policy if exists "checklist photos read" on storage.objects;
create policy "checklist photos read" on storage.objects for select to authenticated
  using (bucket_id = 'request-photos' and public.cur_any() and (name like 'checklists/%' or name like 'machines/%' or name like 'plans/%'));
drop policy if exists "plan images upload" on storage.objects;
create policy "plan images upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'request-photos' and public.cur_admin() and name like 'plans/%');
