// Android app shared-log proof for SOFT-1274.
// Scripted OAuth 2.1 (DCR + PKCE + consent) for two users, then every MCP tool, then an
// isolation check: user B must not read, edit or delete user A's entries.
//   node scripts/e2e-v1.mjs            # local worker on 127.0.0.1:8787 by default
//   BASE=https://... node scripts/e2e-v1.mjs
// Tokens, passwords and codes are redacted before anything is written to proof/.
import { writeFileSync, mkdirSync } from "node:fs";

import { makeConnector } from "./lib/oauth.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const REDIRECT = "dev.calorie.tracker://oauth/callback";
const APP_ORIGIN = process.env.APP_ORIGIN ?? "https://localhost";
const PROOF = process.env.PROOF ?? "proof/app-api.txt";

const lines = [`SOFT-1274 Android shared-log proof. Base ${BASE}. Run at ${new Date().toISOString()}.`];
const secrets = new Set();
const redact = (s) => [...secrets].reduce((t, v) => t.split(v).join("<redacted>"), s);
const log = (...a) => {
  const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ");
  lines.push(s);
  console.log(redact(s));
};

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  log(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`);
};

const connect = makeConnector({ base: BASE, check, log, secrets });

const payload = (response) => JSON.parse(response.body.result.content[0].text);
let id = 1;

// The app signs in with email and password and keeps the session token the bearer plugin
// returns in set-auth-token. This is the exact request the Android WebView makes.
const appSignIn = async (email, password) => {
  const response = await fetch(BASE + "/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  const json = await response.json().catch(() => ({}));
  const token = response.headers.get("set-auth-token") ?? json.token;
  if (token) secrets.add(token);
  check(response.status === 200 && !!token, "app email sign-in returns a session token", response.status);
  check(response.headers.get("access-control-allow-origin") === APP_ORIGIN,
    "app sign-in is allowed from the WebView origin", response.headers.get("access-control-allow-origin"));
  check((response.headers.get("access-control-expose-headers") ?? "").includes("set-auth-token"),
    "the session token header is exposed to the WebView");
  return token;
};

const a = await connect("app-a");
const b = await connect("app-b");
const aToken = await appSignIn(a.email, a.password);
const bToken = await appSignIn(b.email, b.password);

// Preflight for the app's JSON calls: Capacitor serves the bundle from https://localhost,
// so every API call with an Authorization header is a cross-origin preflight.
let preflight = await fetch(BASE + "/api/app/entries", {
  method: "OPTIONS",
  headers: {
    origin: APP_ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,content-type",
  },
});
check(preflight.status === 204
  && preflight.headers.get("access-control-allow-origin") === APP_ORIGIN
  && (preflight.headers.get("access-control-allow-headers") ?? "").includes("authorization"),
  "CORS preflight allows the app to POST JSON with a bearer token", preflight.status);

const api = async (token, path, method = "GET", body) => {
  const response = await fetch(BASE + "/api/app/" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
};
const tool = async (name, args) => payload(await a.rpc("tools/call", { name, arguments: args }, id++));
await a.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "app-proof", version: "1" } }, id++);

check((await api(null, "day")).status === 401, "anonymous app read denied");
check((await api("not-a-session", "day")).status === 401, "a forged bearer token cannot read the log");
check((await api(null, "entries", "POST", { name: "No", kcal: 1 })).status === 401, "anonymous app write denied");

const fromMcp = await tool("add_entry", { name: "Porridge from MCP", kcal: 350, portion_text: "1 bowl" });
let result = await api(aToken, "day");
check(result.status === 200 && result.body.day.entries[0].id === fromMcp.entry.id && result.body.day.consumed_kcal === 350,
  "an entry added from Claude (MCP) shows on the app's home day", { total: result.body.day.consumed_kcal });
check(result.body.day.timezone === "Europe/London" && result.body.day.remaining_kcal === 1650,
  "app home gets today's goal and calories left from the server");
check(result.body.day.entries[0].source === "mcp" && result.body.day.entries[0].client_name !== null,
  "the MCP entry keeps its source and client label");
check(result.body.day.entries[0].portion_text === "1 bowl", "the portion is shown with the entry");

const added = await api(aToken, "entries", "POST", { name: "Banana", kcal: 105, portion_text: "1 medium" });
const foodId = added.body.entry?.id;
check(added.status === 201 && added.body.day.entries[0].id === foodId && added.body.entry.source === "app",
  "text add from the app saves with app source and newest-first order");
for (const bad of [{ name: "", kcal: 10 }, { name: "Food", kcal: -1 }, { name: "Food", kcal: 1.2 }, { name: "Food", kcal: 20001 }, { name: "Food", kcal: 1, user_id: "other" }]) {
  check((await api(aToken, "entries", "POST", bad)).status === 400, "invalid food rejected: " + JSON.stringify(bad));
}
check((await api(bToken, "day")).body.day.entries.length === 0, "another account cannot read the first account's log");
check((await api(bToken, `entries/${foodId}`, "PATCH", { kcal: 1 })).status === 404, "cross-account edit denied");
check((await api(bToken, `entries/${foodId}`, "DELETE")).status === 404, "cross-account delete denied");

const changed = await api(aToken, `entries/${fromMcp.entry.id}`, "PATCH", { kcal: 400, portion_text: "1 big bowl" });
check(changed.status === 200 && changed.body.entry.kcal === 400, "edit from the app saves");
let shared = await tool("get_day", {});
check(shared.entries.some((entry) => entry.id === fromMcp.entry.id && entry.kcal === 400 && entry.portion_text === "1 big bowl"),
  "the app's edit is visible through real MCP");

const deleted = await api(aToken, `entries/${fromMcp.entry.id}`, "DELETE");
check(deleted.status === 200 && deleted.body.day.consumed_kcal === 105, "delete updates today's total");
check(!(await tool("get_day", {})).entries.some((entry) => entry.id === fromMcp.entry.id), "MCP no longer sees the deleted entry");
check((await api(bToken, `entries/${fromMcp.entry.id}/restore`, "POST", {})).status === 404, "cross-account undo denied");
const restored = await api(aToken, `entries/${fromMcp.entry.id}/restore`, "POST", {});
check(restored.status === 200 && restored.body.entry.id === fromMcp.entry.id
  && restored.body.entry.source === "mcp" && restored.body.entry.eaten_at === fromMcp.entry.eaten_at,
  "undo restores the same entry with its source and original time");
check((await api(aToken, `entries/${fromMcp.entry.id}/restore`, "POST", {})).status === 404, "double undo cannot duplicate a food");
shared = await tool("get_day", {});
check(shared.entries.length === 2 && shared.consumed_kcal === 505, "MCP sees the restored entry exactly once", { entries: shared.entries.length, consumed: shared.consumed_kcal });

await tool("set_goal", { kcal: 2100, timezone: "Pacific/Kiritimati" });
result = await api(aToken, "day");
check(result.body.day.timezone === "Pacific/Kiritimati" && result.body.day.goal_kcal === 2100
  && result.body.day.date === new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  "app today follows the profile timezone, not the device or UTC");

mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
check(failures === 0, "Android app API proof complete", { failures });
process.exit(failures ? 1 : 0);
