# EZER ESS — the portal as it stands

What the Employee Self-Service portal is today: its shape, how a person moves
through it, where each screen gets its data, and what is genuinely finished
versus what is scaffolding. Written from the code on branch `TusharPanwar`,
14 September 2026.

Companion docs go deeper on single modules — `INBOX-HOW-IT-WORKS.md`,
`WALL-OF-FAME-HOW-IT-WORKS.md`, `PMS-HOW-IT-WORKS.md`,
`ESS-PROFILE-HOW-IT-WORKS.md`, `FUNZONE-HOW-IT-WORKS.md`. This one is the map
they hang off.

---

## 1. It is one page, not a set of routes

```
/ess-portal  →  <EmployeePortal employeeId … />
```

Everything below the top bar is internal state. There is no `/ess-portal/leave`,
no deep link to a conversation, no browser-history entry per tab. The section
and the sub-tab are React state (`section`, `view`), and `renderView()` is a
switch over `view`.

That is a deliberate trade, and it costs something: a person cannot bookmark
"my payslips" or send somebody a link to a screen, and the back button leaves
the portal rather than going back a tab. What it buys is that switching tabs
never re-fetches or re-mounts anything that was already open — a half-written
reply, a part-filled declaration and a scrolled list all survive a detour.

**Entry.** `app/ess-portal/page.tsx` reads `localStorage['ezer_ess_session']`,
and with no `employee_id` in it redirects to `/ess-login`. Nothing renders
before that check.

---

## 2. Who is looking, and at whom

Two identities, kept apart on purpose.

| | |
|---|---|
| **The session** | Who signed in. An ESS token in `localStorage`, or a Supabase dashboard session for an admin. |
| **The subject** | Whose portal is on screen. Usually the same person. |

An employee whose ESS role carries a wider scope (`TEAM` / `DEPT` / `BRANCH` /
`ORG`) gets a **"View a team member"** band above the portal. Picking somebody
re-renders `EmployeePortal` with their id and `adminMode`, behind a dark
`<SCOPE> VIEW` banner with a way back.

This is the self-service equivalent of admin "login as", and it is the thing
most likely to confuse a reader of this codebase: **when view-as is active,
`emp.id` is the person being viewed, not the person signed in.** Every ESS API
call carries that id as `employee_id`, and `lib/ess/session.ts` decides whether
the caller may ask for it.

The scope list comes from `lib/ess-scope.ts` (`loadAccessScope`). The API never
trusts it — `essRoute()` resolves the caller from the session and re-checks the
`employee_id` on every request.

---

## 3. Navigation

### 3.1 The employee's own sections

`SECTIONS` in `EmployeePortal.tsx`, in order, with the readiness each one
declares:

| Section | Sub-tabs | State |
|---|---|---|
| **Home** | — | ready |
| **Profile** | My Details · Letter Requests · My Letters | ready |
| **Team** | — | ready |
| **Org Chart** | — | ready |
| **Payroll** | Salary Slip · Flexi Benefits · Declaration · Investment Proofs · Flexi Claims · Voluntary PF · Corporate NPS · Loans · Travel Claims · Statutory | **partial** |
| **Attendance** | — | ready |
| **Leave** | — | ready |
| **Inbox** | — | ready |
| **HRIS** | Team Directory · Raise a Request · Tasks & Approvals · Exit Process | **partial** |
| **Company** | — | ready, role-gated |
| **Reports** | — | ready, role-gated |
| **Performance** | — | ready |
| **Wall of Fame** | — | ready |
| **RNR** | — | **soon** — feature grid only, nothing behind it |
| **Fun Zone** | — | ready |

`status` drives a coloured dot in the rail and a badge in the section header:
`ready` → *Available*, `partial` → *Partly available*, `soon` → *Coming soon*.
Sub-tabs carrying `phase` / `needs` (Salary Slip, Statutory) render as blocked
with the reason, rather than as a link to nothing.

A section with one item draws no sub-tab pill row.

**Inbox is top-level, not a sub-tab of HRIS.** It is opened many times a day,
and a level down is what sends people back to the bell instead.

### 3.2 Role gating

Only two sections are conditional:

```tsx
SECTIONS.filter(s => s.k === 'company' ? essMenu.can.company
                   : s.k === 'reports' ? essMenu.can.reports : true)
```

`essMenu` is `GET /api/ess/menu`, which returns the nav **as data** — tabs,
`is_rm`, `is_hod`, `approval_types`, the modules the person holds, and
`can.{approvals,company,reports}`. It is a convenience for the UI and never the
authorization; every route re-checks independently.

Tasks & Approvals appears only when the menu says the login can approve —
decided from org data and the RMS grant, never by comparing a role name in the
component.

### 3.3 "What you manage"

Admins carry a second, different kind of entry: the dashboard modules they
administer. Those do **not** go in the employee's vertical rail — thirteen
personal entries plus up to twenty-five module entries is a scrolling problem,
not a menu. They become grouped dropdowns in a band across the top, and picking
one renders the real dashboard page through `<AdminModuleHost>` with no wrapper
of the portal's around it.

### 3.4 Mobile

Four sections get the thumb bar — Home, Payroll, Attendance, Leave. Everything
else lives under **More**.

---

## 4. Layout

```
┌─ view-as band ──────────────────────────── (only when scoped) ─┐
├─ top bar: logo · "What you manage" menus · bell · person · Close ─┤
│                                                                │
│  ┌ rail ────────┐  ┌ content ─────────────────────────────────┐ │
│  │ Home       ● │  │  TabHeader: icon, label, status badge    │ │
│  │ Profile    ● │  │  SubTabs (only when >1 item)             │ │
│  │ Team       ● │  │                                          │ │
│  │ Payroll    ◐ │  │  renderView()                            │ │
│  │ …            │  │                                          │ │
│  └──────────────┘  └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

Content is capped at **1100 px** with 18/22 px padding — except the Inbox,
which is full-bleed. It is three panes that fill the viewport and scroll
independently; capping it would put it into its own narrow breakpoint on every
desktop. Only its header band keeps the standard measure.

The notification bell shows a **9+** cap. Its count is notifications plus the
Inbox's own unread, and those two deliberately do not overlap:
`inbox_unread_count` excludes what `ess_notifications` already counts, so
nothing is counted twice. A failing inbox call leaves the notification count
standing rather than zeroing the badge.

---

## 5. The design system

Nothing in ESS picks a colour. Every value is a token.

- **`lib/ui/tokens.ts`** exports `C` (colour), `F` (type scale), `W` (weights),
  `S` (spacing), `R` (radii), `E` (easing). Each entry resolves to a CSS custom
  property, not a hex literal.
- **`lib/ui/theme.css`** defines those properties for light and dark. One
  attribute on `<html>` repaints every screen.
- **Contrast is measured, not eyeballed.** Text tokens clear WCAG AA against
  both the white cards and the canvas in each theme. `onAccent` exists because
  white on the brand fill falls to 2.5:1 once the blue lightens in dark mode.

**Type.** DM Sans throughout; Fraunces (`--ezt-serif`) for a deliberately short
list of moments — the Today greeting, the Inbox thread title, catch-up
greeting, empty-state headings and the compose sheet title. Both are loaded in
`app/layout.tsx` via `next/font` and exposed as variables.

**Three global layers**, all mounted in the root layout:

| | |
|---|---|
| `UiScale` | Auto-fits the whole app by width via CSS `zoom` on `<html>`, snapped to 1.0 / 1.25 / 1.5 so 1px rules and icon strokes stay on the pixel grid. |
| `EyeComfort` | A warmth/dim overlay with its own dock. |
| `ThemeToggle` | light / dark / auto, with a boot script in `<head>` so there is no flash. |

`UiScale` is worth knowing about before debugging any layout: `zoom` scales the
used value of every length, **including viewport units**, so `height:100dvh`
paints 125% of the viewport at the 1.25 step. The Inbox measures its height in
JS and divides by the zoom for exactly this reason.

Scoped stylesheets follow one convention — everything under a single class:
`.ezt` (Today), `.ib` (Inbox), `.wof` (Wall).

---

## 6. Where each screen gets its data

Two patterns, and which one a screen uses is a security decision, not a
stylistic one.

**Through `/api/ess/*`** — the server resolves the caller from the session with
`essRoute()` and uses the service-role client. Used wherever the data is
private. The browser holds the anon key, so a row it can read is a row anybody
can read.

**Direct Supabase from the browser** — used where RLS already scopes the read:
Wall of Fame, Fun Zone, Broadcasts. These carry their own not-installed
handling, because a missing table comes back as `PGRST205` rather than an error
the user should see.

### The ESS API surface

```
announcements   celebrations    company        funzone
home            id-card/token   inbox          inbox/directory
inbox/messages  loans           loans/agreement  menu
notifications   nps             preferences    profile
profile/requests  punch         reports        resignation
session         team            today          vpf
wall            approvals
```

Every browser call carries the `Authorization` header built by
`lib/auth-headers.ts` — which checks the ESS session **and** the Supabase one,
and refreshes a token that is about to expire rather than sending it. It is
`async`; calling it without `await` sends a Promise as the header value and
every request 401s from somebody who is, in fact, signed in.

`employee_id` rides along on every call because the shared dashboard login has
no employee of its own.

---

## 7. The sections in more detail

### Home (`components/ess/today/`)
The landing dashboard, scoped under `.ezt`. Hero panel, punch dial, week strip,
stat tiles, pending list, quick actions, announcements, celebrations, holiday
card, recognition card, team-today, journey. `onOpenTab` lets a card switch the
portal to another section, which is why Home is a navigation surface as much as
a summary.

### Profile
`Profile360` renders by employee **code**, and the route decides what to mask
from who is looking — an admin opening a colleague's portal sees that
colleague's profile with a colleague's visibility, not their own. Letter
requests and issued letters sit alongside.

### Payroll — *partly available*
Flexi benefits, investment declaration and proofs, flexi claims, VPF, NPS,
loans and travel claims are all live. **Salary Slip and Statutory are blocked
on payroll generation** and say so rather than linking to an empty screen.

### Attendance / Leave
Attendance summarises present / absent / half-day / late / overtime / loss of
pay from the punch record. Leave applies, tracks and plans.

### Inbox
Three groups — Messages, Wall of Fame, Broadcasts — each with its own unread
badge. **The counts are never summed**; only the Messages count reaches the
bell. Three panes: folders that answer "who is this from?", the conversation
list, and the thread. Polled every 20 s, never pushed. See
`INBOX-HOW-IT-WORKS.md`.

### HRIS — *partly available*
Directory, Raise a Request (a fixed catalogue including a confidential POSH
route assigned to the IC), Tasks & Approvals (role-gated), Exit Process.

### Performance
One section, three audiences. Everyone gets My KRAs; managers additionally get
My Team; HODs get Department. The component decides from org data.

### Wall of Fame
Shoutouts, awards, badges, service milestones. Thanks, never pay. Carries its
own admin console for Awards, Values, Badges, Screens, Administrators and Audit
— **read-only**; it reports permissions but writes nothing.

### Fun Zone
Games with colleagues, scoped to your own company.

### RNR — *coming soon*
A feature grid only: Nominate, Approval, Points, Redeem, Leaderboard. Nothing
behind it.

---

## 8. Current state, honestly

**Solid.** Home, Profile, Team, Org Chart, Attendance, Leave, Inbox,
Performance, Wall of Fame, Fun Zone. Tokenised throughout, light and dark, and
the role gating is driven by data rather than role-name comparisons.

**Partial, and saying so.** Payroll (Salary Slip, Statutory) and HRIS. The UI
names what is missing instead of failing.

**Not built.** RNR.

**Known rough edges**

- **No deep links.** One page means no shareable URL for any screen, and the
  back button exits the portal. Worth revisiting if people start sending each
  other links to their payslips.
- **`EmployeePortal.tsx` is 3,964 lines** and holds the shell, the nav, and a
  dozen section components inline. The newer work (Today, Inbox) lives in its
  own folder; the older sections have not been pulled out.
- **Two "Performance" things.** The PMS section, and a Wall of Fame badge
  grouping in `lib/wall/catalogue.ts`. Unrelated, similarly named.
- **Migration 115 is written and not applied** — it retires the Performance
  *shoutout category*. Until Nayan runs it the category is still in the picker.

**Migrations.** 119 files, `0001` → `115`. `088_broadcast_channel.sql` is in
the tree; Broadcasts renders "Not switched on yet" with the reason while it is
unapplied, which is a state to render rather than an error to swallow.

---

## 9. Conventions worth keeping

1. **Absent is not broken.** A missing table renders an explanation and the
   reason, never an error toast.
2. **Counts are never summed** across kinds of unread. One number for workflow
   and appreciation is how the appreciation goes unread.
3. **The UI never authorizes.** `/api/ess/menu` shapes the nav; every route
   re-checks.
4. **Never read private tables from the browser.** The anon key is in every
   page load.
5. **No colour is chosen in a component.** Tokens only.
6. **Errors say what happened and what to do.** Sentence case, active verbs, no
   "Oops".
