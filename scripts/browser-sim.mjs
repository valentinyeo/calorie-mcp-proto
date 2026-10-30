// Stands in for the human's browser during proof d. Takes the authorize URL that
// `claude mcp login --no-browser` printed, signs a fresh test user up and in through the
// same API calls the login page makes, approves consent, then opens the loopback
// callback URL that Claude Code is listening on. The password lives in memory only.
// Usage: node scripts/browser-sim.mjs "<authorize url>" ["<email domain>"]
import { randomBytes } from "node:crypto";

const authUrl = process.argv[2];
if (!authUrl) throw new Error("pass the authorize URL");
const base = new URL(authUrl).origin;
const email = `proto-${randomBytes(3).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");

const jar = new Map();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const absorb = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
};
const call = async (url, init = {}) => {
  const res = await fetch(url, { redirect: "manual", ...init, headers: { cookie: cookies(), ...(init.headers ?? {}) } });
  absorb(res);
  return res;
};
const json = { "content-type": "application/json", origin: base };
const next = async (res) => res.headers.get("location") ?? (await res.json()).url;

let r = await call(base + "/sign-up/email", { method: "POST", headers: json, body: JSON.stringify({ email, password, name: "Proto Tester" }) });
console.log("sign-up", r.status);
jar.clear();

r = await call(authUrl);
let loc = await next(r);
console.log("authorize ->", new URL(loc, base).pathname);
r = await call(base + "/sign-in/email", { method: "POST", headers: json, body: JSON.stringify({ email, password, oauth_query: new URL(loc, base).search.slice(1) }) });
const signIn = await r.json();
console.log("sign-in", r.status);
loc = signIn.url;
if (!new URL(loc, base).pathname.startsWith("/consent")) {
  r = await call(new URL(loc, base).toString());
  loc = await next(r);
}
if (new URL(loc, base).pathname.startsWith("/consent")) {
  r = await call(base + "/oauth2/consent", { method: "POST", headers: json, body: JSON.stringify({ accept: true, oauth_query: new URL(loc, base).search.slice(1) }) });
  loc = (await r.json()).url;
  console.log("consent", r.status);
}
const cb = new URL(loc);
console.log("callback host", cb.host, "has code:", cb.searchParams.has("code"), "has state:", cb.searchParams.has("state"), "iss:", cb.searchParams.get("iss"));
const done = await fetch(cb);
console.log("loopback callback response", done.status);
console.log("TEST_USER_EMAIL", email);
