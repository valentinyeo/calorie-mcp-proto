// Mean absolute percent error, and cost per photo from measured usage.
// Prices: https://platform.claude.com/docs/en/about-claude/pricing.md
// Haiku 5.5 short prompt: input $0.10 / MTok, output $0.50 / MTok.
// Sonnet 5.5: input $2 / MTok, output $10 / MTok.
// Photo tokens = (input + cache-creation + cache-read) minus the same
// count on a 1x1 photo. The image sometimes lands in the prompt cache,
// so leaving out cache-read makes the photo count negative.
// That drops the Claude Code prompt, which a worker call does not send.
// The photo is ordinary input in a worker, so the input price applies.
// Output tokens are the model's measured output, thinking included.
// Lower mean absolute percent error wins. A tie goes to the cheaper model.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "eval/photo-manifest.json"), "utf8"));
const baseline = JSON.parse(fs.readFileSync(path.join(root, "eval/photo-baseline.json"), "utf8"));
const resultsDir = path.join(root, "eval/results");

const PRICE = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

const label = new Map(manifest.dishes.map((dish) => [dish.id, dish.kcal]));
if (label.size !== 100) throw new Error("manifest is not 100 dishes");

const best = new Map();
for (const name of fs.readdirSync(resultsDir)) {
  if (!name.endsWith(".jsonl")) continue;
  for (const line of fs.readFileSync(path.join(resultsDir, name), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row.ok) continue;
    best.set(`${row.model}\t${row.dish_id}`, row);
  }
}

const stats = [];
for (const model of Object.keys(PRICE)) {
  const base = baseline.models[model];
  if (!base) throw new Error(`missing baseline ${model}`);
  const baseTail = base.input_tokens + base.cache_creation_input_tokens + base.cache_read_input_tokens;
  const rows = [...best.values()].filter((row) => row.model === model);
  if (rows.length !== 100) throw new Error(`${model} has ${rows.length} ok rows, want 100`);
  let apeSum = 0;
  let usdSum = 0;
  for (const row of rows) {
    if (!label.has(row.dish_id)) throw new Error(`unknown dish ${row.dish_id}`);
    if (row.reported_model !== model) throw new Error(`model mismatch ${row.reported_model}`);
    const actual = label.get(row.dish_id);
    const tail = row.usage.input_tokens + row.usage.cache_creation_input_tokens + row.usage.cache_read_input_tokens;
    const photoTokens = tail - baseTail;
    if (photoTokens < 50 || photoTokens > 2000) {
      throw new Error(`${model} ${row.dish_id} photo tokens ${photoTokens} (tail ${tail}, base ${baseTail})`);
    }
    const price = PRICE[model];
    usdSum += (photoTokens * price.input + row.usage.output_tokens * price.output) / 1e6;
    apeSum += Math.abs(row.kcal_hat - actual) / actual * 100;
  }
  stats.push({ model, mape: apeSum / rows.length, usd: usdSum / rows.length });
}

stats.sort((a, b) => a.mape - b.mape || a.usd - b.usd);
for (const row of stats) {
  console.log(`${row.model} mean_abs_pct_error=${row.mape.toFixed(2)} usd_per_photo=${row.usd.toFixed(6)}`);
}
console.log(`picked=${stats[0].model}`);
console.log("photo eval summary passed");
