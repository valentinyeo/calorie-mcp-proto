#!/usr/bin/env node
// Verifies the IGSH-1273 acceptance gates from the merged repository and the live worker.
// Each subcommand asserts everything itself, exits 1 on any failure, and prints a
// success-only marker on the last line. Markers are what GATES.md matches on.
//   node scripts/verify-v1.mjs tools|schema|typecheck|live|auth|proof|inspector
//   node scripts/verify-v1.mjs merged <sha>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev";
const SIX = ["add_entry", "delete_entry", "get_day", "list_entries", "set_goal", "update_entry"];

const sink = (s) => String(s ?? "").trim().split("\n").slice(-6).join("\n");
const die = (why, detail) => {
  console.error(`FAILED: ${why}`);
  if (detail) console.error(sink(detail));
  process.exit(1);
};
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    die(`cannot read ${path}`, e.message);
  }
};

const commands = {
  // The six tools the spec names, taken from the source that registers them.
  tools() {
    const src = read("src/tools.ts");
    const found = [...src.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const unique = [...new Set(found)];
    if (JSON.stringify(unique) !== JSON.stringify(SIX)) die("registered tools differ from the spec", JSON.stringify(unique));
    if (found.length !== unique.length) die("a tool is registered twice", JSON.stringify(found));
    console.log(`found ${unique.length} tools: ${unique.join(", ")}`);
    console.log("v1 tools: six registered");
  },

  // The spec's data shape, read from the migration that creates it.
  schema() {
    const sql = read("migrations/0003_food_log.sql");
    const block = (name) => {
      const m = sql.match(new RegExp(`create table ${name} \\(([\\s\\S]*?)\\n\\);`));
      if (!m) die(`no create table ${name} in the migration`);
      return m[1];
    };
    const entries = block("entries");
    const profile = block("profile");
    const entriesColumns = [
      "user_id", "eaten_at", "local_date", "name", "kcal", "protein_g", "carbs_g",
      "fat_g", "portion_text", "source", "client_name", "created_at", "updated_at", "deleted_at",
    ];
    const profileColumns = ["user_id", "daily_goal_kcal", "timezone", "pro_until", "created_at", "updated_at"];
    const missing = [
      ...entriesColumns.filter((c) => !new RegExp(`^\\s+${c}\\s`, "m").test(entries)).map((c) => `entries.${c}`),
      ...profileColumns.filter((c) => !new RegExp(`^\\s+${c}\\s`, "m").test(profile)).map((c) => `profile.${c}`),
    ];
    if (missing.length) die("spec columns missing", missing.join(", "));
    if (!/alter table entries rename to entries_proto/i.test(sql)) die("prototype rows would be lost: no rename step");
    if (!/create index entries_user_date_idx/i.test(sql)) die("no read index on (user_id, local_date)");
    if (/\bdrop table entries\b/i.test(sql)) die("migration drops the prototype table instead of renaming it");
    console.log("found every spec column on entries and profile, prototype rows carried over");
    console.log("v1 schema: spec columns present");
  },

  typecheck() {
    const r = spawnSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", timeout: 100000 });
    if (r.status !== 0) die("tsc --noEmit failed", `${r.stdout ?? ""}\n${r.stderr ?? ""}`);
    console.log("tsc --noEmit exited 0");
    console.log("v1 typecheck: clean");
  },

  // The deployed worker, not a local one.
  async live() {
    let res;
    try {
      res = await fetch(BASE + "/health", { signal: AbortSignal.timeout(15000) });
    } catch (e) {
      die(`cannot reach ${BASE}/health`, e.message);
    }
    if (res.status !== 200) die("health is not 200", res.status);
    const body = await res.json().catch(() => null);
    const tools = Array.isArray(body?.tools) ? [...body.tools].sort() : [];
    if (JSON.stringify(tools) !== JSON.stringify(SIX)) die("live worker does not advertise the six tools", JSON.stringify(tools));
    if (body.ok !== true) die("health is not ok", JSON.stringify(body));
    console.log(`${BASE}/health returned ${tools.length} tools`);
    console.log("v1 live: six tools");
  },

  // The auth guard: no token means 401 plus the metadata challenge an MCP client follows.
  async auth() {
    let res;
    try {
      res = await fetch(BASE + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      die("cannot reach /mcp", e.message);
    }
    const challenge = res.headers.get("www-authenticate") ?? "";
    if (res.status !== 401) die("unauthenticated /mcp is not refused with 401", res.status);
    if (!challenge.includes("resource_metadata=")) die("challenge has no resource_metadata", challenge);
    for (const scope of ["mcp:read", "mcp:write"]) {
      if (!challenge.includes(scope)) die(`challenge does not ask for ${scope}`, challenge);
    }
    console.log(`401 with challenge: ${challenge.slice(0, 120)}...`);
    console.log("v1 auth: challenge intact");
  },

  // The committed live run: green, two users, isolation asserted in it.
  proof() {
    const log = read("proof/e-v1-e2e.txt");
    const failing = log.split("\n").filter((l) => l.startsWith("FAIL:"));
    if (failing.length) die("the recorded run has failures", failing.join("\n"));
    if (!log.includes("PASS: 0 failing check(s)")) die("the recorded run did not finish green");
    if (!/Base https:\/\//.test(log)) die("the recorded run was not against the live worker");
    const passes = log.split("\n").filter((l) => l.startsWith("PASS:")).length;
    for (const claim of [
      "PASS: B get_day sees an empty log, not A's entry",
      "PASS: B cannot update A's entry",
      "PASS: B cannot delete A's entry",
      "PASS: A's entry is untouched after B's attempts",
    ]) {
      if (!log.includes(claim)) die(`isolation claim missing: ${claim}`);
    }
    console.log(`${passes} recorded checks, 0 failing, isolation asserted for both users`);
    console.log("v1 proof: green live run with isolation");
  },

  // The Inspector run: it listed the six tools and every one of the seven calls exited 0.
  inspector() {
    const log = read("proof/f-v1-inspector.txt");
    if (/\nexit=[1-9]/.test(log)) die("an Inspector call exited nonzero");
    const okCalls = (log.match(/\nexit=0/g) ?? []).length;
    if (okCalls < 7) die(`only ${okCalls} Inspector calls exited 0, expected 7 (tools/list + six tools)`);
    const listing = log.slice(0, log.indexOf("--tool-name") === -1 ? log.length : log.indexOf("--tool-name"));
    for (const t of SIX) {
      if (!listing.includes(`"name": "${t}"`)) die(`tools/list output does not list ${t}`);
      if (!new RegExp(`--tool-name ${t}\\b`).test(log)) die(`no Inspector call for ${t}`);
    }
    console.log(`${okCalls} Inspector calls exited 0, all six tools listed and called`);
    console.log("v1 inspector: six tools called");
  },

  // The squash merge of the ticket must be an ancestor of the current branch.
  merged(sha) {
    if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) die("pass the merge commit sha");
    const r = spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { encoding: "utf8" });
    if (r.status !== 0) die(`commit ${sha} is not an ancestor of HEAD`);
    const subject = spawnSync("git", ["log", "-1", "--format=%s", sha], { encoding: "utf8" }).stdout.trim();
    if (!/IGSH-1273/.test(subject)) die(`commit ${sha} is not the IGSH-1273 merge`, subject);
    console.log(`${sha.slice(0, 7)} on main: ${subject}`);
    console.log("v1 merged: commit on main");
  },
};

const [cmd, ...args] = process.argv.slice(2);
const run = commands[cmd];
if (!run) die(`unknown command: ${cmd ?? "(none)"}; use ${Object.keys(commands).join("|")}`);
await run(...args);
