// Drives the installed APK on an Android emulator over the WebView's Chrome DevTools
// protocol, records the screen and writes the device proof. Runs on a GitHub-hosted
// runner only, never on our server.
//
//   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
//   adb shell am start -n dev.calorie.tracker/.MainActivity
//   node scripts/drive-device.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { chromium } from "playwright";

import { makeConnector } from "./lib/oauth.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8788";
const PROOF = process.env.PROOF ?? "proof/app-device.txt";
const SHOT = process.env.SHOT ?? "proof/device-home.png";
const VIDEO = process.env.VIDEO ?? "proof/device-demo.mp4";

const lines = [`SOFT-1274 APK on Android. API ${BASE}. Run at ${new Date().toISOString()}.`];
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

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" });
const payload = (response) => JSON.parse(response.body.result.content[0].text);

const deviceVersion = adb("shell", "getprop", "ro.build.version.release").trim();
const model = adb("shell", "getprop", "ro.product.model").trim();
check(deviceVersion.length > 0, "an Android device is attached", { model, version: deviceVersion });

// The same Claude-style client the other proofs use, so the entry label is "Added from Claude".
const connect = makeConnector({ base: BASE, check, log, secrets, userAgent: "Claude" });
const user = await connect("device-a");
payload(await user.rpc("tools/call", {
  arguments: { kcal: 310, name: "Porridge with banana", portion_text: "1 bowl" },
  name: "add_entry",
}, 1));

// Record the screen for the whole run, then attach the video to the ticket.
const recording = `${adb("shell", "mktemp", "-p", "/sdcard", "device-XXXX").trim()}.mp4`;
execFileSync("adb", ["shell", "screenrecord", "--bit-rate", "4000000", "--time-limit", "120", recording], {
  detached: true,
  stdio: "ignore",
});
log(`Screen recording started: ${recording}`);

const socket = adb("shell", "cat", "/proc/net/unix")
  .split("\n")
  .map((line) => line.trim().split(/\s+/).pop() ?? "")
  .find((name) => name.startsWith("webview_devtools_remote_"));
check(socket !== undefined, "the app's WebView is debuggable", socket);
adb("forward", "--remove-all");
adb("forward", "tcp:9222", `localabstract:${socket}`);
await sleep(1000);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0] ?? await browser.newContext();
const page = context.pages()[0] ?? await context.newPage();
const total = async () => (await page.locator(".total-number").textContent()) ?? "";

try {
  await page.getByRole("button", { name: "Sign in" }).waitFor({ timeout: 30000 });
  check(true, "the APK installs, opens and shows the sign-in screen");
  await page.getByPlaceholder("you@example.com").fill(user.email);
  await page.getByPlaceholder("Your password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".total-number").waitFor({ timeout: 30000 });
  check(await total() === "310", "home shows today's calories from the server on the device", await total());
  check(await page.getByText("Added from Claude").count() === 1, "the Claude entry shows with its source");
  check((await page.locator(".goal-row .left").textContent()) === "1,690 left", "home shows calories left");

  mkdirSync("proof", { recursive: true });
  writeFileSync(SHOT, execFileSync("adb", ["exec-out", "screencap", "-p"]));

  await page.getByRole("button", { name: "Add food" }).click();
  await page.getByLabel("Food", { exact: true }).fill("Toast, wholemeal");
  await page.getByLabel("Calories", { exact: true }).fill("90");
  await page.getByRole("button", { name: "Add to log" }).click();
  await page.locator(".sheet").waitFor({ state: "detached", timeout: 20000 });
  check(await total() === "400", "adding food on the device updates today's total", await total());

  await page.getByRole("button", { name: /Toast, wholemeal/ }).click();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: /Toast, wholemeal/ }).waitFor({ state: "detached", timeout: 20000 });
  check(await total() === "310", "deleting on the device updates today's total", await total());
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: /Toast, wholemeal/ }).waitFor({ timeout: 20000 });
  check(await total() === "400", "undo puts the entry back on the device", await total());
} catch (error) {
  check(false, "the device run reached the end", error instanceof Error ? error.message : String(error));
  writeFileSync(SHOT.replace(/\.png$/, "-failure.png"), execFileSync("adb", ["exec-out", "screencap", "-p"]));
} finally {
  await browser.close().catch(() => {});
}

// Stop the recording and pull it out of the emulator.
try {
  adb("shell", "pkill", "-INT", "screenrecord");
  await sleep(3000);
  execFileSync("adb", ["pull", recording, VIDEO], { stdio: "inherit" });
  check(true, "screen recording saved", VIDEO);
} catch (error) {
  check(false, "screen recording saved", error instanceof Error ? error.message : String(error));
}
adb("shell", "rm", "-f", recording);

mkdirSync("proof", { recursive: true });
writeFileSync(PROOF, redact(lines.join("\n")) + "\n");
check(failures === 0, "APK device proof complete", { failures });
process.exit(failures ? 1 : 0);
