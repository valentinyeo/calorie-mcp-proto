# SOFT-1281 gates

Ticket: https://app.hypertask.ai/detail/project-2060/1281
Scope: prove the live food-log MCP server works as a custom connector in claude.ai and in
ChatGPT web: add the server, sign in, add one entry, read it back, with screenshots.
Not the APK, not the server code (SOFT-1273, done).

| # | Done means | Evidence |
|---|---|---|
| G1 | Ticket in Doing, assigned to Runner 4 | board read this run: section Doing, assignee Runner 4 |
| G2 | Live server healthy before the test | `/health` lists six tools; `/mcp` 401 with `resource_metadata`; AS metadata served (curl, this run) |
| G3 | A usable claude.ai web session | NOT MET, blocked outside us: login page and Google account chooser reached in the shared Chrome, then claude.ai returns "We couldn't verify your browser" and puts an interactive CAPTCHA on the magic-link page. `proof/screenshots/claude-ai-captcha-blocks-automation.png` |
| G4 | claude.ai: connector added, OAuth sign-in, add_entry + get_day read back | Half met: the connector half of the login passes in a real Chrome tab with claude.ai's own callback (DCR, sign-in, consent, code, token, add_entry, get_day). The claude.ai settings screens need G3. `proof/g-web-claude.txt` |
| G5 | ChatGPT: same, or the plan that blocks it named | Half met: same flow passes with ChatGPT's callback (`proof/g-web-chatgpt.txt`). chatgpt.com itself needs an account; none exists here and signup needs a phone. `proof/screenshots/chatgpt-needs-an-account.png` |
| G6 | Screenshots on the ticket | sign-in page, consent page, claude.ai CAPTCHA, ChatGPT login wall: `proof/screenshots/`, attached to the ticket |
| G7 | Ticket ends outside In Progress | parked to the board lead with the one ask |

## What this run found (it shrinks the ask)

- The server side is done: both apps' real callbacks take a code, exchange it and add plus read an entry.
- claude.ai blocks automation itself, not our server: interactive CAPTCHA on sign-in and on the magic link.
  One human login in the shared Chrome (faceless-chrome, CDP 127.0.0.1:9333) unblocks everything after it.
- ChatGPT needs an account before any test; signup needs a phone.
- Sign-up on the live worker is closed and the Worker deploy token on this box belongs to another Cloudflare
  account, so a test user is inserted straight into D1 instead (`scripts/mk-test-user.mjs`).
