# SOFT-1281 gates

Ticket: https://app.hypertask.ai/detail/project-2060/1281
Scope: prove the live food-log MCP server works as a custom connector in claude.ai and in
ChatGPT web: add the server, sign in, add one entry and read it back, with screenshots.
Not the APK, not the server code (SOFT-1273, done).

## Gates

| # | Done means | Evidence |
|---|---|---|
| G1 | Ticket is in Doing and assigned to Runner 3 | board read 2026-11-12: section Doing, assignee Runner 3 |
| G2 | Live server healthy before the test | 401 challenge with `resource_metadata` on `/mcp`, AS metadata served (curl, this run) |
| G3 | An account exists for each web app | NOT MET: no agent-owned claude.ai or ChatGPT account on this box (chrome profiles hold no session cookie for either; no mailbox the agent may read) |
| G4 | claude.ai: add connector, sign in, add entry, read it | NOT MET: needs a signed-in human browser (G3) |
| G5 | ChatGPT: add connector, sign in, add entry, read it, or name the plan that blocks it | NOT MET: needs a signed-in human browser (G3) |
| G6 | Screenshots from both apps on the ticket | NOT MET: blocked by G3 |
| G7 | Run does not leave the ticket In Progress | park to the board lead with the ask (this run) |

## Facts found this run (they shrink the ask)

- claude.ai custom connectors are now on the FREE plan, limit one connector:
  https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
  ("Free users are limited to one custom connector", page updated 2026-10-30). No money needed for Claude.
- ChatGPT moved custom connectors to Plugins: chatgpt.com/plugins, plus button, "Add custom MCP server".
  https://developers.openai.com/plugins/quickstart
  The docs state no plan requirement. The old README path (Settings, Apps and connectors, Developer mode)
  no longer matches.
- Both signups need a phone or a mailbox the agent does not own, so the test needs Valentin (or a
  mailbox handed to an agent). Creating third-party accounts by automation is out.

## Blocker

Account ownership plus a signed-in browser = Valentin's call class ("needs him at his PC or phone").
A runner may not write the Question (blocker-review --gate, exit 3). Ticket parked to the board lead
(Chief Of Staff, scopes.json for board 2060) to write the one Question.
