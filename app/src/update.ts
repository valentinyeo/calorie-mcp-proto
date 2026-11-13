import type { Update } from "foldkit";

import { Command } from "./command.ts";
import { parseKcal } from "./day.ts";
import type { Model } from "./model.ts";
import { Message } from "./message.ts";

type Return = Update.Return<Model, Message>;

const EXPIRED = "Your sign-in expired. Sign in again.";

const draftKcal = (draft: string): number | null => parseKcal(draft);

const draftValid = (model: Model): string | null => {
  if (model.draftName.trim().length === 0) return "Add the food name.";
  if (draftKcal(model.draftKcal) === null) return "Calories must be a whole number between 0 and 20,000.";
  return null;
};

const command = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    ChangedDraftKcal: ({ value }) => ({ model: { ...model, draftKcal: value } }),
    ChangedDraftName: ({ value }) => ({ model: { ...model, draftName: value } }),
    ChangedDraftPortion: ({ value }) => ({ model: { ...model, draftPortion: value } }),
    ChangedEmail: ({ value }) => ({ model: { ...model, email: value } }),
    ChangedPassword: ({ value }) => ({ model: { ...model, password: value } }),
    ClickedAdd: () => ({
      model: { ...model, draftKcal: "", draftName: "", draftPortion: "", editingId: null, error: null, sheet: "add" },
    }),
    ClickedDelete: ({ id, name }) =>
      model.token === null
        ? { model }
        : {
            commands: [Command.DeleteEntry({ id, token: model.token })],
            model: { ...model, busy: true, editingId: null, sheet: "none", undoId: id, undoName: name },
          },
    ClickedEdit: ({ id }) => {
      const entry = model.day?.entries.find((item) => item.id === id);
      if (entry === undefined) return { model };
      return {
        model: {
          ...model,
          draftKcal: String(entry.kcal),
          draftName: entry.name,
          draftPortion: entry.portion_text ?? "",
          editingId: entry.id,
          error: null,
          sheet: "edit",
        },
      };
    },
    ClickedSignOut: () => ({
      commands: [Command.ClearSession()],
      model: { ...model, day: null, error: null, password: "", sheet: "none", token: null },
    }),
    ClickedUndo: () =>
      model.token === null || model.undoId === null
        ? { model }
        : {
            commands: [Command.UndoDelete({ id: model.undoId, token: model.token })],
            model: { ...model, busy: true },
          },
    ClosedSheet: () => ({ model: { ...model, editingId: null, sheet: "none" } }),
    DismissedError: () => ({ model: { ...model, error: null } }),
    FailedAdd: ({ message }) => ({ model: { ...model, busy: false, error: message } }),
    FailedDay: ({ message }) => ({
      model: message === EXPIRED
        ? { ...model, busy: false, day: null, error: message, loading: false, token: null }
        : { ...model, busy: false, error: message, loading: false },
    }),
    FailedDelete: ({ message }) => ({ model: { ...model, busy: false, error: message, undoId: null } }),
    FailedEdit: ({ message }) => ({ model: { ...model, busy: false, error: message } }),
    FailedRestoreSession: () => ({ model: { ...model, busy: false } }),
    FailedSignIn: ({ message }) => ({ model: { ...model, busy: false, error: message } }),
    FailedUndo: ({ message }) => ({ model: { ...model, busy: false, error: message, undoId: null } }),
    PersistedSession: () => ({ model }),
    RequestedDay: () =>
      model.token === null
        ? { model }
        : { commands: [Command.FetchDay({ token: model.token })], model: { ...model, busy: true } },
    SubmittedAdd: () => {
      const problem = draftValid(model);
      const kcal = draftKcal(model.draftKcal);
      if (problem !== null || kcal === null) return { model: { ...model, error: problem } };
      if (model.token === null) return { model };
      return {
        commands: [
          Command.AddEntry({
            kcal,
            name: model.draftName.trim(),
            portion: model.draftPortion.trim(),
            token: model.token,
          }),
        ],
        model: { ...model, busy: true, error: null },
      };
    },
    SubmittedEdit: () => {
      const problem = draftValid(model);
      const kcal = draftKcal(model.draftKcal);
      if (problem !== null || kcal === null) return { model: { ...model, error: problem } };
      if (model.token === null || model.editingId === null) return { model };
      return {
        commands: [
          Command.EditEntry({
            id: model.editingId,
            kcal,
            name: model.draftName.trim(),
            portion: model.draftPortion.trim(),
            token: model.token,
          }),
        ],
        model: { ...model, busy: true, error: null },
      };
    },
    SubmittedSignIn: () =>
      model.email.trim().length === 0 || model.password.length === 0
        ? { model: { ...model, error: "Add your email and password." } }
        : {
            commands: [Command.SignIn({ email: model.email.trim(), password: model.password })],
            model: { ...model, busy: true, error: null },
          },
    SucceededAdd: ({ day }) => ({
      model: { ...model, busy: false, day, draftKcal: "", draftName: "", draftPortion: "", sheet: "none" },
    }),
    SucceededDay: ({ day }) => ({ model: { ...model, busy: false, day, loading: false } }),
    SucceededDelete: ({ day, entry }) => ({
      model: { ...model, busy: false, day, undoId: entry.id, undoName: entry.name },
    }),
    SucceededEdit: ({ day }) => ({
      model: { ...model, busy: false, day, editingId: null, sheet: "none" },
    }),
    SucceededRestoreSession: ({ token }) => ({
      commands: [Command.FetchDay({ token })],
      model: { ...model, busy: true, loading: true, token },
    }),
    SucceededSignIn: ({ token }) => ({
      commands: [Command.PersistSession({ token }), Command.FetchDay({ token })],
      model: { ...model, busy: true, loading: true, password: "", token },
    }),
    SucceededUndo: ({ day }) => ({ model: { ...model, busy: false, day, undoId: null, undoName: "" } }),
  });

export const update = (model: Model, message: Message): Return => command(model, message);
