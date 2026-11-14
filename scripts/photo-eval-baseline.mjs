// One 1x1 photo per model. Its cache-creation count is the harness tail
// with almost no image. A real plate's extra tokens are the photo.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = path.join(root, "eval/photo-baseline.json");
const models = ["claude-haiku-5-5", "claude-sonnet-5-5"];
// Two different 1x1 PNGs. The second must not be a cache hit of the first.
const warmupPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const schema = JSON.stringify({
  type: "object",
  additionalProperties: false,
  properties: { kcal: { type: "integer" } },
  required: ["kcal"],
});

function run(model, png) {
  const message = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: "Estimate the total kilocalories of the food on this plate, as served." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
      ],
    },
  };
  const args = [
    "-p", "--verbose", "--model", model, "--effort", "low", "--safe-mode",
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--no-session-persistence",
    "--system-prompt", "You estimate plate calories. Reply with JSON only.",
    "--json-schema", schema,
    "--disallowedTools", "Bash,Read,Edit,Write,WebFetch,WebSearch,Glob,Grep",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 50000);
    child.stdout.on("data", (buf) => { stdout += buf; });
    child.stderr.on("data", (buf) => { stderr += buf; });
    child.on("close", (code) => {
      clearTimeout(timer);
      let event = null;
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "result") event = parsed;
        } catch { /* torn line */ }
      }
      if (!event || event.is_error) reject(new Error(stderr.slice(0, 300) || `no result for ${model}`));
      else resolve(event);
    });
    child.stdin.end(JSON.stringify(message) + "\n");
  });
}

const baselines = {};
for (const model of models) {
  // Warm the shared prompt, then measure a different 1x1 so the photo is not a cache hit.
  await run(model, warmupPng);
  const event = await run(model, tinyPng);
  const usage = event.usage;
  baselines[model] = {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
  };
  const tail = usage.input_tokens + usage.cache_creation_input_tokens;
  console.log(`${model} tiny_tail_tokens=${tail}`);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ note: "1x1 png, second call, same prompt as the plate scorer", models: baselines }, null, 2));
console.log("baseline ok");
