// The focused proof: verifier/start-app.sh really starts this checkout offline, and the drive
// tool really drives one feature from docs/feature-map.md end to end in a real browser.
// It needs a browser and about two minutes, so it runs only when asked:
//   PSTACK_APP_TEST=1 node --test verifier/test/app.test.mjs
// It starts the app from this checkout, so it writes .wrangler/ and dist-app/ here. Both are
// ignored by git, and the seed data is invented.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { driveToolPath, repoRoot } from "./support.mjs";

const enabled = process.env.PSTACK_APP_TEST === "1";
const port = Number(process.env.PSTACK_TEST_PORT ?? "8899");
const appPort = Number(process.env.PSTACK_TEST_APP_PORT ?? "5173");

const waitForReady = (child, log, ms) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const done = (settle, value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      settle(value);
    };
    const inspect = () => {
      const text = log.join("");
      if (/(^|\n)READY /.test(text)) return done(resolve, text);
      if (/(^|\n)FAILED /.test(text)) return done(reject, new Error(`start-app.sh failed:\n${text}`));
      if (Date.now() > deadline) return done(reject, new Error(`start-app.sh did not become ready in ${ms}ms:\n${text}`));
    };
    const deadline = Date.now() + ms;
    const timer = setInterval(inspect, 300);
    // start-app.sh prints READY and exits on purpose, leaving the Worker and the app server
    // running, so an exit is only a failure when READY never arrived.
    child.on("close", (code) => {
      inspect();
      setTimeout(() => {
        if (!settled) done(reject, new Error(`start-app.sh exited ${code} before it was ready:\n${log.join("")}`));
      }, 300);
    });
  });

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`))));
  });

const parse = (ready) => Object.fromEntries(
  ready.split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);

test("start-app.sh starts this checkout and the drive tool drives adding a food", { skip: !enabled, timeout: 600_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "pstack-app-test-"));
  const environment = {
    ...process.env,
    PSTACK_MOUNTS: join(work, "mounts"),
    PSTACK_APP_PORT: String(appPort),
    PSTACK_PROFILE: join(work, "profile"),
    PSTACK_SCRATCH: join(work, "scratch"),
  };

  const log = [];
  const starter = spawn("bash", [join(repoRoot, "verifier", "start-app.sh"), repoRoot, String(port)], {
    cwd: repoRoot,
    detached: true,
    env: environment,
  });
  starter.stdout.on("data", (chunk) => log.push(String(chunk)));
  starter.stderr.on("data", (chunk) => log.push(String(chunk)));

  const killApp = () => {
    try {
      process.kill(-starter.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };

  try {
    const ready = parse(await waitForReady(starter, log, 420_000));
    assert.match(ready.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.match(ready.APP_URL, /^http:\/\/localhost:\d+\/.+\/$/);
    assert.equal(ready.SEED_EMAIL, "pstack-verifier@example.com");

    const health = await (await fetch(`${ready.API_URL}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.tools.length, 6);

    const drive = (...args) => run("node", [driveToolPath, ...args], environment);
    const steps = [
      ["open", ready.APP_URL],
      ["fill", "label=Email", ready.SEED_EMAIL],
      ["fill", "label=Password", ready.SEED_PASSWORD],
      ["click", 'role=button[name="Sign in"]'],
      ["wait", ".total-number"],
      ["text", ".total-number"],
      ["click", 'role=button[name="Add food"]'],
      ["fill", "label=Food", "Toast, wholemeal"],
      ["fill", "label=Calories", "90"],
      ["fill", "label=Portion (optional)", "1 slice"],
      ["click", 'role=button[name="Add to log"]'],
      ["text", ".total-number"],
      ["text", ".entries"],
      ["screenshot", "app-test-add-food.png"],
    ];
    const printed = await drive("run", JSON.stringify(steps));
    const sections = printed.split(/^--- action \d+: /m).slice(1).map((section) => {
      const at = section.indexOf("\n");
      return { header: section.slice(0, at), body: section.slice(at + 1).trim() };
    });
    const totals = sections
      .filter((section) => section.header === "text .total-number")
      .map((section) => Number(section.body.replaceAll(",", "")));
    assert.equal(totals.length, 2, `expected the total before and after the add, got:\n${printed}`);
    assert.equal(totals[1], totals[0] + 90, `adding 90 kcal must move the total by 90, got ${totals.join(" -> ")}`);
    const entries = sections.find((section) => section.header === "text .entries");
    assert.ok(entries !== undefined, `no entries section in:\n${printed}`);
    assert.match(entries.body, /Toast, wholemeal/);
    assert.match(entries.body, /Added in the app/);
    assert.ok(statSync(join(environment.PSTACK_SCRATCH, "app-test-add-food.png")).size > 1000, "a real screenshot was taken");
  } finally {
    killApp();
    rmSync(work, { recursive: true, force: true });
  }
});
