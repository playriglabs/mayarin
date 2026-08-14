create table if not exists early_access_signups (
  id text primary key,
  email text not null unique,
  created_at integer not null
);

create index if not exists early_access_signups_created_at
  on early_access_signups (created_at desc);
