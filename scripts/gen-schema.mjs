// Generates the Better Auth + MCP plugin SQLite schema (for D1) using an in-memory node:sqlite db.
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
const db = new DatabaseSync(":memory:");
const opts = {
  database: db, baseURL: "https://x.example", secret: "x".repeat(32),
  emailAndPassword: { enabled: true },
  plugins: [jwt(), mcp({ loginPage: "/sign-in", consentPage: "/consent", resource: "https://x.example/mcp", allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true })],
};
const { compileMigrations } = await getMigrations(opts);
console.log(await compileMigrations());
