# calorie-mcp-proto

Started as a throwaway prototype: can a Cloudflare-hosted MCP server with Better Auth login be
added as a connector by Claude and ChatGPT, and read one entry? The test passed (proofs a to d).
It is now the v1 food-log server for ticket
https://app.hypertask.ai/detail/project-2060/1273, built to `docs/spec.md`.

Live worker: https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev (MCP endpoint: https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp)

## Android app (SOFT-1274)

The Android app is a Foldkit and Effect app in TypeScript (`app/`), wrapped as an
APK by Capacitor. It is not Kotlin. Design reference: Home C on
https://app.hypertask.ai/detail/project-2060/1274.

- `app/src/model.ts`, `message.ts`, `update.ts`, `view.ts`: one Foldkit program (Elm style).
- `app/src/api.ts`: the food log server client. Sign-in is email and password against the
  existing Better Auth account; the session token comes back in `set-auth-token` and is
  kept in Capacitor Preferences on the phone.
- `app/src/day.ts`: pure formatting helpers (day label, entry time in the profile timezone,
  calories left, progress) tested with `npm run app:test`.
- `capacitor.config.ts` and `dist-app/`: the WebView wrapper and its built bundle.

The WebView is served from `https://localhost`, so the Worker only allows that origin
(plus `capacitor://localhost` and `http://localhost:5173` for local runs) through CORS.

App routes use the same per-user food log as the MCP tools, authenticated by the session
token (Bearer), never by a user id in the request:

| Route | Result |
|---|---|
| `GET /api/app/day` | Today in the profile timezone: total, goal, left, macros, newest-first entries with source |
| `POST /api/app/entries` | Add name, integer kcal, optional portion; source `app` |
| `PATCH /api/app/entries/:id` | Edit name, kcal or portion |
| `DELETE /api/app/entries/:id` | Soft delete |
| `POST /api/app/entries/:id/restore` | Undo within 30 seconds, preserving the id, time and source |

GitHub-hosted `Android app` checks (`.github/workflows/android.yml`):

- `checks`: typecheck the Worker and the app, run the app tests, then drive the real local
  Worker through OAuth/MCP and the app API with two accounts (`proof/app-api.txt`).
- `ui`: build the same bundle the APK ships and drive it in Chromium against the real
  Worker: sign in, today's total, a Claude-added entry, add, edit, delete and undo, plus
  `proof/home-c.png` for the design check (`proof/app-ui.txt`).
- `apk`: `cap add android`, `cap sync` and `./gradlew assembleDebug` on the runner.
- `release`: every push to `main` attaches the debug APK to a GitHub release.

Nothing builds on our server, and no paid service or Play publishing is used. Install the
APK from the latest release: https://github.com/valentinyeo/calorie-mcp-proto/releases

## v1 server (IGSH-1273)

Six MCP tools, every one scoped to the signed-in user:

| Tool | What it does |
|---|---|
| `get_day` | one day: calories eaten, goal, calories left, macros, entries. Defaults to today in the user's timezone |
| `list_entries` | entries for one day or a date range |
| `add_entry` | add a food (name, kcal, optional macros, portion, time) and return the new day total |
| `update_entry` | change any field of one entry |
| `delete_entry` | soft delete, undo-safe, returns the new day total |
| `set_goal` | set the daily kcal goal, optionally fix the timezone |

Data lives in D1 per the spec: a `profile` row per user (goal, timezone, `pro_until`) and
`entries` with `eaten_at`, `local_date`, macros, portion, `source`, `client_name`, soft delete.
`local_date` is stamped at write time from the user's IANA timezone, so a day follows the user,
not UTC. Day totals are computed on read and never stored. The free plan reads the last 30 days;
`pro_until` lifts that. Refusals read "That date is outside your plan's range" and mention no price.

Why a separate `profile` table rather than columns on `user`: Better Auth owns `user` and
regenerates its schema, so the app keeps its own 1:1 row instead of fighting it.

Google sign-in is wired and switches on when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
are set as Worker secrets; the sign-in page then shows "Continue with Google". Without them the
email and password form is used, which is what the proof run covers. Creating the Google OAuth
client is free but needs Valentin's Google Cloud project (two values, 2 minutes).

Client label: the stateless transport does not carry MCP `clientInfo` between requests, so
`client_name` comes from the request user agent (`claude-code`, `node`, ...). It is a display
label only, never used for trust.

Proof of the v1 server: `proof/e-v1-e2e.txt` (scripted OAuth for two users, every tool, isolation)
and `proof/f-v1-inspector.txt` (MCP Inspector CLI listing all six tools and calling each one).
Re-run with `node scripts/e2e-v1.mjs` (local) or `BASE=https://... node scripts/e2e-v1.mjs` (live).
The rest of this file describes the original prototype and is kept as history.

## Chosen setup and why

- One Cloudflare Worker plus one D1 database. No Durable Object, no KV, no custom domain. Everything is on the workers.dev subdomain of Valentin's personal Yeo UX Cloudflare account.
- Better Auth is the OAuth 2.1 authorization server, through its MCP plugin (`@better-auth/mcp`) and the `jwt()` plugin. Email and password login.
- The MCP server is the official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32) in stateless streamable HTTP mode, with one read-only tool `list_entries(date)`. The `/mcp` route is guarded by Better Auth's `requireMcpAuth`, which verifies the JWT access token and its audience.
- Client registration uses Dynamic Client Registration (RFC 7591). CIMD (client ID metadata documents) is not enabled.

Why Better Auth and not the Cloudflare `workers-oauth-provider` library: that library needs a KV namespace. Neither Cloudflare token available for this work can list or create KV namespaces (Cloudflare returns "Authentication error", code 10000, so the token lacks the Workers KV Storage permission). Better Auth needs only D1, which the Pecunia D1 token can create. Both Claude and ChatGPT accept DCR, so the choice costs nothing for the question being tested.

## What works

- Protected resource metadata (RFC 9728) and authorization server metadata (RFC 8414) are served, with S256 PKCE, a public client auth method (`none`) and a registration endpoint.
- An unauthenticated or invalid-token call to `/mcp` returns 401 with a `WWW-Authenticate: Bearer resource_metadata="..."` header, which is what Claude requires to start discovery.
- Full OAuth 2.1 authorization code flow with PKCE, resource indicator (RFC 8707), consent screen, refresh token rotation. The access token audience is the MCP URL.
- Real MCP calls over streamable HTTP with that token. `list_entries` returns only the signed-in user's rows.
- Claude Code 2.1.314 added the server, ran its own OAuth login (DCR plus PKCE plus loopback callback), showed the server as Connected, and a Sonnet model call used the tool and returned the seeded row.

## What failed or is not proven

- Proof e (the hosted claude.ai and ChatGPT connector UIs) is still UNPROVEN, but no longer on the server side. A real Chrome tab now plays the connector half for both apps against the live worker and passes every step we control (see proof g). The two missing pieces are outside the box: claude.ai puts an interactive CAPTCHA in front of signing in, and ChatGPT has no account here. Details under proof e below.
- Neither Pecunia token can create KV. That ruled out `workers-oauth-provider`.
- CIMD is not enabled. Better Auth on Workers needs an injected transport that pins the resolved IP address to block server side request forgery, and workerd does not offer that. Claude uses CIMD only when the server advertises it, otherwise it falls back to DCR, which is what happened in the Claude Code run.

## Proofs

| | Proof | Result | File |
|---|---|---|---|
| a | Discovery documents and 401 challenge with `resource_metadata` (curl) | PASS | `proof/a-curl.txt` |
| b | Scripted OAuth 2.1 flow (DCR, sign-in, consent, PKCE token exchange, refresh) then MCP initialize, tools/list, tools/call reading the seeded row | PASS | `proof/b-scripted-oauth.txt` |
| c | MCP Inspector CLI with the bearer token: tools/list and tools/call return the row | PASS | `proof/c-inspector-cli.txt` |
| d | Claude Code as a real MCP client: add server, OAuth login, Connected, model tool call returns the row | PASS | `proof/d-claude-code.txt` |
| e | claude.ai custom connector and ChatGPT connector reading an entry | UNPROVEN, blocked on a signed-in web account | `proof/screenshots/` |
| g | The connector half of the login, driven in a real Chrome tab, once per app: DCR with the app's own callback, `/sign-in`, `/consent`, the callback receiving a code with the matching state, token exchange, `add_entry`, `get_day` reading it back | PASS for claude.ai's and ChatGPT's callbacks | `proof/g-web-claude.txt`, `proof/g-web-chatgpt.txt` |

Proof files are redacted. They contain no bearer tokens, passwords or cookies. The a to d runs were against the live worker.

Proofs b, c and d ran before the final redeploy that closed sign-up and trimmed error text; the tool path did not change. Proof a was re-run on the final version.

Caveat for d: the "browser" step was played by `scripts/browser-sim.mjs`, which makes the same HTTP calls the sign-in and consent pages make. A human browser was not used. Claude Code itself did the discovery, registration, PKCE, token exchange and tool call.

## Where proof e stops (2026-11-13, SOFT-1281)

Sign-up is closed on the live worker (`SIGNUP_OPEN = "0"`), and the Worker deploy token available on this box
belongs to a different Cloudflare account than `account_id` in `wrangler.toml`, so `wrangler deploy` fails with
"does not match any of your authenticated accounts". Sign-up therefore cannot be opened by a deploy right now.
The D1 token still works (`CLOUDFLARE_CACHE_PURGE_API_TOKEN`), so a test user is created straight in D1 with the
same PBKDF2 format `src/auth.ts` verifies: see "Creating a test user" below.

1. claude.ai: a browser can reach the login page and Google returns the account, but claude.ai then refuses with
   "We couldn't verify your browser" and, on the magic-link page, an interactive "Click the TWO matching shapes"
   CAPTCHA. Automation cannot pass it. See `proof/screenshots/claude-ai-captcha-blocks-automation.png`.
   One human login in the shared Chrome (`~/.config/faceless-chrome`, CDP 127.0.0.1:9333) is enough; after that the
   connector screens are ordinary pages and a runner can finish the rest.
2. ChatGPT: `chatgpt.com` loads but every path needs an account. There is none on this box and creating one needs a
   phone. See `proof/screenshots/chatgpt-needs-an-account.png`.

## Creating a test user without a deploy

`scripts/web-connector-proof.mjs` does the connector half of a login. It needs an account on the live worker.
Generate one in the same credential format the worker uses, then insert it with the D1 token:

```sh
EMAIL=proto-web-$(date +%s)@example.com
PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
# hash = base64(16-byte salt):base64(PBKDF2-SHA256(password, salt, 100000)), the format in src/auth.ts
node scripts/mk-test-user.mjs > /tmp/insert.sql
CLOUDFLARE_API_TOKEN="$(stack-key --print cloudflare CLOUDFLARE_CACHE_PURGE_API_TOKEN)" \
  npx wrangler d1 execute calorie-mcp-proto --remote --file /tmp/insert.sql
node scripts/web-connector-proof.mjs --callback https://claude.ai/api/mcp/auth_callback \
  --email "$EMAIL" --password "$PASSWORD" --name claude
```

## Manual steps for proof e (needs a signed-in claude.ai and a ChatGPT account)

Claude: Settings, Connectors, Add custom connector, URL `https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp`. Sign in as the test user on the page that opens, approve consent, enable the connector in a chat, and ask "what did I eat today". The callback is `https://claude.ai/api/mcp/auth_callback`, which DCR accepts because the client registers its own redirect URI. Proof g shows this exact callback receiving a code and that token adding and reading an entry.

ChatGPT: Settings, Apps and connectors, enable Developer mode, create a connector with the same URL and OAuth authentication, sign in, then ask it to call `list_entries`. Its callback is `https://chatgpt.com/connector_platform_oauth_redirect` or `https://chatgpt.com/connector/oauth/{callback_id}`.

## Free plan check

Everything used is available on Workers Free:

- Workers, 100,000 requests per day and 10 ms CPU per request on Free: https://developers.cloudflare.com/workers/platform/limits/
- D1: "Workers Free plan will always include the ability to prototype with D1 for free": https://developers.cloudflare.com/d1/platform/pricing/
- KV is also on Free ("Workers KV is included in both the Free and Paid Workers plans"): https://developers.cloudflare.com/kv/platform/pricing/ . Not used here, only because of the token permission gap.
- Durable Objects exist on Free for SQLite-backed classes only: https://developers.cloudflare.com/durable-objects/platform/pricing/ . Not used.

I could not see the account's plan from the tokens. The sign-in path (PBKDF2 hashing) ran many times without a CPU-limit error, but that does not prove the account is on Free. Nothing in this design needs the $5 plan.

## Gotchas

1. Biggest. A Worker cannot fetch its own workers.dev URL by default. `requireMcpAuth` verifies the token by fetching `${baseURL}/jwks` over HTTP, and that self request returned "Not Found" (Cloudflare error 1101, surfaced as "Jwks failed") until the compatibility flag `global_fetch_strictly_public` was added in `wrangler.toml`. The same flag is needed for CIMD fetches. Without it the whole login works and then every MCP call fails, which looks like a Better Auth bug.
2. The available Cloudflare tokens are split. One can only deploy Workers, the other can only manage D1, and neither can create KV. So D1 was created and migrated with one, the Worker deployed with the other, and `database_id` is hard coded in `wrangler.toml`.
3. Better Auth hashes passwords with scrypt in pure JavaScript, which risks the 10 ms Free CPU limit. This repo swaps in Web Crypto PBKDF2-SHA256 at 100,000 iterations, the maximum Workers allows. Fine for a prototype, not a security review.
4. With `basePath: "/"` the authorization server metadata lives at the root `/.well-known/oauth-authorization-server` and the issuer is the bare origin.
5. The token endpoint answered 403 when session cookies were attached (origin and CSRF check). Real MCP clients send no cookies. Node `fetch` also gets a JSON `{redirect, url}` body from `/oauth2/authorize` instead of a 302, so the scripted flow handles both.
6. The Better Auth MCP docs target MCP spec 2026-07-28 with SDK v2 and `legacy: "reject"`. That would reject clients that still send an older protocol version in `initialize`, so this repo uses SDK 1.32 with the stateless web-standard transport instead.
7. Claude only prefers CIMD when the server advertises `client_id_metadata_document_supported` and lists `none` as a token endpoint auth method. Otherwise it uses DCR. ChatGPT also accepts DCR.
8. Test users `proto-xxxx@example.com` were created in the production D1 database while testing. Their passwords were generated in memory and never stored. Delete them with `wrangler d1 execute calorie-mcp-proto --remote` when the prototype is retired.

## Sources

- MCP authorization spec: https://modelcontextprotocol.io/specification/latest/basic/authorization
- Better Auth MCP plugin: https://www.better-auth.com/docs/plugins/mcp
- Cloudflare workers-oauth-provider: https://github.com/cloudflare/workers-oauth-provider
- Claude connector authentication: https://claude.com/docs/connectors/building/authentication
- ChatGPT apps authentication: https://developers.openai.com/apps-sdk/build/auth

## Layout

- `src/auth.ts` Better Auth configuration (jwt and mcp plugins, PBKDF2 hashing).
- `src/index.ts` Worker entry: login and consent pages, `/mcp` route, app API routing, CORS for the app origins, everything else to Better Auth.
- `src/app-api.ts` the Android app's day and entry routes, scoped to the signed-in session.
- `src/pages.ts` plain HTML sign-in and consent pages.
- `app/` the Foldkit and Effect app source, its tests and the Capacitor wrapper config.
- `scripts/e2e-app.mjs` and `scripts/e2e-app-ui.mjs` the app's shared-log and browser proofs.
- `migrations/` D1 schema (Better Auth tables, then `entries`).
- `scripts/e2e.mjs` proofs b and c. `scripts/browser-sim.mjs` stands in for the browser in proof d. `scripts/gen-schema.mjs` regenerates the Better Auth migration. `scripts/proof-a.sh` proof a.
- `.github/workflows/android.yml` runs app, browser and APK checks on GitHub-hosted runners.
