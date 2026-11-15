# Feature map

Every user-facing feature of Calorie Tracker, taken from the routes in `src/` and the screens
in `app/src/`. The pstack verifier reads this table: the last column is the list of source
paths that own the feature, and a change to any of those paths puts the feature in that PR's
verification run.

Row one, "Sign in and open today's home", is the smoke feature and runs on every pull request.

Starting the app locally (`verifier/start-app.sh`) gives two URLs: the Worker API on port
`<port>` and the built web app on `<port>+1`. The seed account is invented and local only:
`pstack-verifier@example.com` with password `pstack-verifier-local-only`, three invented
entries today (Porridge with banana 310 kcal from the app, Banana 105 kcal from the app,
Chicken salad 420 kcal through MCP as "Claude") against a 2,000 kcal goal in Europe/London.

| Feature | How a user reaches it | Steps to drive it | What a correct result looks like | Source paths |
|---|---|---|---|---|
| Sign in and open today's home | Open the web app URL | Open the app URL, fill Email and Password with the seed account, click "Sign in" | The sign-in form is replaced by home: the "Calorie Tracker" header, a "Sign out" button, and a "Calories eaten today" card | `app/src/view.ts`, `app/src/api.ts`, `app/src/command.ts`, `app/src/update.ts`, `src/app-api.ts`, `src/auth.ts`, `src/index.ts` |
| Today's total, goal, calories left, macros and day label | Home, top card | Sign in, then read the home card | Total equals the sum of today's visible entries, "of 2,000 kcal goal", calories left equals goal minus total, Protein/Carbs/Fat in grams, day label starts with "Today," | `app/src/view.ts`, `app/src/day.ts`, `src/app-api.ts`, `src/db.ts` |
| Add a food from the app | Home, the round "+" button | Click "Add food", fill Food "Toast, wholemeal" and Calories "90", fill Portion "1 slice", click "Add to log" | The sheet closes, the entry appears at the top of today's entries with "Added in the app", and the total rises by 90 | `app/src/view.ts`, `app/src/update.ts`, `app/src/command.ts`, `src/app-api.ts`, `src/db.ts` |
| Edit an entry | Home, tap an entry row | Click the entry row, change Calories, click "Save entry" | The sheet closes, the row shows the new kcal and the total changes by the same amount | `app/src/view.ts`, `app/src/update.ts`, `app/src/command.ts`, `src/app-api.ts`, `src/db.ts` |
| Delete an entry and undo within 30 seconds | Home, tap a row then "Delete entry" | Delete a row, then click "Undo" in the "Deleted ..." bar | After delete the row is gone and the total drops; after undo the same food is back exactly once with its original time and source | `app/src/view.ts`, `app/src/update.ts`, `src/app-api.ts`, `src/db.ts` |
| Entries show where they came from | Home, under each entry name | Sign in and read the small line under each entry name | App entries say "Added in the app", the MCP entry says "Added from Claude", the portion is shown before the source when set | `app/src/day.ts`, `app/src/view.ts` |
| Sign out | Home, top right "Sign out" | Click "Sign out" | The app returns to the sign-in form and today's numbers are gone | `app/src/view.ts`, `app/src/update.ts`, `app/src/session.ts` |
| Session survives a reload | Reload the page after signing in | Sign in, then reload the app URL | The app opens straight on today's home, not the sign-in form | `app/src/session.ts`, `app/src/command.ts`, `src/auth.ts` |
| An AI chat adds and reads food through MCP | An MCP client (Claude, ChatGPT) connected to `<API_URL>/mcp` | List the tools, call `add_entry` with name "Greek yoghurt" and kcal 120, then call `get_day` | Six tools are listed (`get_day`, `list_entries`, `add_entry`, `update_entry`, `delete_entry`, `set_goal`); `add_entry` returns the entry and the new day total; `get_day` returns the same entry | `src/tools.ts`, `src/index.ts`, `src/auth.ts` |
| An AI chat edits and deletes food through MCP | Same MCP connection | Call `update_entry` with a new kcal for that entry, then `delete_entry`, then `get_day` | The update is reflected in the day total, the delete removes the entry from `get_day`, and the day total drops by its kcal | `src/tools.ts`, `src/db.ts` |
| Set the goal and timezone from an AI chat | Same MCP connection | Call `set_goal` with kcal 2100 and timezone `Pacific/Kiritimati`, then read the app's home day | The app shows "of 2,100 kcal goal" and the day date is today in that timezone, not UTC | `src/tools.ts`, `src/db.ts`, `src/app-api.ts` |
| Free plan history limit | An AI chat asking for an old day | Call `get_day` with a date 40 days ago | The tool refuses with an error containing "outside your plan's range" and mentions no price | `src/tools.ts`, `src/db.ts` |
| One account cannot touch another's log | Two accounts, app and MCP | Sign in as the seed account, read an entry id, then call the app day, edit, delete and restore routes with a second account's session | The second account sees an empty day, and edit, delete and restore return 404 | `src/app-api.ts`, `src/db.ts`, `src/auth.ts` |
| Sign-in page, consent page and health check | Worker routes `/sign-in`, `/consent`, `/health` | Open `/sign-in`, open `/consent`, fetch `/health` | The sign-in page shows the "Sign in to Calorie Tracker" heading and the email and password fields; the consent page shows "Allow access?" with Allow and Deny; `/health` returns `{"ok":true}` with the six tool names | `src/pages.ts`, `src/index.ts` |
| Sign in with Google | Sign-in page, "Continue with Google" | Not drivable offline: it needs a real Google OAuth client and a Google account | Not drivable offline, so the verifier reports it as a note | `src/pages.ts`, `src/auth.ts` |
| Android app (APK) | Install the debug APK from the GitHub release | Not drivable offline: it needs the Android SDK, an emulator or a phone, and the `android/` project that Capacitor generates | Not drivable offline, so the verifier reports it as a note. Its screens are the same web app rows above | `app/`, `capacitor.config.ts`, `.github/workflows/android.yml` |
