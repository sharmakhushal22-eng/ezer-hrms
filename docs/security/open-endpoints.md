# Unauthenticated API endpoints — Recruitment & ATS

**Status:** **FIXED** — all listed endpoints now require a session. See *Remediation* below.
**Found:** 27 September 2026 (1–11) · 2 October 2026 (12–13)
**Fixed:** 27 September 2026 (1–11) · 2 October 2026 (12–13)
**Scope audited:** the 22 routes under `app/api/recruitment/`, `app/api/salary-view/`, `app/api/collect-docs/`, as they stood on 27 September. Routes added after that date are NOT covered — 12–13 are the proof; see *Still worth doing*.
**Branch:** `leave-holiday-sync`

Twelve recruitment endpoints answered requests from anyone on the internet. Ten
were found in the original sweep; two more (`offer-approval`, both verbs) landed
with a feature shipped afterwards and were found on 2 October. Of the original
ten, six were proven by direct unauthenticated request; four were established by
reading the source and deliberately **not** fired, because firing them would
delete data or email real candidates.

The findings below are kept in the past tense as the record of what was wrong and
how it was established. Everything in the summary table is now closed.

---

## Remediation

Thirteen routes gained `requireModule(req, 'Recruitment')` — the pattern already
used by `share-report` and `upload-mrf-doc`. `VIEW` is the default and is enough
to shut out an anonymous caller; `'EDIT'` is required where a handler destroys
data, writes a decision, uploads, or sends mail, so a read-only Recruitment role
cannot email a candidate by hand.

| level | handlers |
|---|---|
| `EDIT` | `doc-collection` POST, `interview-invite` POST, `upload-doc` POST, `send-offer-email` POST, `send-letter` POST |
| `VIEW` | the ten remaining GET/POST handlers |

**Nineteen client call sites** were given credentials to match — in `page.tsx`,
`offer-flow-components.tsx` and `CandidateInterviewModal.tsx`. Three are
multipart and use `uploadAuthHeaders()`, which omits `Content-Type` so the
browser can set the boundary; one (`pincode`) runs in a `useEffect` body and
fetches its headers as the first link of the same promise chain.

A pre-existing bug was fixed on the way: `page.tsx` carried its own private
`authHeaders(supabase)` that read **only** the Supabase session and returned `{}`
for an employee signed in through ESS. Since this page is mounted inside ESS by
`components/ess/RecruitmentModule`, the two routes that were *already* guarded
were silently 401-ing for ESS users. It now uses `lib/auth-headers.ts`, which
checks both sessions.

### Verified both ways

A guard that only refuses is half a fix; the other half is that a real user still
gets in. Both were measured.

* **Anonymous → refused.** All 14 endpoints return
  `401 {"error":"Sign in first — this endpoint needs a dashboard session."}`.
  The method is trustworthy because `upload-mrf-doc` and `share-report` — guarded
  before this work — returned the same 401 to the same probe, and the
  candidate-facing token routes (`salary-view/data`, `collect-docs`) still answer
  `404 "This link is invalid."`, unchanged.
* **Signed in → admitted.** From the browser's own session:
  `doc-collection` 200, `doc-collection/file` 404, `doc-collection/zip` 404,
  `interview-invite` 200, `pincode` 200 — no 401s. The 404s are the handlers
  running normally against a non-existent id, exactly as before. Confirmed twice,
  by in-page probe and by the browser's network log independently.

`tsc` 43 (unchanged baseline), suite 752/752.

### Still worth doing

* **`upload-doc` and `interview-ai` have no callers** anywhere in this repo. They
  are guarded rather than deleted, because the EZER ESS Android app lives outside
  this tree and could not be checked. Confirm there, then delete them.
* **RLS remains `allow_all`** (see below). The guards close the HTTP door; they do
  not change the fact that the anon key can still reach these tables directly.
* The routes outside recruitment named at the end of this document were never
  triaged.
* **The audited scope is fixed; the product is not.** `offer-approval` (12–13
  above) was found on 2 October, outside the original 22-route sweep, because it
  shipped with the offer-approval feature AFTER this document was written — its
  own sibling `offer-approval/documents` was guarded on 27 September while the
  parent was not. Re-run the probe against the whole of `app/api` whenever a
  feature lands, not once. `app/api/flexi/claims` is the next candidate: a grep
  showed no guard identifiers and `FlexiClaims.tsx` posts a client-supplied
  `employee_id`. It has NOT been read or probed and is not claimed vulnerable.

---

## How these findings were established

Every route was probed without credentials, using non-existent UUIDs and empty
bodies so that nothing was read, written or sent.

The results only mean something because of the **controls**. Two routes in the
same directory *are* guarded, and both refused the identical probe:

```
POST /api/recruitment/upload-mrf-doc   → 401 {"error":"Sign in first — this endpoint needs a dashboard session."}
POST /api/recruitment/share-report     → 401 {"error":"Sign in first — this endpoint needs a dashboard session."}
```

So the probe detects a guard when one exists. Measured against that baseline, a
`404` or `400` from the routes below is **not a refusal** — it is the handler
running normally, having never asked who is calling. A `404` means it reached
the database. A `400` means it reached input validation.

`lib/api-auth.ts` states the rule this violates, in its own header:

> Routes that write to storage or read bulk data run with the service-role key,
> which bypasses RLS entirely. Without a check of their own they are open to the
> whole internet… That is not hypothetical — the endpoints answered an anonymous
> curl from outside before this existed.

> Hiding a sidebar entry stops nobody from calling the endpoint by hand; this does.

---

## Summary

| # | Endpoint | Method | Effect | Proven | Severity |
|---|---|---|---|---|---|
| 1 | `/api/recruitment/doc-collection` `action:'reject'` | POST | Deletes a stored document, irreversibly | source | **Critical** |
| 2 | `/api/recruitment/doc-collection/zip` | GET | Downloads a candidate's entire document set | probe | **Critical** |
| 3 | `/api/recruitment/doc-collection/file` | GET | Signed URL for any single document | probe | **High** |
| 4 | `/api/recruitment/doc-collection` | GET | Link row incl. `link_token` + all doc rows | probe | **High** |
| 5 | `/api/recruitment/doc-collection` `action:'send'` | POST | Mints a 24h link, emails arbitrary address | source | **High** |
| 6 | `/api/recruitment/interview-invite` | GET | All interview rows incl. meet passcodes | probe | **High** |
| 7 | `/api/recruitment/interview-invite` | POST | Writes decisions; bypasses the approval gate | source | **High** |
| 8 | `/api/recruitment/upload-doc` | POST | Arbitrary upload; overwrites candidate record | probe | **High** |
| 9 | `/api/recruitment/send-offer-email` | POST | Arbitrary email from the company Gmail | probe | **High** |
| 10 | `/api/recruitment/send-letter` | POST | Arbitrary email from the company Gmail | source | **High** |
| 11 | `generate-jd`, `interview-ai`, `screen-resumes`, `parse-resume` | POST | Billable third-party API calls | source | **Medium** |
| 12 | `/api/recruitment/offer-approval` | GET | Enumerates HR Heads + HR Managers (names, codes) per company id | probe | **Medium** |
| 13 | `/api/recruitment/offer-approval` | POST | Reads any offer row by id; sends the approval/decision mail | probe | **High** |

---

## What is actually exposed

Endpoints 1–5 all operate on the CTC-negotiation document collection. The set a
candidate uploads (`lib/recruitment/collect-docs.ts`) is not a few attachments —
it is a complete identity and financial dossier:

| Group | Documents |
|---|---|
| Identity & Tax | **PAN Card**, **Aadhaar Card** (front & back) |
| Financial | **Bank Statement** |
| Education | 10th, 12th, Graduation, Masters, additional certificates |
| Employment | Appointment Letter, Appraisal Letter(s) |
| Income | **Salary slips × 3**, **Form 16** |
| Photograph | Passport-size photo |

Eleven of the fifteen are mandatory. Taken together this is sufficient for
identity theft and discloses a candidate's complete salary history.

`document_collection_links` is read with `select('*')`, so endpoint 4 also
returns:

- `link_token` — the candidate's upload link (`gen_random_bytes(16)` hex)
- `created_by` — the recruiter's email address
- `candidate_email`, `cc_emails` — as written by the send action
- `expires_at`, `status`, `sent_at`, `opened_at`, `submitted_at`

> Note on `link_token`: the `/collect-docs/<token>` page it opens is separately
> OTP-gated (`verifyAccess`, HMAC + timing-safe compare), so the token alone does
> not yield the documents. It is still a secret being handed out, alongside the
> candidate and recruiter email addresses.

---

## Detail

### 1. `POST /api/recruitment/doc-collection` — `{action:'reject', doc_id}`

`app/api/recruitment/doc-collection/route.ts`

The most damaging of the set, because it destroys data:

1. `storage.from('onboarding-docs').remove([doc.file_url])` — deletes the file
2. `.from('candidate_documents_uploaded').delete()` — deletes the row
3. reopens the collection link for a fresh 24 hours
4. sets `candidates.pre_negotiation_done = false`

There is no authorisation check and no soft-delete. Not probed — doing so would
have destroyed a real document.

### 2. `GET /api/recruitment/doc-collection/zip?candidate_id=<uuid>`

`app/api/recruitment/doc-collection/zip/route.ts`

Finds the candidate's most recent collection link, selects every uploaded
document, downloads each from the `onboarding-docs` bucket, and returns one
archive with `Content-Disposition: attachment; filename="<Name>_documents.zip"`.
Optional `&ids=` selects a subset.

The file's own comment describes the trust model plainly: *"Service-role,
addressed by candidate_id"* — knowing a UUID is the entire protection.

```
GET /api/recruitment/doc-collection/zip?candidate_id=00000000-0000-0000-0000-000000000000
→ 404 {"error":"No documents found."}
```

It queried the database. With a real `candidate_id` it returns the archive.

### 3. `GET /api/recruitment/doc-collection/file?doc_id=<uuid>&mode=view|download`

`app/api/recruitment/doc-collection/file/route.ts`

Returns a **10-minute signed URL** for any row in `candidate_documents_uploaded`.

```
GET /api/recruitment/doc-collection/file?doc_id=00000000-0000-0000-0000-000000000000
→ 404 {"error":"Document not found."}
```

This one is a deliberate trade-off rather than an oversight — the comment says
the session requirement was dropped so the ESS-embedded recruitment module would
work without a dashboard session. **That trade-off was avoidable:**
`requireModule` accepts ESS tokens through `verifyEssToken`, so the ESS caller
only needs to send its bearer.

It also directly contradicts its sibling, `upload-mrf-doc`, which *is* guarded
with the comment:

> A signed URL for any path is a read of any file in the bucket — guessing a path
> should not be enough.

### 4. `GET /api/recruitment/doc-collection?candidate_id=<uuid>`

Returns `{ link, docs }` — the full link row (see above) and every document row.

```
GET /api/recruitment/doc-collection?candidate_id=00000000-0000-0000-0000-000000000000
→ 200 {"link":null,"docs":[]}
```

An unauthenticated **200**.

### 5. `POST /api/recruitment/doc-collection` — `{action:'send', …}`

Body: `{candidate_id, mrf_id, company_id, email, cc, created_by}`.

Creates or refreshes a 24-hour collection link and emails it via
`GMAIL_USER` / `GMAIL_APP_PASSWORD` to whatever address the caller supplies,
copying an arbitrary `cc` list. Not probed — it sends real mail.

### 6–7. `GET` / `POST /api/recruitment/interview-invite`

`app/api/recruitment/interview-invite/route.ts`

**GET `?candidate_id=`** returns every `interview_invites` row: interviewer names
and emails, rounds, decisions, feedback, meet links and **meet passcodes**.

```
GET /api/recruitment/interview-invite?candidate_id=00000000-0000-0000-0000-000000000000
→ 200 {"invites":[]}
```

**POST** accepts three actions — `schedule`, `direct_feedback`, `shortlist` —
which insert invite rows, email the candidate and interviewers, create ESS tasks,
and call `applyInterviewDecision`, writing `candidates.stage`.

`action:'shortlist'` is therefore an **approval-gate bypass**: it advances a
candidate through the hiring funnel with no authorisation at all. Not probed —
it writes and emails.

### 8. `POST /api/recruitment/upload-doc`

`app/api/recruitment/upload-doc/route.ts`

`formData{candidate_id, doc_type: AADHAAR|PREV_OFFER, file}` →
uploads to `recruitment/<candidate_id>/<doc_type>_<timestamp>.<ext>` in the
`onboarding-docs` bucket with **`upsert: true`**, then writes the path to
`candidates.aadhaar_url` or `candidates.prev_offer_url`.

```
POST /api/recruitment/upload-doc   (empty form)
→ 400 {"error":"candidate_id, doc_type, file required"}
```

Validation was reached, so a well-formed request would succeed. This means
arbitrary file hosting on your bucket, your domain and your bill, plus
overwriting a candidate's document record.

Its sibling `upload-mrf-doc` carries the guard **and** the comment:

> Same hole as share-report had: a service-role upload with nothing guarding it.

### 9–10. `POST /api/recruitment/send-offer-email` and `POST /api/recruitment/send-letter`

Body `{to, cc, subject, body, offer|letter}` → sends from `GMAIL_USER` with a
rendered PDF attached.

```
POST /api/recruitment/send-offer-email   {}
→ 400 {"error":"Missing recipient, subject, or body"}
```

Arbitrary recipient, arbitrary subject and body, sent **from your corporate
address** — i.e. phishing carrying your own domain's reputation.

### 11. Billable AI endpoints

| Route | Calls | Key |
|---|---|---|
| `generate-jd` | `api.anthropic.com/v1/messages` | `ANTHROPIC_API_KEY` |
| `interview-ai` | `api.anthropic.com/v1/messages` | `ANTHROPIC_API_KEY` |
| `screen-resumes` | Gemini `generateContent` | `GEMINI_API_KEY` |
| `parse-resume` | Gemini `generateContent` | `GEMINI_API_KEY` |

Not a data breach — a billing one. Anyone can burn your credits at scale.

`pincode` (cached proxy to `postalpincode.in`) and `offer-letter-image`
(renders from caller-supplied query params) are lower risk: compute only, no
stored data read.

---

## There is no second line of defence

The database will not stop any of this. **62 policies** across the migrations are:

```sql
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
```

`004_ctc_link.sql` confirms `ctc_negotiations` inherits a permissive anon policy
from `0002`. The service-role key bypasses RLS in any case, and the anon key is
public by definition (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).

A consequence worth stating separately: the documented offer chain —

> shortlist → Negotiation → Offer Approval → HR Head approves → Offers. No bypass.

— is enforced **only in client-side filters**. There is no server-side or
database constraint behind it.

---

## The fix

Both halves already exist in this repository.

**Server**, per route — the pattern from `upload-mrf-doc` and `share-report`:

```ts
import { requireModule } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const gate = await requireModule(req, 'Recruitment')   // 'EDIT' for writes and deletes
  if (gate.error) return gate.error
  …
}
```

`'Recruitment'` is a valid `Module` (`lib/rms/modules.ts`); the default level is
`VIEW`. `requireModule` accepts **both** an ESS token and the legacy Supabase
session, so it does not lock out the ESS-embedded module.

**Client**, at each call site — the pattern already used at
`app/dashboard/recruitment/page.tsx:896, 906, 912, 2806`:

```ts
fetch(url, { headers: await authHeaders(supabase) })
```

> **Plan both halves together.** `doc-collection/file` and `/zip` are called from
> the ESS-embedded recruitment module as well as the dashboard. Add the guard
> without adding the header and "Review Documents" starts returning 401.

### Suggested order

1. `doc-collection` `action:'reject'` — it destroys data
2. `doc-collection/zip`, `/file`, and the `doc-collection` GET — bulk PII
3. `interview-invite` — approval bypass and writes
4. `upload-doc` — arbitrary upload and record overwrite
5. `send-offer-email`, `send-letter` — mail from your domain
6. The four AI routes — cost

### Verifying a fix

Re-run the probe. A fixed route answers `401` before it does anything:

```bash
B=00000000-0000-0000-0000-000000000000
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://localhost:3000/api/recruitment/doc-collection/zip?candidate_id=$B"
# before: 404   after: 401
```

Do **not** verify with a real `candidate_id`, and do not probe the POST routes
with well-formed bodies — they email candidates and delete documents.

---

## What is not affected

Worth recording so remediation is not aimed at the wrong things.

- **Candidate-facing routes are correctly gated.** `collect-docs/*` and
  `salary-view/*` use `verifyAccess` / `verifiedCaller`: HMAC signature with a
  timing-safe compare, OTP with a 10-minute TTL and a 5-attempt cap, plus 401 /
  409 / 410 for unverified, already-answered and expired. `salary-view/respond`
  is a good model.
- **The ESS surface is guarded** by `essRoute` → `requireDashboardUser`, with
  "view as" another employee requiring `hasAdminAccess` or 403.
- **Tab visibility is sound.** All eleven recruitment screen keys are registered
  in `lib/rms/screens.ts`; migration 123 seeds a coherent matrix (L1/L2/HOD →
  MRF only; RECRUITER → ten tabs, HR-Head console excluded; CFO/MD → dashboard
  only); `hrhead` is double-gated on both the rail entry and the tab body. This
  is covered by `lib/rms/__tests__/recruitment-authority.test.ts`.

  Tab visibility is **not** enforcement, however. It decides what is drawn, not
  what the server will answer — which is the whole subject of this document.

---

## Correction to an earlier figure

An initial sweep of `app/api` reported "95 unguarded routes". **That was wrong.**
It tested for a fixed list of guard identifiers and did not include `essRoute`,
which guards the entire ESS surface. The corrected count is **117 routes, 52
guarded**. Of the remaining 65, many are legitimately session-less — login,
the onboarding token flows, OTP issuers.

Only the routes listed in this document were examined individually. Routes named
`rms/admin`, `pms/admin`, `loans/admin`, `idcard/cards`, `idcard/log`,
`hr/recovery-mail` and `company/profile` were **not** tested and are not claimed
to be vulnerable — but their names suggest privileged operations and they are
worth the same triage.

---

### 12–13. `GET` / `POST /api/recruitment/offer-approval`

**Found 2 October 2026. Fixed the same day.** Not part of the 27 September sweep
— this route shipped afterwards, with the offer-approval feature.

Both verbs were completely unauthenticated: no `requireModule`, no
`requireDashboardUser`, no `essRoute` anywhere in the file.

```
GET  /api/recruitment/offer-approval?company_ids=<uuid>,<uuid>
  -> { heads: { [company_id]: [{ id, name, code }] } }
POST /api/recruitment/offer-approval  { action, request_id }
  -> loads the whole offer_approval_requests row and sends the decision mail
```

The GET takes company ids straight from the query string and answers with named
employees. The POST takes a `request_id`, reads the row with `select('*')` and
sends mail to the people named on it — so an anonymous caller who guessed a
request id could trigger approval or decision mail to real recipients.

Caught while adding an HR-Manager picker to the HR Head's approval drawer: the
picker needed the manager list, the natural home was this GET, and widening it
to return `managers` alongside `heads` would have made an existing hole bigger.
The work stopped there and the route was guarded first.

**Fix.** `requireModule(req, 'Recruitment')` on the GET and
`requireModule(req, 'Recruitment', 'EDIT')` on the POST — `EDIT` because it
causes mail to real people. **Five client call sites** gained
`await authHeaders()`: `page.tsx` (1), `offer-flow-components.tsx` (4, of which
two POSTs had been passing a bare `Content-Type` object).

The failure mode to watch for when guarding a route this way is silent:
`headers: authHeaders()` without `await` hands `fetch` a Promise, which it
ignores, so the call goes out unauthenticated and 401s with nothing failing at
build time. A sweep confirmed all five genuinely await.

**Verified both ways.** Anonymous `GET -> 401` and `POST -> 401`. tsc unchanged
at 43; 765/765 tests. The authenticated screens were not driven end to end —
four of the five call sites need a live session — so a click-through of Offer
Approval, the HR Head console and Send Offers is still worth doing.
