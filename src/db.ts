// Food log queries. Every statement is scoped by user_id: no tool may read or write across users.

export interface Entry {
  id: number;
  eaten_at: string;
  local_date: string;
  name: string;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  portion_text: string | null;
  source: string;
  client_name: string | null;
}

export interface Profile {
  daily_goal_kcal: number;
  timezone: string;
  pro_until: string | null;
}

const ENTRY_COLUMNS =
  "id, eaten_at, local_date, name, kcal, protein_g, carbs_g, fat_g, portion_text, source, client_name";

const now = () => new Date().toISOString();

// YYYY-MM-DD in an IANA timezone. en-CA formats exactly that way.
export function localDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile> {
  await db
    .prepare(
      `insert into profile (user_id, created_at, updated_at) values (?, ?, ?)
       on conflict (user_id) do nothing`,
    )
    .bind(userId, now(), now())
    .run();
  const row = await db
    .prepare("select daily_goal_kcal, timezone, pro_until from profile where user_id = ?")
    .bind(userId)
    .first<Profile>();
  if (!row) throw new Error("profile missing");
  return row;
}

export async function setGoal(db: D1Database, userId: string, kcal: number): Promise<number> {
  await getProfile(db, userId);
  await db
    .prepare("update profile set daily_goal_kcal = ?, updated_at = ? where user_id = ?")
    .bind(kcal, now(), userId)
    .run();
  return kcal;
}

export interface Totals {
  date: string;
  goal_kcal: number;
  consumed_kcal: number;
  remaining_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export async function dayTotals(db: D1Database, userId: string, date: string): Promise<Totals> {
  const profile = await getProfile(db, userId);
  const row = await db
    .prepare(
      `select coalesce(sum(kcal), 0) as kcal,
              coalesce(sum(protein_g), 0) as protein_g,
              coalesce(sum(carbs_g), 0) as carbs_g,
              coalesce(sum(fat_g), 0) as fat_g
       from entries
       where user_id = ? and local_date = ? and deleted_at is null`,
    )
    .bind(userId, date)
    .first<{ kcal: number; protein_g: number; carbs_g: number; fat_g: number }>();
  const consumed = Math.round(row?.kcal ?? 0);
  return {
    date,
    goal_kcal: profile.daily_goal_kcal,
    consumed_kcal: consumed,
    remaining_kcal: profile.daily_goal_kcal - consumed,
    protein_g: Math.round((row?.protein_g ?? 0) * 10) / 10,
    carbs_g: Math.round((row?.carbs_g ?? 0) * 10) / 10,
    fat_g: Math.round((row?.fat_g ?? 0) * 10) / 10,
  };
}

export async function listBetween(
  db: D1Database,
  userId: string,
  from: string,
  to: string,
): Promise<Entry[]> {
  const { results } = await db
    .prepare(
      `select ${ENTRY_COLUMNS} from entries
       where user_id = ? and local_date between ? and ? and deleted_at is null
       order by local_date asc, eaten_at asc, id asc`,
    )
    .bind(userId, from, to)
    .all<Entry>();
  return results ?? [];
}

export interface EntryInput {
  name: string;
  kcal: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  portion_text?: string;
  eaten_at?: string;
}

export async function addEntry(
  db: D1Database,
  userId: string,
  input: EntryInput,
  meta: { source: string; clientName: string | null },
): Promise<Entry> {
  const profile = await getProfile(db, userId);
  const eatenAt = input.eaten_at ? new Date(input.eaten_at) : new Date();
  if (Number.isNaN(eatenAt.getTime())) throw new Error("eaten_at must be an ISO 8601 instant");
  const date = localDate(eatenAt, profile.timezone);
  const stamp = now();
  const row = await db
    .prepare(
      `insert into entries (user_id, eaten_at, local_date, name, kcal, protein_g, carbs_g, fat_g,
                            portion_text, source, client_name, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       returning ${ENTRY_COLUMNS}`,
    )
    .bind(
      userId,
      eatenAt.toISOString(),
      date,
      input.name,
      input.kcal,
      input.protein_g ?? null,
      input.carbs_g ?? null,
      input.fat_g ?? null,
      input.portion_text ?? null,
      meta.source,
      meta.clientName,
      stamp,
      stamp,
    )
    .first<Entry>();
  if (!row) throw new Error("insert failed");
  return row;
}

export async function getEntry(db: D1Database, userId: string, id: number): Promise<Entry | null> {
  return db
    .prepare(
      `select ${ENTRY_COLUMNS} from entries where id = ? and user_id = ? and deleted_at is null`,
    )
    .bind(id, userId)
    .first<Entry>();
}

export async function updateEntry(
  db: D1Database,
  userId: string,
  id: number,
  patch: Partial<EntryInput>,
): Promise<Entry> {
  const existing = await getEntry(db, userId, id);
  if (!existing) throw new Error(`no entry with id ${id}`);
  const profile = await getProfile(db, userId);

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, value: string | number | null) => {
    fields.push(`${col} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.kcal !== undefined) set("kcal", patch.kcal);
  if (patch.protein_g !== undefined) set("protein_g", patch.protein_g);
  if (patch.carbs_g !== undefined) set("carbs_g", patch.carbs_g);
  if (patch.fat_g !== undefined) set("fat_g", patch.fat_g);
  if (patch.portion_text !== undefined) set("portion_text", patch.portion_text);
  if (patch.eaten_at !== undefined) {
    const eatenAt = new Date(patch.eaten_at);
    if (Number.isNaN(eatenAt.getTime())) throw new Error("eaten_at must be an ISO 8601 instant");
    set("eaten_at", eatenAt.toISOString());
    set("local_date", localDate(eatenAt, profile.timezone));
  }
  if (fields.length === 0) return existing;
  set("updated_at", now());

  const row = await db
    .prepare(
      `update entries set ${fields.join(", ")}
       where id = ? and user_id = ? and deleted_at is null
       returning ${ENTRY_COLUMNS}`,
    )
    .bind(...values, id, userId)
    .first<Entry>();
  if (!row) throw new Error(`no entry with id ${id}`);
  return row;
}

export async function deleteEntry(db: D1Database, userId: string, id: number): Promise<Entry> {
  const row = await db
    .prepare(
      `update entries set deleted_at = ?, updated_at = ?
       where id = ? and user_id = ? and deleted_at is null
       returning ${ENTRY_COLUMNS}`,
    )
    .bind(now(), now(), id, userId)
    .first<Entry>();
  if (!row) throw new Error(`no entry with id ${id}`);
  return row;
}
