import assert from "node:assert/strict";
import { test } from "node:test";

import { initialModel, type Day } from "../src/model.ts";
import { Message } from "../src/message.ts";
import { update } from "../src/update.ts";

const entry = {
  carbs_g: 40,
  client_name: "Claude",
  eaten_at: "2026-10-30T07:40:00.000Z",
  fat_g: 12,
  id: 7,
  kcal: 310,
  local_date: "2026-10-30",
  name: "Porridge with banana",
  portion_text: "1 bowl",
  protein_g: 9,
  source: "mcp",
};

const day: Day = {
  carbs_g: 40,
  consumed_kcal: 310,
  date: "2026-10-30",
  entries: [entry],
  fat_g: 12,
  goal_kcal: 2100,
  protein_g: 9,
  remaining_kcal: 1790,
  timezone: "Europe/London",
};

const signedIn = { ...initialModel, busy: false, token: "session-token" };

const commandNames = (commands: readonly { name: string }[] | undefined): string[] =>
  (commands ?? []).map((command) => command.name);

test("a valid add sends the entry to the server and closes nothing early", () => {
  const model = { ...signedIn, draftKcal: "310", draftName: " Porridge ", draftPortion: "1 bowl", sheet: "add" as const };
  const result = update(model, Message.SubmittedAdd());
  assert.deepEqual(commandNames(result.commands), ["AddEntry"]);
  assert.equal(result.model.busy, true);
  assert.equal(result.model.error, null);
});

test("an add without calories never reaches the server", () => {
  const model = { ...signedIn, draftKcal: "", draftName: "Porridge", sheet: "add" as const };
  const result = update(model, Message.SubmittedAdd());
  assert.equal(result.commands, undefined);
  assert.match(result.model.error ?? "", /Calories/);
});

test("a saved entry refreshes today and closes the sheet", () => {
  const model = { ...signedIn, draftName: "Porridge", sheet: "add" as const };
  const result = update(model, Message.SucceededAdd({ day }));
  assert.equal(result.model.sheet, "none");
  assert.equal(result.model.day?.consumed_kcal, 310);
  assert.equal(result.model.draftName, "");
});

test("tapping an entry prefills the edit sheet", () => {
  const result = update({ ...signedIn, day }, Message.ClickedEdit({ id: 7 }));
  assert.equal(result.model.sheet, "edit");
  assert.equal(result.model.editingId, 7);
  assert.equal(result.model.draftKcal, "310");
  assert.equal(result.model.draftPortion, "1 bowl");
});

test("deleting shows undo naming the entry, and undo asks the server to restore it", () => {
  const deleted = update({ ...signedIn, day }, Message.ClickedDelete({ id: 7, name: "Porridge with banana" }));
  assert.deepEqual(commandNames(deleted.commands), ["DeleteEntry"]);
  assert.equal(deleted.model.undoId, 7);

  const settled = update(deleted.model, Message.SucceededDelete({ day: { ...day, consumed_kcal: 0, entries: [], remaining_kcal: 2100 }, entry }));
  assert.equal(settled.model.undoId, 7);
  assert.equal(settled.model.undoName, "Porridge with banana");

  const undone = update(settled.model, Message.ClickedUndo());
  assert.deepEqual(commandNames(undone.commands), ["UndoDelete"]);

  const restored = update(undone.model, Message.SucceededUndo({ day }));
  assert.equal(restored.model.undoId, null);
  assert.equal(restored.model.day?.entries.length, 1);
});

test("an expired session drops the token so the sign-in screen returns", () => {
  const result = update(
    { ...signedIn, day, loading: true },
    Message.FailedDay({ message: "Your sign-in expired. Sign in again." }),
  );
  assert.equal(result.model.token, null);
  assert.equal(result.model.loading, false);
});

test("a network failure keeps the session and shows the message", () => {
  const result = update(signedIn, Message.FailedDay({ message: "Could not reach the server." }));
  assert.equal(result.model.token, "session-token");
  assert.equal(result.model.error, "Could not reach the server.");
});

test("signing out clears the stored token", () => {
  const result = update({ ...signedIn, day }, Message.ClickedSignOut());
  assert.deepEqual(commandNames(result.commands), ["ClearSession"]);
  assert.equal(result.model.token, null);
  assert.equal(result.model.day, null);
});

test("a saved session starts a day load", () => {
  const result = update(initialModel, Message.SucceededRestoreSession({ token: "saved" }));
  assert.deepEqual(commandNames(result.commands), ["FetchDay"]);
  assert.equal(result.model.token, "saved");
});

test("a fresh sign-in persists the token and loads today", () => {
  const result = update(initialModel, Message.SucceededSignIn({ token: "fresh" }));
  assert.deepEqual(commandNames(result.commands), ["PersistSession", "FetchDay"]);
  assert.equal(result.model.password, "");
});
