// Scripted OAuth 2.1 + PKCE flow against the deployed worker, then MCP calls. Proofs b and c.
// Run under a D1-capable Cloudflare token (only used to seed one row):  node scripts/e2e.mjs
// The test password and every token live in memory only; the log is redacted before it is written.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev";
const RESOURCE = BASE + "/mcp";
const REDIRECT = "http://127.0.0.1:8976/callback";
const email = `proto-${randomBytes(3).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");
const secrets = new Set([password]);
const lines = [];
const log = (...a) => {
  const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ");
  lines.push(s);
  console.log(redact(s));
};
const redact = (s) => [...secrets].reduce((t, v) => t.split(v).join("<redacted>"), s);

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
}
async function http(url, init = {}) {
  const res = await fetch(url, { redirect: "manual", ...init, headers: { cookie: cookieHeader(), ...(init.headers ?? {}) } });
  absorb(res);
  return res;
}
const json = (b) => ({ "content-type": "application/json", ...b });

// 0. create the test user (sign-up is open only while SIGNUP_OPEN=1) and seed one entry
log("== 0. sign up test user", email);
let r = await http(BASE + "/sign-up/email", { method: "POST", headers: json({ origin: BASE }), body: JSON.stringify({ email, password, name: "Proto Tester" }) });
log("sign-up status", r.status);
jar.clear();
const today = new Date().toISOString().slice(0, 10);
execFileSync("wrangler", ["d1", "execute", "calorie-mcp-proto", "--remote", "--command",
  `insert into entries (user_id, date, name, kcal, meal) select id, '${today}', 'Porridge with banana', 350, 'breakfast' from "user" where email='${email}'`], { stdio: "pipe" });
log("seeded entry for", today);

// 1. dynamic client registration (public client, PKCE)
log("== 1. register client (RFC 7591)");
r = await http(BASE + "/oauth2/register", { method: "POST", headers: json({}), body: JSON.stringify({
  client_name: "proto-script", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], application_type: "native" }) });
const client = await r.json();
log("register status", r.status, { client_id: client.client_id, token_endpoint_auth_method: client.token_endpoint_auth_method, redirect_uris: client.redirect_uris });

// 2. authorize: unauthenticated -> login page -> sign in -> consent -> code
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const authUrl = BASE + "/oauth2/authorize?" + new URLSearchParams({
  client_id: client.client_id, redirect_uri: REDIRECT, response_type: "code", scope: "mcp:read offline_access",
  state, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE }).toString();
log("== 2. authorize (no session yet)");
// A browser navigation gets a 302; Node fetch is treated as a "fetch" request and gets {redirect:true,url} JSON. Handle both.
const nextLoc = async (res) => res.headers.get("location") ?? (await res.json()).url;
r = await http(authUrl);
let loc = await nextLoc(r);
log("authorize status", r.status, "->", loc?.split("?")[0]);
const loginQuery = new URL(loc, BASE).search.slice(1);
log("== 2b. sign in through the login page's API call");
r = await http(BASE + "/sign-in/email", { method: "POST", headers: json({ origin: BASE }), body: JSON.stringify({ email, password, oauth_query: loginQuery }) });
let body = await r.json();
log("sign-in status", r.status, { redirect: body.redirect, url: body.url?.split("?")[0] });
// Better Auth sends the browser straight on to the next prompt (here: /consent), or to authorize.
loc = body.url;
if (!new URL(loc, BASE).pathname.startsWith("/consent")) { r = await http(new URL(loc, BASE).toString()); loc = await nextLoc(r); log("authorize (with session) status", r.status, "->", loc?.split("?")[0]); }
let code;
if (loc.startsWith(REDIRECT)) code = new URL(loc).searchParams.get("code");
else {
  const consentQuery = new URL(loc, BASE).search.slice(1);
  log("== 2c. consent");
  r = await http(BASE + "/oauth2/consent", { method: "POST", headers: json({ origin: BASE }), body: JSON.stringify({ accept: true, oauth_query: consentQuery }) });
  body = await r.json();
  log("consent status", r.status, { url: body.url?.split("?")[0] });
  const cb = new URL(body.url);
  log("callback params", { state_ok: cb.searchParams.get("state") === state, iss: cb.searchParams.get("iss"), has_code: !!cb.searchParams.get("code") });
  code = cb.searchParams.get("code");
}
secrets.add(code);

// 3. token exchange with PKCE + resource
log("== 3. token exchange (PKCE S256, resource indicator)");
r = await fetch(BASE + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
  grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }) });
const tok = await r.json();
log("token status", r.status, { err: tok.error_description,  token_type: tok.token_type, expires_in: tok.expires_in, scope: tok.scope, has_refresh_token: !!tok.refresh_token, error: tok.error });
secrets.add(tok.access_token);
if (tok.refresh_token) secrets.add(tok.refresh_token);
const claims = JSON.parse(Buffer.from(tok.access_token.split(".")[1], "base64url"));
log("access token claims", { iss: claims.iss, aud: claims.aud, azp: claims.azp === client.client_id ? "<client_id>" : claims.azp, scope: claims.scope, sub: "<user id>", exp_in: claims.exp - claims.iat });

// 4. MCP over streamable HTTP
const rpc = async (method, params, id = 1) => {
  const res = await fetch(RESOURCE, { method: "POST", headers: { authorization: "Bearer " + tok.access_token, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
log("== 4. MCP calls with the bearer token");
log("initialize", await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "proto-script", version: "1" } }));
const list = await rpc("tools/list", {}, 2);
log("tools/list", list);
const call = await rpc("tools/call", { name: "list_entries", arguments: { date: today } }, 3);
log("tools/call list_entries", call);
const row = JSON.parse(call.body.result.content[0].text).entries[0];
log(row?.name === "Porridge with banana" && row.kcal === 350 ? "PASS: got porridge row" : "FAIL: no porridge row");
const wrong = await rpc("tools/call", { name: "list_entries", arguments: { date: "1999-01-01" } }, 4);
log("other date (expect empty)", wrong.body.result.content[0].text);

// 5. refresh token rotation
if (tok.refresh_token) {
  r = await fetch(BASE + "/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: client.client_id, resource: RESOURCE }) });
  const t2 = await r.json();
  log("== 5. refresh status", r.status, { rotated: t2.refresh_token && t2.refresh_token !== tok.refresh_token, error: t2.error });
}

mkdirSync("proof", { recursive: true });
writeFileSync("proof/b-scripted-oauth.txt", redact(lines.join("\n")) + "\n");

// 6. MCP Inspector CLI (proof c)
const insp = (method, extra = []) => {
  const a = ["-y", "@modelcontextprotocol/inspector", "--cli", RESOURCE, "--transport", "http", "--header", `Authorization: Bearer ${tok.access_token}`, "--method", method, ...extra];
  const p = spawnSync("npx", a, { encoding: "utf8", timeout: 180000 });
  return `$ npx @modelcontextprotocol/inspector --cli ${RESOURCE} --transport http --header "Authorization: Bearer <redacted>" --method ${method} ${extra.join(" ")}\nexit=${p.status}\n${p.stdout}${p.stderr}`;
};
const c = [insp("tools/list"), insp("tools/call", ["--tool-name", "list_entries", "--tool-arg", `date=${today}`])].join("\n\n");
writeFileSync("proof/c-inspector-cli.txt", redact(c) + "\n");
console.log(redact(c));
