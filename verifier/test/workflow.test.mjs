// Guards on the workflow itself, because two of the three rules that made the first real run
// unreadable live in .github/workflows/pstack-verifier.yml and nowhere else.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { repoRoot } from "./support.mjs";

const workflow = readFileSync(join(repoRoot, ".github", "workflows", "pstack-verifier.yml"), "utf8");
const lines = workflow.split("\n");

test("every gh call in the workflow names the repository explicitly", () => {
  const ghCalls = lines
    .map((line) => line.trim())
    .filter((line) => /(^|[\s|;&(])gh [a-z]/.test(line) && !line.startsWith("#"));
  assert.ok(ghCalls.length > 0, "the workflow no longer calls gh, so this guard is stale");
  for (const call of ghCalls) {
    assert.match(call, /--repo "\$GITHUB_REPOSITORY"/, `gh call without --repo "$GITHUB_REPOSITORY": ${call}`);
  }
});

test("the start step hands both start logs to the verifier", () => {
  assert.match(workflow, /--head-start-log "\$RUNNER_TEMP\/pstack\/logs-head\.log"/);
  assert.match(workflow, /--parent-start-log "\$RUNNER_TEMP\/pstack\/logs-parent\.log"/);
});

test("the app user gets its checkouts outside the runner's home, and the reach check runs first", () => {
  assert.match(workflow, /\/opt\/pstack/);
  assert.match(workflow, /verifier\/reach\.sh/);
  // Granting traverse on the runner's home would let the untrusted app walk into the runner's
  // own directories while the login-bearing step is running. The checkouts move instead.
  assert.doesNotMatch(workflow, /chmod[^\n]*\/home\/runner/);
});
