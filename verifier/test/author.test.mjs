// The owner decided on 2026-11-15 that the verifier on GitHub is DeepSeek for every author,
// so every accepted author family gets the DeepSeek verifier, and so does a body with no
// author-model line. Only a value outside the four known families fails closed.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentModelFor,
  AUTHOR_FAMILIES,
  AUTHOR_FAMILY_DEFAULT,
  chooseFamilies,
  LOGIN_VAR_CLAUDE,
  LOGIN_VAR_DEEPSEEK,
  loginFor,
  MODEL_CLAUDE,
  MODEL_DEEPSEEK,
  REASONS,
} from "../verify.mjs";

// The six rows of the owner's table, one test per row, in table order.

test("row 1: a claude author gets the deepseek verifier", () => {
  assert.deepEqual(chooseFamilies("author-model: claude"), { authorFamily: "claude", verifierFamily: "deepseek" });
});

test("row 2: an openai author gets the deepseek verifier", () => {
  assert.deepEqual(chooseFamilies("author-model: openai"), { authorFamily: "openai", verifierFamily: "deepseek" });
});

test("row 3: a grok author gets the deepseek verifier", () => {
  assert.deepEqual(chooseFamilies("author-model: grok"), { authorFamily: "grok", verifierFamily: "deepseek" });
});

test("row 4: a deepseek author gets the deepseek verifier", () => {
  assert.deepEqual(chooseFamilies("author-model: deepseek"), { authorFamily: "deepseek", verifierFamily: "deepseek" });
});

test("row 5: a missing author-model line is a deepseek author, so the verifier is deepseek", () => {
  for (const body of ["Just a plain description.", "", undefined, null]) {
    assert.deepEqual(chooseFamilies(body), { authorFamily: "deepseek", verifierFamily: "deepseek" });
  }
  assert.equal(AUTHOR_FAMILY_DEFAULT, "deepseek");
});

test("row 6: any other author-model value fails closed as unknown_author_model", () => {
  for (const value of ["gemini", "claude,deepseek", "none"]) {
    assert.throws(
      () => chooseFamilies(`author-model: ${value}`),
      (error) => error.reason === REASONS.authorModelUnknown,
      value,
    );
  }
  assert.equal(REASONS.authorModelUnknown, "unknown_author_model");
});

test("every accepted family is read in any case and anywhere in the body", () => {
  assert.deepEqual(AUTHOR_FAMILIES, ["claude", "openai", "grok", "deepseek"]);
  assert.equal(chooseFamilies("AUTHOR-MODEL: Claude").authorFamily, "claude");
  assert.equal(chooseFamilies("some text\n\nauthor-model:   grok   \nmore text").authorFamily, "grok");
});

test("the deepseek verifier model is the flash constant, never a pro model", () => {
  assert.equal(agentModelFor("deepseek"), MODEL_DEEPSEEK);
  assert.equal(agentModelFor("claude"), MODEL_CLAUDE);
  assert.equal(MODEL_DEEPSEEK, "deepseek-v4.1-flash");
  assert.equal(/pro/i.test(MODEL_DEEPSEEK), false);
  assert.equal(MODEL_CLAUDE, "claude-opus-5-5");
});

test("each provider reads exactly its own login variable", () => {
  const env = { CLAUDE_CODE_OAUTH_TOKEN: "oat-value-123456", OPENCODE_API_KEY: "oc-value-123456" };
  assert.deepEqual(loginFor("claude", env), { name: LOGIN_VAR_CLAUDE, value: "oat-value-123456" });
  assert.deepEqual(loginFor("deepseek", env), { name: LOGIN_VAR_DEEPSEEK, value: "oc-value-123456" });
});

test("a missing or blank login variable fails closed with its own reason", () => {
  for (const provider of ["claude", "deepseek"]) {
    for (const env of [{}, { CLAUDE_CODE_OAUTH_TOKEN: "  ", OPENCODE_API_KEY: "" }]) {
      assert.throws(
        () => loginFor(provider, env),
        (error) => error.reason === REASONS.missingLoginVariable,
        provider,
      );
    }
  }
  assert.throws(
    () => loginFor("claude", { OPENCODE_API_KEY: "oc-value-123456" }),
    (error) => error.reason === REASONS.missingLoginVariable,
  );
});

test("the login variable names are the ones Pi and Claude Code name", () => {
  assert.equal(LOGIN_VAR_CLAUDE, "CLAUDE_CODE_OAUTH_TOKEN");
  assert.equal(LOGIN_VAR_DEEPSEEK, "OPENCODE_API_KEY");
});
