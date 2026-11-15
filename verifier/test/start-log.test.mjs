// What a failed start says in the PR comment. The first real run failed with
// "the Worker on the head checkout answered 0 on /health" and nothing else, so the reason for
// the failure ("Permission denied" from the start script) was only in the job log. A failure
// must now carry the last 20 lines of the Worker's start log, and never a login value.
import assert from "node:assert/strict";
import { test } from "node:test";

import { REASONS, START_LOG_LINES } from "../verify.mjs";
import { answerFor, harness, LOGIN } from "./support.mjs";

const smoke = "Sign in and open today's home";
const logWith = (count, prefix = "step") =>
  `${Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n")}\n`;

const logBlock = (body) => {
  const match = /```\n([\s\S]*?)\n```/.exec(body);
  assert.notEqual(match, null, `no fenced start log block in:\n${body}`);
  return match[1].split("\n");
};

test("the block is exactly the last 20 lines of the Worker start log", async () => {
  assert.equal(START_LOG_LINES, 20);
  const fixture = harness({ headStarted: false, headStartLog: logWith(25) });
  assert.equal(await fixture.run(), 1);
  const block = logBlock(fixture.read("comment.md"));
  assert.deepEqual(block, Array.from({ length: 20 }, (_, index) => `step ${index + 6}`));
});

test("the start log in the comment carries no login value", async () => {
  const fixture = harness({
    headStarted: false,
    headStartLog: `step: start the Worker\nnpm warn using OPENCODE_API_KEY=${LOGIN}\nstep: waited 180s\n`,
  });
  assert.equal(await fixture.run(), 1);
  const body = fixture.read("comment.md");
  assert.doesNotMatch(body, new RegExp(LOGIN));
  assert.match(body, /<redacted>/);
});

test("a failed start with no captured log still says so instead of staying silent", async () => {
  const fixture = harness({ headStarted: false });
  assert.equal(await fixture.run(), 1);
  const body = fixture.read("comment.md");
  assert.match(body, new RegExp(REASONS.headNotStarted));
  assert.match(body, /head start log/i);
  assert.match(body, /No head start log was passed to the verifier/i);
});

test("a parent that did not start brings its own start log into the comment", async () => {
  const fixture = harness({ answer: answerFor([smoke]), parentStarted: false, parentStartLog: logWith(3, "parent step") });
  assert.equal(await fixture.run(), 0);
  const body = fixture.read("comment.md");
  assert.match(body, /parent checkout did not start/);
  assert.match(body, /parent step 3/);
});

test("a passing run puts no start log in the comment", async () => {
  const fixture = harness({ answer: answerFor([smoke]), headStartLog: logWith(5) });
  assert.equal(await fixture.run(), 0);
  assert.doesNotMatch(fixture.read("comment.md"), /```/);
});
