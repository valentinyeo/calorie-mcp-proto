-- Real food-log schema (spec: docs/spec.md "Data shape").
-- Better Auth owns "user", "session", "account", "oauth*", "jwks". This adds the app's own
-- profile row (1:1 with user) and rebuilds entries from the prototype's read-only shape.

alter table entries rename to entries_proto;

create table profile (
  user_id text primary key references "user" ("id") on delete cascade,
  daily_goal_kcal integer not null default 2000,
  timezone text not null default 'Europe/London',
  pro_until text,
  created_at text not null,
  updated_at text not null
);

create table entries (
  id integer primary key autoincrement,
  user_id text not null references "user" ("id") on delete cascade,
  eaten_at text not null,             -- UTC instant, ISO 8601
  local_date text not null,           -- YYYY-MM-DD in the user's timezone at write time
  name text not null,
  kcal integer not null,              -- required
  protein_g real,
  carbs_g real,
  fat_g real,
  portion_text text,
  source text not null default 'mcp', -- app | mcp | cli | photo | barcode
  client_name text,                   -- "Claude", "ChatGPT", ...
  created_at text not null,
  updated_at text not null,
  deleted_at text                     -- soft delete, undo-safe
);

insert into entries (id, user_id, eaten_at, local_date, name, kcal, source, created_at, updated_at)
select id, user_id, date || 'T12:00:00Z', date, name, kcal, 'app',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from entries_proto;

drop table entries_proto;

create index entries_user_date_idx on entries (user_id, local_date);
