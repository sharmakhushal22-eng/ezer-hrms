# EZER HRMS — Android app architecture

*Written 19 Oct 2026 with the first build of `apps/mobile/`. Companion document: [mobile-feature-parity.md](mobile-feature-parity.md).*

The Android app is the website's **employee self-service portal (ESS, `/ess`)** on a phone. It is not a second product: it has no backend, no database and no business rules of its own. It calls the same Next.js API routes and the same Supabase project the website uses, signs in with the same ESS accounts, and shows the same sidebar sections with the same rules.

---

## 1. The existing website (what the app is built on)

| Layer | What it is |
|---|---|
| Framework | Next.js 16.2.6 (App Router), React 19.2.4, TypeScript strict, deployed on Vercel (`bom1`). Production: `https://ezer-hrms-chi.vercel.app` (branch `main`). |
| Database | One Supabase project (PostgreSQL, Mumbai). ~184 SQL migrations in `supabase/migrations/`, run by hand in the SQL editor. |
| Styling | Inline styles from tokens (`lib/ui/tokens.ts` → CSS variables in `lib/ui/theme.css`, ESS overrides in `components/ess/portal.css`). Trust-blue brand `#2563EB`, DM Sans, light + dark. |
| Employee portal | `/ess` → `components/ess/PortalPage.tsx` → `components/ess/EmployeePortal.tsx` (one React tree; `SECTIONS` is the sidebar). Travel & Expenses is its own page, `/ess/travel` → `components/te/TeHome.tsx`. |
| Admin | `/dashboard/*` (Supabase-Auth admin login) and the "Manage" band inside ESS for employees who hold admin modules. **Out of scope for the app.** |

### 1.1 How an employee is identified (ESS auth)

ESS employees are **not Supabase Auth users**.

1. `/ess-login` posts `{identifier}` to `POST /api/ess-auth/status` (does the email / employee code exist; is a password set), then `{identifier, password}` to `POST /api/ess-auth/login`.
2. The login route checks a scrypt hash in `ess_accounts` (`lib/ess-auth.ts`) and returns a token from `lib/ess-session.ts`: `base64url({sub: employee_id, exp}) + "." + HMAC-SHA256` signed with `ESS_SESSION_SECRET` (falls back to the service-role key). It lives **12 hours**, with no refresh.
3. Every authenticated route reads `Authorization: Bearer <token>` (`lib/api-auth.ts → requireDashboardUser`, `lib/ess/session.ts → essCaller/essRoute`). An `employee_id` in a query or body never establishes identity on those routes. It only means "view as", which only an admin may do, and it is audited.
4. First login: `POST /api/ess-auth/set-password`. HR-issued temporary password: `must_change_password` → `POST /api/ess-auth/change-password`.

### 1.2 Roles and what an employee sees

* `GET /api/ess/menu` returns the nav as data: `is_rm`, `is_hod`, `approval_types`, `roles`, `modules`, `can.{approvals,company,reports}`, `super_admin`. It merges `ess_menu()` (org structure: reporting lines, HOD of a department) with the RMS grant (`role_permissions`, `role_approval_rights`).
* The sidebar shows every section to every employee **except** Company (`can.company` = "Company Dashboard" module ≥ VIEW) and Reports (`can.reports` = "ESS Reports" ≥ VIEW). Tasks & Approvals is shown to everyone; its content depends on `can.approvals` (RM, HOD, a functional approval type, or super admin). Raising an MRF needs `is_rm || is_hod || can.approvals`.
* HR, HR Head and Admin are not separate apps. They are employees whose grant also opens admin modules ("What you manage"). The app shows such a person their own ESS portal, including the approvals and Company/Reports their roles open, and **never** the admin modules.
* The menu is a UI convenience. **Authorization is enforced by each route on the server**, so hiding a section is never the only barrier.

### 1.3 How the ESS screens reach data

| Path | Used by | Auth |
|---|---|---|
| `/api/ess/*` (today, punch, attendance, leave, menu, notifications, inbox, social, celebrations, approvals, mrf, offer/onboarding approvals, interview, resignation, company, reports, team, pms, profile, id-card, requests, wall, funzone, preferences, announcements) | most screens | Bearer token ✅ |
| `/api/te/*` | Travel & Expenses | Bearer token via `lib/te/server.ts teRoute` ✅ |
| `/api/travel/*` | legacy Travel Claims | Bearer via `lib/travel/actor.ts` ✅ |
| `/api/rms/hierarchy`, `/api/rms/orgchart` | Team, Org Chart | Bearer ✅ |
| `/api/ess/vpf`, `/api/ess/nps`, `/api/ess/loans`, `/api/ess/loans/agreement`, `/api/flexi/claims` | VPF, NPS, Loans, Flexi Claims | **none**: trusts `employee_id` ❌ (see §6) |
| **Supabase directly, public anon key** | employee record (`lib/supabase-ess.ts`), Flexi Benefits, Investment Proofs/Declaration, Flexi Claims bills, Performance writes, Wall of Fame, Broadcasts, Team Directory, Raise a Request, Letter Requests, My Letters | **none**: RLS is `allow_all` ❌ (see §6) |

---

## 2. The app

```
apps/mobile/                      Expo SDK 57 · React Native 0.86 · TypeScript strict
  app.config.ts                   name, package com.ezerhrms.app, icons, permissions
  eas.json                        build profiles (preview = installable APK)
  .env.example                    EXPO_PUBLIC_API_URL / _SUPABASE_URL / _SUPABASE_ANON_KEY
  metro.config.js                 lets the app import pure website logic from ../../lib
  scripts/check-shared.mjs        proves those imports are pure
  scripts/sync-icons.mjs          regenerates the icon set from lib/ui/icons.tsx
  src/
    app/                          Expo Router routes (thin files; the screens live in features/)
      _layout.tsx                 providers + sign-in gate
      login.tsx
      (tabs)/                     Home · Payroll · Attendance · Leave · More (the website's MOBILE_PRIMARY)
      profile/ team orgchart performance inbox/ hris/ company reports social funzone rnr expenses/ payroll/ section/[key]
    core/                         no UI
      config.ts                   backend URLs (public values only)
      api.ts                      fetch → website /api with Bearer token, ApiError, multipart files
      session.tsx                 ESS session in SecureStore, expiry, sign-out on 401
      secure.ts                   SecureStore (Android Keystore) wrapper
      supabase.ts                 the public client, for the queries the website runs directly
      query.ts                    TanStack Query client, foreground refetch, invalidate()
      menu.ts                     /api/ess/menu
      employee.ts                 the employee record (website's loadEmployeeDetail)
      nav.ts                      SECTIONS / NAV_GROUPS / MOBILE_PRIMARY, copied from EmployeePortal.tsx
      links.ts                    website links ('tab:leave', '/ess?tab=approvals') → app routes
    ui/                           the design system
      theme.ts                    tokens copied from theme.css + portal.css (light & dark)
      ThemeProvider.tsx           light / dark / system (same three choices as the website)
      primitives.tsx              Txt, Card, Button, Badge, Notice, Stat, Input, PickerField, Segmented…
      overlays.tsx                Sheet, SelectSheet, DateSheet, toast notify(), confirm(), prompt()
      Screen.tsx  TabBar.tsx  Logo.tsx  icons.tsx
    features/<module>/            one folder per website module: screens, components, api calls, logic
```

### 2.1 Technology choices

| Need | Choice | Why |
|---|---|---|
| App framework | Expo SDK 57 (RN 0.86) | Stable SDK, three months old and at patch .30; SDK 58 was three weeks old. Builds APKs on EAS without Android Studio. |
| Navigation | Expo Router (file routes) + bottom tabs + stack | Mirrors the website's URL-per-screen model (`/ess/leave` → `/leave`). |
| Server state | TanStack Query v5 | Caching, foreground refetch, invalidation after mutations. |
| Session storage | `expo-secure-store` | Token encrypted with an Android Keystore key. |
| Backend | the website's `/api` routes + the same public Supabase client | No second backend and no duplicated business rules. |
| UI | Hand-built primitives on the website's tokens, DM Sans (`@expo-google-fonts/dm-sans`), `react-native-svg` | Same look as the website and no third-party component kit. |
| Files | `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-sharing`, `expo-web-browser` | Uploads (multipart, same field names) and opening signed URLs or PDFs. |
| Location | `expo-location`, foreground only | Same as the website: punch has no location; T&E/legacy travel record GPS only while the recorder screen is open. |

### 2.2 Authentication in the app

`src/features/auth/LoginScreen.tsx` is the website's `/ess-login` step for step (same four steps, fields, validation order and messages). The response is kept in **SecureStore** under `ezer_ess_session`, the same JSON the website keeps in `localStorage`. `src/core/session.tsx` then:

* restores the session on launch only if the token's expiry is still ahead (30 s skew, like `lib/ess-session-client.ts`). An expired session goes to the login screen with "Your session has expired. Please sign in again." The website bounces such a session back into the portal instead (its bug).
* signs out automatically when the 12 hours run out while the app is open, and on any 401 from the API;
* on sign-out deletes the token and clears every cached query, so nothing of one person survives into the next sign-in on a shared phone.

`set-password` returns a token (the website added this after the app was first built); the app uses it, and falls back to a normal login only if it is missing.

Admin-only surfaces are excluded by construction: the app has no route for any admin module, no "Manage" band, no Admin button and no view-as.

### 2.3 Data synchronisation (website ↔ app)

There is one source of truth, the Supabase database behind the website. The app never keeps its own copy.

* **Reads** are cached for 30 seconds (`staleTime`). Opening a screen again after that refetches it.
* **Returning to the app** from the background refetches every screen on display (`focusManager` ← `AppState`). An approval made on the website shows up when the employee reopens the app.
* **Pull to refresh** on every screen refetches on demand.
* **After a mutation** the screen invalidates every query it affects. A punch refreshes Home, Attendance and the bell; an approval refreshes Approvals, Home, Leave/Attendance and notifications.
* **Inbox** polls every 20 s while it is open, as the website does.
* **Realtime** (Supabase channels) is not used. The website doesn't use it for ESS either, and with the anon key and `allow_all` RLS a realtime subscription would broadcast other employees' rows.

### 2.4 Branding

`src/ui/theme.ts` copies the token values from `lib/ui/theme.css` and `components/ess/portal.css` (canvas `#F6F8FB`, brand `#2563EB`/`#1D4ED8`, status colours with their tints and edges, dark-mode values). The logo is the website's SVG emblem from `lib/ui/Logo.tsx`, redrawn with `react-native-svg`. The app icon and splash were rendered from that same SVG. The icons are generated from `lib/ui/icons.tsx` by `scripts/sync-icons.mjs`. The phone tab bar and the More screen copy the portal's own phone layout (`.ess-tabbar`, the "More" sheet, `MOBILE_PRIMARY`).

---

## 3. Sharing code with the website

The app imports **pure** website logic straight from `lib/` through the `@web/*` alias (`tsconfig.json` + `metro.config.js`). Examples: `@web/today/format` (time/date formats, tenure), `@web/today/schema` (`tabTarget`), `@web/ess/routes` (`parseEssPath`), leave-year and accrual rules, travel distance and loan schedule maths. A fix to one of those files on the website reaches the app on its next build.

Only dependency-free modules qualify. `npm run check:shared` (`scripts/check-shared.mjs`) follows every `@web` import and fails if any file in the chain imports Supabase, `next/*`, `react-dom`, Node built-ins or website code outside `lib/`. Logic that lives inside a website component (e.g. the flexi/TDS maths in `FlexiTdsCalculator.tsx`) is copied into the feature folder with a comment naming its source, and should be moved into `lib/` on the website so both import it.

Never import website **components** into the app: they are DOM React.

---

## 4. Adding a future website feature to the app

When a new employee-facing section or sub-tab appears in the website's `SECTIONS`:

1. **Find the backend contract.** Read the new website screen and note every call it makes: `/api/...` route (method, body, response) or direct Supabase query. If it reads Supabase directly, prefer adding a token-checked `/api/ess/...` route first and using it from both clients.
2. **Add it to `src/core/nav.ts`** with the same section/item key and label as the website. It then appears in More, the feature search and the link resolver (so notifications that link to it open it).
3. **Build the screen** in `src/features/<module>/`. Put calls in `api.ts` with TanStack Query hooks keyed by the module name, screens and components in their own files, and pure rules imported via `@web/...` or kept in a pure file with tests. Use the `src/ui` primitives and palette only, never hex literals.
4. **Add a route file** under `src/app/` (one line: `export { default } from '@/features/<module>/Screen'`).
5. **Invalidate** the related queries after every mutation, and give the screen `onRefresh`.
6. Run `npm run check` (typecheck + shared-code check + tests), test in the web harness or on a device, then build a new APK (§5) and bump `version` / `android.versionCode` in `app.config.ts`.

If the website only changes the *rules* of an existing screen (a validation, a limit, a status), check whether the rule lives in the API (nothing to do), in a shared `lib/` module (rebuild the app), or in a website component (update the copy in the app, or move it to `lib/`).

### 4.1 Keeping the app in step with the website (the routine)

The app records the last website commit it was compared against:

> **Last synced website commit: `30ca34b`** (origin/NayanAhuja, 30 Oct 2026).

To bring the app up to date after the website changes:

1. `git checkout feat/mobile-app && git merge origin/NayanAhuja` (or the branch the website now lives on). The app's `@web/*` imports pick up every pure `lib/` change automatically.
2. `cd apps/mobile && npm run check`. A type error here is usually a website type that changed shape (e.g. a field became nullable); fix the app screen that uses it.
3. List what an employee would see differently:
   `git log --oneline 30ca34b..HEAD -- components/ess components/profile components/te components/pms components/esign app/api/ess app/api/te app/api/pms app/api/exit app/api/esign lib`
   and for each module `git diff 30ca34b HEAD -- <its website files>`. The module → website-file map is in `docs/mobile-feature-parity.md`.
4. Port each employee-facing change into `src/features/<module>/`, following §4. Admin-only changes need nothing.
5. Update the "Last synced" commit above and the parity table, bump `version` and `android.versionCode` in `app.config.ts`, then build a new APK (§5).

Most website changes are API or `lib/` changes and need no app code at all; only screens (`components/...`) need porting by hand.

---

## 5. Build, run and distribute

See `apps/mobile/README.md` for exact commands. In short:

* **Dev:** `cd apps/mobile && npm install && cp .env.example .env.local` (fill the two Supabase public values), then `npx expo start`. Open on a phone via a development build, or `npx expo start --web` for a quick browser check.
* **Test APK:** `npm run build:apk` (= `eas build --platform android --profile preview`), under the Expo project `@girish18/ezer-hrms` (`owner` / `extra.eas.projectId` in `app.config.ts`). EAS builds in the cloud and returns a download link and QR code for an installable `.apk`. No Play Store involved.
* **Config on EAS:** `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set as EAS environment variables (they are public values; never put a secret in an `EXPO_PUBLIC_` variable).

---

## 6. Security review: issues that block a safe public launch

These are **pre-existing website/backend issues**. The app does not create them, and it is no worse than the website because the same public key ships in every browser today. But an installable app that real employees use makes them more urgent. None was changed in this work; each needs a decision and a migration or route change.

| # | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| S1 | **Critical** | Row-level security is effectively off. Tables carry `allow_all … TO anon, authenticated USING (true) WITH CHECK (true)`, including `ess_accounts` (password hashes and salts), `employees` (PII: PAN, bank last-4, addresses, DOB), leave, payroll and tax tables. Anyone holding the public anon key, which is in every website page, can read and **write** them. | `supabase/migrations/021_ess.sql` lines 112–118 and the CLAUDE.md RLS pattern | Revoke anon access table by table; move browser reads behind token-checked `/api/ess/*` routes (both clients); keep only safe public reads. |
| S2 | **Critical** | Five routes the ESS uses have no authentication and trust the `employee_id` they are given: `/api/ess/vpf`, `/api/ess/nps`, `/api/ess/loans`, `/api/ess/loans/agreement`, `/api/flexi/claims` (GET by `company_id` returns a whole company's claims). | route sources: no `essRoute`/`requireDashboardUser` | Wrap them in `essRoute` and take the employee from the token, as the other `/api/ess/*` routes do. Both clients already send the token. |
| S3 | High | No rate limiting or lockout on `/api/ess-auth/login`, and the minimum password is 6 characters. Passwords can be brute-forced. | `app/api/ess-auth/login/route.ts` | Per-identifier/IP attempt limits; a longer minimum. |
| S4 | High | `/api/ess-auth/status` is public and returns the full name and employee id for any email or employee code. That allows enumeration, and it feeds S3. | `app/api/ess-auth/status/route.ts` | Return only `{found, has_password}` and show the name after a successful login. |
| S5 | Medium | The session secret falls back to `SUPABASE_SERVICE_ROLE_KEY` when `ESS_SESSION_SECRET` is unset. There is no server-side revocation; a token stays valid for 12 h after sign-out. | `lib/ess-session.ts` | Set a dedicated `ESS_SESSION_SECRET`; consider a session table for revocation. |
| S6 | Medium | Cross-company reads in browser queries: Broadcasts and the Team Directory show every company's rows. | spec 08 §3, spec 07 | Filter by `company_id` (in an API route, per S1). |

What the app itself does about secrets: only public values are compiled in (`EXPO_PUBLIC_API_URL`, Supabase URL and anon key). There is no service-role key and no session secret. The token is kept in SecureStore, never logged, and dropped on sign-out. `.env.local` is git-ignored.
