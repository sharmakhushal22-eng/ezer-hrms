# Configuration (letters, emails, notifications) — how it works

**For:** the EZER dev team
**Date:** 11 October 2026
**Covers:** migrations `157_config_templates.sql` and `158_config_branch_scope.sql`, `lib/config/*`,
`lib/mail/send.ts`, `/dashboard/configuration`, and every workflow that sends a letter, an email
or a work notification

---

## 1. What changed, in one paragraph

The words of every letter, email and work notification the portal sends used to be written
inside the routes and screens that send them. They now come from **Configuration**
(`Setup → Configuration`). A Super Admin edits a **Global default**. A company can have **its
own version**, and since migration 137 **each branch of a company can have its own version
too**. Every workflow works as before: same screens, same buttons, same data entry. When it
builds the text, it asks `lib/config/store.ts`, which returns:

**branch version → company version → Global version → built-in text**

The built-in text is the old hard-coded wording, moved into the registry unchanged (tests
prove it). So **nothing anyone receives changes until somebody publishes an edit**, and a
publish is live from the very next send, with no deploy.

## 2. Setup — two SQL steps

Run both in the Supabase SQL Editor. Both are idempotent.

1. `supabase/migrations/157_config_templates.sql`. Applied already (it was first numbered 134,
   and renamed because upstream also shipped a 134). It creates:
   - `config_templates`: the edited text.
   - `config_template_versions`: the append-only history. A trigger refuses to update or
     delete it.
   - `config_publish_template()` / `config_reset_template()`.
   - RLS on, with no policies, so only the service role can use the tables.
2. `supabase/migrations/158_config_branch_scope.sql`. **Still to be applied.** It adds
   `location_id` (a branch = a row of `locations`) to both tables and enforces one live row per
   level: Global / company / branch. It replaces the two functions with versions that take
   `p_location_id`.

**Before 137 is applied** everything works at company and Global level. The Configuration
screen shows the Branch selector disabled with a hint, and a branch publish is refused with a
clear message. Workflows simply do not look for branch versions. Nothing breaks.

## 3. Which version a workflow gets (scope)

Every send passes the **record's** company and branch, not the sender's:

| Record | Company | Branch |
|---|---|---|
| Candidate / offer / interview / document link / salary link | candidate's company (or the request's) | the **MRF's** `location_id` |
| Onboarding | `onboarding_candidates.company_id` | `onboarding_candidates.location_id` |
| Employee (leave, resignation, NPS, loans) | `employees.company_id` | `employees.location_id` |
| Transfer | the company **moved to** | the branch **moved to** |

Helpers: `employeeScope`, `candidateScope`, `mrfScope` and `onboardingScope` in `lib/config/store.ts`.
None of them throws. A failed lookup just falls through to company / Global / built-in.

## 4. Who can edit

`lib/config/access.ts`:

- **Super Admin** edits Global, every company and every branch.
- **Anyone granted the `Configuration` module** (Roles → Module Access) edits their own
  company and its branches. VIEW lets them read; EDIT lets them save and publish. Global is
  read-only for them.
- The legacy shared login keeps full access, as everywhere else. If its email belongs to an
  employee, that employee's roles decide.

## 5. The template language (`lib/config/render.ts`)

Small on purpose; nothing in it can run code.

```
{{candidate_name}}                            a value
{{#if meet_link}}Join: {{meet_link}}{{/if}}   only when the value is filled (no nesting)
**bold**                                      bold
(blank line)                                  new paragraph
{{details}}                                   a BLOCK the code draws (a facts table, a list of
                                              steps) — must sit on its own line
```

- Unknown variables, malformed braces and unbalanced `{{#if}}` blocks are refused before
  publish (HTTP 422). The editor and the server run the same `validateTemplate`.
- Values are escaped in HTML. Web addresses in an email become links.
- **Offer letters** have a structure (`lib/config/offer-letter.ts`):
  - opening paragraph(s);
  - `[Heading] text` paragraphs, which become the numbered clauses;
  - the closing;
  - then three sections, each starting with its marker line: `--- Annexure A notes ---` (one
    note per line), `--- Annexure B terms ---` (`[Heading]` paragraphs) and
    `--- Acceptance ---`.

  The letterhead, reference, Annexure A table, salary break-up and signatory are drawn by code.

## 6. Everything that is configurable (72 system templates + every HR letter type)

### Recruitment

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `offer_letter.employment` / `.internship` / `.nats` / `.naps` / `.contract` / `.consultant` | Letter | Offer letter, one per engagement | Send Offers → offer file → Generate letter / Send (and the HR Head review) |
| `offer.email` / `offer.email.internship` / `.nats` / `.naps` / `.contract` / `.consultant` | Email | Offer email, one per engagement (HR can still edit before sending) | Send Offers → Send |
| `interview.candidate` / `interview.interviewer_main` / `interview.interviewer_panel` | Email | Interview invites | Candidate → Interviews → Schedule round |
| `doc_collection.invite` / `doc_collection.reupload` | Email | Document link / re-upload request | Pre-negotiation checks |
| `doc_collection.otp` | Email | Document upload — verification code | Candidate upload page |
| `doc_collection.submitted` | Email | Documents submitted — recruiter | Candidate upload page → Submit |
| `salary_view.otp` | Email | Salary offer — verification code | Candidate salary page |
| `offer.accepted.hiring_manager` / `offer.accepted.candidate` | Email | Salary offer accepted | Candidate salary page → Accept |
| `offer.approval.head` / `offer.approval.manager` | Email | Offer approval request / awaiting HR Head | Offer Approval → Submit to HR Head |
| `offer.revision.head` | Email | Offer revision requested | Offers → candidate reply → Revision |
| `offer.followup.candidate` / `offer.followup.hr` | Email | Offer follow-up (48 h) | Daily cron |
| `acceptance.experienced.letter` / `acceptance.fresher.letter` | Letter | Acceptance & resignation advisory / Joining confirmation | Pre-onboarding → Accepted |
| `acceptance.experienced.email` / `acceptance.fresher.email` | Email | Their covering emails (`{{letter_body}}` = the letter text) | same |
| `notify.interview.main` / `.panel` / `.feedback` | In-app | Interview to conduct / feedback in | Schedule round / feedback |
| `notify.offer.approval_head` / `.awaiting_head` / `.approved` / `.rejected` / `.revision` / `.confidential_ready` | In-app | Offer approval notifications | Offer approval flow |
| `notify.mrf.sent_back_hm` / `.sent_back` / `.assigned` | In-app | MRF notifications | Tasks & Approvals → MRF |

### Onboarding

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `onboarding.invite` / `onboarding.reminder` | Email | Onboarding link / resend | Onboarding |
| `onboarding.otp` | Email | Onboarding — verification code | New joiner page |
| `onboarding.form_submitted` | Email | Joining form submitted — HR (**now really sent**) | New joiner page → Submit |
| `onboarding.employee_id` | Email | Welcome — your Employee ID (**now really sent**) | Generate employee code |
| `onboarding.welcome_ack` | Email | Policy acknowledgement (opening text; table, policies, declaration drawn by code) | Generate employee code |
| `onboarding.activation_approval` | Email | Activation approval request | Activation wizard |
| `onboarding.setup_reminder` / `onboarding.stay_in_touch` | Email | D-3 setup / >30-day stay-in-touch | Daily cron |

### HR Letters

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `hr_letter:<letter_templates.id>` | Letter | Every HR letter type | HR Letters → Generate |
| `hr_letter.email` | Email | Covering email | HR Letters → Email |

### Employee lifecycle

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `transfer.letter` | Letter | Transfer letter (`{{transfer_details}}` block drawn by code) | Employees / Transfer |
| `transfer.notice` | Email | Transfer — email to employee | same |
| `resignation.recovery_payroll` | Email | Notice-period recovery — Payroll | Resignation with shortfall |
| `notify.resignation.submitted` / `.retention` / `.moved` / `.awaiting` / `.lwd` | In-app | Resignation notifications | ESS resignation flow |

### Payroll & finance

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `loan.agreement` | Letter | Loan agreement (title + terms; schedule drawn by code) | ESS → Loans |
| `loan.approved_finance` / `loan.exit_alert` | Email | Loan approved — Finance / exiting employee with a loan | Loans admin / payroll sync |
| `nps.pran_creation` / `nps.pran_reminder` | Email | NPS PRAN mails (`{{pran_steps}}` box drawn by code) | NPS enrol / NPS report |

### Leave & attendance

| Key | Channel | Template | Sent from |
|---|---|---|---|
| `notify.leave.awaiting` / `.awaiting_hr` / `.passed_to_hr` / `.approved` / `.declined` / `.withdrawn` | In-app | Leave notifications | ESS leave flow |

**Deliberately not templated:** social / Fun Zone / Wall of Fame / celebration notifications
(decision: only work-related ones), the candidate's "Resume(s) shortlisted" browser-side
insert, and the joining portal (`/joining/[token]`), which sends no mail.

## 7. Files

### New

| File | Purpose |
|---|---|
| `supabase/migrations/157_config_templates.sql`, `158_config_branch_scope.sql` | Tables, history, publish / reset; branch level |
| `lib/config/registry.ts` | Template definitions: key, where used, recipient, variables with fictional samples |
| `lib/config/offer-templates.ts` | Built-in text of the 6 offer letters and 6 offer emails |
| `lib/config/offer-letter.ts` | Offer-letter values, structure parser (`letterFromTemplate`), validation |
| `lib/config/offer-mail.ts` | Offer-email values (browser-safe) |
| `lib/config/workflow-templates.ts` | Built-in text of every other email, letter and notification |
| `lib/config/render.ts` | Pure renderer / validator / HTML helpers |
| `lib/config/store.ts` | Server: resolve branch → company → Global → built-in; `renderEmail` (with blocks), `renderNotification`, the scope helpers |
| `lib/config/notify.ts` | `notifyFromTemplate()`: the in-app insert with templated words; never throws |
| `lib/config/access.ts` | Who may view / edit which scope |
| `lib/mail/send.ts` | **The one email sender** (Gmail SMTP, same `GMAIL_*` env). Never throws; returns `{ sent, skipped?, error? }` |
| `lib/employees/transfer-auth.ts` | Transfer routes: Transfer EDIT or Employees EDIT |
| `lib/letters/winAnsi.ts`, `lib/letters/previewPdf.ts` | HR-letter PDF safety (₹ etc.) and the shared preview |
| `app/api/config/templates/route.ts`, `app/api/config/preview/route.ts` | Configuration API |
| `app/dashboard/configuration/page.tsx` | The screen: Company → Branch selector; Letters / Emails / Notifications / Activity tabs |
| `lib/config/__tests__/*` | Every built-in text = the old text, including all 6 offer letters and emails (`fixtures/` hold the old upstream code as the reference) |

### Changed (all through `lib/mail/send.ts` now — no route creates its own transport)

| Area | Files | What changed |
|---|---|---|
| Offers | `lib/recruitment/offer-letter-pdf.ts`, `app/api/recruitment/send-offer-email`, `offer-flow-components.tsx` | Letter text per engagement from the template, by company + MRF branch; layout untouched. The email is prefilled from the template (GET) and still editable |
| Offer approval | `app/api/recruitment/offer-approval`, `lib/recruitment/offer-approval-notify.ts`, `confidential-flow.ts`, `offer-response`, `offer-accepted-mail.ts` | Emails + notifications from templates. Facts table kept as a block |
| Candidate links | `app/api/collect-docs` (+`/otp`), `app/api/salary-view/otp` | Templates. `submittedEmail()` removed from `lib/recruitment/collect-docs.ts` |
| Interviews | `app/api/recruitment/interview-invite`, `app/api/ess/interview` | Emails and notifications, now branch-scoped |
| Pre-onboarding | `app/api/recruitment/send-letter`, `app/dashboard/recruitment/page.tsx` (`sendAcceptance`) | New `{ acceptance, candidate_id }` call: server renders letter + email. The old `{ subject, body, letter }` call still works |
| Cron | `app/api/cron/offer-followup` | 4 mails from templates; a failed send still leaves the candidate un-marked so the next run retries |
| Onboarding | `otp`, `submit`, `generate-code`, `activation-approval`, `lib/onboarding/ack-email.ts` | Templates; the two mails that were only *logged* are now *sent*, and the log says `SENT` / `FAILED` truthfully |
| Lifecycle | `app/api/transfer/*`, `app/api/hr/recovery-mail` | Templates |
| Payroll | `lib/loans/notify.ts`, `lib/nps/pran-email.ts`, `app/api/ess/loans/agreement`, `app/api/ess/nps`, `app/api/nps/pran-reminder` | Templates |
| ESS notifications | `app/api/ess/{leave,approvals,resignation,mrf}` | `notify()` → `notifyFromTemplate()` |

### Auth added (these sent mail for anyone who called them)

| Route | Now requires | Client updated |
|---|---|---|
| `POST /api/hr/recovery-mail` | Employees EDIT | `lib/employees/hr-actions.ts` |
| `POST /api/transfer/generate-letter`, `POST /api/transfer/notify` | Transfer EDIT or Employees EDIT | `lib/employees/hr-actions.ts` |
| `POST /api/onboarding/activation-approval` | Onboarding EDIT | `components/onboarding/ActivationWizard.tsx` |
| `GET/POST /api/recruitment/offer-approval` | Recruitment | `offer-flow-components.tsx`, `recruitment/page.tsx` |
| `POST /api/nps/pran-reminder` | Payroll EDIT (or `Bearer CRON_SECRET`) | `components/payroll/NpsReport.tsx` |

Left open on purpose: `GET /api/transfer/generate-letter?id=` and `GET /api/ess/loans/agreement?format=html`
are opened from an email link / new tab, where no sign-in header can be sent. Follow-up
worth doing: `POST`/`PATCH /api/ess/loans/agreement` trust an `employee_id` in the body.

## 8. Visible differences, on purpose

- Emails that drew their own coloured HTML (the OTP mails, PRAN mails, approval button) are
  now the template's text. Bold and links are kept; the facts table, the PRAN steps box and
  the acknowledgement table are still drawn by code.
- The transfer letter's inter-company note is a normal paragraph instead of a green box.
- "Joining form submitted" (to HR) and "Welcome — your Employee ID" (to the joiner) are
  really emailed now. HR is the onboarding's HR SPOC, else the employee who created it, else
  `HR_DEFAULT_EMAIL`.
- The old Global `offer.letter` row is obsolete and hidden. Upstream replaced the single
  offer letter with one per engagement, and the signatory now comes from the letterhead
  configuration.

## 9. Adding a template later

1. Add a `TemplateDef` to `lib/config/workflow-templates.ts` (or `registry.ts`). Use today's
   wording as `defaults` and give every variable a fictional sample.
2. In the route: `renderEmail('<key>', scope, vars, blocks?)` + `sendMail()`, or
   `notifyFromTemplate(employeeId, '<key>', vars, { scope, link })`. Build `scope` with
   the helpers in §3.
3. Add an "old text = new text" test to `lib/config/__tests__/workflow-templates.test.ts`.

No migration is needed: a template with no row uses its built-in text.

## 10. Verified

- `node --experimental-strip-types --test "lib/**/__tests__/*.test.ts"`: all Configuration,
  letter and offer tests pass. The 13 failures are the same at HEAD: Windows path separators
  in the theme / z-index audits, ESIC, and the upstream recruitment-tab parse.
- `npx tsc --noEmit`: no new errors (the remaining ones are all pre-existing).
- `next build`: succeeds.
- End-to-end against the dev server: 42 / 42 checks, with test records cleaned up afterwards.
