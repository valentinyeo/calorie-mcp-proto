// The drive tool: acts like a user against one local checkout of Calorie Tracker, and calls
// the app's HTTP and MCP endpoints the way a user's AI chat does. Built on Playwright, which
// this repo already declares as a devDependency, so there is nothing new to install.
//
// A sequence of user actions runs in one browser in one call, because form input does not
// survive a reload. Everything else is one action per call on the stored session.
//
//   node verifier/drive.mjs run '[["open","http://localhost:5173/head/"],
//     ["fill","label=Email","pstack-verifier@example.com"],
//     ["fill","label=Password","pstack-verifier-local-only"],
//     ["click","role=button[name=\"Sign in\"]"],
//     ["text",".total-number"],
//     ["screenshot","home.png"]]'
//
//   node verifier/drive.mjs open http://localhost:5173/head/
//   node verifier/drive.mjs click 'role=button[name="Add food"]'
//   node verifier/drive.mjs text '.total-number'
//   node verifier/drive.mjs screenshot home.png
//   node verifier/drive.mjs signin <api> <email> <password>
//   node verifier/drive.mjs http GET <api>/api/app/day --token
//   node verifier/drive.mjs mcp-tools <api> <email> <password>
//   node verifier/drive.mjs mcp-call <api> <email> <password> add_entry '{"name":"Greek yoghurt","kcal":120}'
//
// Selectors are anything Playwright accepts as a locator, plus `label=...` for getByLabel and
// `role=button[name="Sign in"]` for getByRole. `--nth N` picks one match, `--profile <dir>`
// keeps the browser session, `--scratch <dir>` limits where screenshots may go. Everything is
// local (127.0.0.1 and localhost) and the only account used is the invented seed account.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { chromium } from "playwright";

import { connectMcp } from "./lib/oauth.mjs";

const LIMIT = 4000;
const cut = (text, limit = LIMIT) => {
  const value = String(text ?? "");
  return value.length > limit ? `${value.slice(0, limit)}\n...[${value.length - limit} more characters]` : value;
};

const args = process.argv.slice(2);
const flags = new Map();
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--profile") flags.set("profile", args[++i]);
  else if (args[i] === "--nth") flags.set("nth", args[++i]);
  else if (args[i] === "--token") flags.set("token", "1");
  else if (args[i] === "--scratch") flags.set("scratch", args[++i]);
  else words.push(args[i]);
}

const profile = resolve(flags.get("profile") ?? process.env.PSTACK_PROFILE ?? "/tmp/pstack-drive-profile");
const scratch = resolve(flags.get("scratch") ?? process.env.PSTACK_SCRATCH ?? "/tmp/pstack-drive-scratch");
const lastUrlFile = join(profile, "last-url");
const tokenFile = join(profile, "session-token");
const [command, ...rest] = words;

const out = (text) => process.stdout.write(`${cut(text)}\n`);

const locator = (page, selector) => {
  const nth = flags.has("nth") ? Number(flags.get("nth")) : null;
  let found;
  if (selector.startsWith("label=")) {
    found = page.getByLabel(selector.slice("label=".length), { exact: true });
  } else if (selector.startsWith("label~=")) {
    found = page.getByLabel(selector.slice("label~=".length));
  } else if (selector.startsWith("role=")) {
    const spec = selector.slice("role=".length);
    const match = /^([a-z]+)\[name="(.*)"\]$/i.exec(spec);
    found = match === null ? page.getByRole(spec) : page.getByRole(match[1], { name: match[2] });
  } else {
    found = page.locator(selector);
  }
  return nth === null ? found : found.nth(nth);
};

const pageText = async (page) => (await page.locator("body").innerText().catch(() => "")).trim();

// The app answers every click with a fetch and the click call returns before it settles.
// Give the app a moment so the next action sees what the user would see.
const settle = async (page, ms = 1200) => page.waitForTimeout(ms);

const safeScreenshot = async (page, target) => {
  const path = isAbsolute(target) ? target : join(scratch, target);
  const resolved = resolve(path);
  if (!resolved.startsWith(scratch)) {
    throw new Error(`screenshot path ${resolved} is outside the scratch directory ${scratch}`);
  }
  mkdirSync(dirname(resolved), { recursive: true });
  await page.screenshot({ path: resolved });
  return `screenshot saved: ${resolved}`;
};

async function act(page, action) {
  const [verb, ...params] = action;
  switch (verb) {
    case "open": {
      await page.goto(params[0], { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await settle(page, 500);
      return `opened ${page.url()} title "${await page.title()}"\n${await pageText(page)}`;
    }
    case "reload": {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await settle(page, 800);
      return `reloaded ${page.url()}\n${await pageText(page)}`;
    }
    case "click": {
      await locator(page, params[0]).click({ timeout: 15000 });
      await settle(page);
      return `clicked ${params[0]}\n${await pageText(page)}`;
    }
    case "fill": {
      await locator(page, params[0]).fill(params[1], { timeout: 15000 });
      return `filled ${params[0]} with ${JSON.stringify(params[1])}`;
    }
    case "wait": {
      await locator(page, params[0]).waitFor({ state: "visible", timeout: 20000 });
      return `visible: ${params[0]}`;
    }
    case "text": {
      return params[0] === undefined
        ? await pageText(page)
        : await locator(page, params[0]).innerText({ timeout: 15000 });
    }
    case "screenshot":
      return safeScreenshot(page, params[0]);
    default:
      throw new Error(`unknown action: ${verb}`);
  }
}

async function withPage(actions) {
  mkdirSync(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    deviceScaleFactor: 2,
    viewport: { height: 844, width: 390 },
  });
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    let last = "";
    try {
      last = readFileSync(lastUrlFile, "utf8").trim();
    } catch {
      // nothing opened yet with this profile
    }
    if (actions[0]?.[0] !== "open" && last !== "") {
      await page.goto(last, { waitUntil: "domcontentloaded" });
    }
    for (const [index, action] of actions.entries()) {
      // One header per action, so a caller can tell which output came from which step.
      out(`--- action ${index + 1}: ${[action[0], ...action.slice(1)].join(" ")}`);
      out(await act(page, action));
    }
    writeFileSync(lastUrlFile, page.url());
    if (errors.length > 0) out(`page errors: ${JSON.stringify(errors.slice(0, 3))}`);
  } finally {
    await context.close();
  }
}

const httpJson = async (method, url, body, token, origin) => {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(origin === undefined ? {} : { origin }),
      ...(token === undefined || token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body }),
  });
  return { response, text: await response.text() };
};

const main = async () => {
  if (command === undefined) {
    process.stderr.write("usage: node verifier/drive.mjs <command> ...\n");
    process.exit(2);
  }

  if (command === "run") {
    const actions = JSON.parse(rest[0]);
    if (!Array.isArray(actions) || actions.some((action) => !Array.isArray(action) || action.length === 0)) {
      process.stderr.write("run: expected a JSON array of [verb, ...params] actions\n");
      process.exit(2);
    }
    await withPage(actions);
    return;
  }

  if (command === "signin") {
    const [api, email, password] = rest;
    const { response, text } = await httpJson(
      "POST",
      `${api}/sign-in/email`,
      JSON.stringify({ email, password }),
      null,
      api,
    );
    let token = response.headers.get("set-auth-token");
    if (token === null) token = JSON.parse(text || "{}").token ?? null;
    if (!response.ok || token === null) {
      out(`signin failed: ${response.status} ${cut(text, 500)}`);
      process.exit(1);
    }
    mkdirSync(profile, { recursive: true });
    writeFileSync(tokenFile, token);
    out(`signin ok: ${response.status}, session stored for ${email}`);
    return;
  }

  if (command === "http") {
    const [method, url, body] = rest;
    let token = null;
    if (flags.has("token")) {
      try {
        token = readFileSync(tokenFile, "utf8").trim();
      } catch {
        out("http: --token was passed but no session is stored, run signin first");
        process.exit(1);
      }
    }
    const { response, text } = await httpJson(method.toUpperCase(), url, body, token);
    out(`${method.toUpperCase()} ${url} -> ${response.status}\n${text}`);
    return;
  }

  if (command === "mcp-tools" || command === "mcp-call") {
    const [api, email, password, tool, json] = rest;
    const mcp = await connectMcp({ base: api, email, password });
    if (command === "mcp-tools") {
      const listed = await mcp.rpc("tools/list", {}, 1);
      out(JSON.stringify(listed.body, null, 2));
      return;
    }
    out(JSON.stringify(await mcp.tool(tool, JSON.parse(json ?? "{}"), 2), null, 2));
    return;
  }

  await withPage([[command, ...rest]]);
};

main().catch(async (error) => {
  process.stdout.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
