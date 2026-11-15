// The verifier has to come from a different model family than the author. The author states
// its family in one line of the pull request body; anything unclear fails closed.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentModelFor,
  AUTHOR_FAMILY_DEFAULT,
  LOGIN_VAR_CLAUDE,
  LOGIN_VAR_DEEPSEEK,
  loginFor,
  MODEL_CLAUDE,
  MODEL_DEEPSEEK,
  parseAuthorFamily,
  providerForFamily,
  REASONS,
} from "../verify.mjs";

test("a pull request with no author-model line is treated as our workers: deepseek", () => {
  assert.equal(parseAuthorFamily("Just a plain description."), AUTHOR_FAMILY_DEFAULT);
  assert.equal(AUTHOR_FAMILY_DEFAULT, "deepseek");
  assert.equal(providerForFamily(AUTHOR_FAMILY_DEFAULT), "claude");
});

test("an empty or missing body is treated as deepseek", () => {
  assert.equal(parseAuthorFamily(""), "deepseek");
  assert.equal(parseAuthorFamily(undefined), "deepseek");
  assert.equal(parseAuthorFamily(null), "deepseek");
});

test("every family the ticket names is accepted, in any case", () => {
  assert.equal(parseAuthorFamily("author-model: deepseek"), "deepseek");
  assert.equal(parseAuthorFamily("author-model: claude"), "claude");
  assert.equal(parseAuthorFamily("author-model: openai"), "openai");
  assert.equal(parseAuthorFamily("AUTHOR-MODEL: Claude"), "claude");
  assert.equal(parseAuthorFamily("some text\n\nauthor-model:   openai   \nmore text"), "openai");
});

test("a claude author gets a non-Claude verifier", () => {
  assert.equal(providerForFamily("claude"), "deepseek");
  assert.equal(agentModelFor("deepseek"), MODEL_DEEPSEEK);
  assert.equal(MODEL_DEEPSEEK, "deepseek-flash");
});

test("every other author gets the Claude family verifier", () => {
  assert.equal(providerForFamily("deepseek"), "claude");
  assert.equal(providerForFamily("openai"), "claude");
  assert.equal(agentModelFor("claude"), MODEL_CLAUDE);
  assert.equal(MODEL_CLAUDE, "claude-opus-5-5");
});

test("an unknown author-model value fails closed", () => {
  for (const value of ["grok", "gemini", "claude,deepseek", "none"]) {
    assert.throws(
      () => parseAuthorFamily(`author-model: ${value}`),
      (error) => error.reason === REASONS.authorModelUnknown,
      value,
    );
  }
});

test("each provider reads exactly its own login variable", () => {
  const env = { CLAUDE_CODE_OAUTH_TOKEN: "oat-value-123456", DEEPSEEK_API_KEY: "sk-deepseek-123456" };
  assert.deepEqual(loginFor("claude", env), { name: LOGIN_VAR_CLAUDE, value: "oat-value-123456" });
  assert.deepEqual(loginFor("deepseek", env), { name: LOGIN_VAR_DEEPSEEK, value: "sk-deepseek-123456" });
});

test("a missing or blank login variable fails closed with its own reason", () => {
  for (const provider of ["claude", "deepseek"]) {
    for (const env of [{}, { CLAUDE_CODE_OAUTH_TOKEN: "  ", DEEPSEEK_API_KEY: "" }]) {
      assert.throws(
        () => loginFor(provider, env),
        (error) => error.reason === REASONS.missingLoginVariable,
        provider,
      );
    }
  }
  assert.throws(
    () => loginFor("claude", { DEEPSEEK_API_KEY: "sk-deepseek-123456" }),
    (error) => error.reason === REASONS.missingLoginVariable,
  );
});

test("the login variable names are the ones the docs name", () => {
  assert.equal(LOGIN_VAR_CLAUDE, "CLAUDE_CODE_OAUTH_TOKEN");
  assert.equal(LOGIN_VAR_DEEPSEEK, "DEEPSEEK_API_KEY");
});
