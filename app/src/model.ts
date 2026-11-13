import { Schema } from "effect";

// The app mirrors the food log server's entry shape. Nullable optional macros keep the
// Schema honest: the server sends null, never a missing key.
export const Entry = Schema.Struct({
  id: Schema.Number,
  eaten_at: Schema.String,
  local_date: Schema.String,
  name: Schema.String,
  kcal: Schema.Number,
  protein_g: Schema.NullOr(Schema.Number),
  carbs_g: Schema.NullOr(Schema.Number),
  fat_g: Schema.NullOr(Schema.Number),
  portion_text: Schema.NullOr(Schema.String),
  source: Schema.String,
  client_name: Schema.NullOr(Schema.String),
});
export type Entry = typeof Entry.Type;

export const Day = Schema.Struct({
  date: Schema.String,
  timezone: Schema.String,
  goal_kcal: Schema.Number,
  consumed_kcal: Schema.Number,
  remaining_kcal: Schema.Number,
  protein_g: Schema.Number,
  carbs_g: Schema.Number,
  fat_g: Schema.Number,
  entries: Schema.Array(Entry),
});
export type Day = typeof Day.Type;

export const Sheet = Schema.Literals(["none", "add", "edit"]);
export type Sheet = typeof Sheet.Type;

export const Model = Schema.Struct({
  token: Schema.NullOr(Schema.String),
  email: Schema.String,
  password: Schema.String,
  busy: Schema.Boolean,
  loading: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  day: Schema.NullOr(Day),
  sheet: Sheet,
  draftName: Schema.String,
  draftKcal: Schema.String,
  draftPortion: Schema.String,
  editingId: Schema.NullOr(Schema.Number),
  undoId: Schema.NullOr(Schema.Number),
  undoName: Schema.String,
});
export type Model = typeof Model.Type;

export const initialModel: Model = {
  token: null,
  email: "",
  password: "",
  busy: true,
  loading: false,
  error: null,
  day: null,
  sheet: "none",
  draftName: "",
  draftKcal: "",
  draftPortion: "",
  editingId: null,
  undoId: null,
  undoName: "",
};
