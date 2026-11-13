import { Effect, Schema } from "effect";
import { Command as CommandDef } from "foldkit";

import * as api from "./api.ts";
import { Message } from "./message.ts";
import * as session from "./session.ts";

const failure = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

// Every Command turns its own failure into a Message, so the Effect channel stays
// `never` and update never sees a thrown error.
const attempt = <A>(run: () => Promise<A>): Effect.Effect<A | Error> =>
  Effect.promise(async () => {
    try {
      return await run();
    } catch (error) {
      return error instanceof Error ? error : new Error(failure(error));
    }
  });

const RestoreSession = CommandDef.define("RestoreSession", {
  messages: [Message.SucceededRestoreSession, Message.FailedRestoreSession],
  execute: Effect.map(attempt(() => session.loadToken()), (result) =>
    result instanceof Error || result === null
      ? Message.FailedRestoreSession()
      : Message.SucceededRestoreSession({ token: result })
  ),
});

const PersistSession = CommandDef.define("PersistSession", {
  args: { token: Schema.String },
  messages: [Message.PersistedSession],
  execute: ({ token }) =>
    Effect.map(attempt(() => session.saveToken(token)), () => Message.PersistedSession()),
});

const ClearSession = CommandDef.define("ClearSession", {
  messages: [Message.PersistedSession],
  execute: Effect.map(attempt(() => session.clearToken()), () => Message.PersistedSession()),
});

const SignIn = CommandDef.define("SignIn", {
  args: { email: Schema.String, password: Schema.String },
  messages: [Message.SucceededSignIn, Message.FailedSignIn],
  execute: ({ email, password }) =>
    Effect.map(attempt(() => api.signIn(email, password)), (result) =>
      result instanceof Error || typeof result !== "string"
        ? Message.FailedSignIn({ message: failure(result) })
        : Message.SucceededSignIn({ token: result })
    ),
});

const FetchDay = CommandDef.define("FetchDay", {
  args: { token: Schema.String },
  messages: [Message.SucceededDay, Message.FailedDay],
  execute: ({ token }) =>
    Effect.map(attempt(() => api.fetchDay(token)), (result) =>
      result instanceof Error
        ? Message.FailedDay({ message: failure(result) })
        : Message.SucceededDay({ day: result.day })
    ),
});

const AddEntry = CommandDef.define("AddEntry", {
  args: { token: Schema.String, name: Schema.String, kcal: Schema.Number, portion: Schema.String },
  messages: [Message.SucceededAdd, Message.FailedAdd],
  execute: ({ token, name, kcal, portion }) =>
    Effect.map(
      attempt(() => api.addEntry(token, { kcal, name, portion_text: portion.length > 0 ? portion : undefined })),
      (result) =>
        result instanceof Error ? Message.FailedAdd({ message: failure(result) }) : Message.SucceededAdd({ day: result.day }),
    ),
});

const EditEntry = CommandDef.define("EditEntry", {
  args: { token: Schema.String, id: Schema.Number, name: Schema.String, kcal: Schema.Number, portion: Schema.String },
  messages: [Message.SucceededEdit, Message.FailedEdit],
  execute: ({ token, id, name, kcal, portion }) =>
    Effect.map(
      attempt(() => api.updateEntry(token, id, { kcal, name, portion_text: portion.length > 0 ? portion : undefined })),
      (result) =>
        result instanceof Error ? Message.FailedEdit({ message: failure(result) }) : Message.SucceededEdit({ day: result.day }),
    ),
});

const DeleteEntry = CommandDef.define("DeleteEntry", {
  args: { token: Schema.String, id: Schema.Number },
  messages: [Message.SucceededDelete, Message.FailedDelete],
  execute: ({ token, id }) =>
    Effect.map(attempt(() => api.deleteEntry(token, id)), (result) =>
      result instanceof Error
        ? Message.FailedDelete({ message: failure(result) })
        : result.entry === undefined
          ? Message.FailedDelete({ message: "The server did not confirm the delete." })
          : Message.SucceededDelete({ day: result.day, entry: result.entry })
    ),
});

const UndoDelete = CommandDef.define("UndoDelete", {
  args: { token: Schema.String, id: Schema.Number },
  messages: [Message.SucceededUndo, Message.FailedUndo],
  execute: ({ token, id }) =>
    Effect.map(attempt(() => api.restoreEntry(token, id)), (result) =>
      result instanceof Error ? Message.FailedUndo({ message: failure(result) }) : Message.SucceededUndo({ day: result.day })
    ),
});

export const Command = {
  AddEntry,
  ClearSession,
  DeleteEntry,
  EditEntry,
  FetchDay,
  PersistSession,
  RestoreSession,
  SignIn,
  UndoDelete,
};
