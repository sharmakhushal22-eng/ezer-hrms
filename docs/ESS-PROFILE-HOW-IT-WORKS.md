# Updated ESS Profile — how it works

**For:** Nayan Ahuja · **Date:** 4 September 2026 · **Branch:** `TusharPanwar`
**Covers:** migrations `091` and `092`

> **Status: the schema is finished, the screens are not.** These two files are
> handed over early and separately so the database work can start while the UI
> is written. Nothing in the app reads these tables yet, so applying them
> changes nothing a user can see.

---

## 1. What the profile is

One page per employee, readable by that employee and — with progressively less
of it — by their manager, HR, and anybody else in the company. Eight tabs:
Overview, Personal, Employment, Statutory, Payroll, Time & Leave, Growth,
Records.

## 2. The idea worth keeping: a field carries its own state

Every field on the page declares what can be done to it:

| State | Means | Example |
|---|---|---|
| `locked` | Read only — changing it is somebody else's job | Date of joining |
| `direct` | Edit it yourself; saves immediately | Blood group |
| `request` | Editing raises an approval, routed to HR or Payroll | IFSC |
| `event` | Opens a workflow rather than an edit box | Marital status |

Editability is **data, not markup**. `profile_field_config` holds the copy that
drives routing; the client holds the copy that decides how a field renders.

`marital_status` being an `event` is the clearest example — changing it opens
the family, nominee and insurance steps, because a marriage changes who your
gratuity goes to.

## 3. Masking is done in the database, not the browser

`get_employee_profile(employee, viewer)` is the **only** way profile data
leaves the database. It resolves the viewer's role **positionally** — who you
are *to this employee*, not a title you hold — and then removes what you may
not read from the payload **entirely**, rather than blanking it. Nothing
sensitive travels and is merely hidden.

| Viewer | Sees |
|---|---|
| `self` | everything except full PAN and passport |
| `manager` | the above, minus Aadhaar, bank, addresses, family names, date of birth |
| `hr` | everything |
| `peer` | name, code, designation, department, reporting line — and pay never |

Role comes from `ess_user_roles` joined to `ess_roles`. The original read an
`employee_roles` table that does not exist here, which would have created
cleanly and failed at the first call.

## 4. The ID card, and what the QR actually protects

The QR carries a **signed token and nothing else** — no name, no code, no PII.

- A token lives **30 seconds**; the screen rotates every **15**, so there is
  always a live overlap and a guard never reads a dead code.
- Each token has a `jti` and is scannable **once**. A screenshot passed to a
  friend fails on the second scan, and dies after 30 seconds regardless.
- Tokens carry `card_version`. Rotating the secret — loss, theft, exit —
  invalidates **every code ever issued**, instantly.
- Signing needs two halves: a per-employee secret in the database and the
  `ID_CARD_PEPPER` in the environment. Neither alone can forge a code.
- Leaving or suspension revokes the card automatically, by trigger.

Every attempt is written to `id_card_scans`, good or bad. A cluster of
`replayed` rows against one person means the code is being shared.

Guard side: any phone camera opens `/verify/<token>` and gets a green or red
screen. The verify response carries name, code, photo, designation and access
zones — deliberately thin, so a compromised scanner learns nothing.

## 5. What is deliberately not built

- **Offline gate verification.** Would need the device to hold a per-employee
  key. Not until a site without connectivity actually asks.
- **The approval inbox** for `profile_change_requests` — that belongs in the
  Inbox section, not here.
- **A shift field.** `shifts` does not exist in this database, so it is dropped
  rather than faked.

## 6. Two bugs found while adapting

**Every ID card would have been missing.** The original issues cards `where
coalesce(status,'active') = 'active'`. This database stores `'Active'`,
capitalised — the predicate matches nothing, the migration succeeds, and zero
cards exist. It would have surfaced when somebody held up a blank ID at a gate.

**Every change request would have failed.** `format('select %I …',
cfg.source_column)` with `source_column` holding `'employees.full_name'`
quotes the whole string as one identifier. Not a column.

Both are fixed, and both are the same species: code that reads correctly and
does nothing.

## 7. What I need from you

1. Run `091`, then `092`
2. Create the private `employee-photos` bucket
3. Set `ID_CARD_PEPPER` and `NEXT_PUBLIC_APP_URL`
4. Decide RLS on `091`'s tables — `092`'s are already locked to deny-all

`INSTRUCTIONS.txt` has the detail for each.
