# Resume here — EZER HRMS Android app (updated 1 Nov 2026, evening)

Branch **`feat/mobile-app`**. App in `apps/mobile/` (Expo SDK 57, React Native). It mirrors the website's
employee self-service portal (`/ess`), same backend, admin excluded.

## Play Store prep (7 Nov 2026)
* `eas.json`: versionCode now counted by EAS (`appVersionSource: remote`, production `autoIncrement`), and a `submit.production` profile (internal track, draft) reading `google-play-service-account.json` (git-ignored).
* Store listing text, Data safety / content-rating answers and graphics: `store/` (`PLAY-STORE-LISTING.md`, `icon-512.png`, `feature-graphic-1024x500.jpg`).
* Privacy policy: website page `app/privacy/page.tsx` → `/privacy`. It goes live only when it reaches `main`. `CONTACT_EMAIL` there is a placeholder until the real mailbox exists.
* The first AAB must be uploaded by hand in Play Console (Google's API cannot create the first release); `eas submit` works after that.
* Review risk: Messages and the Wall are user-generated content with no "report post" / "block" action; Google may ask for one.

## Round after the phone UI pass (1 Nov 2026, version 1.2.0 / versionCode 3)
* Entrance on cold start: `features/intro/` (2.6 s, one UI-thread clock, tap skips, reduced motion = logo hold + fade, skipped on deep links, not replayed after sign-out). The doorway is a real hole in the scene, so the next screen shows through it. The login screen is the lobby (`LobbyHeader`, `LobbyBackdrop`).
* Home hero: boxed tiles gone; `HeroFacts` sits beside a smaller dial.
* Leave calendar: attendance marks (`dayMarks`), tap a past day to apply, exact weekly offs for a past month (`withMonthOffs`).
  **Previous months need `leave_backdate_config`:** the table was empty on 1 Nov, so `backdate_days` is 0 and the server refuses past dates. HR sets it on the website: Attendance & Shifts → Leave Rules. Until then the arrow stays disabled.
* ID card PDF is built on the phone (`features/profile/idCardPdf.ts`, SVG → expo-print → share sheet). The old link opened the website with no session. Other `openWebsite` callers (MRF, offer, loan agreement print) go the same way and are untested.
* T&E GPS audit, not fixed: see the open list below.

## Phone UI pass (1 Nov 2026, version 1.1.0 / versionCode 2)
Rebuilt the app's frame on the phone patterns of the website's `feat/mobile-ess` branch (PR #13). That branch is CSS and
layout for the website, so nothing was merged from it; its ideas were rebuilt natively. No business logic changed.
* Sections live in `(tabs)`: top bar and thumb bar stay, sub-tabs swap in place (`?sub=` param, `features/shell/Section.tsx`),
  panels stay mounted. More is a sheet (`features/shell/MoreSheet.tsx`). Only true drill-downs are pushed.
* No "…" anywhere except previews; `Txt fit` for tight lines; font scale capped at 1.15.
* Keyboard: `KeyboardAvoidingView` padding on Android, `useFieldAboveKeyboard`, sheets sized to the room left.
* Tested on a real Android emulator (API 35, 360dp, font 1.15), not only the browser harness. Recipe: Android SDK +
  AVD, `expo export --platform android`, swap the `.hbc` into the APK's `assets/index.android.bundle`, zipalign, apksigner,
  `adb install`. A JS-only change reaches the emulator in about 3 minutes with no NDK. Emulator needs `-dns-server 8.8.8.8`.

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
0. T&E GPS (audited 1 Nov, no changes made): recording stops when the screen locks (`expo-keep-awake` is installed but unused, no background service); "Distance so far" sums only unsent fixes so it stays near 0; a running journey cannot end without a GPS fix (`te_leg_no_gps` takes PLANNED only) and the denied banner promises an exit that does not exist; End can drop queued fixes; `is_mock` is stored but no check reads it; `te_routes` is empty and places are unnamed, so server geocoding is not working.
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
