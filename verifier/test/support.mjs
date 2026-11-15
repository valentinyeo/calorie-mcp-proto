// Shared scaffolding for the verifier tests. No network, no model, no browser: the agent call
// and the URL check are injected, so every test below exercises the real orchestration code
// with a fake model.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "../verify.mjs";

export const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const featureMapPath = join(repoRoot, "docs", "feature-map.md");
export const driveToolPath = join(repoRoot, "verifier", "drive.mjs");

export const BASE_SHA = "1".repeat(40);
export const HEAD_SHA = "2".repeat(40);
export const LOGIN = "oat-not-a-real-token-9f8e7d6c5b4a";

export const row = (feature, overrides = {}) => ({
  feature,
  parent_result: "835 kcal, 3 entries",
  head_result: "835 kcal, 3 entries",
  verdict: "ok",
  evidence: "read .total-number 835 on both sides",
  severity: "none",
  ...overrides,
});

export const answerFor = (features, overrides = {}) => ({ features: features.map((name) => row(name, overrides)) });

export function harness({
  prBody = "author-model: deepseek\n\nA change.",
  changedFiles = ["app/src/view.ts"],
  answer = { features: [] },
  agentResult = null,
  login = LOGIN,
  featureMap = featureMapPath,
  headStarted = true,
  parentStarted = true,
  headStartLog = null,
  parentStartLog = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pstack-test-"));
  const changedFilesFile = join(dir, "changed.txt");
  const prBodyFile = join(dir, "pr-body.md");
  const scratch = join(dir, "scratch");
  writeFileSync(changedFilesFile, `${changedFiles.join("\n")}\n`);
  writeFileSync(prBodyFile, prBody);
  // The two start logs the workflow tails into the comment. null means the flag was not passed,
  // which is the case where the comment has to say no log arrived.
  const startLogs = [];
  for (const [side, content] of [["head", headStartLog], ["parent", parentStartLog]]) {
    if (content === null) continue;
    const file = join(dir, `logs-${side}.log`);
    writeFileSync(file, content);
    startLogs.push(`--${side}-start-log`, file);
  }

  const calls = { agent: [], comment: [] };
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    CLAUDE_CODE_OAUTH_TOKEN: login,
    OPENCODE_API_KEY: login,
    GITHUB_TOKEN: "gh-token-that-must-not-reach-the-agent",
    PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers",
  };

  const argv = [
    "--pr", "42",
    "--base-sha", BASE_SHA,
    "--head-sha", HEAD_SHA,
    "--parent", join(dir, "parent"),
    "--head-dir", join(dir, "head"),
    "--changed-files", changedFilesFile,
    "--feature-map", featureMap,
    "--pr-body-file", prBodyFile,
    "--pr-title", "SOFT-2383: something",
    "--scratch", scratch,
    "--drive", driveToolPath,
    ...startLogs,
    "--no-comment",
  ];

  const run = async (overrides = {}) => {
    const write = process.stdout.write;
    process.stdout.write = () => true;
    try {
      return await main(overrides.argv ?? argv, {
        env: overrides.env ?? env,
        callAgent: overrides.callAgent ?? (async (options) => {
          calls.agent.push(options);
          return agentResult ?? {
            code: 0,
            stdout: JSON.stringify(overrides.answer ?? answer),
            stderr: "",
            timedOut: false,
            error: null,
          };
        }),
        checkUrl: overrides.checkUrl ?? (async (url) => {
          const ok = url.includes("8789") || url.includes("/head/") ? headStarted : parentStarted;
          // A refused connection is status 0, which is what the real checkUrl reports.
          return { ok, status: ok ? 200 : 0 };
        }),
        postComment: overrides.postComment ?? (async (options) => {
          calls.comment.push(options);
        }),
      });
    } finally {
      process.stdout.write = write;
    }
  };

  return {
    argv,
    calls,
    dir,
    env,
    read: (name) => readFileSync(join(scratch, name), "utf8"),
    run,
    scratch,
  };
}
