// The two shell helpers the workflow uses to start the app, tested here because the run that
// failed took ten minutes to say "Permission denied".
//
//   reach.sh          names the directory that stops the unprivileged app user from reaching a
//                     checkout, instead of the bare "Permission denied" bash printed
//   wait-for-start.sh stops waiting as soon as both starters are dead, instead of sleeping out
//                     the whole ten minute deadline
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { repoRoot } from "./support.mjs";

const reach = join(repoRoot, "verifier", "reach.sh");
const waitForStart = join(repoRoot, "verifier", "wait-for-start.sh");

const scratchTree = () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-scripts-"));
  chmodSync(dir, 0o755);
  return dir;
};

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
};

const sudoAs = (user, args) => run("sudo", ["-n", "-u", user, "env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", ...args]);
const sudoWorks = () => run("sudo", ["-n", "true"]).code === 0;

const deadPid = () => {
  const child = spawnSync("true");
  return String(child.pid ?? 999_999);
};

test("reach.sh passes a checkout the app user can read", () => {
  const dir = scratchTree();
  try {
    const app = join(dir, "head");
    mkdirSync(join(app, "verifier"), { recursive: true });
    writeFileSync(join(app, "verifier", "start-app.sh"), "#!/usr/bin/env bash\n");
    const { code, out } = run("bash", [reach, join(app, "verifier", "start-app.sh"), app]);
    assert.equal(code, 0, out);
    assert.match(out, /^OK /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reach.sh names the directory that stops the app user, then passes once it is traversable", { skip: !sudoWorks() && "sudo is not available" }, () => {
  const dir = scratchTree();
  try {
    // This checkout can sit under a 0750 home of its own, so the unprivileged user needs a copy
    // it can read: exactly the problem reach.sh exists to name.
    const script = join(dir, "reach.sh");
    copyFileSync(reach, script);
    chmodSync(script, 0o755);

    // The runner's own home is 0750: every file inside can belong to the app user and the
    // kernel still refuses to walk down to it. This is that shape.
    const blocked = join(dir, "home");
    const app = join(blocked, "head");
    mkdirSync(join(app, "verifier"), { recursive: true });
    writeFileSync(join(app, "verifier", "start-app.sh"), "#!/usr/bin/env bash\n");
    chmodSync(join(app, "verifier", "start-app.sh"), 0o644);
    chmodSync(blocked, 0o700);

    const denied = sudoAs("nobody", ["bash", script, join(app, "verifier", "start-app.sh"), app]);
    assert.equal(denied.code, 1, denied.out);
    assert.match(denied.out, /FAILED /);
    assert.match(denied.out, new RegExp(blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(denied.out, /not traversable/);

    chmodSync(blocked, 0o755);
    const allowed = sudoAs("nobody", ["bash", script, join(app, "verifier", "start-app.sh"), app]);
    assert.equal(allowed.code, 0, allowed.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const waitLogs = (dir, settled) => {
  const files = {};
  for (const side of ["parent", "head"]) {
    files[side] = join(dir, `logs-${side}.log`);
    writeFileSync(files[side], settled ? "step: install\nREADY head\n" : "step: install\n");
  }
  return files;
};

test("wait-for-start.sh returns as soon as both sides are ready", () => {
  const dir = scratchTree();
  try {
    const files = waitLogs(dir, true);
    const started = Date.now();
    const { code, out } = run("bash", [waitForStart, "600", "parent", files.parent, deadPid(), "head", files.head, deadPid()]);
    assert.equal(code, 0, out);
    assert.ok(Date.now() - started < 5_000, `waited ${Date.now() - started}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait-for-start.sh gives up the moment both starters are dead, not at the ten minute deadline", () => {
  const dir = scratchTree();
  try {
    const files = waitLogs(dir, false);
    const started = Date.now();
    const { code, out } = run("bash", [waitForStart, "600", "parent", files.parent, deadPid(), "head", files.head, deadPid()]);
    const elapsed = Date.now() - started;
    assert.equal(code, 1, out);
    assert.ok(elapsed < 10_000, `waited ${elapsed}ms with nothing alive`);
    assert.match(out, /parent/);
    assert.match(out, /head/);
    assert.match(out, /exited without READY or FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wait-for-start.sh still waits out its deadline while a starter is alive", async () => {
  const dir = scratchTree();
  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    const files = waitLogs(dir, false);
    const started = Date.now();
    const child = spawn("bash", [waitForStart, "2", "head", files.head, String(sleeper.pid)], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 1, out);
    assert.match(out, /deadline/);
    assert.ok(Date.now() - started >= 1_000, "gave up before the deadline while the starter was alive");
  } finally {
    sleeper.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
