// v1 end-to-end proof for IGSH-1273.
// Scripted OAuth 2.1 (DCR + PKCE + consent) for two users, then every MCP tool, then an
// isolation check: user B must not read, edit or delete user A's entries.
//   node scripts/e2e-v1.mjs            # local worker on 127.0.0.1:8787 by default
//   BASE=https://... node scripts/e2e-v1.mjs
// Tokens, passwords and codes are redacted before anything is written to proof/.
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const RESOURCE = BASE + "/mcp";
const REDIRECT = "http://127.0.0.1:8976/callback";
const PROOF = process.env.PROOF ?? "proof/e-v1-e2e.txt";

const lines = [];
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
async function connect(tag) {
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
    scope: "mcp:read mcp:write offline_access",
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

const payload = (res) => {
  const t = res.body?.result?.content?.[0]?.text;
  if (t === undefined) return null;
  try { return JSON.parse(t); } catch { return t; }
};

const today = new Date().toISOString().slice(0, 10);
let id = 1;

// ---------------------------------------------------------------- user A
const a = await connect("a");
let init = await a.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "v1-e2e-script", version: "1" } }, id++);
check(init.status === 200 && init.body?.result?.serverInfo?.name === "calorie-tracker", "A initialize", init.body?.result?.serverInfo);

const list = await a.rpc("tools/list", {}, id++);
const names = (list.body?.result?.tools ?? []).map((t) => t.name).sort();
const expected = ["add_entry", "delete_entry", "get_day", "list_entries", "set_goal", "update_entry"];
check(JSON.stringify(names) === JSON.stringify(expected), "A tools/list has exactly the six tools", names);

const add = await a.rpc("tools/call", { name: "add_entry", arguments: { name: "Porridge with banana", kcal: 350, protein_g: 12, carbs_g: 60, fat_g: 6, portion_text: "1 bowl" } }, id++);
const added = payload(add);
check(!!added?.entry?.id && added.entry.kcal === 350, "A add_entry porridge", added?.entry);
check(added?.day?.consumed_kcal === 350 && added?.day?.goal_kcal === 2000 && added?.day?.remaining_kcal === 1650, "A add_entry returns the new day total", added?.day);
check(added?.entry?.source === "mcp" && added?.entry?.client_name === "v1-e2e-script", "A entry records source and client name", { source: added?.entry?.source, client: added?.entry?.client_name });
const entryId = added.entry.id;

const day = payload(await a.rpc("tools/call", { name: "get_day", arguments: {} }, id++));
check(day?.consumed_kcal === 350 && day?.entries?.length === 1 && day?.entries[0].name === "Porridge with banana", "A get_day (default today) reads it back", { consumed: day?.consumed_kcal, entries: day?.entries?.length });

const listed = payload(await a.rpc("tools/call", { name: "list_entries", arguments: { date: added.entry.local_date } }, id++));
check(listed?.count === 1 && listed.entries[0].id === entryId, "A list_entries by date", listed?.count);

const upd = payload(await a.rpc("tools/call", { name: "update_entry", arguments: { id: entryId, kcal: 400, portion_text: "1 big bowl" } }, id++));
check(upd?.entry?.kcal === 400 && upd.entry.portion_text === "1 big bowl" && upd.day.consumed_kcal === 400, "A update_entry kcal 350 -> 400", { kcal: upd?.entry?.kcal, consumed: upd?.day?.consumed_kcal });

const goal = payload(await a.rpc("tools/call", { name: "set_goal", arguments: { kcal: 1800 } }, id++));
check(goal?.goal_kcal === 1800, "A set_goal 1800", goal);
const afterGoal = payload(await a.rpc("tools/call", { name: "get_day", arguments: {} }, id++));
check(afterGoal?.goal_kcal === 1800 && afterGoal?.remaining_kcal === 1400, "A get_day reflects the new goal", { goal: afterGoal?.goal_kcal, left: afterGoal?.remaining_kcal });

// Range read across the free window, and the gate beyond it.
const range = payload(await a.rpc("tools/call", { name: "list_entries", arguments: { from: added.entry.local_date, to: added.entry.local_date } }, id++));
check(range?.count === 1, "A list_entries date range", range?.count);
const old = await a.rpc("tools/call", { name: "list_entries", arguments: { date: "2020-01-01" } }, id++);
check(old.body?.result?.isError === true && /outside your plan's range/.test(payload(old)?.message ?? JSON.stringify(payload(old))), "A read older than 30 days is refused with the plain error", payload(old));

// ---------------------------------------------------------------- user B
const b = await connect("b");
const bInit = await b.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "v1-e2e-script-b", version: "1" } }, id++);
check(bInit.status === 200, "B initialize", bInit.status);

const bDay = payload(await b.rpc("tools/call", { name: "get_day", arguments: {} }, id++));
check(bDay?.consumed_kcal === 0 && bDay?.entries?.length === 0, "B get_day sees an empty log, not A's entry", { consumed: bDay?.consumed_kcal, entries: bDay?.entries?.length });

const bList = payload(await b.rpc("tools/call", { name: "list_entries", arguments: { date: added.entry.local_date } }, id++));
check(bList?.count === 0, "B list_entries on A's date is empty", bList?.count);

const bRead = await b.rpc("tools/call", { name: "list_entries", arguments: { from: "2026-01-01", to: today } }, id++);
check(payload(bRead)?.entries?.every((e) => e.id !== entryId) ?? true, "B range read never contains A's entry", payload(bRead)?.count);

const bEdit = await b.rpc("tools/call", { name: "update_entry", arguments: { id: entryId, kcal: 1 } }, id++);
check(bEdit.body?.result?.isError === true, "B cannot update A's entry", payload(bEdit));

const bDelete = await b.rpc("tools/call", { name: "delete_entry", arguments: { id: entryId } }, id++);
check(bDelete.body?.result?.isError === true, "B cannot delete A's entry", payload(bDelete));

const stillThere = payload(await a.rpc("tools/call", { name: "get_day", arguments: {} }, id++));
check(stillThere?.entries?.length === 1 && stillThere.entries[0].kcal === 400, "A's entry is untouched after B's attempts", stillThere?.entries?.length);

// ---------------------------------------------------------------- delete + undo-safety
const del = payload(await a.rpc("tools/call", { name: "delete_entry", arguments: { id: entryId } }, id++));
check(del?.ok === true && del.day.consumed_kcal === 0, "A delete_entry soft-deletes and returns the new total", { ok: del?.ok, consumed: del?.day?.consumed_kcal });
const gone = payload(await a.rpc("tools/call", { name: "get_day", arguments: {} }, id++));
check(gone?.entries?.length === 0 && gone.consumed_kcal === 0, "A deleted entry no longer counts", { entries: gone?.entries?.length, consumed: gone?.consumed_kcal });

// ---------------------------------------------------------------- MCP Inspector CLI
// Gate: the Inspector lists all six tools and every call passes.
import { spawnSync } from "node:child_process";
const inspLog = [];
const insp = (method, extra = []) => {
  const args = ["-y", "@modelcontextprotocol/inspector", "--cli", RESOURCE, "--transport", "http",
    "--header", `Authorization: Bearer ${a.token}`, "--header", "user-agent: mcp-inspector", "--method", method, ...extra];
  const p = spawnSync("npx", args, { encoding: "utf8", timeout: 240000 });
  const shown = `$ npx @modelcontextprotocol/inspector --cli ${RESOURCE} --transport http --header "Authorization: Bearer <redacted>" --method ${method} ${extra.join(" ")}\nexit=${p.status}`;
  inspLog.push(shown + "\n" + (p.stdout ?? "") + (p.stderr ?? ""));
  return { status: p.status, out: (p.stdout ?? "") + (p.stderr ?? "") };
};
// Inspector prints the tool result as an escaped JSON string, so unescape before asserting.
const plain = (s) => s.split('\\"').join('"').split('\\n').join('\n');
const grabId = (s) => Number((plain(s).match(/"id":\s*(\d+)/) ?? [])[1]);

const inspList = insp("tools/list");
check(inspList.status === 0 && expected.every((n) => plain(inspList.out).includes(`"name": "${n}"`)), "Inspector tools/list lists all six tools", plain(inspList.out).match(/"name": "[a-z_]+"/g));

const inspAdd = insp("tools/call", ["--tool-name", "add_entry", "--tool-arg", "name=Porridge", "--tool-arg", "kcal=350", "--tool-arg", "portion_text=1 bowl"]);
const inspId = grabId(inspAdd.out);
check(inspAdd.status === 0 && inspId > 0 && plain(inspAdd.out).includes("Porridge"), "Inspector add_entry", { id: inspId });

const inspDay = insp("tools/call", ["--tool-name", "get_day"]);
check(inspDay.status === 0 && /"consumed_kcal"/.test(plain(inspDay.out)), "Inspector get_day", (plain(inspDay.out).match(/"consumed_kcal": \d+/) ?? [])[0]);

const inspList2 = insp("tools/call", ["--tool-name", "list_entries", "--tool-arg", `date=${today}`]);
check(inspList2.status === 0 && /"count"/.test(plain(inspList2.out)), "Inspector list_entries", (plain(inspList2.out).match(/"count": \d+/) ?? [])[0]);

const inspUpd = insp("tools/call", ["--tool-name", "update_entry", "--tool-arg", `id=${inspId}`, "--tool-arg", "kcal=420"]);
check(inspUpd.status === 0 && /"kcal": 420/.test(plain(inspUpd.out)), "Inspector update_entry", (plain(inspUpd.out).match(/"kcal": \d+/) ?? [])[0]);

const inspGoal = insp("tools/call", ["--tool-name", "set_goal", "--tool-arg", "kcal=2100"]);
check(inspGoal.status === 0 && plain(inspGoal.out).includes("2100"), "Inspector set_goal", (plain(inspGoal.out).match(/"goal_kcal": \d+/) ?? [])[0]);

const inspDel = insp("tools/call", ["--tool-name", "delete_entry", "--tool-arg", `id=${inspId}`]);
check(inspDel.status === 0 && plain(inspDel.out).includes('"ok": true'), "Inspector delete_entry", plain(inspDel.out).includes('"ok": true'));

writeFileSync("proof/f-v1-inspector.txt", redact(inspLog.join("\n\n")) + "\n");
log(`Inspector run: ${inspLog.length} calls, failures so far ${failures}`);

// Session-scoped token is what Inspector gets for the CI-style tools/list check.
writeFileSync("/tmp/igsh1273-token", a.token);

mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failing check(s). Base ${BASE}`);
process.exit(failures === 0 ? 0 : 1);
