# calorie-mcp-proto

Throwaway prototype. It answers one question: can a Cloudflare-hosted MCP server with Better Auth login be added as a connector by Claude and ChatGPT, and read one entry? Nothing here is the product.

Live worker: https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev (MCP endpoint: https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp)

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

- Proof e (the hosted claude.ai and ChatGPT connector UIs) is UNPROVEN. No agent-owned claude.ai or ChatGPT account is documented for this box, and Valentin's own browser and accounts were off limits for this work. Manual steps are below.
- Neither Pecunia token can create KV. That ruled out `workers-oauth-provider`.
- CIMD is not enabled. Better Auth on Workers needs an injected transport that pins the resolved IP address to block server side request forgery, and workerd does not offer that. Claude uses CIMD only when the server advertises it, otherwise it falls back to DCR, which is what happened in the Claude Code run.

## Proofs

| | Proof | Result | File |
|---|---|---|---|
| a | Discovery documents and 401 challenge with `resource_metadata` (curl) | PASS | `proof/a-curl.txt` |
| b | Scripted OAuth 2.1 flow (DCR, sign-in, consent, PKCE token exchange, refresh) then MCP initialize, tools/list, tools/call reading the seeded row | PASS | `proof/b-scripted-oauth.txt` |
| c | MCP Inspector CLI with the bearer token: tools/list and tools/call return the row | PASS | `proof/c-inspector-cli.txt` |
| d | Claude Code as a real MCP client: add server, OAuth login, Connected, model tool call returns the row | PASS | `proof/d-claude-code.txt` |
| e | claude.ai custom connector and ChatGPT connector reading an entry | UNPROVEN | none, see below |

Proof files are redacted. They contain no bearer tokens, passwords or cookies. The a to d runs were against the live worker.

Caveat for d: the "browser" step was played by `scripts/browser-sim.mjs`, which makes the same HTTP calls the sign-in and consent pages make. A human browser was not used. Claude Code itself did the discovery, registration, PKCE, token exchange and tool call.

## Manual steps for proof e (needs a human with a Claude or ChatGPT account)

Sign-up is closed on the live worker (`SIGNUP_OPEN = "0"`). Open it first by setting `SIGNUP_OPEN = "1"` in `wrangler.toml` and running `wrangler deploy`, create a user by POSTing to `/sign-up/email`, seed a row in the `entries` table (`user_id` is the Better Auth user id), then close sign-up again.

Claude: Settings, Connectors, Add custom connector, URL `https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp`. Sign in as the test user on the page that opens, approve consent, enable the connector in a chat, and ask "what did I eat today". The callback is `https://claude.ai/api/mcp/auth_callback`, which DCR accepts because the client registers its own redirect URI.

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
- `src/index.ts` Worker entry: login and consent pages, `/mcp` route, everything else to Better Auth.
- `src/pages.ts` plain HTML sign-in and consent pages.
- `migrations/` D1 schema (Better Auth tables, then `entries`).
- `scripts/e2e.mjs` proofs b and c. `scripts/browser-sim.mjs` stands in for the browser in proof d. `scripts/gen-schema.mjs` regenerates the Better Auth migration. `scripts/proof-a.sh` proof a.
- No GitHub Actions workflows on purpose: this is a private repo and hosted minutes are not allowed there.
