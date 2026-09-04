# Profile 360 — what the drop-in module assumes, and what is actually here

**Analysed:** 4 September 2026, against the live database
**Source:** `~/Desktop/HRMS/Updated_Profile` (`EZER-Profile360.zip` + the 360 HTML)

The integration guide says "copy the folders into the repo root, keeping the
paths exactly as above". **It cannot be dropped in.** It was written against a
different schema — the same one the Wall of Fame bundle came from — and it
collides with migrations that are already applied here.

This file is the evidence, so the adaptation is a record rather than a memory.

---

## 1. The migration numbers collide

| | Module ships | This repo already has |
|---|---|---|
| `085` | `085_profile_360.sql` | `085_wall_of_fame_seed.sql` |
| `086` | `086_id_card_qr.sql` | `086_shoutouts_and_feed.sql` |

Renumbered to **`091_profile_360.sql`** and **`092_id_card_qr.sql`**. `090` is
the Fun Zone. This is the third time this has happened — `055→066` for the PMS
and the same family of renames for the wall — so it is a property of where
these bundles come from, not an accident.

---

## 2. Four tables the module reads do not exist

Confirmed by `SELECT`, which returns an explicit `PGRST205`:

`employee_roles` · `shifts` · `branches` · `employee_assets`

> **An instrument note.** A `head: true` count request returned **200 with a
> null count** for all four — it looked like "present, 0 rows". Only a real
> `SELECT` reports the error. Anything built on the count probe would have
> concluded these tables were fine.

`employee_roles` is the serious one: `get_employee_profile()` resolves the
viewer's role from it, so the RPC would create cleanly and then fail at the
first call. Roles here live in **`ess_user_roles` + `ess_roles`**.

`branches` → **`locations`**. `shifts` has no equivalent; the shift field is
dropped rather than faked.

---

## 3. Fourteen columns are renames

Every one verified present under its real name:

| Module assumes | Actually |
|---|---|
| `employees.employee_code` | `emp_code` |
| `employees.date_of_joining` | `company_doj` |
| `employees.reports_to_l1` / `_l2` | `l1_manager_id` / `l2_manager_id` |
| `employees.official_email` | `office_email` |
| `employees.alt_mobile` | `alternate_mobile` |
| `employees.pan` | `pan_number` |
| `employees.uan` | `uan_number` |
| `employees.ifsc` | `ifsc_code` |
| `employees.esic_ip_number` | `esic_number` |
| `employees.bank_last4` | `bank_account_last4` |
| `employees.status` | `employment_status` |
| `employees.present_address` | `res_address1` |
| `employees.permanent_address` | `perm_address1` |
| `departments.name` · `companies.name` · `locations.name` | `dept_name` · `company_name` · `location_name` |

`departments.name` is the one that has already cost this project a bug: asking
for it fails the whole select, and every department silently rendered as
"Unknown".

---

## 4. Thirteen columns genuinely do not exist

Neither present under another name, nor added by the module's own migration:

`attendance_mode` · `auth_user_id` · `bank_holder_name` · `driving_licence` ·
`extension` · `is_disabled` · `md_id` · `passport_no` · `payment_mode` ·
`pf_number` · `probation_months` · `pt_state` · `weekly_off`

The adapted migration adds them. Two exceptions:

- **`md_id`** is not added. The MD is already recorded at company level as
  `companies.md_employee_id`, which the PMS chain resolution uses. A
  per-employee copy would be a second source of truth for the same fact.
- **`auth_user_id`** is not added, because this app does not resolve viewers
  that way — see §5.

For scale: the module assumes 41 columns this database does not have under
those names. Its own migration supplies 14 of them. `employees` here has
**217 columns** — it is richer than the module expects, not poorer.

---

## 5. The viewer is resolved by this app's session, not the module's

`getViewerId()` reads a Supabase auth cookie, maps it to
`employees.auth_user_id`, and **falls back to an `x-employee-code` header or an
`ezer_emp` cookie**. The guide says:

> *"Delete the fallback block before go-live — with it in place, anyone can set
> a header and read any profile."*

It is not carried over at all. `auth_user_id` does not exist here, and this app
already has a session layer — `essRoute()` — that every other ESS route uses.
Wiring the profile to anything else would mean two answers to "who is asking",
and the weaker one would be the one an attacker picked.

---

## 6. The design has eight tabs; the module builds four

`buildTabs()` returns **personal, job, statutory, payroll**. The HTML design
also has **overview, time, growth, records**, and §11 of the guide says so
plainly: family, nominee, insurance, documents, assets, education, experience,
PMS and exit are *fetched* by the RPC and sit unused in the payload.

So the missing four tabs are a rendering job against data that is already
there — no further schema work.

---

## 7. What the field `state` means

The design's real idea, and worth keeping exactly:

| State | Means |
|---|---|
| `locked` | Read only. Changing it is somebody else's job. |
| `direct` | Edit it yourself; saves immediately. |
| `request` | Edit raises an approval routed to HR or Payroll. |
| `event` | Opens a workflow — marital status opens family, nominee and insurance. |

Editability is data, not markup. The database copy in `profile_field_config`
drives routing; the client copy decides how a field renders. Both have to move
together, which the guide flags in §9.
