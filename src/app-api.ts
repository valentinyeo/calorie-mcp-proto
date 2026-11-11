import * as z from "zod";
import {
  addEntry, dayTotals, deleteEntry, getEntry, getProfile, listBetween, localDate,
  restoreEntry, updateEntry,
} from "./db";

const input = z.object({
  name: z.string().trim().min(1).max(200),
  kcal: z.number().int().min(0).max(20000),
  portion_text: z.string().max(120).optional(),
}).strict();
const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export async function appApi(request: Request, db: D1Database, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const profile = await getProfile(db, userId);
  const today = localDate(new Date(), profile.timezone);
  const day = async () => ({
    ...await dayTotals(db, userId, today),
    timezone: profile.timezone,
    entries: (await listBetween(db, userId, today, today)).reverse(),
  });
  const reply = (body: unknown, status = 200) => Response.json(body, {
    status, headers: { "cache-control": "no-store" },
  });
  try {
    if (url.pathname === "/api/app/day" && request.method === "GET") return reply(await day());
    if (url.pathname === "/api/app/entries" && request.method === "POST") {
      const entry = await addEntry(db, userId, input.parse(await request.json()), { source: "app", clientName: "Android" });
      return reply({ entry, day: await day() }, 201);
    }
    const match = /^\/api\/app\/entries\/(\d+)(\/restore)?$/.exec(url.pathname);
    if (!match) return reply({ error: "Not found" }, 404);
    const id = idSchema.parse(match[1]);
    if (match[2] && request.method === "POST") {
      const entry = await restoreEntry(db, userId, id);
      if (!entry) return reply({ error: "Entry not found" }, 404);
      return reply({ entry, day: await day() });
    }
    if (match[2]) return reply({ error: "Method not allowed" }, 405);
    if (!["PATCH", "DELETE"].includes(request.method)) return reply({ error: "Method not allowed" }, 405);
    if (!await getEntry(db, userId, id)) return reply({ error: "Entry not found" }, 404);
    const entry = request.method === "DELETE"
      ? await deleteEntry(db, userId, id)
      : await updateEntry(db, userId, id, input.partial().parse(await request.json()));
    return reply({ entry, day: await day() });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: "Check the food name, calories and portion" }, 400);
    throw error;
  }
}
