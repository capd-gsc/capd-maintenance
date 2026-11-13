-- Minimal stand-ins for Supabase's auth / storage schemas so the real SQL files run on plain Postgres
do $$ begin create role anon nologin; exception when others then null; end $$; do $$ begin create role authenticated nologin; exception when others then null; end $$;
create schema auth; create schema storage;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create publication supabase_realtime;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
