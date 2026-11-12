# Gates: IGSH-1274

Scope: Native Kotlin/Compose Android Home C, Google sign-in, cached today's total/goal/left, newest-first source-labelled entries, text add, edit and delete/undo against the shared food log. Current ticket description governs scope. Chief Of Staff authorized no-spend debug APK/device proof on 2026-11-11 instead of paid Play distribution.

- [ ] G1: App API reads/writes the same isolated per-user food log as MCP; rejects anonymous/cross-user access and preserves undo identity.
  EVIDENCE: app-api SUCCESS at ddd1147b8df9c3d9942590300ad4a48dd6db21d4, https://github.com/valentinyeo/calorie-mcp-proto/actions/runs/43102827183/job/130798398806. Revalidate current head after changes.
- [ ] G2: Native APK builds; GitHub-hosted native day/cache tests and lint pass.
  EVIDENCE: previous Android job failed before compilation: setup-android requested removed package tools. Fix explicit SDK package selection in the same existing PR; no local builds/tests.
- [ ] G3: Same-day/same-account cache renders before background refresh; wrong-day/account data never appears; device cold start under 500ms.
  EVIDENCE: native tests and QA-device timing remain pending.
- [ ] G4: Play internal track build installs on a phone.
  ABANDON: paid Play distribution waits on IGSH-1272 Question 341578; Chief Of Staff explicitly authorized debug APK proof instead. Not claimed complete.
- [ ] G5: Debug APK driven on device: MCP-added entry appears, app edit visible through MCP, delete/undo works; recording attached.
  EVIDENCE: adb devices lists no connected QA device on 2026-11-12. Device proof remains pending.
- [ ] G6: Home C matches approved reference; independent design QA recorded before broad release.
  EVIDENCE: pending; do not substitute self-review.
- [ ] G7: Existing PR reviewed, current-head required checks green, merged/deployed and live behavior proven; only then Done.
  EVIDENCE: continuing https://github.com/valentinyeo/calorie-mcp-proto/pull/2 in runner-1/igsh-1274-android; original runner checkout untouched. No merge or deployment yet.

Resume: tmux attach -t ht-or-runner-1 (Cursor Grok RUNNER 1)
