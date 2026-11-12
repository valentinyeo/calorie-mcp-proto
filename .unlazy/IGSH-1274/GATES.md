# Gates: IGSH-1274

Scope: Native Kotlin/Compose Android Home C, Google sign-in, cached today's total/goal/left, newest-first source-labelled entries, text add, edit and delete/undo against the shared food log. Current ticket description governs scope. Chief Of Staff authorized no-spend debug APK/device proof on 2026-11-11 instead of paid Play distribution.

- [x] G1: App API reads/writes the same isolated per-user food log as MCP; rejects anonymous/cross-user access and preserves undo identity.
  EVIDENCE: implementation aa608ebb0583197c4e02e2670df16ec50f1811d1; GitHub-hosted app-api SUCCESS, https://github.com/valentinyeo/calorie-mcp-proto/actions/runs/43149141442/job/130953919770. Downloaded android-api-proof/android-api.txt confirms real OAuth PKCE, anonymous/read-only/cross-account rejection, MCP-to-app visibility, app-to-MCP edits, delete/restore preserving ID/source/time, double-undo rejection and profile-timezone day selection. This proves the CI worker, not production deployment.
- [x] G2: Native APK builds; GitHub-hosted native day/cache tests and lint pass.
  EVIDENCE: same implementation, android SUCCESS, https://github.com/valentinyeo/calorie-mcp-proto/actions/runs/43149141442/job/130953919967. Downloaded APK and reports: six tests, zero failures, zero skipped; lint completed with 14 warnings. APK SHA-256 recorded below. No local build or tests run.
- [ ] G3: Same-day/same-account cache renders before background refresh; wrong-day/account data never appears; device cold start under 500ms.
  EVIDENCE: six native tests cover timezone/day rollover/DST, entry ordering/source labels and totals. Account-switch rendering and device cold-start timing remain unproven; do not substitute parser tests for these checks.
- [ ] G4: Play internal track build installs on a phone.
  ABANDON: paid Play distribution waits on IGSH-1272 Question 341578; Chief Of Staff explicitly authorized debug APK proof instead. Not claimed complete.
- [ ] G5: Debug APK driven on device: MCP-added entry appears, app edit visible through MCP, delete/undo works; recording attached.
  EVIDENCE: blocked on https://app.hypertask.ai/detail/project-11514/325. On 2026-11-12 adb devices -l fails: connection refused at configured Windows tunnel 127.0.0.1:15037; lh status/machines show laptop1 and laptop2 disconnected; lh shell cannot inspect PhoneTunnels because Windows agent laptop1 is disconnected. No device install or data changes attempted.
- [ ] G6: Home C matches approved reference; independent design QA recorded before broad release.
  EVIDENCE: pending; do not substitute self-review.
- [ ] G7: Existing PR reviewed, current-head required checks green, merged/deployed and live behavior proven; only then Done.
  EVIDENCE: sole existing PR https://github.com/valentinyeo/calorie-mcp-proto/pull/2; implementation aa608ebb0583197c4e02e2670df16ec50f1811d1 has both checks green. Reviewed OAuth PKCE/state/redirect validation, API auth scopes/user-scoped queries, encrypted cache and UI actions. No merge or deployment: real-device proof, Google login and independent design QA remain outstanding. This continuation changes only this ledger; its push requires a fresh CI result before merge.

Artifacts: /home/valentin/.local/state/vcc-evidence/IGSH-1274/run-20261112-r1 (outside the worktree).
APK SHA-256: e9e86823444a3b7262695e1cd4c81812c7b0b610ab7f8d506748981ff73e6b07.
Feedback: existing https://app.hypertask.ai/detail/project-12057/636 bumped for the recurring disconnected check-phone access.
Resume: tmux attach -t ht-or-runner-1 (Cursor Grok RUNNER 1)
