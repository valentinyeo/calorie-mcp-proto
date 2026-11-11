# Gates: IGSH-1273 real food-log MCP server

OWNS: src/**, migrations/**, scripts/**, proof/**, README.md

Scope: the merged v1 food-log MCP server defines the six spec tools on the spec schema, typechecks, runs live, refuses unauthenticated calls, and its committed proofs show a green two-user run.

- [ ] G1: the merged source registers exactly the six spec tools
  CHECK: node scripts/verify-v1.mjs tools
  EXPECT: v1 tools: six registered
  EVIDENCE: pending

- [ ] G2: the schema carries every spec column plus soft delete, and keeps the prototype rows
  CHECK: node scripts/verify-v1.mjs schema
  EXPECT: v1 schema: spec columns present
  EVIDENCE: pending

- [ ] G3: the repository typechecks with strict mode
  CHECK: node scripts/verify-v1.mjs typecheck
  EXPECT: v1 typecheck: clean
  EVIDENCE: pending

- [ ] G4: the deployed worker advertises exactly the six tools
  CHECK: node scripts/verify-v1.mjs live
  EXPECT: v1 live: six tools
  EVIDENCE: pending

- [ ] G5: an unauthenticated MCP call is refused with the metadata challenge and the read/write scopes
  CHECK: node scripts/verify-v1.mjs auth
  EXPECT: v1 auth: challenge intact
  EVIDENCE: pending

- [ ] G6: the committed live run is green and asserts that a second user cannot read, edit or delete the first user's entries
  CHECK: node scripts/verify-v1.mjs proof
  EXPECT: v1 proof: green live run with isolation
  EVIDENCE: pending

- [ ] G7: the committed Inspector run lists all six tools and every call exited zero
  CHECK: node scripts/verify-v1.mjs inspector
  EXPECT: v1 inspector: six tools called
  EVIDENCE: pending

- [ ] G8: the IGSH-1273 squash merge is an ancestor of main
  CHECK: node scripts/verify-v1.mjs merged 84b73106aee405b5b8901a82044d038a4e770492
  EXPECT: v1 merged: commit on main
  EVIDENCE: pending

- [ ] G9: Claude Code adds the server, signs in, adds porridge and reads the day total back
  EVIDENCE: pending

ABANDON: G9 this runner may not use another model or provider, so Claude Code cannot be driven here. Handoff: a lead or Valentin opens sign-up, creates a user, then adds https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp in Claude Code once, as README describes. Scripted OAuth and MCP Inspector cover every other path against the same auth stack.
