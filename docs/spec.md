# Calorie Tracker MCP: v1 spec

Ticket: https://app.hypertask.ai/detail/project-2060/1272
Status: draft, waiting for the product yes on the ticket. Defaults below apply until he changes them.

## Problem Statement

People already tell ChatGPT or Claude what they ate. That log dies in the chat. Calorie apps make them type it again. Valentin wants one app that does one thing well: an MCP server that holds your food log, so any AI chat (Claude, ChatGPT, Grok, a CLI) can read and change it, and an Android app whose home screen shows calories eaten today.

## Solution

One Cloudflare Worker with one D1 database holds everything: login (Better Auth), the MCP endpoint, a REST API for the app and CLI, and payment webhooks. The Android app shows today first and lets people add, edit and delete entries. In-app photo recognition and long history are paid. MCP access is free with 30 days of history.

The prototype in this repo proves the riskiest part: Claude Code adds the server, logs in through OAuth with PKCE and reads one entry scoped to its user (proof/ a to d).

## Data shape

- **user**: id, email, name, daily_goal_kcal (default 2000), timezone (IANA), trial_used_at, pro_until, created_at.
- **entry**: id, user_id, eaten_at (UTC instant), local_date (YYYY-MM-DD in user timezone at write time), name, kcal (integer, required), protein_g, carbs_g, fat_g (optional), portion_text, source (app, mcp, cli, photo, barcode), client_name (e.g. "Claude", "ChatGPT"), created_at, updated_at, deleted_at (soft delete, purged after 30 days).
- **day total**: computed on read from entries for (user_id, local_date) where deleted_at is null. Never stored.
- **entitlement_source**: user_id, source (play, web), status (trialing, active, grace, expired), product, current_period_end, trial_end, event_id, updated_at. Primary key (user_id, source).
- **pro_until** on user: latest current_period_end over rows in trialing, active or grace. Recomputed by every webhook. Every paid gate reads only this value.
- Better Auth owns its own tables (session, account, oauth clients, jwks).

## MCP tools

| Tool | Input | Output | Gate |
|---|---|---|---|
| get_day | date (optional, default today) | total kcal, goal, left, macros, entries | free within 30 days |
| list_entries | date or from/to | entries | free within 30 days |
| add_entry | name, kcal, macros optional, portion_text, eaten_at optional | created entry plus new day total | free |
| update_entry | id, any entry field | updated entry | free |
| delete_entry | id | ok plus new day total | free |
| set_goal | kcal | goal | free |
| get_summary | from, to | per-day totals, averages | paid beyond 30 days |

- Transport: Streamable HTTP, stateless createMcpHandler, wrapped by requireMcpAuth.
- Tool descriptions tell the AI to estimate kcal itself and to confirm before deleting.
- Out-of-range errors say "outside your plan's range". No price or upgrade text in tool output.
- Rate limit: 500 tool calls per user per day.

## Auth flow

- Better Auth jwt() plus mcp() plugins on the same Worker. Dynamic client registration on, application type "infer". CIMD off.
- Advertise offline_access. Return iss in authorization responses. Resource equals the exact /mcp URL.
- Compatibility flag global_fetch_strictly_public, so the Worker can fetch its own /jwks (prototype gotcha).
- Sign-in methods: Google, plus email magic link only if Google is not possible for a user. Same user id on app, web and MCP.
- Android: Google sign-in through Better Auth, Bearer session token.
- CLI: deviceAuthorization() device code, Bearer token. Paid only.
- Minimal website: sign-in, OAuth consent page, account page with plan, checkout and manage-subscription links.

## Paid gates (GBP)

- Free: Android app logging, barcode lookup, text search, full MCP, 30 days of history.
- Pro: in-app photo and label AI (30 a day fair use), history beyond 30 days, weekly and monthly summaries, CLI and API token, CSV export.
- Price: £4.99 a month or £34.99 a year. 14-day trial, once per user.
- Android buys through Google Play Billing via RevenueCat. No web price inside the app.
- Web and MCP-only buyers pay through Paddle checkout on our site.

## Android home

- Top: calories eaten today, big. Goal and left below. Macros small.
- Below: today's entries, newest first, each tagged with its source ("Added from Claude").
- Small add button: text search, barcode, photo (photo shows Pro badge after trial).
- Tap an entry to edit kcal or portion. Swipe to delete with undo.
- Figma: https://www.figma.com/design/YSgJcoHJS9xdAM9BKyuQH8?node-id=30-2

## Costs per user

- Photo model: Claude Haiku 5.5 at $0.10 / $0.50 per million tokens, about $0.00029 per photo with prompt.
- Trial cap: 10 photos a day. Worst-case trial: 140 photos, about $0.05.
- Paying user at 30 photos a day: about $0.26 a month.
- MCP use costs us almost nothing: the user's AI does the estimating.
- Fixed: $5 a month Workers Paid from launch. $25 once for Play. Domain about $12 a year (guess).
- Fees: Google 15%. Paddle 5% plus 50 cents. RevenueCat free under $2,500 a month.

## User Stories

1. As a user, I open the app and see calories eaten today at the top.
2. As a user, I see how many calories I have left against my goal.
3. As a user, I add a food by typing its name and picking a match.
4. As a user, I scan a barcode and get the product's calories.
5. As a user, I edit an entry's calories or portion with one tap.
6. As a user, I delete an entry and can undo it.
7. As a user, I set my daily goal.
8. As a user, I sign in with Google on the app.
9. As a Claude user, I add the server URL as a custom connector and sign in once.
10. As a Claude user, I say "I had porridge with banana" and it lands in my log.
11. As a Claude user, I ask "how much have I eaten today" and get the right total.
12. As a Claude user, I ask to fix or delete an entry and it changes in the app.
13. As a ChatGPT user on a plan that allows custom connectors, I do the same.
14. As a user, entries added from an AI show up in the app with their source.
15. As a free user, I can read 30 days back through MCP and the app.
16. As a trial user, I take up to 10 food photos a day in the app.
17. As a Pro user, I take a food or label photo and confirm the estimate before it saves.
18. As a Pro user, I see weekly and monthly summaries.
19. As a Pro user, I log from a terminal with a CLI after a device-code login.
20. As a Pro user, I export my log as CSV.
21. As an app user, I subscribe through Google Play.
22. As an MCP-only user, I subscribe on the website.
23. As a user who paid on the web, I get Pro in the app after signing in.
24. As a user, my day follows my timezone, not UTC.

## Implementation Decisions

- One Worker, Hono router, D1, R2 only if photo thumbnails ship. No KV, no Durable Objects.
- Days are computed from local_date, set at write time from the user's timezone.
- Soft delete so undo and AI edits are safe.
- Webhook handlers are idempotent on event_id. RevenueCat webhook re-fetches the subscriber before writing.
- Photo AI call runs in the Worker. The API key never ships in the APK.
- Food lookup: Open Food Facts API for barcodes (15 requests a minute limit), UK product subset cached in D1.
- Android: native Kotlin and Compose, same toolchain as Multiprompt Android.

## Testing Decisions

- Every MCP change: MCP Inspector CLI pass, recorded in the PR.
- Auth changes: scripted OAuth with PKCE plus Claude Code connect test (prototype proofs b and d).
- Live connector test on claude.ai and ChatGPT web before launch. Needs a test account.
- Android: Play internal track build installed and driven on a device or emulator.
- Photo eval: 100 real food photos, AI kcal vs label kcal, mean % error per model. Haiku 5.5 vs Sonnet 5.5. About $1.
- Payments: Play license tester purchase and Paddle sandbox purchase both set pro_until.

## Out of Scope

- iOS app.
- Full website view of the log (later).
- MyFitnessPal import.
- Social features, recipes, meal plans, water, weight, exercise.
- Voice input in v1 (people can talk to their AI instead).
- Languages other than English.

## Further Notes

- ChatGPT plan support for custom connectors is unconfirmed. Do not promise ChatGPT in the Play listing until a live test passes.
- ChatGPT directory apps may not sell subscriptions. Keep upgrade text out of tool output.
- Check with Paddle that it accepts a UK solo seller and collects UK VAT. Polar is the fallback.
- Research: calorie research rounds 1 and 2, attached to the ticket.
