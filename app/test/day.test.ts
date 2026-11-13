import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dayLabel,
  entryTime,
  groupThousands,
  parseKcal,
  progressPercent,
  remainingLabel,
  sourceLabel,
} from "../src/day.ts";

test("a Claude entry is labelled with its client name", () => {
  assert.equal(sourceLabel({ client_name: "Claude", source: "mcp" }), "Added from Claude");
  assert.equal(sourceLabel({ client_name: null, source: "mcp" }), "Added from an AI chat");
  assert.equal(sourceLabel({ client_name: "Android", source: "app" }), "Added in the app");
});

test("the day label names the day the server used", () => {
  assert.equal(dayLabel("2026-10-30"), "Today, Fri 30 Oct");
});

test("entry times render in the profile timezone, not UTC", () => {
  assert.equal(entryTime("2026-10-30T07:40:00.000Z", "UTC"), "07:40");
  assert.equal(entryTime("2026-10-30T07:40:00.000Z", "Europe/London"), "07:40");
  assert.equal(entryTime("2026-10-30T07:40:00.000Z", "Asia/Tokyo"), "16:40");
});

test("progress stays inside the bar", () => {
  assert.equal(progressPercent(1240, 2100), 59);
  assert.equal(progressPercent(0, 2100), 0);
  assert.equal(progressPercent(3000, 2100), 100);
  assert.equal(progressPercent(500, 0), 0);
});

test("calories parse strictly", () => {
  assert.equal(parseKcal("310"), 310);
  assert.equal(parseKcal(" 0 "), 0);
  assert.equal(parseKcal(""), null);
  assert.equal(parseKcal("3.5"), 3);
  assert.equal(parseKcal("-1"), null);
  assert.equal(parseKcal("lots"), null);
  assert.equal(parseKcal("20001"), null);
});

test("remaining calories read as left or over", () => {
  assert.equal(remainingLabel(860), "860 left");
  assert.equal(remainingLabel(-40), "40 over");
  assert.equal(remainingLabel(1240), "1,240 left");
});

test("thousands are grouped", () => {
  assert.equal(groupThousands(1240), "1,240");
});
