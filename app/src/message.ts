import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";

import { Day, Entry } from "./model.ts";

export const Message = defineMessageUnion({
  ChangedDraftKcal: { value: Schema.String },
  ChangedDraftName: { value: Schema.String },
  ChangedDraftPortion: { value: Schema.String },
  ChangedEmail: { value: Schema.String },
  ChangedPassword: { value: Schema.String },
  ClickedAdd: {},
  ClickedDelete: { id: Schema.Number, name: Schema.String },
  ClickedEdit: { id: Schema.Number },
  ClickedSignOut: {},
  ClickedUndo: {},
  ClosedSheet: {},
  DismissedError: {},
  FailedAdd: { message: Schema.String },
  FailedDay: { message: Schema.String },
  FailedDelete: { message: Schema.String },
  FailedEdit: { message: Schema.String },
  FailedRestoreSession: {},
  FailedSignIn: { message: Schema.String },
  FailedUndo: { message: Schema.String },
  PersistedSession: {},
  RequestedDay: {},
  SubmittedAdd: {},
  SubmittedEdit: {},
  SubmittedSignIn: {},
  SucceededAdd: { day: Day },
  SucceededDay: { day: Day },
  SucceededDelete: { day: Day, entry: Entry },
  SucceededEdit: { day: Day },
  SucceededRestoreSession: { token: Schema.String },
  SucceededSignIn: { token: Schema.String },
  SucceededUndo: { day: Day },
});
export type Message = typeof Message.Type;
