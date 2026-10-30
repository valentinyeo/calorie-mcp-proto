create table entries (id integer primary key autoincrement, user_id text not null references "user" ("id") on delete cascade, date text not null, name text not null, kcal integer not null, meal text not null);
create index entries_user_date_idx on entries (user_id, date);
