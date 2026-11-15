// The one PR comment and its first line. The first line is what a human and a required check
// read, so its shape is fixed and a wrong sha cannot pretend to be an answer.
import assert from "node:assert/strict";
import { test } from "node:test";

import { commentFirstLine, REASONS, renderBody, renderTable, STATUS } from "../verify.mjs";
import { answerFor, harness, HEAD_SHA } from "./support.mjs";

const smoke = "Sign in and open today's home";
const sha40 = "0123456789abcdef0123456789abcdef01234567";

test("the first line names the status and the full head sha", () => {
  assert.equal(commentFirstLine(STATUS.pass, sha40), `pstack-verifier: PASS @ ${sha40}`);
  assert.equal(commentFirstLine(STATUS.passNotes, sha40), `pstack-verifier: PASS+NOTES @ ${sha40}`);
  assert.equal(commentFirstLine(STATUS.fail, sha40), `pstack-verifier: FAIL @ ${sha40}`);
  assert.equal(commentFirstLine(STATUS.pass, sha40).split(" @ ")[1].length, 40);
});

test("an abbreviated sha cannot produce a first line", () => {
  for (const bad of ["0123456", "", "z".repeat(40), sha40.slice(0, 39) + "!"]) {
    assert.throws(() => commentFirstLine(STATUS.pass, bad), (error) => error.reason === REASONS.badSha);
  }
});

test("the rendered body starts with the required first line and nothing before it", async () => {
  const fixture = harness({ answer: answerFor([smoke]) });
  await fixture.run();
  const body = fixture.read("comment.md");
  assert.equal(body.split("\n")[0], `pstack-verifier: PASS @ ${HEAD_SHA}`);
});

test("the body carries the per feature table and the verifier model family", () => {
  const body = renderBody({
    status: STATUS.pass,
    headSha: sha40,
    rows: [{ feature: "Sign in", parent_result: "ok", head_result: "ok", verdict: "ok", evidence: "835 kcal", severity: "none" }],
    reasons: [],
    notes: [],
    provider: "claude",
    model: "claude-opus-5-5",
    authorFamily: "deepseek",
    selected: [{ name: "Sign in" }],
  });
  assert.equal(body.split("\n")[0], `pstack-verifier: PASS @ ${sha40}`);
  assert.match(body, /\| Feature \| parent \| head \| verdict \| severity \| evidence \|/);
  assert.match(body, /Verifier model family: claude \(claude-opus-5-5\)\. Author model family: deepseek\./);
});

test("a same-family run says so in one plain line", () => {
  const body = renderBody({
    status: STATUS.pass,
    headSha: sha40,
    rows: [],
    reasons: [],
    notes: [],
    provider: "deepseek",
    model: "deepseek-v4.1-flash",
    authorFamily: "deepseek",
    selected: [],
  });
  assert.ok(
    body.includes("Same family: the author and the verifier are both deepseek (owner's decision, 2026-11-15)."),
    body,
  );
  assert.equal(body.split("\n").filter((line) => line.startsWith("Same family: ")).length, 1);
});

test("a cross-family run does not claim a same family", () => {
  const body = renderBody({
    status: STATUS.pass,
    headSha: sha40,
    rows: [],
    reasons: [],
    notes: [],
    provider: "claude",
    model: "claude-opus-5-5",
    authorFamily: "deepseek",
    selected: [],
  });
  assert.equal(body.includes("Same family: "), false);
});

test("a pipe or a newline in observed text cannot break the table", () => {
  const table = renderTable([
    {
      feature: "One",
      parent_result: "a | b",
      head_result: "line one\nline two",
      verdict: "regression",
      evidence: "|",
      severity: "major",
    },
  ]);
  const row = table.split("\n")[2];
  // Six cells means five separators plus the two outer pipes, once the escaped pipes are taken out.
  const cells = row.replaceAll("\\|", "<pipe>").split("|").filter((cell) => cell !== "");
  assert.equal(cells.length, 6);
  assert.match(row, /a \\\| b/);
  assert.match(row, /line one line two/);
});

test("a FAIL body still shows what the agent saw", () => {
  const body = renderBody({
    status: STATUS.fail,
    headSha: sha40,
    rows: [
      {
        feature: "Add a food",
        parent_result: "835 -> 925",
        head_result: "835 -> 835",
        verdict: "regression",
        evidence: "total stayed 835",
        severity: "major",
      },
    ],
    reasons: ["major: Add a food"],
    notes: [],
    provider: "claude",
    model: "claude-opus-5-5",
    authorFamily: "deepseek",
    selected: [{ name: "Add a food" }],
  });
  assert.match(body.split("\n")[0], /^pstack-verifier: FAIL @ 0123456789/);
  assert.match(body, /major: Add a food/);
  assert.match(body, /total stayed 835/);
});
