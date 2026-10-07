-- =============================================================
-- occu.no — lock the database to the owner account.
--
-- Before running:
--   1. Authentication → Users → "Add user" → "Create new user"
--      (your e-mail + a strong password, tick "Auto Confirm User").
--   2. Change the e-mail on the line marked  <-- below.
-- Then paste this whole file into SQL Editor and press Run.
--
-- It is safe to run more than once. Everything runs in one
-- transaction: if anything fails (e.g. the e-mail doesn't exist),
-- nothing is changed.
-- =============================================================
begin;

do $$
declare
  owner_email constant text := 'occu.contact@gmail.com';   -- <-- your login e-mail
  v_owner uuid;
  p record;
begin
  select id into v_owner from auth.users where lower(email) = lower(owner_email);
  if v_owner is null then
    raise exception 'No user with e-mail % — create it under Authentication → Users first', owner_email;
  end if;

  -- ---------- app_state: one JSON row per page/profile ----------
  create table if not exists public.app_state (
    key        text primary key,
    data       jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );
  alter table public.app_state
    add column if not exists owner uuid references auth.users(id) on delete cascade;

  -- Existing rows (written anonymously until now) belong to the owner.
  update public.app_state set owner = v_owner where owner is null;

  alter table public.app_state alter column owner set default auth.uid();
  alter table public.app_state alter column owner set not null;

  alter table public.app_state enable row level security;
  alter table public.app_state force row level security;

  -- Remove every old policy (the original setup allowed everyone).
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'app_state' loop
    execute format('drop policy %I on public.app_state', p.policyname);
  end loop;

  create policy app_state_owner_select on public.app_state
    for select to authenticated using (owner = (select auth.uid()));
  create policy app_state_owner_insert on public.app_state
    for insert to authenticated with check (owner = (select auth.uid()));
  create policy app_state_owner_update on public.app_state
    for update to authenticated
    using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
  create policy app_state_owner_delete on public.app_state
    for delete to authenticated using (owner = (select auth.uid()));

  revoke all on public.app_state from anon;
  grant select, insert, update, delete on public.app_state to authenticated;

  -- Live updates between devices (Realtime also enforces the policies above).
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'app_state') then
    execute 'alter publication supabase_realtime add table public.app_state';
  end if;

  -- ---------- progress photos: private bucket, owner only ----------
  insert into storage.buckets (id, name, public)
  values ('progress-photos', 'progress-photos', false)
  on conflict (id) do update set public = false;

  update storage.objects set owner_id = v_owner::text
   where bucket_id = 'progress-photos' and owner_id is null;

  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual, '') || coalesce(with_check, '')) like '%progress-photos%' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;

  create policy progress_photos_owner_select on storage.objects
    for select to authenticated
    using (bucket_id = 'progress-photos' and owner_id = (select auth.uid())::text);
  create policy progress_photos_owner_insert on storage.objects
    for insert to authenticated
    with check (bucket_id = 'progress-photos'
                and (storage.foldername(name))[1] = (select auth.uid())::text);
  create policy progress_photos_owner_delete on storage.objects
    for delete to authenticated
    using (bucket_id = 'progress-photos' and owner_id = (select auth.uid())::text);
end $$;

commit;

-- Quick check — should list 4 app_state policies, 3 photo policies,
-- rls_enabled = true and public = false.
select 'app_state policy' as what, policyname as name from pg_policies
 where schemaname = 'public' and tablename = 'app_state'
union all
select 'photo policy', policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'progress_photos_%'
union all
select 'rls_enabled', relrowsecurity::text from pg_class where oid = 'public.app_state'::regclass
union all
select 'bucket public', public::text from storage.buckets where id = 'progress-photos';
