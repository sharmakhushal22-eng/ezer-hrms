# EZER Learn: implementation report

Branch `feat/lms`, cut from `origin/NayanAhuja` at `eaf44b5`.

**State: built and tested locally, not live.** Nothing has been applied to the Supabase project.
It needs the three migrations and the checks in [SETUP.md](SETUP.md).

## What was delivered

| Area | Delivered |
|---|---|
| Research | Ten LMS products and four Indian HR suites, video hosting with a cost model, in `research/` |
| Database | 27 tables, 25 functions, one private bucket, three new roles |
| Server | `lib/lms/`, 27 API routes, one daily job |
| HR workspace | Ten tabs, including the course builder |
| Employee | My Learning, Catalogue, Achievements, Team, course player, inside ESS |
| Candidate | Link and code sign-in, limited portal, conversion on joining |
| Public | Certificate verification |

## Migrations

| File | Adds | Touches existing data |
|---|---|---|
| `206_lms_schema.sql` | Tables, RLS, indexes, triggers, `lms-content` bucket | No |
| `207_lms_engine.sql` | Functions, all revoked from browser roles | No |
| `208_lms_roles.sql` | L&D Manager, Content Author, Training Coordinator, and Learning rows in `role_permissions` | Adds rows only. `ON CONFLICT DO NOTHING`, and nobody is assigned a role |
| `verify/208_lms_verify.sql` | Read-only PASS/FAIL checks | No |

Existing code changed: `lib/rms/modules.ts`, `resolve.ts`, `nav.ts` (three modules, a shared-screen
guard), `app/dashboard/layout.tsx`, `components/ess/EmployeePortal.tsx`, `AdminModules.tsx`,
`lib/ess/routes.ts`, `lib/supabase-ess.ts`, `lib/ui/icons.tsx`, `lib/notifications/catalogue.ts`,
`proxy.ts`, `vercel.json`, and one best-effort hook in `lib/onboarding/create-employee.ts`.
`tus-js-client` is the one new dependency.

## Security policies

RLS on every table with no policy. Table and function grants revoked from `anon` and
`authenticated`. A private bucket with no storage policy. Composite foreign keys across tenants.
Triggers that freeze published versions and make the audit log append-only. Details are in
ARCHITECTURE.md, section 11.

The review also closed two holes the brief did not name. The ESS "view as" path lets anyone with
any admin module open any portal in any company, so Learning adds its own check. And a candidate
token signed like an ESS token would have been accepted by ESS routes, so it uses a separately
derived key.

## Test results

| Check | Result |
|---|---|
| New unit tests | 105 pass |
| End-to-end through real routes | **75 of 75 pass**, on a clean database |
| Real browser upload | A real 13 MB H.264 file through the builder in Chrome by `tus-js-client`, in several 6 MB chunks. Byte-identical on arrival, duration and poster captured |
| Real playback | Real H.264, audio and PDF through the player at 1280 px and 390 px |
| Existing test suite | No regressions from this work. 15 failures and 5 cancelled are as on the base branch, plus 2 time-of-day failures (below) |
| TypeScript | 39 errors, the identical set to the base branch |
| Production build | Passes |

Two inbox tests, `relTime` and `dayLabel`, began failing during this work. They assert that 26
hours ago reads "Yesterday", which is false in the first two hours after midnight. Their files are
unchanged from the base branch, and this is an existing test defect.

### The 17 brief scenarios

All pass in `scripts/lms-e2e/e2e.mjs`.

| # | Scenario | Notes |
|---|---|---|
| 1 | HR creates a course and uploads videos | Resumable upload, HR Manager |
| 2 | Quizzes after individual videos | |
| 3 | Passing percentage | With attempt limits |
| 4 | Publish | HR Manager refused, HR Head allowed. Publishing assigns nobody |
| 5 | Assign to one employee | Audit row and bell confirmed |
| 6 | Bulk assignment | Skips who already has it |
| 7 | Whole department | Audience preview first |
| 8 | Mandatory for the organisation | Actives only, not the leaver or the other company |
| 9 | Employee completes videos and quizzes | Forged heartbeat refused first |
| 10 | Fails and retries | Answers hidden until passed |
| 11 | Certificate | PDF, public verify, revocation, owner-only download |
| 12 | Self-enrolment | Plus restricted courses and manager approval |
| 13 | New joiner | Due from joining date; long-serving staff untouched; second run changes nothing |
| 14 | Candidate preboarding | Link, code, course, then conversion; token refused everywhere else |
| 15 | Manager's team | Own reports only; assigns to them, not beyond |
| 16 | Organisation reports | Filters and Excel; cross-company for Super Admin only |
| 17 | Unauthorised access | Employees, no session, other company, other learner, other branch, view-as |

Also covered: versioning across learner states, sequential paths, recertification, leavers,
reminders once a day, escalation, Excel import, four-eyes review, timed attempts, cooldown, rewatch
policy, random draw, waived enrolments.

## How it was tested, and what that does not prove

There is no way to run DDL on the live project from the build environment, so the end-to-end
suite ran the real app against real Postgres semantics (PGlite) with a hand-written stand-in for
PostgREST, Storage and TUS. The PostgREST binary could not be used, because downloading and running
it was refused by the environment's safety controls. All test people and companies are invented;
copying real employee rows was also refused, and rightly.

**Not verified on real infrastructure:**

- Supabase's signed TUS route. The client is proven against the stand-in, and the server side is
  confirmed from Supabase's source and tests only.
- Seeking on a signed URL (206 responses).
- Any email actually being delivered. Sending is off in the rig, so OTPs were set directly.
- `&download=` on document links.
- Real phones. Only Chrome's 390 px emulation, so iOS Safari and Android Chrome playback and PDF
  rendering are unproven.
- Sessions longer than about 30 seconds of video, and real tab closes (hiding was simulated).
- Dark mode was checked on the main screens only.
- Scheduled publishing firing through the daily job was checked by code path, not by a run.

SETUP.md section 4 is a 15-minute check for the first three.

## Outstanding

**Needed before launch**
1. Run the migrations and the verify script.
2. Confirm the Supabase plan is Pro, raise the global upload limit, and decide the Spend Cap.
3. Do the 15-minute live check, and test on one real iPhone and one Android phone.
4. Assign roles. Nobody receives one automatically.

**Decisions made that you may want to revisit**
- An active preboarding template invites candidates by email automatically from the daily job.
  The screen says so. If you would rather HR always clicks, keep templates paused and invite by hand.
- Someone who leaves an audience keeps their enrolment. HR can cancel it.
- A shared video URL can be copied and works for up to a day (ARCHITECTURE.md, section 10).
- Only the hash of a candidate's link is stored, so a reminder mail cannot include it. If a
  candidate loses the link, HR resends it, which issues a new one.

**Known limits**
- Native mobile screens are not included. The Expo app is on an unmerged branch.
- `/dashboard/learning` needs a desktop width, like the rest of the dashboard.
- Uploaded files that end up unused are not cleaned up from storage.
- Lint: about 170 `no-explicit-any` in the admin screens, the same idiom as `lib/esign` but more of
  it, and some React hook notices on load-on-mount effects. Neither affects behaviour.

Deferred features are in [FEATURE-DECISIONS.md](FEATURE-DECISIONS.md).
