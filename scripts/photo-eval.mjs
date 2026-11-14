// Score one Nutrition5k plate at a time on Haiku 5.5 and Sonnet 5.5.
// The photo goes in the user message. Tools that can read the repo are off,
// so the calorie file cannot leak into the guess.
// EVAL_BUDGET_MS caps this process (default 90s). EVAL_MODEL limits one model.
// Ok rows append to eval/results/<model>.jsonl and a rerun skips them.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "eval/photo-manifest.json"), "utf8"));
const photosDir = path.join(root, "eval/photos");
const resultsDir = path.join(root, "eval/results");
const models = process.env.EVAL_MODEL
  ? [process.env.EVAL_MODEL]
  : ["claude-haiku-5-5", "claude-sonnet-5-5"];
const budgetMs = Number(process.env.EVAL_BUDGET_MS || 90000);
const started = Date.now();

const schema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  properties: { kcal: { type: "integer" } },
  required: ["kcal"],
});
const systemPrompt = "You estimate plate calories. Reply with JSON only.";
const userText = "Estimate the total kilocalories of the food on this plate, as served.";

fs.mkdirSync(resultsDir, { recursive: true });

function resultsPath(model) {
  return path.join(resultsDir, `${model}.jsonl`);
}

function loadDone(model) {
  const done = new Set();
  const file = resultsPath(model);
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.ok) done.add(row.dish_id);
  }
  return done;
}

function nextJob(doneByModel) {
  for (const dish of manifest.dishes) {
    for (const model of models) {
      if (!doneByModel.get(model).has(dish.id)) return { dish, model };
    }
  }
  return null;
}

function parseKcal(result) {
  if (result && typeof result === "object" && Number.isInteger(result.kcal)) return result.kcal;
  const text = String(result ?? "").trim();
  try {
    const parsed = JSON.parse(text);
    if (Number.isInteger(parsed.kcal)) return parsed.kcal;
  } catch {
    // The model sometimes wraps the JSON in prose.
  }
  return null;
}

function runClaude(model, imageB64) {
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: userText },
        { type: "image", source: { type: "base64", media_type: "image/png", data: imageB64 } },
      ],
    },
  };
  const args = [
    "-p",
    "--verbose",
    "--model", model,
    "--effort", "low",
    "--safe-mode",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--no-session-persistence",
    "--system-prompt", systemPrompt,
    "--json-schema", schema,
    "--disallowedTools", "Bash,Read,Edit,Write,WebFetch,WebSearch,Glob,Grep",
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: "/tmp", env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 50000);
    child.stdout.on("data", (buf) => {
      stdout += buf;
    });
    child.stderr.on("data", (buf) => {
      stderr += buf;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}

function resultEvent(stdout) {
  let found = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") found = event;
    } catch {
      // Verbose stream lines are JSON. Ignore a torn line.
    }
  }
  return found;
}

async function scoreOne(dish, model) {
  const src = path.join(photosDir, `${dish.id}.png`);
  const imageB64 = fs.readFileSync(src).toString("base64");
  const call = await runClaude(model, imageB64);
  const event = resultEvent(call.stdout);
  const usage = event?.usage;
  const kcal = event ? parseKcal(event.result) : null;
  const reported = event?.modelUsage ? Object.keys(event.modelUsage)[0] : null;
  const ok = Boolean(event && event.is_error === false && kcal !== null && usage && reported === model);
  return {
    ok,
    dish_id: dish.id,
    model,
    kcal_hat: kcal,
    usage: usage && {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    },
    reported_model: reported,
    total_cost_usd: event?.total_cost_usd ?? null,
    num_turns: event?.num_turns ?? null,
    exit_code: call.code,
    signal: call.signal,
    error: ok ? null : (call.stderr || call.stdout).slice(0, 300),
  };
}

const doneByModel = new Map(models.map((model) => [model, loadDone(model)]));
let wrote = 0;
while (Date.now() - started < budgetMs) {
  const job = nextJob(doneByModel);
  if (!job) {
    console.log("photo eval complete");
    process.exit(0);
  }
  const row = await scoreOne(job.dish, job.model);
  fs.appendFileSync(resultsPath(job.model), `${JSON.stringify(row)}\n`);
  if (row.ok) doneByModel.get(job.model).add(job.dish.id);
  wrote += 1;
  const done = [...doneByModel.values()].reduce((sum, set) => sum + set.size, 0);
  console.log(`${row.ok ? "ok" : "fail"} ${row.model} ${row.dish_id} kcal_hat=${row.kcal_hat} done=${done}`);
}
console.log(`budget stop wrote=${wrote}`);
