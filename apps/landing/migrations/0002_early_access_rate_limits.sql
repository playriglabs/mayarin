create table early_access_rate_limits (
  client_hash text primary key,
  requests integer not null,
  expires_at integer not null
);

create index early_access_rate_limits_expiry
  on early_access_rate_limits (expires_at);
