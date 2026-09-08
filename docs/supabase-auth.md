# Supabase Auth Setup

1. In Supabase, open **SQL Editor** and run the following script.
2. In `.env.local`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to your project URL and publishable/anon key.
3. Restart `npm run dev`. For Netlify, add the same two values as site environment variables before building.

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can create their own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, profile)
  values (new.id, coalesce(new.raw_user_meta_data -> 'profile', '{}'::jsonb))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();
```

The trigger preserves avatar data when Supabase email confirmation is enabled and a session is not yet available during signup.