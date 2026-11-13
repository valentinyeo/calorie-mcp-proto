// Prints the SQL that creates one test user on the live worker without opening sign-up.
//
// Sign-up is closed on the live worker and the deploy token on this box cannot deploy it
// (see README, "Where proof e stops"), so a test user is inserted straight into D1 with the
// same credential format src/auth.ts verifies: base64(salt):base64(PBKDF2-SHA256(pw, salt, 100000)).
//
//   EMAIL=proto-web-$(date +%s)@example.com PASSWORD=... node scripts/mk-test-user.mjs > /tmp/insert.sql
//   CLOUDFLARE_API_TOKEN="$(stack-key --print cloudflare CLOUDFLARE_CACHE_PURGE_API_TOKEN)" \
//     npx wrangler d1 execute calorie-mcp-proto --remote --file /tmp/insert.sql
import { randomBytes, randomUUID } from "node:crypto";

const email = process.env.EMAIL;
const password = process.env.PASSWORD;
if (!email || !password) throw new Error("need EMAIL and PASSWORD in the environment");

const salt = randomBytes(16);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
const b64 = (u) => Buffer.from(u).toString("base64");
const stored = `${b64(salt)}:${b64(bits)}`;

const userId = randomUUID();
const now = Math.floor(Date.now() / 1000);
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

console.log(`INSERT INTO user (id,name,email,emailVerified,image,createdAt,updatedAt) VALUES (${q(userId)},'Web Connector Tester',${q(email)},1,NULL,${now},${now});`);
console.log(`INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (${q(randomUUID())},${q(userId)},'credential',${q(userId)},${q(stored)},${now},${now});`);
