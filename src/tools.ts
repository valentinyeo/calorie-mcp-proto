import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import {
  addDays,
  addEntry,
  dayTotals,
  deleteEntry,
  getProfile,
  isValidTimezone,
  listBetween,
  localDate,
  setGoal,
  updateEntry,
  type Entry,
} from "./db";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = (description: string) =>
  z.string().regex(DATE, "Use YYYY-MM-DD").optional().describe(description);

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** Free plan: the last 30 days. Pro: everything up to `pro_until`. */
function assertInRange(profile: { pro_until: string | null }, timezone: string, date: string) {
  if (profile.pro_until && new Date(profile.pro_until).getTime() > Date.now()) return;
  const earliest = addDays(localDate(new Date(), timezone), -29);
  if (date < earliest) throw new Error(`That date is outside your plan's range (free plan: ${earliest} onwards).`);
}

export function registerTools(server: McpServer, db: D1Database, userId: string, clientName: string | null) {
  server.registerTool(
    "get_day",
    {
      description:
        "Read one day of the signed-in user's food log: calories eaten, the daily goal, calories left and macros. Defaults to today in the user's timezone. Use this for questions like 'how much have I eaten today'.",
      inputSchema: { date: dateSchema("Day to read, YYYY-MM-DD. Defaults to today.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date }) => {
      const profile = await getProfile(db, userId);
      const day = date ?? localDate(new Date(), profile.timezone);
      assertInRange(profile, profile.timezone, day);
      const totals = await dayTotals(db, userId, day);
      const entries = await listBetween(db, userId, day, day);
      return text({ ...totals, entries });
    },
  );

  server.registerTool(
    "list_entries",
    {
      description:
        "List food log entries for one day, or for a date range. Read-only. Defaults to today in the user's timezone.",
      inputSchema: {
        date: dateSchema("Single day, YYYY-MM-DD."),
        from: dateSchema("Range start, YYYY-MM-DD."),
        to: dateSchema("Range end, YYYY-MM-DD."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ date, from, to }) => {
      const profile = await getProfile(db, userId);
      const today = localDate(new Date(), profile.timezone);
      const start = from ?? date ?? today;
      const end = to ?? date ?? today;
      if (start > end) throw new Error("from must be on or before to");
      assertInRange(profile, profile.timezone, start);
      assertInRange(profile, profile.timezone, end);
      const entries = await listBetween(db, userId, start, end);
      return text({ from: start, to: end, count: entries.length, entries });
    },
  );

  server.registerTool(
    "add_entry",
    {
      description:
        "Add one food entry to the signed-in user's log and return the entry plus the new day total. Estimate the calories yourself from the food and portion the user describes, and state the estimate in your reply. Do not invent macro values: leave them out when you are not confident.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Food name, e.g. 'Porridge with banana'"),
        kcal: z.number().int().min(0).max(20000).describe("Calories for this portion, integer"),
        protein_g: z.number().min(0).max(2000).optional().describe("Protein in grams"),
        carbs_g: z.number().min(0).max(2000).optional().describe("Carbohydrate in grams"),
        fat_g: z.number().min(0).max(2000).optional().describe("Fat in grams"),
        portion_text: z.string().max(120).optional().describe("Portion as the user said it, e.g. '1 bowl'"),
        eaten_at: z
          .string()
          .optional()
          .describe("When it was eaten, ISO 8601 instant. Defaults to now. Convert local times to UTC."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const profile = await getProfile(db, userId);
      const entry = await addEntry(db, userId, input, { source: "mcp", clientName });
      const totals = await dayTotals(db, userId, entry.local_date);
      return text({ entry, day: totals });
    },
  );

  server.registerTool(
    "update_entry",
    {
      description:
        "Change fields of one existing entry (for example its calories or portion). Only the fields you pass change. The entry must belong to the signed-in user.",
      inputSchema: {
        id: z.number().int().positive().describe("Entry id from get_day or list_entries"),
        name: z.string().min(1).max(200).optional(),
        kcal: z.number().int().min(0).max(20000).optional(),
        protein_g: z.number().min(0).max(2000).optional(),
        carbs_g: z.number().min(0).max(2000).optional(),
        fat_g: z.number().min(0).max(2000).optional(),
        portion_text: z.string().max(120).optional(),
        eaten_at: z.string().optional().describe("New time, ISO 8601 instant (UTC)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...patch }) => {
      const entry = await updateEntry(db, userId, id, patch);
      const totals = await dayTotals(db, userId, entry.local_date);
      return text({ entry, day: totals });
    },
  );

  server.registerTool(
    "delete_entry",
    {
      description:
        "Delete one entry (soft delete, so it can be undone). Confirm with the user before deleting, unless they already said to delete it.",
      inputSchema: { id: z.number().int().positive().describe("Entry id from get_day or list_entries") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const entry = await deleteEntry(db, userId, id);
      const totals = await dayTotals(db, userId, entry.local_date);
      return text({ ok: true, deleted: entry, day: totals });
    },
  );

  server.registerTool(
    "set_goal",
    {
      description: "Set the signed-in user's daily calorie goal in kcal. Returns the new goal.",
      inputSchema: {
        kcal: z.number().int().min(500).max(10000).describe("Daily goal in kcal"),
        timezone: z
          .string()
          .optional()
          .describe("Optional IANA timezone, e.g. Europe/London, to fix which day entries count against"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ kcal, timezone }) => {
      if (timezone !== undefined && !isValidTimezone(timezone)) throw new Error(`unknown timezone: ${timezone}`);
      if (timezone) {
        await getProfile(db, userId);
        await db.prepare("update profile set timezone = ?, updated_at = ? where user_id = ?")
          .bind(timezone, new Date().toISOString(), userId)
          .run();
      }
      const goal = await setGoal(db, userId, kcal);
      const profile = await getProfile(db, userId);
      return text({ goal_kcal: goal, timezone: profile.timezone });
    },
  );
}

export type { Entry };
