# Resume here — EZER HRMS Android app (updated 30 Oct 2026)

Branch **`feat/mobile-app`**. App in `apps/mobile/` (Expo SDK 57, React Native). It mirrors the website's
employee self-service portal (`/ess`), same backend, admin excluded.

## State (30 Oct 2026)
* All modules built, ported to the website as of commit `379a058` (origin/NayanAhuja), and tested in the
  browser harness as Rohan / Kiran / Shreya. `npm run check` (typecheck + shared-code + tests), `npx eslint src`
  and `npx expo-doctor` all pass.
* Feature table: `docs/mobile-feature-parity.md`. Architecture + **the routine for re-syncing with the website**:
  `docs/mobile-app-architecture.md` §4.1.
* EAS: project `@girish18/ezer-hrms` (linked in `app.config.ts`); EAS env vars `EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` set for preview + production. Build a test APK: `cd apps/mobile && npm run build:apk`
  (needs `npx eas-cli login` as girish18 on the machine). Bump `version` + `android.versionCode` for each new APK.
* Git gotcha: the main checkout's `.git/info/exclude` lists `apps/`, so NEW app files don't show in `git status`.
  Stage them with `git add -f apps/mobile/<path>` (never `.env.local` or `node_modules`).

## Open items
1. Verify on a real phone (from the APK): camera/file uploads (profile photo, bills, proofs), GPS journey recording,
   letter PDF download/share, e-sign in-app browser, punch with location.
2. Untested for lack of data: PMS approval card at a chain stage, exit clearance inbox / settled-exit letters,
   MRF "Edit & resubmit", claim-approval screen, Play Together.
3. Not in the app (by choice): Finance desk Advances/Payouts/Corrections/Months; Help → negotiation CTC calculator.
4. Shared-code wishes from the module work: `Screen` `onScroll` + `TeScreen` `sub` passthrough (T&E pinned bar),
   a shared `TimeSheet` in `@/ui/overlays`, `Button` `accessibilityLabel`.
5. Server/data issues found (not app bugs): Rohan (ordinary employee) passes the Travel/Finance desk checks;
   `employee_badges`↔`badge_master` FK missing. Security findings in the architecture doc §6.
6. Test records from the app work are deleted (`TEST-RECORDS.md`). 11 older "CLAUDE TEST" leave rows from website testing (11–12 Oct) remain, awaiting the user's decision.

## Testing setup (browser harness — the app's web build against the live API)
- Node: `export PATH="$HOME/.local/node/bin:$PATH"` (Node 22 in `~/.local/node`).
- Dev server: `cd apps/mobile && env -u CI npx expo start --web --port 8081 < /dev/null` (NOT with `CI=1` — that disables file watching).
- Driver: `handoff/tools/shot.mjs` (playwright-core + local Chrome with web security off, because the live API has no CORS for localhost). Put it in a scratch folder, `npm i playwright-core@1.56.1` there, run `node shot.mjs steps.json`. Step format is in the file header.
- Test logins (seeded TEST data, on `/ess-login`; password is in the handoff memory note `live-db-testing-rules`): Rohan SRS9042 (employee), Kiran SRS9047 (manager), Shreya SRS9010 (approver). Tokens last 12 h.
- DB rules: the Supabase project is the live one but holds only seeded test data; label any test write "CLAUDE TEST", keep a ledger, no DDL, mail only the test inboxes.

## Files in this folder
- `specs/01…08-*.md` — exhaustive specs of every website module (fields, endpoints, response shapes, error strings, rules) written from the source. **Read the relevant one before changing a module.**
- `specs/MOBILE-CONVENTIONS.md` — the rules every module was built to (UI kit API, data access, ownership, testing).
- `TEST-RECORDS.md` — records created on the DB during testing.
- `tools/` — harness driver and the icon renderer used for the app icon.
