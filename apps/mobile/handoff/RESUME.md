# Resume here — EZER HRMS Android app (paused 20 Oct 2026)

Work paused because the Claude usage limit kept stopping the build. Everything is
committed on branch **`feat/mobile-app`** (pushed to origin). This file is what a new
Claude session needs to carry on exactly where this one stopped.

## How to resume (copy-paste)

```bash
cd ~/Documents/ezer-hrms
git fetch origin
git checkout feat/mobile-app && git pull
cd apps/mobile && npm install
# public values only — same as the website's NEXT_PUBLIC_* ones:
{ echo "EXPO_PUBLIC_API_URL=https://ezer-hrms-chi.vercel.app"; \
  grep "^NEXT_PUBLIC_SUPABASE_URL=" ../../.env.local | sed 's/^NEXT_PUBLIC_/EXPO_PUBLIC_/'; \
  grep "^NEXT_PUBLIC_SUPABASE_ANON_KEY=" ../../.env.local | sed 's/^NEXT_PUBLIC_/EXPO_PUBLIC_/'; } > .env.local
```

Then start Claude Code in the repo and say:

> Read `apps/mobile/handoff/RESUME.md` and continue the Android app from where it stopped.

(The old conversation can also be reopened from Claude Code's session history, but the
background agents it ran cannot be resumed; this file replaces them.)

## What the user asked for (original brief, short)
Build an Android app (Expo/React Native) that mirrors the website's **employee-facing
sidebar** (ESS `/ess`) with exact parity — same features, rules, branding, backend and
data; exclude admin; docs `docs/mobile-app-architecture.md` + `docs/mobile-feature-parity.md`;
test; EAS APK for testers; make future website features easy to add.

Decisions the user already made (do not re-ask):
1. Screens that query Supabase directly on the website → **mirror the website** (same queries, anon key); document the RLS risk.
2. APK → **EAS cloud build only** (no local Android SDK). Needs the user's Expo login: `cd apps/mobile && npx eas-cli@latest login` (not done yet).
3. Git → branch `feat/mobile-app` (off `feat/ui-combined`), push, PR **into `NayanAhuja`** (clean mobile-only diff; main ⊂ NayanAhuja).

## State of each module (all compile: `npx tsc --noEmit` = 0 errors; `npm run check:shared` passes)

| Module | Folder | Status |
|---|---|---|
| Core, UI kit, login, shell (tabs, More, bell, search, placeholders, RNR, Salary Slip/Statutory) | `src/core`, `src/ui`, `src/features/{auth,shell}` | ✅ done, tested |
| Home (Today) | `features/home` | ✅ done, tested (Kiran) |
| Attendance | `features/attendance` | ✅ done, tested (Rohan, Kiran) |
| Leave | `features/leave` | ✅ done, tested (Rohan) |
| HR Services + Company + Reports | `features/{hris,company,reports}` | ✅ done, tested (Shreya, Kiran, Rohan); MRF edit wizard only typechecked |
| Profile (My Details/Profile360, Letter Requests, My Letters, ID card) | `features/profile` | 🟡 built; agent stopped while re-running its tab/sheet tests — re-verify |
| Team, Org Chart, Performance | `features/{team,orgchart,performance}` | 🟡 built; stopped during its Shreya test run — re-verify |
| Payroll: Flexi Benefits, Investment Proofs, Flexi Claims, Declaration | `features/payroll-tax` | 🟡 built (tax maths extracted to `tax.ts` + test); stopped while linting — lint + verify |
| Payroll: VPF, NPS, Loans, Travel Claims | `features/payroll-benefits` | 🟡 built; stopped while re-testing after token expiry — verify |
| Travel & Expenses (~135 web screens) | `features/expenses`, routes `src/app/expenses/**` | 🟡 largest; 3 parts built (planner/places/vehicles, trips/journeys/GPS, expenses/claims/advances) + approvals; trip-detail screen was in progress — finish + verify |
| Inbox (Messages, Wall tab, Broadcasts) | `features/inbox` | 🟡 built; not yet verified/reported |
| Social + Fun Zone | `features/{social,funzone}` | 🟡 built (wish composer, mind games, bot, Play Together); verify. **Delete the test routes `src/app/funzone/mind-test.tsx` and `vs-test.tsx`** if they are only harness helpers. |

For each 🟡 module: read its spec in `handoff/specs/` and the code, run
`npx eslint src/features/<m>` + `npx tsc --noEmit`, test in the browser harness (below)
against the live API, fix gaps, and compare against the website's behaviour.

## Remaining work after the modules
1. Integration pass: walk every screen as Rohan (employee), Kiran (manager), Shreya (approver); light + dark; fix layout issues; `npx eslint src` clean.
2. Write **`docs/mobile-feature-parity.md`** (table: sidebar item | website route | employee access | mobile screen | status) — not written yet. Website routes are `/ess`, `/ess/<view>` (e.g. `/ess/leave`), T&E `/ess/travel`; app routes are in `src/core/nav.ts`.
3. Update `docs/mobile-app-architecture.md` (exists; add final module notes, the gaps each agent reported).
4. EAS: user logs in → `npx eas-cli init` → `eas env:create` for the two Supabase public values (preview env) → bump version → commit → `npm run build:apk`. Report the build link. Never claim an APK exists unless the build succeeded.
5. Open the PR `feat/mobile-app` → `NayanAhuja` (end PR body with the Claude Code attribution line).
6. Clean up test records (`handoff/TEST-RECORDS.md`) — offer the user deletion.

## Shared-code notes from the module agents (already applied unless stated)
- Root layout renders nothing until the session is restored; `api()` signs out only on a 401 for a request that carried a token (fixes a deep-link race).
- `Screen`/`TabScreen` accept `scrollRef` (Leave could switch to it; it draws its own ScrollView now).
- Tasks & Approvals hidden for non-approvers in the HR Services list (matches `HrisShell`).
- `allowImportingTsExtensions` on (website lib files import `./x.ts`).
- Wish: `Txt` `fontVariant` prop (Home passes it via style).
- Website `lib/onboarding/salary-breakdown.ts` uses `@/lib` imports so the app copied 3 functions (`features/hris/approvals/salary.ts`); switching that file to relative imports would allow sharing.

## Security findings (in the architecture doc §6; not fixed — user decision)
RLS `allow_all` incl. `ess_accounts` password hashes (critical); `/api/ess/{vpf,nps,loans,loans/agreement}` and `/api/flexi/claims` unauthenticated (critical); no login rate limit; `/api/ess-auth/status` leaks names; session secret falls back to service-role key; Broadcasts/Directory cross-company.

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
