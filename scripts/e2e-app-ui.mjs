// Drives the real Foldkit app in a browser against a real Worker, the same bundle Capacitor
// puts in the APK. Proves sign-in, today's calories, a Claude-added entry, text add, edit,
// delete and undo, then saves a screenshot for the design check.
//   BASE=http://127.0.0.1:8787 APP=http://localhost:5173 node scripts/e2e-app-ui.mjs
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

import { makeConnector } from "./lib/oauth.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const APP = process.env.APP ?? "http://localhost:5173";
const PROOF = process.env.PROOF ?? "proof/app-ui.txt";
const SHOT = process.env.SHOT ?? "proof/home-c.png";

const lines = [`SOFT-1274 Foldkit app UI proof. App ${APP}, API ${BASE}. Run at ${new Date().toISOString()}.`];
const secrets = new Set();
const redact = (s) => [...secrets].reduce((t, v) => t.split(v).join("<redacted>"), s);
const log = (...a) => {
  const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ");
  lines.push(s);
  console.log(redact(s));
};

let failures = 0;
const check = (ok, label, detail) => {
  if (!ok) failures++;
  log(`${ok ? "PASS" : "FAIL"}: ${label}${detail === undefined ? "" : " -> " + JSON.stringify(detail)}`);
};

const payload = (response) => JSON.parse(response.body.result.content[0].text);
// Claude sends a user agent starting with its own name, which the server records as the
// entry's client label ("Added from Claude").
const connect = makeConnector({ base: BASE, check, log, secrets, userAgent: "Claude" });

const user = await connect("ui-a");
const claudeEntry = payload(await user.rpc("tools/call", {
  arguments: { kcal: 310, name: "Porridge with banana", portion_text: "1 bowl" },
  name: "add_entry",
}, 1));
payload(await user.rpc("tools/call", {
  arguments: { kcal: 105, name: "Banana", portion_text: "1 medium" },
  name: "add_entry",
}, 2));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { height: 844, width: 390 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

const total = async () => (await page.locator(".total-number").textContent()) ?? "";

try {
  await page.goto(APP, { waitUntil: "networkidle" });
  check(await page.getByRole("button", { name: "Sign in" }).isVisible(), "the app boots to the sign-in screen");

  await page.getByPlaceholder("you@example.com").fill(user.email);
  await page.getByPlaceholder("Your password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".total-number").waitFor({ timeout: 15000 });

  check((await page.locator(".today").textContent())?.startsWith("Today,") === true,
    "home leads with today's day label", await page.locator(".today").textContent());
  check(await total() === "415", "home shows today's calories from the server", await total());
  check((await page.locator(".goal-row").textContent())?.includes("2,000 kcal goal") === true,
    "home shows the goal");
  check((await page.locator(".goal-row .left").textContent()) === "1,585 left",
    "home shows calories left", await page.locator(".goal-row .left").textContent());
  check(await page.getByRole("button", { name: /Porridge with banana/ }).isVisible(),
    "the entry Claude added through MCP is on home");
  check(await page.getByText("Added from Claude").count() === 2,
    "Claude-added entries show their source", await page.getByText("Added from Claude").count());
  check((await page.getByRole("button", { name: /Porridge with banana/ }).locator(".row-sub").textContent())
    ?.includes("1 bowl") === true, "the portion sits under the food name");

  await page.screenshot({ path: SHOT });

  // Add by text.
  await page.getByRole("button", { name: "Add food" }).click();
  await page.getByLabel("Food", { exact: true }).fill("Toast, wholemeal");
  await page.getByLabel("Calories", { exact: true }).fill("90");
  await page.getByLabel("Portion (optional)", { exact: true }).fill("1 slice");
  await page.getByRole("button", { name: "Add to log" }).click();
  await page.locator(".sheet").waitFor({ state: "detached", timeout: 10000 });
  check(await total() === "505", "adding a food updates today's total", await total());
  check((await page.getByRole("button", { name: /Toast, wholemeal/ }).textContent())?.includes("Added in the app") === true,
    "an app entry shows it was added in the app");

  // Edit.
  await page.getByRole("button", { name: /Toast, wholemeal/ }).click();
  await page.getByLabel("Calories", { exact: true }).fill("100");
  await page.getByRole("button", { name: "Save entry" }).click();
  await page.locator(".sheet").waitFor({ state: "detached", timeout: 10000 });
  check(await total() === "515", "editing calories updates today's total", await total());

  // Delete with undo.
  await page.getByRole("button", { name: /Toast, wholemeal/ }).click();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByText("Deleted Toast, wholemeal").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: /Toast, wholemeal/ }).waitFor({ state: "detached", timeout: 10000 });
  check(await total() === "415", "deleting updates today's total", await total());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: /Toast, wholemeal/ }).waitFor({ timeout: 10000 });
  check(await total() === "515", "undo restores the entry and the total", await total());

  // The same entry keeps one identity after undo, so it cannot be duplicated.
  check(await page.getByRole("button", { name: /Toast, wholemeal/ }).count() === 1,
    "undo leaves exactly one copy of the food");

  await page.screenshot({ path: SHOT.replace(/\.png$/, "-after.png") });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".total-number").waitFor({ timeout: 15000 });
  check(await total() === "515", "the session survives a reload, so the app opens straight to today", await total());
  check(consoleErrors.length === 0, "no console errors in the app", consoleErrors.slice(0, 3));
  check(claudeEntry.entry.source === "mcp", "the seeded entry really came through MCP");
} catch (error) {
  check(false, "the UI run reached the end", error instanceof Error ? error.message : String(error));
  await page.screenshot({ path: SHOT.replace(/\.png$/, "-failure.png") }).catch(() => {});
} finally {
  await browser.close();
}

mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
check(failures === 0, "Foldkit app UI proof complete", { failures });
process.exit(failures ? 1 : 0);
