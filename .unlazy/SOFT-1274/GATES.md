# Gates: SOFT-1274

OWNS: .github/workflows/android-device.yml, scripts/start-emulator.sh, scripts/device-proof.sh

Scope (rewritten 2026-11-14 from the ticket description): APK v1 of the Calorie Tracker
Android app. Foldkit + Effect in TypeScript inside an app folder, wrapped as a Capacitor
APK, email sign-in, Home C with today's total, goal and calories left and the entries with
their source, add by text, edit, delete with undo, against the live food log server.
GitHub Actions builds a debug APK on every push to main, attaches it to a GitHub release,
and a device proof installs and opens the APK, shows today's calories from the server, shows
an entry added by Claude, and records the screen.

Everything below was already delivered by the merged PRs #2 to #6 on 2026-11-13, and main is
released: https://github.com/valentinyeo/calorie-mcp-proto/releases/tag/android-21 (commit
4ace5b5). What is left is the one open Done-when: the APK on an Android device with a screen
recording. Two routes, both blocked on another ticket.

- [ ] G1: A device proof installs and opens the APK: today's calories from the live server, the Claude entry with its source, add, delete and undo, screen recording kept.
  EVIDENCE: blocked. Emulator route in PR #7 acb2854 now installs the emulator's shared libraries (the 09:49 run died on libpulse.so.0) but cannot run: GitHub refuses to start any job, HYCI-458. Phone route: the check phone is on adb again but locked, HYCI-460.
- [ ] G2: The screen recording and home screenshot from the device run are attached to the ticket.
  EVIDENCE: pending G1.
- [ ] G3: PR #7 merged with its checks green.
  EVIDENCE: draft, impossible while GitHub starts no jobs, HYCI-458.
- [ ] G4: Ticket moved to Done with the proof.
  EVIDENCE: pending G1 and G3.

Recheck: when HYCI-458 clears rerun Android device proof on soft-1274-emulator-boot; when
HYCI-460 clears run the phone proof against the android-21 APK.
