// Puts invented data into one local checkout so the verifier has something to read on both
// sides: one account, a 2,000 kcal goal in Europe/London, two entries added in the app and
// one entry added through MCP as "Claude". Local only, invented foods, invented password,
// no real person and no real amount. Idempotent: if today already has entries it does nothing.
//   node verifier/seed.mjs http://127.0.0.1:8787
import { connectMcp } from "./lib/oauth.mjs";

export const SEED_EMAIL = "pstack-verifier@example.com";
export const SEED_PASSWORD = "pstack-verifier-local-only";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (base === "") {
  console.error("usage: node verifier/seed.mjs <api-url>");
  process.exit(2);
}

const json = { "content-type": "application/json" };

const post = (path, body, token) =>
  fetch(base + path, {
    method: "POST",
    headers: { ...json, origin: base, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });

const signIn = async () => {
  const response = await post("/sign-in/email", { email: SEED_EMAIL, password: SEED_PASSWORD });
  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    return response.headers.get("set-auth-token") ?? body.token ?? null;
  }
  return null;
};

const signUp = async () => {
  const response = await post("/sign-up/email", { email: SEED_EMAIL, password: SEED_PASSWORD, name: "Pstack Verifier" });
  if (!response.ok && response.status !== 422) {
    throw new Error(`sign-up failed: ${response.status}`);
  }
};

let token = await signIn();
if (token === null) {
  await signUp();
  token = await signIn();
}
if (token === null) {
  console.error("seed: could not get a session for the seed account");
  process.exit(1);
}

const day = async () => {
  const response = await fetch(base + "/api/app/day", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`day read failed: ${response.status}`);
  return (await response.json()).day;
};

const before = await day();
const names = new Set(before.entries.map((entry) => entry.name));

const addInApp = async (name, kcal, portion) => {
  if (names.has(name)) return;
  const response = await post("/api/app/entries", { name, kcal, portion_text: portion }, token);
  if (response.status !== 201) {
    throw new Error(`app add failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
};

await addInApp("Porridge with banana", 310, "1 bowl");
await addInApp("Banana", 105, "1 medium");

if (!names.has("Chicken salad")) {
  const mcp = await connectMcp({ base, email: SEED_EMAIL, password: SEED_PASSWORD, userAgent: "Claude" });
  await mcp.tool("add_entry", { name: "Chicken salad", kcal: 420, portion_text: "1 bowl" }, 2);
}

const after = await day();
console.log(
  `seed: ${SEED_EMAIL} has ${after.entries.length} invented entries today, ${after.consumed_kcal} kcal against a ${after.goal_kcal} kcal goal in ${after.timezone}`,
);
