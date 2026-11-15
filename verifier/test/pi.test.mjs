// The DeepSeek verifier family runs through the Pi coding agent and nothing else: never the
// OpenCode app, never a CLI pointed at a DeepSeek endpoint. These tests assert the exact Pi
// command line, the constants, the fail-closed login, and the absence of the old path in the
// files. A model call is never made here.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  agentArgs,
  agentBin,
  agentEnv,
  LOGIN_VAR_DEEPSEEK,
  MODEL_DEEPSEEK,
  PI_PACKAGE,
  PROVIDER_DEEPSEEK,
  REASONS,
} from "../verify.mjs";
import { answerFor, harness, repoRoot } from "./support.mjs";

const smoke = "Sign in and open today's home";

// Built from fragments so this test file never itself contains the strings it forbids.
const OPENCODE_APP = ["opencode", "ai"].join("-");
const DEEPSEEK_ENDPOINT = ["api", "deepseek", "com"].join(".");

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

test("the deepseek family builds exactly the owner's Pi launch line", () => {
  const args = agentArgs({
    provider: "deepseek",
    model: MODEL_DEEPSEEK,
    dirs: ["/work/parent", "/work/head"],
    driveTool: "/work/parent/verifier/drive.mjs",
    sessionDir: "/work/scratch/pi-sessions",
  });
  assert.deepEqual(args, [
    "-p",
    "--provider", "opencode-go",
    "--model", "deepseek-v4.1-flash",
    "--thinking", "high",
    "--session-dir", "/work/scratch/pi-sessions",
    "--tools", "bash,read",
    "--exclude-tools", "edit,write,powershell",
    "--no-extensions",
    "--no-mcp",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ]);
  // The owner's launch line, first three flags, spelled out.
  assert.deepEqual(args.slice(0, 4), ["-p", "--provider", "opencode-go", "--model"]);
  assert.equal(args[4], "deepseek-v4.1-flash");
});

test("the deepseek family runs the pi binary and the claude family keeps claude", () => {
  assert.equal(agentBin("deepseek"), "pi");
  assert.equal(agentBin("claude"), "claude");
});

test("the provider, model and login constants are Pi's", () => {
  assert.equal(PROVIDER_DEEPSEEK, "opencode-go");
  assert.equal(MODEL_DEEPSEEK, "deepseek-v4.1-flash");
  assert.equal(/pro/i.test(MODEL_DEEPSEEK), false, "never a Pro model");
  assert.equal(LOGIN_VAR_DEEPSEEK, "OPENCODE_API_KEY");
  assert.equal(PI_PACKAGE, "@earendil-works/pi-coding-agent");
});

test("the deepseek child environment carries only the opencode-go login", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pstack-pi-env-"));
  const env = agentEnv({
    provider: "deepseek",
    login: { name: "OPENCODE_API_KEY", value: "oc-not-a-real-key" },
    scratch,
    baseEnv: { PATH: "/usr/bin", PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers" },
  });
  assert.equal(env.OPENCODE_API_KEY, "oc-not-a-real-key");
  assert.equal(env.ANTHROPIC_BASE_URL, undefined, "no endpoint override is handed to Pi");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.deepEqual(
    Object.keys(env).sort(),
    ["HOME", "LANG", "OPENCODE_API_KEY", "PATH", "PLAYWRIGHT_BROWSERS_PATH", "TMPDIR"].sort(),
  );
});

test("a missing opencode-go login fails closed on the deepseek family, before any agent call", async () => {
  // A claude author gets the deepseek verifier; the harness env then has no Pi login.
  const fixture = harness({ prBody: "author-model: claude\n\nA change.", answer: answerFor([smoke]) });
  const code = await fixture.run({ env: { PATH: "/usr/bin:/bin", CLAUDE_CODE_OAUTH_TOKEN: "oat-claude-only" } });
  assert.equal(code, 1);
  assert.equal(fixture.calls.agent.length, 0);
  const body = fixture.read("comment.md");
  assert.match(body.split("\n")[0], /^pstack-verifier: FAIL @/);
  assert.match(body, new RegExp(REASONS.missingLoginVariable));
  assert.match(body, /OPENCODE_API_KEY/);
});

test("the deepseek login value never appears in any output", async () => {
  const loginValue = "opencode-go-login-not-real-1a2b3c";
  const fixture = harness({
    prBody: "author-model: claude\n\nA change.",
    login: loginValue,
    answer: { features: [{ ...answerFor([smoke]).features[0], evidence: `found ${loginValue} in the environment` }] },
  });
  await fixture.run();
  for (const file of ["comment.md", "report.md", "agent-stdout.txt", "prompt.txt"]) {
    assert.equal(fixture.read(file).includes(loginValue), false, `${file} leaked the login`);
  }
  assert.match(fixture.read("comment.md"), /<redacted>/);
});

test("no OpenCode app and no DeepSeek endpoint is installed or named", () => {
  const files = [
    ...walk(join(repoRoot, "verifier")),
    join(repoRoot, ".github", "workflows", "pstack-verifier.yml"),
  ];
  assert.ok(files.length > 5);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes(OPENCODE_APP), false, `${file} names the OpenCode app`);
    assert.equal(text.includes(DEEPSEEK_ENDPOINT), false, `${file} names the DeepSeek endpoint`);
  }
});

test("the workflow installs the pinned Pi package and hands it the one login", () => {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "pstack-verifier.yml"), "utf8");
  const pinned = /npm install -g @earendil-works\/pi-coding-agent@(\d+\.\d+\.\d+)\b/.exec(workflow);
  assert.ok(pinned, "the workflow does not install an exact Pi version");
  assert.equal(pinned[1], "1.5.2", "the pin is the version npm view prints");
  assert.match(workflow, /OPENCODE_API_KEY: \$\{\{ secrets\.OPENCODE_API_KEY \}\}/);
  assert.equal(workflow.includes("DEEPSEEK_API_KEY"), false, "the old DeepSeek login is gone");
  assert.equal(workflow.includes(`${"npm install -g"} @opencode`), false);
});
