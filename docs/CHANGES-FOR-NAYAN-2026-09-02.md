# EZER HRMS — what changed, and what it needs from the database

**For:** Nayan Ahuja
**From:** Tushar's branch, `TusharPanwar` (pushed 02-Sep-2026, head `4288542`)
**Covers:** 22 commits · 47 files · +6,017 / −402

Everything marked *probed* below was checked against the live database on
02-Sep-2026, not assumed from the file list.

---

## 1. The short version

Four things shipped: the **dashboard sidebar** and **home page** were
redesigned, an **ESS Inbox** was built, and the **company profile** gained
registration certificates while losing its Documents and Policies tabs.

Two of those need you.

| | |
|---|---|
| **Migrations to run** | **7** — 075 through 081, in order, none applied yet |
| **Manual step** | one storage bucket, `company-docs` — 081 does not work without it |
| **Decisions I left to you** | RLS on 6 new tables · whether 078 is still worth running |

Nothing in the app breaks while these are unapplied. Every new screen
detects the missing tables and says *"not switched on yet"* rather than
showing an error.

---

## 2. Migrations

Run in this order, from the `sql/` folder of
`EZER-migrations-for-Nayan-2026-09-01.zip`.

| # | File | Lines | Adds | Status *(probed 02-Sep)* |
|---|---|---|---|---|
| 075 | `075_ess_notification_catalogue.sql` | 166 | 4 columns + 13 indexes | PENDING |
| 076 | `076_pms_persist_scores.sql` | 133 | 1 function + 1 trigger | PENDING |
| 077 | `077_company_profile_full.sql` | 181 | 28 columns + `company_contacts` | PENDING |
| 078 | `078_company_documents_policies.sql` | 132 | 2 tables + 1 column | PENDING — **may be skippable, see §5** |
| 079 | `079_group_profile.sql` | 62 | 12 columns on `groups` | PENDING |
| 080 | `080_ess_inbox.sql` | 437 | **7 tables + 4 functions** | PENDING |
| 081 | `081_registration_documents.sql` | 83 | 6 columns on `registrations` | PENDING |

**Order only matters between 077 and 078** — both touch `companies`, and 078
assumes the shape 077 leaves. The rest are independent. All seven are
idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, guarded
constraint blocks), so re-running any of them is safe.

**How they were checked:** parsed with `libpg_query` — the parser PostgreSQL
itself uses — and every column they reference on an existing table verified
present against the live schema. They have **not been run**; I don't touch
your database. What that does *not* prove is runtime behaviour on real data.

### A correction on 076

My earlier note said 076 was applied. It wasn't, and the probe was wrong:
I checked `pms_overall_rating.self_score`, which came back fine. That column
is declared in **066** — 076 doesn't add the column, it adds the **trigger
that finally writes to it**. The column has been sitting there empty.

The honest check is:

```sql
SELECT 1 FROM pg_proc WHERE proname = 'pms_has_reviews';
```

Nothing today. 076 is pending.

*(If you probe over PostgREST instead, note it matches on exact argument
names — `pms_score` reports "missing" if you call it with the wrong ones,
which is what misled me.)*

---

## 3. New in this batch: 080, the ESS Inbox

A messaging surface in the ESS portal, below Leave. Three kinds of thing land
in one place because to the employee they're all *"something waiting for me"*:

- **DIRECT** — colleague to colleague, private to its participants
- **DESK** — a thread addressed to a *function* (HR, Payroll, IT), answered by
  whoever staffs it today
- **SYSTEM** — the notification streams the bell already produces, grouped by
  the department that owns them

### Tables

| Table | What it holds |
|---|---|
| `inbox_desks` | the functions you can write to — 5 seeded |
| `inbox_desk_agents` | who answers each desk — **starts empty** |
| `inbox_conversations` | the threads |
| `inbox_participants` | **who may read and reply** |
| `inbox_messages` | the messages |
| `inbox_policy` | one row: reach mode and limits, HR-editable |
| `inbox_reach_overrides` | per-ESS-role exceptions to that reach |

### Functions

| Function | Purpose |
|---|---|
| `inbox_touch_conversation()` | trigger — keeps the thread summary true |
| `inbox_unread_count()` | messages **from people** only — see below |
| `inbox_unread_by_conversation()` | the per-folder badge, which **does** include notifications |
| `inbox_can_message()` | may A open a thread with B |

### Three design decisions worth your review

**Access is one rule in one place.** You can read a conversation if and only
if you have a row in `inbox_participants`. There is no second path and no
"…or if you are an admin" — an HR person who needs to see a thread is *added*
to it, visibly, rather than reading it silently.

Desks are the single deliberate exception: a desk thread is readable by
whoever staffs the desk *right now*, resolved through `inbox_desk_agents` at
query time. Frozen into `participants` instead, an agent who changed teams
would keep access to every thread they ever touched.

**Unread is computed from `participants.last_read_at`,** not stored per
message per person — one row per person per thread instead of one per person
per message, on the table that grows fastest.

**The two unread functions count different things, on purpose.** The inbox
mirrors `ess_notifications` into per-department threads, so a leave approval
exists twice: once as the notification the bell counts, once as a message in
the "Leave & Attendance" thread. One badge counting both would show a single
approval as two things waiting. So `inbox_unread_count()` **excludes**
`kind='SYSTEM'`; `inbox_unread_by_conversation()` includes it, because a
folder badge inside the inbox is a different question.

> **If you change one of these, check the other.**

### ⚠️ The RLS question is different this time

For every other table in this app the house pattern is:

```sql
FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)
```

and I've flagged that as an open question without pushing. **Here I want to
push**, because the consequence isn't the same.

`inbox_messages` holds private conversations between named employees. The
anon key ships in every page load. An allow-all policy on this table means
anyone who can open the app can read every private message in the company —
including anything an employee writes to HR about a colleague, their pay, or
their exit.

The app never reads these tables from the browser. Every read goes through
`/api/ess/inbox` with the service role, after checking participation.

**My recommendation, for you to accept or replace:**

| Tables | Policy |
|---|---|
| `inbox_messages`, `inbox_participants`, `inbox_conversations` | Enable RLS, grant **nothing** to `anon` or `authenticated`. Service role only. |
| `inbox_desks`, `inbox_desk_agents`, `inbox_policy` | Same, unless you want the ESS client reading the desk list directly — it doesn't today. |

Nothing in the app breaks either way. If you'd rather match the neighbours,
that's your call — but please make it deliberately rather than by copying the
block above.

### After running 080

The five desks exist but `inbox_desk_agents` is **empty**, so nobody answers
them. The ESS UI says so plainly rather than accepting a message into a void.
Agents are added from the HRMS: **Admin Setup → Inbox**.

Also: flip `NOTIF_HAS_CODE` to `true` in `lib/notifications/dispatch.ts` once
**075** is applied. Until then the app uses `category` and behaves identically.

---

## 4. New in this batch: 081, registration certificates

Six nullable columns on `registrations` and three CHECKs. No new table.

A registration row carried a number and two dates. The certificate — the thing
an inspector actually asks for — lived in somebody's email.

```
document_path · document_name · document_mime · document_size
document_uploaded_at · document_uploaded_by
```

**Metadata only.** The file goes to Supabase Storage the way flexi-bills and
onboarding-docs already do.

**Three CHECKs, each stopping a specific mess:**

1. **mime is PDF or DOCX only.** A browser renders PDF and cannot render Word,
   so the UI previews the first and downloads the second rather than shipping
   a statutory certificate to a third-party viewer service for a preview.
2. **path and name travel together.** A path with no name is a file nobody can
   identify in a list; a name with no path is a row pointing at nothing.
3. **size ≤ 15 MB**, so a mis-selected video is refused by the database and not
   only by the route.

### 🪣 This makes the `company-docs` bucket necessary

It was asked for in the 078 notes, for a Documents tab that has since been
removed. **If you skipped creating it, it's needed after all.** This is the
only manual step in the whole package.

```
name     company-docs
access   PRIVATE
policy   whatever flexi-bills / onboarding-docs already use
```

**PRIVATE matters more here** than it did for the old Documents tab. These are
PAN, GST, EPF and ESIC certificates. The app never links to a file directly —
every view is a short-lived signed URL minted server-side — so a public bucket
would be giving away something the application itself never exposes.

Until the bucket exists the UI says uploads are unavailable rather than
offering a button that fails.

---

## 5. 078 — you may not need it any more

**Nothing in the app uses 078.**

It was written for the **Documents** and **Policies** tabs of the company
profile. Those two tabs were **removed from the product on 02-Sep** at
Tushar's request. `company_documents`, `company_directors` and
`companies.attendance_modes` are now read by no screen and no route — I
checked the whole codebase, not just the obvious places.

Two honest options:

- **Run it** if those tabs are expected back. The tables are harmless empty,
  the columns nullable, and restoring the tabs then becomes a UI change with
  no migration on the critical path. The data layer for them is still in the
  code, deliberately, for exactly this reason.
- **Skip it** if they're not coming back. Nothing breaks; 079, 080 and 081
  don't depend on it.

**077 must still be run either way** — the company profile uses most of what
077 adds.

It's still in the package rather than quietly dropped, because it's Tushar's
call, not mine.

---

## 6. Changes in the app that affect your side

### Registrations are no longer written from the browser

This one matters for how you think about table permissions.

The company profile used to write `registrations` **with the anon key**, from
the browser:

```js
supabase.from('registrations').update(patch).eq('id', id)
```

Which meant the rule *"only EZER may change the company profile"* was
unenforceable wherever it was written down — anyone who could open the app
could PATCH the table directly. Hiding the Edit button would have changed
nothing.

Every registration write now goes through `/api/company/profile`, which
resolves the caller's grant **server-side**. The old anon-writing helper
(`upsertRegistration`) is kept but marked, so the next caller doesn't reach
for it.

**Verified unauthenticated:** `PATCH` / `POST` / `DELETE` on the profile route
all return 403, and the `companies` table was confirmed unchanged afterwards.

> Still open, and not caused by these files: the **company master itself**
> (`companies`, `locations`) is still written from the browser through the
> anon client on the older per-field edits. Worth closing; not something a
> migration can fix.

### Who may edit the company profile

`ADMIN_COMPANY` — the customer's own administrator — has been **removed** from
`COMPANY_EDIT_ROLES`, on instruction. Only the EZER platform roles
(`ADMIN_SUPER`, `SUPER_ADMIN`) and EZER customer support (`IMPL_MANAGER`) can
change the company master now.

A company admin keeps every other admin power; this governs the company
profile alone, and they can still **read** all of it.

### The inbox mirrors, and marks read, `ess_notifications`

Opening a notification thread in the inbox sets `is_read = true` on the
matching `ess_notifications` rows. The notification rows remain the single
source of truth for "read"; the inbox mirrors them, so the mirror marks the
original. Without that, an employee clears the inbox and the bell still shows
a count.

---

## 7. Everything else that shipped (no DB impact)

Listed so you know what changed if you pull the branch.

**Dashboard sidebar** — a colour per module carried on a 26px icon tile,
sections that fold open and shut with the state remembered, a gradient wash
per section, and readable label ink. Every colour measured: worst adjacent
pair ΔE 17.5 light / 18.8 dark, every glyph ≥3:1 in both themes.

**Dashboard home** — module cards with real depth, and content text lifted out
of caption weight. Three genuine defects fixed along the way:

- `MRF_APPROVED` displayed as **"Mrf approved"** — the action type was
  lowercased wholesale and only the first letter restored, destroying every
  acronym (ESS, KRA, PMS, HOD)
- Recent activity drew an **empty tinted square** beside every row (`icon: ''`)
- Birthdays: `c.type === 'birthday' ? '' : ''` — both arms empty strings

**Company profile** — Documents and Policies tabs removed (ten sections now);
registration certificates and a remove control added; the gender chips fixed
(they were failing AA at 4.37:1 / 3.84:1, and "Unknown" at 2.33:1).

**Two auth bugs found and fixed** — the ESS inbox read a `localStorage` key
nothing writes, so every request went out unauthenticated; and the admin panel
sent no `Authorization` header at all. Both now use one shared helper. An audit
of all 101 client-side API calls found one more (travel-claims `expand()`,
which failed *silently*).

> **Also surfaced by that audit, and worth your eyes:** ten API routes have
> **no auth check at all** — `attendance/punch`, `ess/vpf`, `ess/nps`,
> `ess/loans`, `ess/loans/agreement`, `flexi/claims`, `nps/pran-reminder`,
> `recruitment/screen-resumes`, `recruitment/upload-doc`, and **`db-export`**.
> Their callers send no token and it has never surfaced as a bug *because
> nothing is checked*. `db-export` is the one I'd look at first — it will
> export the database for anyone who can reach the URL. Flagged, not changed:
> gating them needs the callers fixed first or those screens break.

---

## 8. Two test suites you can run

```bash
python3 scripts/smoke-menu.py              # 45 checks — the sidebar
python3 scripts/smoke-company-profile.py   # 34 checks — the company profile
```

No dependencies, no dev server, no database. They re-derive facts from the
source rather than trusting its comments — that every section has a tab block
and an accent, that removed sections are gone from *every* place they lived,
that contrast figures hold, and that every API verb resolves the grant before
it acts.

Browser halves (need `websocket-client` and a running dev server) live in
`scripts/menu-perf/` and `scripts/company-profile-checks/`, each with a README.

---

## 9. Open items

| # | Item | Owner |
|---|---|---|
| 1 | **RLS on the 6 inbox tables** — see §3, recommendation included | Nayan |
| 2 | **RLS** on `company_contacts`, `company_documents`, `company_directors`, the 15 `pms_*` tables, `ess_notifications` | Nayan |
| 3 | **`company-docs` bucket** — 081 needs it | Nayan |
| 4 | **Run or skip 078** — see §5 | Tushar |
| 5 | **Desk agents** — 5 desks exist, nobody staffs them (Admin Setup → Inbox) | HR |
| 6 | Company master still writable from the browser via anon | open |
| 7 | Ten unauthenticated API routes, incl. `db-export` | open |
| 8 | 129 of 398 active employees have no ESS account, so a notification to one is stored and unreadable | accounts |
| 9 | One orphaned leave request: Arjun Malhotra (SRS9021), applied 10-Jul, `current_approver_id` NULL and no `l1_manager_id` — nobody is notified and nobody can approve it. Setting his L1 manager fixes both. | HR |

---

## 10. If something looks wrong

**"column … does not exist" after running a file**
That file didn't complete. Read the console output — a failed statement
mid-file leaves a partial apply. All seven are safe to re-run.

**The manager rating form still won't open after 076**
Check the trigger exists:
```sql
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_pms_sync_role_score';
```
It only populates on the **next** review write; the backfill at the end of 076
handles reviews already submitted. There are 0 submitted reviews today, so
there's nothing to backfill yet — the first self rating submitted after this
runs is the real test.

**The company profile still shows "Not recorded" everywhere after 077**
Expected. 077 adds the **columns**; the values still have to be entered.

**The ESS Inbox says "not switched on yet"**
080 hasn't been run. That's the designed message, not a fault.

**Certificate upload says uploads are unavailable**
The `company-docs` bucket doesn't exist yet. See §4.

---

*Anything here that doesn't match what you find, tell Tushar and I'll fix the
file rather than patch around it.*
