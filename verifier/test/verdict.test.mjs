// The verdict function. The agent reports what it saw; this fixed function decides, so no
// sentence in the answer can turn a broken feature into a pass.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANSWER_KEYS,
  decideVerdict,
  REASONS,
  SEVERITIES,
  STATUS,
  validateAnswer,
  VERDICTS,
} from "../verify.mjs";
import { row } from "./support.mjs";

const features = [{ name: "Sign in and open today's home" }, { name: "Add a food from the app" }];

test("a clean answer with no finding is a plain PASS", () => {
  const decision = decideVerdict({ rows: [row(features[0].name)] });
  assert.equal(decision.status, STATUS.pass);
  assert.deepEqual(decision.reasons, []);
  assert.deepEqual(decision.notes, []);
});

test("a note makes it PASS+NOTES, never a plain PASS", () => {
  const decision = decideVerdict({ rows: [row(features[0].name, { severity: "note", verdict: "not_drivable" }), row(features[1].name)] });
  assert.equal(decision.status, STATUS.passNotes);
  assert.match(decision.notes.join("\n"), /note: Sign in/);
});

test("a minor issue makes it PASS+NOTES", () => {
  const decision = decideVerdict({ rows: [row(features[1].name, { severity: "minor" })] });
  assert.equal(decision.status, STATUS.passNotes);
});

test("a major finding is FAIL", () => {
  const decision = decideVerdict({ rows: [row(features[1].name, { severity: "major", verdict: "regression" })] });
  assert.equal(decision.status, STATUS.fail);
  assert.match(decision.reasons.join("\n"), /major: Add a food/);
});

test("a blocker is FAIL even when every other feature is fine", () => {
  const decision = decideVerdict({
    rows: [row(features[0].name), row(features[1].name, { severity: "blocker", verdict: "regression" })],
  });
  assert.equal(decision.status, STATUS.fail);
});

test("a major regression can never become PASS+NOTES", () => {
  const decision = decideVerdict({
    rows: [row(features[1].name, { severity: "major", verdict: "regression", head_result: "500 from the app" })],
  });
  assert.equal(decision.status, STATUS.fail);
  assert.notEqual(decision.status, STATUS.passNotes);
});

test("a feature broken on both sides is still judged by its severity", () => {
  assert.equal(
    decideVerdict({ rows: [row(features[0].name, { severity: "major", verdict: "broken_on_both" })] }).status,
    STATUS.fail,
  );
  assert.equal(
    decideVerdict({ rows: [row(features[0].name, { severity: "minor", verdict: "broken_on_both" })] }).status,
    STATUS.passNotes,
  );
});

test("an answer that drove nothing on the head is FAIL", () => {
  const decision = decideVerdict({
    rows: [row(features[0].name, { severity: "note", verdict: "not_drivable" })],
  });
  assert.equal(decision.status, STATUS.fail);
  assert.match(decision.reasons.join("\n"), new RegExp(REASONS.droveNothing));
});

test("an empty feature list is FAIL", () => {
  assert.equal(decideVerdict({ rows: [] }).status, STATUS.fail);
});

test("a head judged alone because the parent did not start is PASS+NOTES at best", () => {
  const decision = decideVerdict({ rows: [row(features[0].name)], parentStarted: false });
  assert.equal(decision.status, STATUS.passNotes);
  assert.match(decision.notes.join("\n"), /parent checkout did not start/);
});

test("a major finding still fails when the parent did not start", () => {
  assert.equal(
    decideVerdict({ rows: [row(features[0].name, { severity: "major" })], parentStarted: false }).status,
    STATUS.fail,
  );
});

test("the answer schema keeps exactly the agreed fields and values", () => {
  assert.deepEqual(ANSWER_KEYS, ["feature", "parent_result", "head_result", "verdict", "evidence", "severity"]);
  assert.deepEqual(VERDICTS, ["ok", "regression", "broken_on_both", "not_drivable"]);
  assert.deepEqual(SEVERITIES, ["blocker", "major", "minor", "note", "none"]);

  const rows = validateAnswer({ features: [row(features[0].name)] }, features);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ANSWER_KEYS);
});

const rejected = [
  ["an unknown verdict", { verdict: "probably_fine" }],
  ["an unknown severity", { severity: "critical" }],
  ["an empty evidence string", { evidence: "  " }],
  ["a missing field", { evidence: undefined }],
  ["an unknown extra field", { confidence: "high" }],
  ["a feature nobody asked for", { feature: "Teleport" }],
];

for (const [label, overrides] of rejected) {
  test(`the answer fails closed on ${label}`, () => {
    const bad = { ...row(features[0].name), ...overrides };
    for (const key of Object.keys(bad)) if (bad[key] === undefined) delete bad[key];
    assert.throws(() => validateAnswer({ features: [bad] }, features), (error) => error.reason === REASONS.answerSchema);
  });
}

test("the answer fails closed when a feature is listed twice", () => {
  const twice = { features: [row(features[0].name), row(features[0].name)] };
  assert.throws(() => validateAnswer(twice, features), (error) => error.reason === REASONS.answerSchema);
});

test("the answer fails closed when the top level is not the agreed object", () => {
  assert.throws(() => validateAnswer([], features), (error) => error.reason === REASONS.answerSchema);
  assert.throws(() => validateAnswer({ rows: [] }, features), (error) => error.reason === REASONS.answerSchema);
});
