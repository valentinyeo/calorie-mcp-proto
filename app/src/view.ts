import type { Document, HtmlBuilder } from "foldkit/html";

import { dayLabel, entryTime, groupThousands, progressPercent, remainingLabel, sourceLabel } from "./day.ts";
import type { Entry, Model } from "./model.ts";
import { Message } from "./message.ts";

const signIn = (model: Model, h: HtmlBuilder<Message>) =>
  h.main(
    [h.Class("signin")],
    [
      h.h1([h.Class("brand")], ["Calorie Tracker"]),
      h.p([h.Class("lede")], ["Sign in to see today's calories."]),
      h.form(
        [h.Class("card form"), h.OnSubmit(Message.SubmittedSignIn())],
        [
          h.label([h.Class("field")], [
            h.span([h.Class("field-label")], ["Email"]),
            h.input([
              h.Class("input"),
              h.Type("email"),
              h.Name("email"),
              h.Autocomplete("email"),
              h.Placeholder("you@example.com"),
              h.Required(true),
              h.Value(model.email),
              h.OnInput((value) => Message.ChangedEmail({ value })),
            ]),
          ]),
          h.label([h.Class("field")], [
            h.span([h.Class("field-label")], ["Password"]),
            h.input([
              h.Class("input"),
              h.Type("password"),
              h.Name("password"),
              h.Autocomplete("current-password"),
              h.Placeholder("Your password"),
              h.Required(true),
              h.Value(model.password),
              h.OnInput((value) => Message.ChangedPassword({ value })),
            ]),
          ]),
          h.button(
            [h.Class("primary"), h.Type("submit"), h.Disabled(model.busy)],
            [model.busy ? "Signing in..." : "Sign in"],
          ),
        ],
      ),
      model.error === null
        ? h.empty
        : h.p([h.Class("error"), h.Role("alert")], [model.error]),
      h.p([h.Class("fineprint")], ["This account is the same food log your AI chats read and change."]),
    ],
  );

const macro = (label: string, grams: number, h: HtmlBuilder<Message>) =>
  h.div([h.Class("macro")], [
    h.span([h.Class("macro-label")], [label]),
    h.span([h.Class("macro-value")], [`${groupThousands(grams)} g`]),
  ]);

const entryRow = (model: Model, entry: Entry, h: HtmlBuilder<Message>) => {
  const source = sourceLabel(entry);
  const portion = entry.portion_text === null || entry.portion_text.length === 0 ? null : entry.portion_text;
  return h.li([h.Key(String(entry.id))], [
    h.button(
      [h.Class("row"), h.Type("button"), h.OnClick(Message.ClickedEdit({ id: entry.id }))],
      [
        h.span([h.Class("row-time")], [entryTime(entry.eaten_at, model.day?.timezone ?? "UTC")]),
        h.span([h.Class("row-main")], [
          h.span([h.Class("row-name")], [entry.name]),
          h.span([h.Class("row-sub")], [portion === null ? source : `${portion} · ${source}`]),
        ]),
        h.span([h.Class("row-kcal")], [`${groupThousands(entry.kcal)} kcal`]),
      ],
    ),
  ]);
};

const home = (model: Model, h: HtmlBuilder<Message>) => {
  const day = model.day;
  const goal = day?.goal_kcal ?? 0;
  const consumed = day?.consumed_kcal ?? 0;
  const percent = progressPercent(consumed, goal);
  return h.main(
    [h.Class("home")],
    [
      h.header([h.Class("topbar")], [
        h.div([h.Class("topbar-text")], [
          h.p([h.Class("today")], [day === null ? "Today" : dayLabel(day.date)]),
          h.h1([h.Class("brand-small")], ["Calorie Tracker"]),
        ]),
        h.button(
          [h.Class("ghost"), h.Type("button"), h.OnClick(Message.ClickedSignOut())],
          ["Sign out"],
        ),
      ]),
      day === null
        ? h.p(
            [h.Class("card empty")],
            [model.loading || model.busy ? "Loading today..." : "Today's numbers did not load."],
          )
        : h.div(
            [],
            [
              h.section([h.Class("card hero")], [
                h.p([h.Class("card-label")], ["Calories eaten today"]),
                h.p([h.Class("total")], [
                  h.span([h.Class("total-number")], [groupThousands(consumed)]),
                  h.span([h.Class("total-unit")], ["kcal"]),
                ]),
                h.div([h.Class("goal-row")], [
                  h.span([], [`of ${groupThousands(goal)} kcal goal`]),
                  h.span([h.Class("left")], [remainingLabel(day.remaining_kcal)]),
                ]),
                h.div(
                  [h.Class("progress"), h.Role("progressbar"), h.AriaLabel("Calories eaten today")],
                  [h.div([h.Class("progress-fill"), h.Style({ width: `${percent}%` })], [])],
                ),
                h.div([h.Class("macros")], [
                  macro("Protein", day.protein_g, h),
                  macro("Carbs", day.carbs_g, h),
                  macro("Fat", day.fat_g, h),
                ]),
              ]),
              h.section([h.Class("entries")], [
                h.div([h.Class("entries-head")], [
                  h.h2([h.Class("entries-title")], ["Today's entries"]),
                  h.span([h.Class("count")], [
                    `${day.entries.length} ${day.entries.length === 1 ? "entry" : "entries"}`,
                  ]),
                ]),
                day.entries.length === 0
                  ? h.p([h.Class("empty-entries")], ["Nothing logged yet today. Tap + to add food."])
                  : h.ul([h.Class("rows")], day.entries.map((entry) => entryRow(model, entry, h))),
              ]),
            ],
          ),
      h.button(
        [h.Class("fab"), h.Type("button"), h.AriaLabel("Add food"), h.OnClick(Message.ClickedAdd())],
        ["+"],
      ),
      model.undoId === null
        ? h.empty
        : h.div([h.Class("undo"), h.Role("status")], [
            h.span([], [`Deleted ${model.undoName}`]),
            h.button(
              [h.Class("undo-button"), h.Type("button"), h.OnClick(Message.ClickedUndo())],
              ["Undo"],
            ),
          ]),
      sheet(model, h),
    ],
  );
};

const sheet = (model: Model, h: HtmlBuilder<Message>) => {
  if (model.sheet === "none") return h.empty;
  const editing = model.sheet === "edit";
  return h.div(
    [h.Class("sheet-backdrop")],
    [
      h.form(
        [
          h.Class("sheet"),
          h.AriaLabel(editing ? "Edit entry form" : "Add food form"),
          h.OnSubmit(editing ? Message.SubmittedEdit() : Message.SubmittedAdd()),
        ],
        [
          h.div([h.Class("sheet-head")], [
            h.h2([h.Class("sheet-title")], [editing ? "Edit entry" : "Add food"]),
            h.button(
              [h.Class("ghost"), h.Type("button"), h.OnClick(Message.ClosedSheet())],
              ["Close"],
            ),
          ]),
          h.label([h.Class("field")], [
            h.span([h.Class("field-label")], ["Food"]),
            h.input([
              h.Class("input"),
              h.Type("text"),
              h.Placeholder("Porridge with banana"),
              h.Value(model.draftName),
              h.OnInput((value) => Message.ChangedDraftName({ value })),
            ]),
          ]),
          h.label([h.Class("field")], [
            h.span([h.Class("field-label")], ["Calories"]),
            h.input([
              h.Class("input"),
              h.Type("number"),
              h.InputMode("numeric"),
              h.Placeholder("310"),
              h.Min("0"),
              h.Max("20000"),
              h.Value(model.draftKcal),
              h.OnInput((value) => Message.ChangedDraftKcal({ value })),
            ]),
          ]),
          h.label([h.Class("field")], [
            h.span([h.Class("field-label")], ["Portion (optional)"]),
            h.input([
              h.Class("input"),
              h.Type("text"),
              h.Placeholder("1 bowl"),
              h.Value(model.draftPortion),
              h.OnInput((value) => Message.ChangedDraftPortion({ value })),
            ]),
          ]),
          h.button(
            [h.Class("primary"), h.Type("submit"), h.Disabled(model.busy)],
            [editing ? "Save entry" : "Add to log"],
          ),
          editing && model.editingId !== null
            ? h.button(
                [
                  h.Class("danger"),
                  h.Type("button"),
                  h.Disabled(model.busy),
                  h.OnClick(Message.ClickedDelete({ id: model.editingId, name: model.draftName })),
                ],
                ["Delete entry"],
              )
            : h.empty,
        ],
      ),
    ],
  );
};

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: model.day === null ? "Calorie Tracker" : `${groupThousands(model.day.consumed_kcal)} kcal today`,
  body: h.div([h.Class("app")], [
    model.token === null ? signIn(model, h) : home(model, h),
    model.error === null || model.token === null
      ? h.empty
      : h.div([h.Class("toast"), h.Role("alert")], [
          h.span([], [model.error]),
          h.button(
            [h.Class("toast-close"), h.Type("button"), h.OnClick(Message.DismissedError())],
            ["Dismiss"],
          ),
        ]),
  ]),
});
