# Bulk uploaders that write straight from the browser

**Status:** reported, not fixed. Outside the PMS scope the current work is
bound to, and too wide to change mid-session.
**Written:** 9 November 2026
**Audience:** whoever owns Employees, Leave and Payroll.

---

## The short version

Four bulk upload surfaces write to the database **from the user's browser**,
with no server-side check on who is asking. Three more call database
functions the same way. The permission system that would stop an unauthorised
write exists and is well built — but for these paths it runs only in the
browser, where it decides what the screen shows rather than what the database
accepts.

This is a **design gap, not a live incident**. Nothing here says anybody has
misused it. It says the thing that would stop them is not where it needs to
be.

---

## Two patterns in the same codebase

**Through an API route** — the browser calls `/api/…`, which runs on the
server, checks the caller's grant, and uses the service key. The browser
never touches the database directly.

```
app/api/employees/bulk-upload/route.ts:261
    const gate = await requireModule(req, 'Bulk Upload', 'EDIT')
```

**Straight from the browser** — the page calls Supabase itself, using
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. That key is public by design: it is compiled
into the JavaScript bundle every visitor downloads. On this path the
**database** is the only thing between a request and the data.

```
components/employees/BulkUploadModal.tsx:127
    const { data: emp, error } =
      await supabase.from('employees').insert(row).select('id').single()
```

The second pattern is normal and safe **when the database enforces the
rules**. That is the part that is missing.

---

## The surfaces

| Surface | File | Writes | Server check |
|---|---|---|---|
| Bulk Uploader (8 categories) | `app/dashboard/bulk-upload/page.tsx` | via API route | **yes** — `requireModule(…, 'EDIT')` |
| PMS Final Rating Upload | `components/pms/AdminTabs.tsx` | API route → RPC | **yes** — role, policy, full re-validation |
| **Employee bulk add** | `components/employees/BulkUploadModal.tsx:127` | `employees`, `employee_tasks`, `employee_code_sequences` | **none** |
| **Leave balances** | `lib/supabase-leave-upload.ts:86` | `leave_balances` | **none** |
| **Leave quota** | `lib/supabase-leave-upload.ts:132` `commitQuota` | `leave_policy` | **none** |
| **Statutory leave import** | `lib/supabase-statutory-leave.ts:49` | `state_statutory_leave` | **none** |
| Attendance upload | `lib/payroll/core.ts:157` | RPC `upload_attendance_batch` | partial — see below |
| OT upload | `lib/payroll/core.ts` | RPC `upload_ot_batch` | partial |
| Manual voucher / bulk pay-heads | `lib/payroll/manual-voucher.ts:50` | RPC `save_manual_voucher` | partial |

**"Partial"** means the RPC is real server-side logic and does its own work
properly — but it is invoked from the browser with the public key, and
nothing in it establishes who the caller is or whether they may run it.

`BulkUploadModal` states the position in its own second line:

```
// Client-side (permissive RLS): download template → fill → upload → insert.
```

---

## Why the database does not catch it

Row Level Security is the mechanism that would make these writes safe. Two
things work against it here.

**1. Many tables have a policy that permits everything.** The project-wide
pattern, repeated across migrations and documented in `CLAUDE.md` as the
house style, is:

```sql
CREATE POLICY "allow_all_<table>" ON <table>
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```

That is a policy which allows every row to every caller. **104 distinct
tables** carry one.

**2. Some tables have no RLS at all.** `employees`, `leave_balances` and
`leave_policy` are never given `ENABLE ROW LEVEL SECURITY` in any migration.
With RLS off, policies are not consulted; access falls back to table grants,
which in a default Supabase project include the anonymous role.

So for the affected tables the database has no opinion about who is asking.
`lib/rms/*` — `canManage`, `canSeeScreen`, `requireModule` — is a genuine,
carefully built permission system, and on these paths it governs the
interface only.

---

## What has NOT been verified

Stated plainly so nobody plans around a claim that was never tested.

- **No access was attempted.** Everything above is read from source. Probing
  a live system's authorisation was not in scope and was not done.
- **Whether the default grants to `anon` are still in place** on those
  tables. If they have been revoked, RLS being off matters much less.
- **Whether anything upstream** — a proxy, a gateway, network rules —
  restricts use of the public key from outside the app.

Those three answers decide whether this is a theoretical gap or a reachable
one. Checking them is the first thing to do, and it is quick.

---

## Options, with trade-offs

Roughly in order of effort.

**1. Confirm the exposure first.** Check the grants on `employees`,
`leave_balances`, `leave_policy` and `state_statutory_leave`, and whether the
public key is usable from outside the app. Half an hour, and it decides how
urgent the rest is.

**2. Move the four unguarded uploaders behind API routes.** The pattern
already exists and works — `app/api/employees/bulk-upload/route.ts` is the
model: authenticate, `requireModule`, re-validate server-side, write with the
service key. Most faithful fix, largest change, touches working screens.

**3. Enable RLS with real policies on the affected tables.** Fixes every
caller at once, including any future one. But a wrong policy locks out
legitimate users, and it needs the app's identity model mapped onto database
roles — which does not exist yet.

**4. Add authorisation to the three payroll RPCs.** Smaller: those already
run server-side, and can check the caller rather than trusting them.

Options 2 and 3 are alternatives, not a sequence. Doing 1 first tells you
which is worth the disruption.

---

## Two related notes

**No tests.** None of the six unguarded uploaders has any test coverage:
`BulkUploadModal`, both leave flows, statutory leave, attendance, OT, manual
voucher. The two that go through API routes are well covered. Whatever is
decided above, tests should land with it.

**Part-applied batches.** Separate from authorisation, and worth knowing:
the leave quota upload (`commitQuota`, `lib/supabase-leave-upload.ts:132`)
and the manual voucher both write row by row in a loop, counting failures and
carrying on. A failure halfway leaves some rows written and some not, with
nothing recording which. The PMS upload shows the alternative — validate every row,
then apply every row, so a bad row anywhere means nothing is written.

---

*Compiled while testing the PMS bulk upload and publish features. Every file
and line reference was read directly; the claims about RLS come from reading
all migrations, not from a summary.*
