// The feature map is the source of both the feature list and the selection rule: a pull
// request is verified on the features whose source paths its diff touches, plus the smoke one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseFeatureMap, REASONS, selectFeatures, SMOKE_FEATURE } from "../verify.mjs";
import { featureMapPath } from "./support.mjs";

const real = parseFeatureMap(readFileSync(featureMapPath, "utf8"));
const names = real.map((feature) => feature.name);

test("this repo's feature map parses and covers the app", () => {
  assert.ok(real.length >= 10, `expected 10 or more features, got ${real.length}`);
  for (const feature of real) {
    assert.ok(feature.paths.length > 0, `${feature.name} has no source paths`);
    assert.ok(feature.steps.length > 0, `${feature.name} has no drive steps`);
    assert.ok(feature.expected.length > 0, `${feature.name} has no expected result`);
  }
  assert.ok(names.includes(SMOKE_FEATURE), "the smoke feature is in the map");
  assert.equal(new Set(names).size, names.length, "feature names are unique");
});

test("a changed file inside a feature's paths selects it", () => {
  const selected = selectFeatures(real, ["src/tools.ts"]);
  assert.ok(selected.some((feature) => feature.name === "An AI chat adds and reads food through MCP"));
  assert.ok(selected.some((feature) => feature.name === SMOKE_FEATURE));
});

test("a changed path inside a directory a feature owns selects it", () => {
  const selected = selectFeatures(real, ["app/src/styles.css"]);
  assert.ok(selected.some((feature) => feature.name === "Android app (APK)"));
});

test("the smoke feature is always in the run and always first", () => {
  const nothing = selectFeatures(real, ["README.md"]);
  assert.equal(nothing.length, 1);
  assert.equal(nothing[0].name, SMOKE_FEATURE);
  assert.match(nothing[0].why, /smoke/);

  const some = selectFeatures(real, ["src/db.ts"]);
  assert.equal(some[0].name, SMOKE_FEATURE);
  assert.equal(some.filter((feature) => feature.name === SMOKE_FEATURE).length, 1);
});

test("a path that no feature owns still yields the smoke feature only", () => {
  const selected = selectFeatures(real, ["changelog.d/SOFT-1277.md", "package-lock.json"]);
  assert.deepEqual(selected.map((feature) => feature.name), [SMOKE_FEATURE]);
});

test("an unknown smoke name falls back to the first feature instead of crashing", () => {
  const selected = selectFeatures(real, [], "A feature that was renamed");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].name, real[0].name);
});

test("the selection is deterministic and keeps the map's order", () => {
  const one = selectFeatures(real, ["src/tools.ts", "app/src/view.ts"]);
  const two = selectFeatures(real, ["app/src/view.ts", "src/tools.ts"]);
  assert.deepEqual(one.map((feature) => feature.name), two.map((feature) => feature.name));
  const order = one.map((feature) => names.indexOf(feature.name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("a feature map with no rows fails closed", () => {
  assert.throws(
    () => parseFeatureMap("# Feature map\n\nNothing here yet.\n"),
    (error) => error.reason === REASONS.featureMapMissing,
  );
});
