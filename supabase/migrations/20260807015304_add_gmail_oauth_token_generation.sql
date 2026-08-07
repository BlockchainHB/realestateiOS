alter table private.gmail_oauth_tokens
  add column authorization_generation bigint not null default 1
  check (authorization_generation > 0);

comment on column private.gmail_oauth_tokens.authorization_generation is
  'Monotonic OAuth grant generation used to reject stale refresh writes.';
