# Gates: IGSH-1273 real food-log MCP server

OWNS: src/**, migrations/**, scripts/**, proof/**, README.md

Scope: the merged v1 food-log MCP server defines the six spec tools on the spec schema, typechecks, runs live, refuses unauthenticated calls, and its committed proofs show a green two-user run.

- [x] G1: the merged source registers exactly the six spec tools
  CHECK: node scripts/verify-v1.mjs tools
  EXPECT: v1 tools: six registered
  EVIDENCE: automatic-evidence=v1; definition-sha256=7dea495416f99aadc3c771618496fa0b7c5a2c74cfe7ed940b4ed88c3aebfd16; exit=0; EXPECT=matched; output-sha256=b87f649715b1a9d2f061be3312278c321d8e48b67660e4a6a20737181d07ad7e; output-bytes=111; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G2: the schema carries every spec column plus soft delete, and keeps the prototype rows
  CHECK: node scripts/verify-v1.mjs schema
  EXPECT: v1 schema: spec columns present
  EVIDENCE: automatic-evidence=v1; definition-sha256=4b22c655242371ab5f7dbf8a33a91a9aa47710438fc88dd72ab38ded0079d91f; exit=0; EXPECT=matched; output-sha256=2ca61ce1fccabb42d4f0dc56978fa793bf925670d1a39c651358d721be0acb4d; output-bytes=108; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G3: the repository typechecks with strict mode
  CHECK: node scripts/verify-v1.mjs typecheck
  EXPECT: v1 typecheck: clean
  EVIDENCE: automatic-evidence=v1; definition-sha256=46811ba214f180dc4aa499953e18b7942b6b8b2732e8967ed6d269fbc8a22917; exit=0; EXPECT=matched; output-sha256=af3ae9c3dc36ff6420c89596ec348d391c16a209f272b61db14a46058cd3846c; output-bytes=42; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G4: the deployed worker advertises exactly the six tools
  CHECK: node scripts/verify-v1.mjs live
  EXPECT: v1 live: six tools
  EVIDENCE: automatic-evidence=v1; definition-sha256=18f0ec8f4294c7e67f0971eacd84819c93ad056b8e417c22f7e3f6afcf1bf835; exit=0; EXPECT=matched; output-sha256=f6bf4a7b06b87c1abb87ad8289336024171e4cd7beec83b759fb64a149bda649; output-bytes=102; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G5: an unauthenticated MCP call is refused with the metadata challenge and the read/write scopes
  CHECK: node scripts/verify-v1.mjs auth
  EXPECT: v1 auth: challenge intact
  EVIDENCE: automatic-evidence=v1; definition-sha256=764e48ddb200c607a0290394a8e8367bc89257eb8c77692f13784db2a1b5458f; exit=0; EXPECT=matched; output-sha256=2298308ab55d5cb276c69b0752716125c2eb4f8088921f6b9c4e8a28ca8f3843; output-bytes=170; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G6: the committed live run is green and asserts that a second user cannot read, edit or delete the first user's entries
  CHECK: node scripts/verify-v1.mjs proof
  EXPECT: v1 proof: green live run with isolation
  EVIDENCE: automatic-evidence=v1; definition-sha256=3a719519d95718c80db2226abce733bbb105f720654994b1474196be17f197ce; exit=0; EXPECT=matched; output-sha256=72398ed58ddaed744733aafc5b233a66eda19ce2fdb5b3c318e1ee42ec4924e5; output-bytes=105; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G7: the committed Inspector run lists all six tools and every call exited zero
  CHECK: node scripts/verify-v1.mjs inspector
  EXPECT: v1 inspector: six tools called
  EVIDENCE: automatic-evidence=v1; definition-sha256=fc187c2ad108c6350572d59b1a6d3d065d48933a4f4bcd9c91066a81f74a564a; exit=0; EXPECT=matched; output-sha256=c7fae48d21d0ead7313f97385e3b4baf301aa08350cc73648ac7b720993945d0; output-bytes=91; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [x] G8: the IGSH-1273 squash merge is an ancestor of main
  CHECK: node scripts/verify-v1.mjs merged 84b73106aee405b5b8901a82044d038a4e770492
  EXPECT: v1 merged: commit on main
  EVIDENCE: automatic-evidence=v1; definition-sha256=c053aaf240e5862e4d8cfdbb403afbdb0f3d754ac366c00f6ff3680c90b33c16; exit=0; EXPECT=matched; output-sha256=9e4816a3f50e79e62a92433ad91be8b1c29b89f7e039e9ad3c75169d725d8352; output-bytes=129; shell=/bin/sh; cwd=/home/valentin/projects/calorie-mcp-proto; path=a701b0cb5fe6/52 entries

- [ ] G9: Claude Code adds the server, signs in, adds porridge and reads the day total back
  EVIDENCE: pending

ABANDON: G9 this runner may not use another model or provider, so Claude Code cannot be driven here. Handoff: a lead or Valentin opens sign-up, creates a user, then adds https://calorie-mcp-proto.ancient-glitter-9ac9.workers.dev/mcp in Claude Code once, as README describes. Scripted OAuth and MCP Inspector cover every other path against the same auth stack.

<!--
Negative controls run on 2026-11-11, each exiting 1 so the oracles can fail:
- live against https://example.invalid -> FAILED: cannot reach .../health
- merged with sha deadbeef -> FAILED: commit deadbeef is not an ancestor of HEAD
- tools check on a copy of src/tools.ts with set_goal removed -> FAILED: registered tools differ from the spec
- proof check on a copy of proof/e-v1-e2e.txt with one PASS rewritten to FAIL -> FAILED: the recorded run has failures
Gate check must run with --cwd . because this ledger sits in .unlazy/, so an
explicitly named ledger would otherwise anchor CHECK at .unlazy/IGSH-1273/.
-->
