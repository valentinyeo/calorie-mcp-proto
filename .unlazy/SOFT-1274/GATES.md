# Gates: SOFT-1274

OWNS: .github/workflows/android-device.yml, scripts/start-emulator.sh, scripts/device-proof.sh

Scope (rewritten 2026-11-14 from the ticket description): APK v1 of the Calorie Tracker
Android app. Foldkit + Effect in TypeScript inside an app folder, wrapped as a Capacitor
APK, email sign-in, Home C with today's total, goal and calories left and the entries with
their source, add by text, edit, delete with undo, against the live food log server.
GitHub Actions builds a debug APK on every push to main, attaches it to a GitHub release,
and a device proof installs and opens the APK, shows today's calories from the server, shows
an entry added by Claude, and records the screen.

Everything below was already delivered by the merged PRs #2 to #6 on 2026-11-13. What is
left this run is the last Done-when: the APK on an Android runtime with a screen recording.

- [ ] G1: The emulator boots on a GitHub-hosted runner (API 34, KVM) inside the device proof workflow.
  EVIDENCE: pending.
- [ ] G2: The device proof drives the APK: installs, opens, signs in, home shows today's calories from the server, the Claude entry shows with its source, add, delete and undo pass.
  EVIDENCE: pending. proof/app-device.txt with all PASS.
- [ ] G3: The screen recording and home screenshot from the device run are attached to the ticket.
  EVIDENCE: pending. proof/device-demo.mp4 and proof/device-home.png.
- [ ] G4: The PR is merged to main with its checks green.
  EVIDENCE: pending.
- [ ] G5: A push to main releases the APK for the merge commit and the release link is on the ticket.
  EVIDENCE: pending.
- [ ] G6: Ticket moved to Done with the proof.
  EVIDENCE: pending.
