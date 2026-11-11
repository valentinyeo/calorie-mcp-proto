# IGSH-1273 gates

Ticket: https://app.hypertask.ai/detail/project-2060/1273
Scope: build the real food-log MCP server from the prototype: spec tables, six tools
(get_day, list_entries, add_entry, update_entry, delete_entry, set_goal), Google sign-in
wiring, per-user isolation. No payments, no Android, no photo. Deploy on the existing free
worker (no spend).

| # | Gate (done means) | Evidence required |
|---|---|---|
| G1 | D1 schema matches the spec: profile (goal, timezone, pro_until) plus entries (eaten_at, local_date, macros, portion, source, client_name, soft delete) | migration file applied locally and on the live D1, `pragma table_info` output |
| G2 | Six tools registered with the exact names | MCP Inspector CLI `tools/list` output |
| G3 | Every tool call passes: add porridge, get day total, list, edit, delete, set goal | Inspector CLI `tools/call` output for all six, live worker |
| G4 | A second user never sees the first user's entries (read, edit, delete) | two-user isolation run: user B sees empty day, B cannot edit or delete A's entry |
| G5 | Sign-in still works end to end: DCR, PKCE, consent, token, MCP call | scripted OAuth run against the live worker, PASS line |
| G6 | Google sign-in is wired and switches on with GOOGLE_CLIENT_ID/SECRET; email sign-in still works without it | code path + proof that email flow still passes (Google needs Valentin's free OAuth client) |
| G7 | Live and merged: PR merged to main, worker serving the new tools | PR URL, merge commit SHA, live call after deploy |
| G8 | Typecheck clean, no uncommitted changes | `tsc --noEmit` exit 0, `git status` clean |

Waiver note: Claude Code connect (ticket Done-when 2 and 3) is replaced by the scripted
OAuth client plus MCP Inspector CLI, because this runner may not use another model or
provider. The prototype proof d covers Claude Code on the same auth stack.
