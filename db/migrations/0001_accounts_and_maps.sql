do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mindsprout_app') then
    create role mindsprout_app nologin;
  end if;
end
$$;

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index users_single_admin on users ((true)) where is_admin;

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_id on sessions (user_id);

create table maps (
  id text not null,
  owner_id uuid not null references users on delete cascade,
  schema_version integer not null,
  map jsonb not null,
  title text generated always as (map->>'title') stored,
  updated_at text generated always as (map->>'updatedAt') stored,
  check (map->>'id' = id),
  primary key (owner_id, id)
);
create index maps_owner_updated_at_id on maps (owner_id, updated_at desc, id collate "C");

alter table maps enable row level security;
alter table maps force row level security;
create policy maps_owner on maps
  using (owner_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (owner_id = nullif(current_setting('app.user_id', true), '')::uuid);

grant usage on schema public to mindsprout_app;
grant select, insert, update, delete on maps to mindsprout_app;
grant select, insert, update (password_hash) on users to mindsprout_app;
grant select, insert, delete on sessions to mindsprout_app;
