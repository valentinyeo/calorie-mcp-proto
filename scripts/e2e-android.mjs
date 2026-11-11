// Android shared-log proof proof for IGSH-1274.
// Scripted OAuth 2.1 (DCR + PKCE + consent) for two users, then every MCP tool, then an
// isolation check: user B must not read, edit or delete user A's entries.
//   node scripts/e2e-v1.mjs            # local worker on 127.0.0.1:8787 by default
//   BASE=https://... node scripts/e2e-v1.mjs
// Tokens, passwords and codes are redacted before anything is written to proof/.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const RESOURCE = BASE + "/mcp";
const REDIRECT = "dev.calorie.tracker://oauth/callback";
const PROOF = process.env.PROOF ?? "proof/android-api.txt";

const lines = [`IGSH-1274 Android shared-log proof. Base ${BASE}. Run at ${new Date().toISOString()}.`];
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

const json = (b) => ({ "content-type": "application/json", ...b });

function session() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
  };
  const http = async (url, init = {}) => {
    const res = await fetch(url, { redirect: "manual", ...init, headers: { cookie: cookieHeader(), ...(init.headers ?? {}) } });
    absorb(res);
    return res;
  };
  return { jar, http, clear: () => jar.clear() };
}

const nextLoc = async (res) => res.headers.get("location") ?? (await res.json()).url;

// Create the user (sign-up must be open), then run the real OAuth dance and return a token.
async function connect(tag, scope = "mcp:read mcp:write offline_access") {
  const email = `v1-${tag}-${randomBytes(3).toString("hex")}@example.com`;
  const password = randomBytes(18).toString("base64url");
  secrets.add(password);
  const s = session();

  log(`\n== ${tag}: sign up ${email}`);
  let r = await s.http(BASE + "/sign-up/email", {
    method: "POST",
    headers: json({ origin: BASE }),
    body: JSON.stringify({ email, password, name: `Tester ${tag}` }),
  });
  check(r.status === 200, `${tag} sign-up`, r.status);
  s.clear();

  r = await s.http(BASE + "/oauth2/register", {
    method: "POST",
    headers: json({}),
    body: JSON.stringify({
      client_name: "v1-e2e-script",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      application_type: "native",
    }),
  });
  const client = await r.json();
  check((r.status === 200 || r.status === 201) && !!client.client_id, `${tag} dynamic client registration`, r.status);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const authUrl = BASE + "/oauth2/authorize?" + new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  }).toString();

  r = await s.http(authUrl);
  let loc = await nextLoc(r);
  check(!!loc && loc.includes("/sign-in"), `${tag} authorize sends an anonymous caller to the sign-in page`, loc?.split("?")[0]);

  r = await s.http(BASE + "/sign-in/email", {
    method: "POST",
    headers: json({ origin: BASE }),
    body: JSON.stringify({ email, password, oauth_query: new URL(loc, BASE).search.slice(1) }),
  });
  let body = await r.json();
  check(r.status === 200 && !!body.url, `${tag} sign-in`, { status: r.status, url: body.url?.split("?")[0] });
  loc = body.url;

  if (!new URL(loc, BASE).pathname.startsWith("/consent")) {
    r = await s.http(new URL(loc, BASE).toString());
    loc = await nextLoc(r);
  }
  let code;
  if (loc.startsWith(REDIRECT)) code = new URL(loc).searchParams.get("code");
  else {
    r = await s.http(BASE + "/oauth2/consent", {
      method: "POST",
      headers: json({ origin: BASE }),
      body: JSON.stringify({ accept: true, oauth_query: new URL(loc, BASE).search.slice(1) }),
    });
    body = await r.json();
    const cb = new URL(body.url);
    check(cb.searchParams.get("state") === state, `${tag} consent returns the right state`, cb.searchParams.get("state") === state);
    code = cb.searchParams.get("code");
  }
  secrets.add(code);

  r = await fetch(BASE + "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  const tok = await r.json();
  check(r.status === 200 && !!tok.access_token, `${tag} token exchange with PKCE`, { status: r.status, err: tok.error_description });
  secrets.add(tok.access_token);
  if (tok.refresh_token) secrets.add(tok.refresh_token);

  const rpc = async (method, params, id) => {
    const res = await fetch(RESOURCE, {
      method: "POST",
      headers: {
        authorization: "Bearer " + tok.access_token,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        "user-agent": `v1-e2e-script/${tag}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { email, token: tok.access_token, rpc };
}

const payload = (response) => JSON.parse(response.body.result.content[0].text);
let id = 1;
const a = await connect("android-a");
const b = await connect("android-b");
const readonly = await connect("android-readonly", "mcp:read");
const api = async (user, path, method = "GET", body) => {
  const response = await fetch(BASE + "/api/app/" + path, {
    method,
    headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${user.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};
const tool = async (name, args) => payload(await a.rpc("tools/call", { name, arguments: args }, id++));
await a.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "android-proof", version: "1" } }, id++);
check((await api(null, "day")).status === 401, "anonymous app read denied");
check((await api(null, "entries", "POST", { name: "No", kcal: 1 })).status === 401, "anonymous app write denied");
check((await api(readonly, "day")).status === 200, "read scope permits app day");
check((await api(readonly, "entries", "POST", { name: "No", kcal: 1 })).status === 403, "read scope cannot write through app API");
const fromMcp = await tool("add_entry", { name: "Porridge from MCP", kcal: 350, portion_text: "1 bowl" });
let result = await api(a, "day");
check(result.status === 200 && result.body.entries[0].id === fromMcp.entry.id && result.body.consumed_kcal === 350,
  "MCP entry appears in app day", { total: result.body.consumed_kcal });
check(result.body.timezone === "Europe/London" && result.body.remaining_kcal === 1650, "app returns profile timezone, goal and left");
check(result.body.entries[0].source === "mcp", "MCP source preserved in app");
const added = await api(a, "entries", "POST", { name: "Banana", kcal: 105, portion_text: "1 medium" });
const foodId = added.body.entry?.id;
check(added.status === 201 && added.body.day.entries[0].id === foodId && added.body.entry.source === "app", "text add, app source and newest-first sorting");
for (const bad of [{ name: "", kcal: 10 }, { name: "Food", kcal: -1 }, { name: "Food", kcal: 1.2 }, { name: "Food", kcal: 20001 }, { name: "Food", kcal: 1, user_id: "other" }]) {
  check((await api(a, "entries", "POST", bad)).status === 400, "invalid food rejected");
}
check((await api(b, "day")).body.entries.length === 0, "other account cannot read first account's log");
check((await api(b, `entries/${foodId}`, "PATCH", { kcal: 1 })).status === 404, "cross-account edit denied");
check((await api(b, `entries/${foodId}`, "DELETE")).status === 404, "cross-account delete denied");
const changed = await api(a, `entries/${fromMcp.entry.id}`, "PATCH", { kcal: 400, portion_text: "1 big bowl" });
check(changed.status === 200 && changed.body.entry.kcal === 400, "app edit succeeds");
let shared = await tool("get_day", {});
check(shared.entries.some(entry => entry.id === fromMcp.entry.id && entry.kcal === 400 && entry.portion_text === "1 big bowl"), "app edit is visible through real MCP");
const deleted = await api(a, `entries/${fromMcp.entry.id}`, "DELETE");
check(deleted.status === 200 && deleted.body.day.consumed_kcal === 105, "delete updates total");
check(!(await tool("get_day", {})).entries.some(entry => entry.id === fromMcp.entry.id), "MCP no longer sees deleted entry");
check((await api(b, `entries/${fromMcp.entry.id}/restore`, "POST", {})).status === 404, "cross-account restore denied");
const restored = await api(a, `entries/${fromMcp.entry.id}/restore`, "POST", {});
check(restored.status === 200 && restored.body.entry.id === fromMcp.entry.id && restored.body.entry.source === "mcp" && restored.body.entry.eaten_at === fromMcp.entry.eaten_at,
  "undo preserves identity, source and original timestamp");
check((await api(a, `entries/${fromMcp.entry.id}/restore`, "POST", {})).status === 404, "double undo cannot duplicate a food");
shared = await tool("get_day", {});
check(shared.entries.length === 2 && shared.consumed_kcal === 505, "MCP sees restored entry exactly once");
await tool("set_goal", { kcal: 2100, timezone: "Pacific/Kiritimati" });
result = await api(a, "day");
check(result.body.timezone === "Pacific/Kiritimati" && result.body.goal_kcal === 2100 && result.body.date === new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), "app today follows profile timezone rather than device or UTC");
mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
check(failures === 0, "Android API proof complete", { failures });
process.exit(failures ? 1 : 0);
