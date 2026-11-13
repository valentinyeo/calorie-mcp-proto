import * as z from "zod";

import type { Auth } from "./auth.js";
import {
  addEntry,
  dayTotals,
  deleteEntry,
  getEntry,
  getProfile,
  listBetween,
  localDate,
  restoreEntry,
  updateEntry,
} from "./db.js";

// The app talks to the same per-user food log as the MCP tools. Auth is the Bearer
// session token issued at /sign-in/email; nothing here trusts a user id from the body.
const input = z.object({
  name: z.string().trim().min(1).max(200),
  kcal: z.number().int().min(0).max(20000),
  portion_text: z.string().max(120).optional(),
}).strict();
const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function appApi(request: Request, auth: Auth, db: D1Database): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  const userId = session?.user?.id;
  if (!userId) return reply({ error: "Sign in again to see your log." }, 401);

  const url = new URL(request.url);
  const profile = await getProfile(db, userId);
  const today = localDate(new Date(), profile.timezone);
  const day = async () => ({
    ...await dayTotals(db, userId, today),
    timezone: profile.timezone,
    entries: (await listBetween(db, userId, today, today)).reverse(),
  });

  try {
    if (url.pathname === "/api/app/day" && request.method === "GET") return reply({ day: await day() });
    if (url.pathname === "/api/app/day") return reply({ error: "Method not allowed" }, 405);
    if (url.pathname === "/api/app/entries" && request.method === "POST") {
      const entry = await addEntry(db, userId, input.parse(await request.json()), {
        clientName: "Android",
        source: "app",
      });
      return reply({ day: await day(), entry }, 201);
    }
    if (url.pathname === "/api/app/entries") return reply({ error: "Method not allowed" }, 405);

    const match = /^\/api\/app\/entries\/(\d+)(\/restore)?$/.exec(url.pathname);
    if (!match) return reply({ error: "Not found" }, 404);
    const id = idSchema.parse(match[1]);

    if (match[2] && request.method === "POST") {
      const entry = await restoreEntry(db, userId, id);
      if (!entry) return reply({ error: "That entry cannot be restored." }, 404);
      return reply({ day: await day(), entry });
    }
    if (match[2]) return reply({ error: "Method not allowed" }, 405);
    if (request.method !== "PATCH" && request.method !== "DELETE") {
      return reply({ error: "Method not allowed" }, 405);
    }
    if (!await getEntry(db, userId, id)) return reply({ error: "Entry not found" }, 404);
    const entry = request.method === "DELETE"
      ? await deleteEntry(db, userId, id)
      : await updateEntry(db, userId, id, input.partial().parse(await request.json()));
    return reply({ day: await day(), entry });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return reply({ error: "Check the food name, calories and portion." }, 400);
    }
    throw error;
  }
}
