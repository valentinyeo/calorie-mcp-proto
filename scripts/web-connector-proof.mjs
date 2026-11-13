// Web-connector proof for SOFT-1281.
//
// Plays the browser half of a claude.ai / ChatGPT custom-connector login against the live
// food-log server, using the shared Chrome on 127.0.0.1:9333 (its own tab, never an existing one):
//
//   1. registers an OAuth client with the connector's real callback (DCR, PKCE S256)
//   2. opens /oauth2/authorize in a real Chrome tab: /sign-in, then /consent
//   3. signs in as the test user, approves, and catches the redirect the connector would receive
//   4. exchanges the code for a token and calls add_entry, then get_day, over MCP
//
//   node scripts/web-connector-proof.mjs --callback https://claude.ai/api/mcp/auth_callback \
//     --email proto-web-1@example.com --password '...'
//
// Tokens, passwords and codes are redacted before anything reaches proof/.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const BASE = args.get("base") ?? "https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev";
const CDP = args.get("cdp") ?? "http://127.0.0.1:9333";
const CALLBACK = args.get("callback");
const EMAIL = args.get("email");
const PASSWORD = args.get("password");
const NAME = args.get("name") ?? "web-connector";
const PROOF = args.get("proof") ?? `proof/g-web-${NAME}.txt`;
if (!CALLBACK || !EMAIL || !PASSWORD) throw new Error("need --callback, --email and --password");

const lines = [`SOFT-1281 web connector proof. Base ${BASE}. Callback ${CALLBACK}. Run at ${new Date().toISOString()}.`];
const secrets = new Set([PASSWORD]);
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

// 1. dynamic client registration with the connector's own callback
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const reg = await fetch(BASE + "/oauth2/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: `${NAME} web connector`,
    redirect_uris: [CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
}).then((r) => r.json());
if (reg.client_id) secrets.add(reg.client_id);
check(!!reg.client_id, "dynamic client registration accepts the connector callback", { redirect_uris: reg.redirect_uris ?? CALLBACK });

const authorize = new URL(BASE + "/oauth2/authorize");
authorize.searchParams.set("client_id", reg.client_id);
authorize.searchParams.set("redirect_uri", CALLBACK);
authorize.searchParams.set("response_type", "code");
authorize.searchParams.set("scope", "mcp:read mcp:write");
authorize.searchParams.set("state", state);
authorize.searchParams.set("code_challenge", challenge);
authorize.searchParams.set("code_challenge_method", "S256");

// 2. drive a real Chrome tab through sign-in and consent
const version = await fetch(CDP + "/json/version").then((r) => r.json());
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  socket.addEventListener("open", res, { once: true });
  socket.addEventListener("error", rej, { once: true });
});
let sequence = 0;
const pending = new Map();
const visited = [];
socket.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Network.requestWillBeSent") visited.push(m.params.request.url);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
});
const call = (method, params = {}, sessionId) => {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
};
const callBrowser = (method, params = {}) => {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await call("Target.createTarget", { url: "about:blank", background: true });
const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
await call("Page.enable", {}, sessionId);
await call("Network.enable", {}, sessionId);
await call("Target.activateTarget", { targetId }).catch(() => {}); // a background tab takes no mouse events
// Start from a clean session for the food-log origin only; the browser's other logins stay.
for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data"]) {
  await call("Network.deleteCookies", { name, domain: new URL(BASE).hostname }, sessionId).catch(() => {});
}
const evaluate = async (expression) => {
  const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result.value;
};
const clickText = async (pattern) => {
  const box = await evaluate(`(() => { const els=[...document.querySelectorAll('button,a,[role=button]')]; const t=els.find(e=>new RegExp(${JSON.stringify(pattern)},'i').test(e.innerText||'')); if(!t) return null; t.scrollIntoView({block:'center'}); const r=t.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  if (!box || box.__error) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await call("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 }, sessionId);
  }
  return true;
};
const setField = async (name, value) => {
  await evaluate(`(() => { const i=document.querySelector('input[name=${name}]'); i.focus(); i.value=${JSON.stringify(value)}; i.dispatchEvent(new Event('input',{bubbles:true})); return i.value.length; })()`);
};

let code = null;
let callbackUrl = null;
try {
  await call("Page.navigate", { url: authorize.toString() }, sessionId);
  await wait(5000);
  const signInPath = await evaluate("location.pathname");
  check(/\/sign-in/.test(signInPath), "authorize sends the connector to the server sign-in page", signInPath);

  await setField("email", EMAIL);
  await setField("password", PASSWORD);
  check(await clickText("^Sign in$"), "sign-in form submitted");
  await wait(5000);
  check(/\/consent/.test(await evaluate("location.pathname")), "signed-in user reaches the consent page", await evaluate("location.pathname"));

  check(await clickText("^Allow$"), "consent approved");
  await wait(6000);

  callbackUrl = visited.find((u) => u.startsWith(CALLBACK)) ?? null;
  const landing = await evaluate("location.href");
  if (callbackUrl) code = new URL(callbackUrl).searchParams.get("code");
  const gotState = callbackUrl ? new URL(callbackUrl).searchParams.get("state") : null;
  check(!!code, "connector callback received an authorization code", callbackUrl ? callbackUrl.split("?")[0] : landing.split("?")[0]);
  check(gotState === state, "callback carried the same state", gotState);
  if (code) secrets.add(code);
} finally {
  await call("Target.closeTarget", { targetId });
  socket.close();
}

if (!code) {
  log(`\nFAILURES: ${failures}`);
  mkdirSync("proof", { recursive: true });
  writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
  process.exit(1);
}

// 3. token exchange, then the two MCP calls the connector would make
const tokenRes = await fetch(BASE + "/oauth2/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CALLBACK,
    client_id: reg.client_id,
    code_verifier: verifier,
    resource: BASE + "/mcp",
  }),
});
const tokenBody = await tokenRes.json().catch(() => ({}));
check(tokenRes.ok && !!tokenBody.access_token, "authorization code exchanged for an access token", tokenRes.status);
if (tokenBody.access_token) secrets.add(tokenBody.access_token);

const mcp = async (method, params, id = 1) => {
  const r = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokenBody.access_token}`,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
  try { return JSON.parse(line.replace(/^data: /, "")); } catch { return { raw: text.slice(0, 300) }; }
};
await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: NAME, version: "1" } });
const toolCall = async (name, args) => {
  const r = await mcp("tools/call", { name, arguments: args }, 2);
  if (r.error) return { error: r.error };
  const raw = r.result?.content?.[0]?.text ?? JSON.stringify(r.result);
  try { return JSON.parse(raw); } catch { return raw; }
};

const entryName = `Web connector test ${new Date().toISOString().slice(0, 16)}Z`;
const added = await toolCall("add_entry", { name: entryName, kcal: 412, portion_text: "one bowl" });
check(!added?.error && added?.entry?.name === entryName, "add_entry wrote the entry through the connector token", added?.entry ?? added);
const day = await toolCall("get_day", {});
const found = (day?.entries ?? []).some((e) => e.name === entryName);
check(found, "get_day reads the same entry back", { total_kcal: day?.total_kcal, entries: (day?.entries ?? []).map((e) => e.name) });

log(`\nFAILURES: ${failures}`);
mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
console.log(`wrote ${PROOF}`);
process.exit(failures ? 1 : 0);
