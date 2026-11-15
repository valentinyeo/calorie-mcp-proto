// Every fail-closed class, driven through the real main() with a fake model. A run that cannot
// prove a pass ends as FAIL with a reason class, never as a quiet pass.
import assert from "node:assert/strict";
import { test } from "node:test";

import { commentFirstLine, REASONS, STATUS } from "../verify.mjs";
import { answerFor, harness, HEAD_SHA } from "./support.mjs";

const smoke = "Sign in and open today's home";

test("a run with a clean answer is PASS and exits zero", async () => {
  const fixture = harness({ changedFiles: ["app/src/view.ts"], answer: answerFor([smoke]) });
  const code = await fixture.run();
  assert.equal(code, 0);
  assert.equal(fixture.read("comment.md").split("\n")[0], commentFirstLine(STATUS.pass, HEAD_SHA));
  assert.equal(fixture.calls.agent.length, 1);
});

test("it fails closed when the model login variable is missing", async () => {
  const fixture = harness({ answer: answerFor([smoke]) });
  const code = await fixture.run({ env: { PATH: "/usr/bin:/bin" } });
  assert.equal(code, 1);
  assert.equal(fixture.calls.agent.length, 0);
  const body = fixture.read("comment.md");
  assert.match(body.split("\n")[0], /^pstack-verifier: FAIL @ [0-9a-f]{40}$/);
  assert.match(body, new RegExp(REASONS.missingLoginVariable));
});

test("it fails closed when the CLI exits non-zero", async () => {
  const fixture = harness({ agentResult: { code: 2, stdout: "", stderr: "Error: not logged in", timedOut: false, error: null } });
  const code = await fixture.run();
  assert.equal(code, 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.cliError));
});

test("it fails closed when the CLI cannot be started at all", async () => {
  const fixture = harness({ agentResult: { code: 1, stdout: "", stderr: "", timedOut: false, error: new Error("spawn claude ENOENT") } });
  assert.equal(await fixture.run(), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.cliError));
});

test("it fails closed on a timeout", async () => {
  const fixture = harness({ agentResult: { code: 1, stdout: "", stderr: "", timedOut: true, error: null } });
  assert.equal(await fixture.run(), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.timeout));
});

test("it fails closed on an empty answer", async () => {
  const fixture = harness({ agentResult: { code: 0, stdout: "   \n", stderr: "", timedOut: false, error: null } });
  assert.equal(await fixture.run(), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.answerNotJson));
});

test("it fails closed on a non-JSON answer", async () => {
  const fixture = harness({ agentResult: { code: 0, stdout: "Everything looks great, ship it!", stderr: "", timedOut: false, error: null } });
  assert.equal(await fixture.run(), 1);
  const body = fixture.read("comment.md");
  assert.match(body, new RegExp(REASONS.answerNotJson));
  assert.match(body.split("\n")[0], /^pstack-verifier: FAIL/);
});

test("it fails closed on unknown field values in the answer", async () => {
  const fixture = harness({
    answer: { features: [{ ...answerFor([smoke]).features[0], severity: "catastrophic" }] },
  });
  assert.equal(await fixture.run(), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.answerSchema));
});

test("it fails closed when the app does not start on the head commit", async () => {
  const fixture = harness({ answer: answerFor([smoke]), headStarted: false });
  assert.equal(await fixture.run(), 1);
  assert.equal(fixture.calls.agent.length, 0);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.headNotStarted));
});

test("it fails closed when the agent drove nothing on the head", async () => {
  const fixture = harness({
    answer: { features: [{ ...answerFor([smoke]).features[0], verdict: "not_drivable", severity: "note", evidence: "ran out of time" }] },
  });
  assert.equal(await fixture.run(), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.droveNothing));
});

test("an unknown author-model value fails closed before the agent is called", async () => {
  const fixture = harness({ prBody: "author-model: grok\n\nA change.", answer: answerFor([smoke]) });
  assert.equal(await fixture.run(), 1);
  assert.equal(fixture.calls.agent.length, 0);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.authorModelUnknown));
});

test("a missing head sha fails closed", async () => {
  const fixture = harness({ answer: answerFor([smoke]) });
  const argv = fixture.argv.map((value) => (value === HEAD_SHA ? "abc1234" : value));
  assert.equal(await fixture.run({ argv }), 1);
  assert.match(fixture.read("comment.md"), new RegExp(REASONS.badSha));
});

test("when the parent does not start the head is judged alone, PASS+NOTES at best", async () => {
  const fixture = harness({ answer: answerFor([smoke]), parentStarted: false });
  assert.equal(await fixture.run(), 0);
  const body = fixture.read("comment.md");
  assert.equal(body.split("\n")[0], commentFirstLine(STATUS.passNotes, HEAD_SHA));
  assert.match(body, /parent checkout did not start/);
});

test("a regression on the head is FAIL and exits one", async () => {
  const fixture = harness({
    answer: {
      features: [
        answerFor([smoke]).features[0],
        {
          feature: "Add a food from the app",
          parent_result: "adding Toast, wholemeal moved the total 835 -> 925",
          head_result: "the sheet closed but the total stayed 835",
          verdict: "regression",
          evidence: "read .total-number 835 after Add to log on the head",
          severity: "major",
        },
      ],
    },
  });
  assert.equal(await fixture.run(), 1);
  const body = fixture.read("comment.md");
  assert.equal(body.split("\n")[0], commentFirstLine(STATUS.fail, HEAD_SHA));
  assert.match(body, /major: Add a food from the app/);
  assert.match(body, /the total stayed 835/);
});
