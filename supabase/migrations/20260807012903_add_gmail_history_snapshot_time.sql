alter table public.gmail_sync_states
  add column last_history_snapshot_at timestamptz;

update public.gmail_sync_states state
set last_history_snapshot_at = connection.connected_at
from public.gmail_connections connection
where connection.id = state.connection_id;

alter table public.gmail_sync_states
  alter column last_history_snapshot_at set default now(),
  alter column last_history_snapshot_at set not null;

comment on column public.gmail_sync_states.last_history_snapshot_at is
  'Time immediately before Gmail produced the history snapshot represented by last_history_id.';
