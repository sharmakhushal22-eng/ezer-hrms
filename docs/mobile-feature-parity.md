# EZER HRMS — Android app ↔ ESS website feature parity

Compared against website commit `30ca34b` (origin/NayanAhuja, 30 Oct 2026).
How to re-sync after the website changes: `docs/mobile-app-architecture.md` §4.1.

Status: ✅ same as the website · 🟡 present, with the noted difference · ⏳ "Soon" on the website too · ✖ not in the app (reason given).
"Access" is who the website shows it to; the app asks the same API (`/api/ess/menu` and each route's own check), so it shows exactly the same people.

| Website item | Website route | Access | App route | App folder | Status |
|---|---|---|---|---|---|
| Home (Today) | `/ess` | everyone | `/` | `features/home` | ✅ punch dial, week, leave/attendance cards, joining journey (copes with no joining date) |
| Profile → My Details (Profile 360) | `/ess/profile` | everyone | `/profile` | `features/profile` | ✅ 8 tabs, all self-service editors, change history, photo limits |
| Profile → Letter Requests | `/ess/documents` | everyone | `/profile/letter-requests` | `features/profile` | ✅ |
| Profile → My Letters | `/ess/letters` | everyone | `/profile/letters` | `features/profile` | ✅ signed download link; appointment letters appear here |
| Profile → Documents to sign (EZER Sign) | `/ess/to-sign` | everyone | `/esign` | `features/esign` | 🟡 list is native; signing opens the website's `/sign/<token>` page in an in-app browser (OTP, PDF, signature pad) |
| Digital ID card | Profile drawer | everyone | `/profile/id-card` | `features/profile` | 🟡 a page instead of a drawer; the PDF opens the website |
| Team | `/ess/team` | everyone | `/team` | `features/team` | ✅ |
| Org Chart | `/ess/orgchart` | everyone | `/orgchart` | `features/orgchart` | ✅ |
| Payroll → Salary Slip | `/ess/payslip` | — | `/payroll/payslip` | `features/shell` | ⏳ placeholder, as on the website |
| Payroll → Flexi Benefits | `/ess/flexi` | everyone | `/payroll/flexi` | `features/payroll-tax` | ✅ CTC / variable / DOJ read-only from salary record |
| Payroll → Investment Proofs | `/ess/proofs` | everyone | `/payroll/proofs` | `features/payroll-tax` | ✅ |
| Payroll → Flexi Claims | `/ess/flexiclaims` | everyone | `/payroll/flexiclaims` | `features/payroll-tax` | ✅ |
| Payroll → Voluntary PF | `/ess/vpf` | everyone | `/payroll/vpf` | `features/payroll-benefits` | ✅ |
| Payroll → Corporate NPS | `/ess/nps` | everyone | `/payroll/nps` | `features/payroll-benefits` | ✅ |
| Payroll → Loans | `/ess/loans` | everyone | `/payroll/loans` | `features/payroll-benefits` | ✅ |
| Payroll → Travel Claims | `/ess/claims` | everyone | `/payroll/claims` | `features/payroll-benefits` | ✅ |
| Payroll → Statutory | `/ess/statutory` | — | `/payroll/statutory` | `features/shell` | ⏳ placeholder, as on the website |
| Attendance | `/ess/attendance` | everyone | `/attendance` | `features/attendance` | ✅ |
| Leave | `/ess/leave` | everyone | `/leave` | `features/leave` | ✅ |
| Inbox (Messages, Wall, Broadcasts) | `/ess/inbox` | everyone | `/inbox` | `features/inbox` | ✅ |
| Notifications bell (incl. Interviews to conduct) | bell | everyone | bell sheet, any screen | `features/shell` | ✅ acknowledge + give feedback on interviews |
| Travel & Expenses — traveller | `/ess/travel` | everyone | `/expenses/**` | `features/expenses` | 🟡 planner v2 (Trip → Route → Commute → Stay → Review), drafts + autosave, trips, live GPS journeys, bills, claims, advances, dashboard. Maps: keyless map + "Open in Google/Apple Maps"; "find a place by name" needs a Maps key (hidden on the website too without one); no slim "On this trip" bar on scroll |
| Travel & Expenses — approvals | `/ess/travel` | approvers | `/expenses/approvals/**` | `features/expenses` | ✅ trip + claim approval |
| Travel & Expenses — Travel desk | `/ess/travel` | desk members | `/expenses/desk/travel` | `features/expenses/desk` | ✅ all 7 rooms; "Show the route" opens Google Maps |
| Travel & Expenses — Finance desk | `/ess/travel` | finance | `/expenses/desk/finance` | `features/expenses/desk` | 🟡 Verification and Journeys in the app; Advances, Payouts, Corrections, Months say "done on the website" (bank files and month locks are back-office work) |
| HR Services → Team Directory | `/ess/directory` | everyone | `/hris/directory` | `features/hris` | ✅ |
| HR Services → Raise a Request | `/ess/requests` | everyone | `/hris/requests` | `features/hris` | ✅ incl. MRF wizard (department + work location required) |
| HR Services → Tasks & Approvals | `/ess/approvals` | approvers | `/hris/approvals` | `features/hris` | ✅ MRF, offers, exits waiting on you, exit clearance inbox, onboarding sign-off, request queue (resignation LWD pre-filled) |
| HR Services → Exit Process | `/ess/exit` | everyone | `/hris/exit` | `features/hris` | ✅ timeline names approvers; clearance, F&F and exit letters |
| Company | `/ess/company` | role-gated | `/company` | `features/company` | ✅ |
| Reports | `/ess/reports` | role-gated | `/reports` | `features/reports` | ✅ |
| Performance (PMS) | `/ess/performance` | everyone; My team / My department by role | `/performance` | `features/performance` | ✅ KRAs + self rating, carry-forward, change log, approval chain (send back / approve / finalise), one-to-ones, Rate My Team, HOD publish, result acknowledgement. PIP request and "Nudge RM L2" inert, as on the website |
| Social | `/ess/social` | everyone | `/social` | `features/social` | ✅ (Wall-of-Fame badges don't load on the website either — DB has no FK between `employee_badges` and `badge_master`) |
| RNR | `/ess/rnr` | — | `/rnr` | `features/shell` | ⏳ placeholder, as on the website |
| Fun Zone | `/ess/funzone` | everyone | `/funzone` | `features/funzone` | ✅ |
| Help → TDS / Negotiation CTC calculator | Help | HR roles + hiring managers | — | — | ✖ a recruitment tool, not employee self-service |
| Admin dashboard (`/dashboard/**`, "Manage" modules) | `/dashboard` | admins | — | — | ✖ out of scope by design: the app is employee self-service only |

## Where the app deliberately differs
* Rate My Team (Performance) has "← Choose somebody else"; the website has no way back once a person is picked.
* "Request a change" (Profile) opens the Edit sheet with "Needs approval" first; the website scrolls to it.
* Confirm-account fields hide the paste menu; a phone can't block paste the way a browser can.
* Independent Performance reads run in parallel (same queries) — the employee tab took over 6 s one after another.
* Session is re-checked whenever the app returns to the foreground (phone timers pause in the background).

## Known issues found while testing (website/server side, not fixed in the app)
* An ordinary employee (Rohan SRS9042) gets 200 from `/api/te/desk` and `/api/te/finance/overview`, so both the website and the app show him the Travel and Finance desks. Check his roles / `te_on_desk` / migration 161 on the live DB.
* `employee_badges` ↔ `badge_master` has no foreign key, so the Wall-of-Fame badges query returns 400 (PGRST200) on both clients.
* Security findings in `docs/mobile-app-architecture.md` §6 still stand.
