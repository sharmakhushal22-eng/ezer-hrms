# 02 — Attendance & Leave (ESS employee screens) — functional spec for the React Native rebuild

Source of truth (all read in full for this spec):

| Area | File |
|---|---|
| Attendance screen (portal section `attendance`) | `components/ess/EmployeePortal.tsx` lines ~1357–2362 (`AttendanceModule` at 2256 and its sub-components) |
| Attendance log (list + bulk regularisation) | `components/ess/attendance/AttendanceLog.tsx` (471 lines) |
| Attendance client data layer | `lib/supabase-attendance.ts` (161 lines) |
| Attendance API | `app/api/ess/attendance/route.ts` (GET / POST / PATCH) |
| Punch API | `app/api/ess/punch/route.ts` + `lib/attendance/punch.ts` |
| Leave screen (portal section `leave`) | `components/ess/LeaveSection.tsx` (2234 lines; lines 981–2234 are a scoped CSS string) |
| Leave API | `app/api/ess/leave/route.ts` (669 lines, GET / POST / PATCH) |
| Leave/attendance decisions (approve, decline, cancel, regularise) | `lib/leave/workflow.ts` |
| Balances | `lib/leave/ledger.ts`, `lib/leave/policy.ts`, `lib/leave/accrual.ts`, `lib/ess/leave-year.ts` |
| Notifications / formatters | `lib/leave/notify.ts` |
| Manager queue for leave / corrections | `app/api/ess/approvals/route.ts`, `lib/ess/pending.ts` |
| Auth plumbing | `lib/ess/api.ts`, `lib/auth-headers.ts`, `lib/ess-session-client.ts`, `lib/rms/client.ts`, `lib/ess/session.ts`, `lib/ess/asked.ts`, `lib/api-auth.ts` |

Things that **do not exist** anywhere in this product and must not be invented: WFH requests, on-duty requests, leave attachments / medical certificates (the `leave_types.doc_required_after` column exists but nothing reads it), a "contact during leave" field, a comp-off earning screen, a leave-encashment request flow, a separate "missed punch" request type (missed punches are fixed through regularisation), team attendance / team leave calendars on these screens. Managers approve leave and corrections in **Tasks & Approvals**, not on the Leave or Attendance screen (contract summarised in §9).

---

## 0. Conventions used by every call in this spec

### 0.1 Auth and the `api()` helper

`lib/ess/api.ts`:

```ts
export async function api(path: string, employeeId: string, init?: RequestInit) {
  const token = await authToken()                     // lib/rms/client.ts
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, body })
  return body
}
```

* Every call: `Content-Type: application/json`, `Authorization: Bearer <ESS token>`, `?employee_id=<own employee id>` appended, `cache: no-store`.
* On non-2xx it throws an `Error` whose `.message` is `body.error` (or `HTTP <status>`), with `.status` and the whole parsed `.body` attached. **The leave 409 relies on `.body`** (§7.4). The RN client must keep that behaviour.
* `authToken()` = ESS token from `localStorage['ezer_ess_session']` (JSON `{ token, ... }`; token is `<base64url payload>.<sig>`, payload has `exp` in **milliseconds**; treated as absent when `Date.now() + 30_000 >= exp`), else the Supabase session access token. RN: store the token from `/api/ess-auth/login` in SecureStore and apply the same expiry check.
* Server identity (`lib/ess/session.ts` `essCaller`): the token names the employee. `employee_id` (query, or JSON body for non-GET) equal to your own id (or absent) = normal. A different id → `403 {"error":"You can only open your own portal."}` unless the caller holds admin access (then "view as", and every write in this spec is refused — see each route).
* Auth errors (`lib/api-auth.ts`): no bearer → `401 {"error":"Sign in first. This endpoint needs a dashboard session."}`; invalid/expired → `401 {"error":"Your session has expired. Sign in again."}`.
* `essRoute` also calls the `ess_menu` RPC; if it fails twice → `500 {"error":"ess_menu: <msg>. Has migration 071 been run?"}`.

### 0.2 The portal toast (`notify`)

Leave uses the portal's `notify(msg, type='success'|'error')`: a single toast slot, shown for 3000 ms; a second `notify` replaces the first. Attendance does not use it (messages are inline).

### 0.3 Dates and time zones

* All `YYYY-MM-DD` values are IST calendar dates. The server's "today" is `new Date(Date.now()+5.5h).toISOString().slice(0,10)`.
* The web clients compute their own "today" from the **device local date** (`getFullYear/getMonth/getDate`), assuming the device is in India. RN must do the same (or force Asia/Kolkata).
* Timestamps (`work_in`, `work_out`, `punch_time`, `recorded_in`…) are ISO timestamptz. Display formats are listed per widget.

### 0.4 Design tokens → hex (RN cannot use the CSS variables `C.*` resolve to)

`lib/ui/tokens.ts` `C.*` are `var(--ez-*)` strings defined in `lib/ui/theme.css`. Values:

| Token | Light | Dark |
|---|---|---|
| `C.ink` | `#111827` | `#F3F4F6` |
| `C.inkSoft` | `#374151` | `#D1D5DB` |
| `C.muted` | `#4B5563` | `#9CA3AF` |
| `C.faint` | `#626D80` | `#828C9B` |
| `C.brand` | `#2563EB` | `#60A5FA` |
| `C.brandDeep` | `#1D4ED8` | `#93C5FD` |
| `C.brandTint` | `#EFF6FF` | `#172033` |
| `C.brandEdge` | `#BFDBFE` | `#24344F` |
| `C.onAccent` | `#FFFFFF` | `#0D1117` |
| `C.surface` | `#FFFFFF` | `#171B21` |
| `C.canvas` | `#F3F5F8` | `#0F1216` |
| `C.sunken` | `#F3F4F6` | `#14181E` |
| `C.line` | `#E5E7EB` | `#262C35` |
| `C.lineStrong` | `#D1D5DB` | `#39414D` |
| `C.positive` / `positiveTint` | `#047857` / `#ECFDF5` | `#34D399` / `#10241D` |
| `C.warning` / `warningTint` | `#B45309` / `#FFFBEB` | `#FBBF24` / `#251C0D` |
| `C.critical` / `criticalTint` | `#C0201F` / `#FEF2F2` | `#F87171` / `#2A1414` |
| `C.info` / `infoTint` | `#0369A1` / `#F0F9FF` | `#7DD3FC` / `#10222B` |

Type scale `F`: micro 11, tiny 12, small 13, body 14, lead 15; weights `W`: 400/500/600/700; radius `R`: sm 7, md 10, lg 14, xl 20, pill 999; spacing `S`: xs 4, sm 8, md 12, lg 16, xl 24. `eyebrow` = 11px, 700, letterSpacing .09em, uppercase, `C.muted`. Font "DM Sans".

---

## 1. Navigation, visibility, deep links

* Portal sections (`EmployeePortal.tsx` `SECTIONS`): `attendance` ("Attendance", desc "Your punches, working hours and monthly calendar", one item, no sub-tab row) and `leave` ("Leave", desc "Apply for leave, track your requests and plan around holidays", one item). Both are in the rail group **"Time & pay"** (order: attendance, leave, payroll, expenses) and are two of the four mobile thumb-bar entries (`MOBILE_PRIMARY = ['home','payroll','attendance','leave']`).
* Always visible to every ESS employee (only `company` and `reports` are filtered by role).
* Web URLs: `/ess/attendance`, `/ess/leave`; legacy `/ess?tab=attendance`, `/ess?tab=leave` (parsed by `lib/ess/routes.ts` `parseEssPath`, which is pure and client-safe).
* Links the server puts on bell notifications / e-mails (`lib/leave/notify.ts` `portalUrl`, `link:` fields in `workflow.ts` and the leave route): `/ess?tab=leave`, `/ess?tab=attendance`, `/ess?tab=approvals`; e-mails use `${NEXT_PUBLIC_APP_URL}/ess?tab=<tab>`. RN must route all three (approvals = Tasks & Approvals).
* "View as" (admin opening someone else's portal): reads work; every write here returns 403 with the messages quoted per route.

---

## 2. Attendance screen — overall layout (`AttendanceModule`)

`isMobile = window.innerWidth < 1024` (re-evaluated on resize). `todayStr` = device-local `YYYY-MM-DD`.

State: `month` (1–12) and `year` (start = current), `monthData`, `regs` (regularisation requests), `selectedDate`, `raiseDate`, `loading`, `withdrawing`.

Data loads on mount and whenever month/year changes:

1. **Month**: `loadMonthlyAttendance(emp.id, year, month)` → `GET /api/ess/attendance?month=YYYY-MM` (§4.1). No `.catch`: on failure the shimmer stays forever (web bug; RN should show an error + retry, but must not invent different copy for success states).
2. **Requests**: `GET /api/ess/attendance` (no params → current month) and only `regularisations` is kept; on error `regs = []`.

Sections, top to bottom:

* (A) `MonthHero` — month name, navigation, attendance ring.
* (B) `AttendanceSummaryChips` — 7 stat tiles.
* (C+D) side by side on desktop (wrap on mobile): calendar card (`AttendanceCalendar`, inside a decorative 3D `TiltCard`, tilt disabled on mobile) and the right panel: `DayDetailPanel` when a day is selected, otherwise `DayPanelResting` (donut).
* (E) `RegularisationForm` — only while `raiseDate` is set.
* (F) `AttendanceLog` — collapsed card; expands to the day-by-day list (§3).
* (G) `RegularisationList` — "My Regularisation Requests".

Month navigation: ‹ prev / › next (wrap year), "Today" button only when not on the current month. Every navigation clears `selectedDate` and `raiseDate`.

Loading state of the calendar: a 7-column grid of 35 shimmer cells (60 px wide, height 40 mobile / 56 desktop, radius 10, `C.brandTint`).

### 2.1 The day vocabulary (shared by calendar, list, week strip)

The server decides each day's `kind` (§4.1). The calendar maps it to a **status** via `resolveDay()` (`lib/supabase-attendance.ts`):

```ts
const k = day?.kind ?? (dateStr > todayStr ? 'UPCOMING' : 'ABSENT')
const status = k === 'UPCOMING' ? (dateStr === todayStr ? 'TODAY' : 'FUTURE') : k === 'LEAVE' ? 'ON_LEAVE' : k
// holiday returned only when k==='HOLIDAY'; leave only when k is LEAVE or HALF_LEAVE
```

`KIND_META` (`AttendanceLog.tsx`, exported; label, code, fg, bg, bar):

| kind | label | code | fg | bg | bar (dot/accent) |
|---|---|---|---|---|---|
| PRESENT | Present | P | positive | positiveTint | positive |
| LATE | Late | LT | warning | positiveTint | positive |
| HALF_DAY | Half day | ½ | warning | warningTint | warning |
| MISS_IN | Missed punch-in | MI | critical | warningTint | critical |
| MISS_OUT | Missed punch-out | MO | critical | warningTint | critical |
| IN_PROGRESS | At work now | ● | info | infoTint | info |
| ABSENT | Absent | A | critical | criticalTint | critical |
| LEAVE | Leave | L | brandDeep | brandTint | brand |
| HALF_LEAVE | Half-day leave | ½L | brandDeep | brandTint | brand |
| HOLIDAY | Holiday | H | info | infoTint | info |
| WEEKLY_OFF | Weekly off | WO | faint | sunken | lineStrong |
| UPCOMING | — | (empty) | faint | transparent | line |

Calendar-only aliases: `ON_LEAVE→LEAVE`, `FUTURE→UPCOMING`, `MISS_PUNCH→MISS_OUT`. Calendar cell fill/ink (`STATUS_STYLE`, [background, ink]):

| status | bg | ink |
|---|---|---|
| PRESENT | sunken | positive |
| LATE | sunken | warning |
| IN_PROGRESS | infoTint | info |
| HALF_DAY | warningTint | warning |
| MISS_IN / MISS_OUT / MISS_PUNCH | warningTint | critical |
| ABSENT / LWP | criticalTint | critical |
| WEEKLY_OFF | sunken | faint |
| HOLIDAY | infoTint | info |
| ON_LEAVE / HALF_LEAVE | brandTint | brandDeep |
| FUTURE | transparent | lineStrong |
| TODAY | canvas | brand |
| (anything else) | brandTint | brandDeep |

`STATUS_BAR[s]` = `KIND_META[alias(s)].bar` (LWP → critical; unknown → line). `STATUS_FULL[s]` = KIND_META label, except LWP "Loss of pay", FUTURE "—", TODAY "Today, not in yet". `STATUS_LABEL[s]` = KIND_META code (LWP "LWP"; TODAY → ""). Note: `LWP` never comes from the server; it is dead vocabulary that the tiles still reference.

`StatusBadge`: pill (fontSize 10, padding 2×9, radius 99, weight 600) with bg/ink from STATUS_STYLE, 6 px dot in STATUS_BAR, text STATUS_FULL.

`KindBadge` (list): pill with `m.bg`/`m.fg`, 6 px dot `m.bar`, text `label` + extra: LEAVE/HALF_LEAVE → ` · {leave.short_name}`; LATE with late_minutes → ` · {n}m`; HOLIDAY with note and not compact → ` · {note}`. Border `1px solid C.line` only for UPCOMING, else transparent.

### 2.2 `MonthHero`

* Row: ‹ (title "Previous month"), `"{MonthName} {year}"` (year in `C.faint`, 500), › (title "Next month"), and "Today" when not on the current month. Nav buttons 32×32, radius 10, border `C.line`, bg `C.surface`.
* Line: `"{working} working day{s} · {present} present, {absent} absent"` when `working > 0`, else `"No working days recorded yet"`.
* If overtime ≠ `0h 0m`: `"⏱ {Xh Ym} overtime this month"` in `C.positive`.
* Ring (82 px desktop / 68 mobile, stroke 7, track `C.line`): arc = pct; colour: pct null → faint; ≥95 positive; ≥85 warning; else critical. Centre `"{pct}%"` or `"-"`, caption "ATTENDANCE".

### 2.3 Month statistics — `monthStats(year, month, md, todayStr)` (client-side, NOT the server `summary`)

Walks every date of the month **up to and including today** (future skipped), `resolveDay` each:

```
if rec?.late_minutes  → lateCount++          (rec exists only when the day has work_in or work_out)
if rec?.overtime_minutes → ot += minutes
PRESENT | LATE | IN_PROGRESS → present++
HALF_DAY → halfDay++
MISS_IN | MISS_OUT → missPunch++ AND present++
LWP → lop++            (never happens with current server)
ABSENT → absent++
ON_LEAVE | HALF_LEAVE → onLeave++
WEEKLY_OFF, HOLIDAY, TODAY → nothing
working = present + absent + halfDay + lop
pct     = working > 0 ? round((present + 0.5*halfDay) / working * 100) : null
totalOTHours = `${floor(ot/60)}h ${ot%60}m`
```

Returns `{ present, absent, halfDay, lateCount, lopDays, missPunch, onLeave, totalOTHours, working, pct }`. When monthData is null all zero, pct null. RN must replicate this exactly (the server's `summary` counts differently — e.g. it includes future/upcoming and maps HALF_DAY to LATE — and is not used by the web screen). This function is pure; it lives inside the component file, so copy it.

### 2.4 `AttendanceSummaryChips` (7 tiles)

Order and source; colours `[bg, fg] = STATUS_STYLE[k]`, accent bar `STATUS_BAR[k]`:

| Label | Value | k |
|---|---|---|
| Present | present | PRESENT |
| Absent | absent | ABSENT |
| Half day | halfDay | HALF_DAY |
| Missed punch (wide) | missPunch | MISS_OUT |
| Late | lateCount | LATE |
| Overtime (wide) | totalOTHours | ON_LEAVE |
| Loss of pay | lopDays | LWP |

Tile: radius 10, padding 10×13, 3 px left accent bar, value 21px/700, label 10px/600 uppercase. A zero (`"0"` or `"0h 0m"`) tile is greyed: bg sunken, border line, bar line, text `C.faint`. Layout: mobile 3-column grid gap 8; desktop wrapping row.

### 2.5 `AttendanceCalendar`

* Header row: weekdays `Sun…Sat`; desktop shows two letters (`Su`, `Mo`…), mobile one. A weekday is coloured `C.brand` if any date of `monthData.weekoffSet` (this month's weekly offs) falls on it, else `C.muted`.
* Grid: 7 columns, gap 4, leading blanks = weekday of the 1st (Sunday-first). Cell height 40 mobile / 56 desktop; grid max width 444 px desktop, 100% mobile.
* Cell per date: `{status, rec, leave, day} = resolveDay(...)`.
  * Background: selected → gradient brand→brandDeep; FUTURE → transparent; else STATUS_STYLE bg. Text: selected → onAccent; else STATUS_STYLE ink.
  * Border: selected `1px brandDeep`; today `2px brand`; else `1px line`. Radius 10. FUTURE opacity .45.
  * Content: day number (12 mobile/13 desktop; 800 weight on today); below it the code (8/9 px, 800) in STATUS_BAR colour (onAccent when selected), not shown for FUTURE or empty code. Code = for ON_LEAVE/HALF_LEAVE `leave.short_name || code`, else `STATUS_LABEL[status]`.
  * Top-left marker: amber 5 px dot (`C.warning`) if `day.correction.status === 'PENDING'`; else a "✓" (8px, `C.positive`, onAccent if selected) if `day.regularised || day.correction.status === 'APPROVED'`.
  * Top-right 4 px brand dot on today when not selected.
  * Tooltip/long-press text: `"{STATUS_FULL}[ · in HH:mm][ · out HH:mm][ · {late}m late][ · correction pending | · regularised]"` (HH:mm = `fmtT`, below).
  * FUTURE cells disabled. Tapping any other cell (TODAY included) sets `selectedDate` and clears `raiseDate`.
* Legend under the grid (border-top `C.brandEdge`): for PRESENT, LATE, HALF_DAY, MISS_IN, MISS_OUT, ABSENT, ON_LEAVE, HOLIDAY, WEEKLY_OFF → code (or "•") in STATUS_BAR colour + STATUS_FULL; then amber dot "Correction pending"; then green "✓" "Regularised".

`fmtT(iso)` = `new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false})` (device time zone), `'-'` for null.

### 2.6 `DayPanelResting` (no day selected)

Card titled "THIS MONTH SO FAR" (11px/700 muted uppercase). Donut 168 px (r 66, stroke 18, track sunken) with slices in this order:

| Label | Value | Colour |
|---|---|---|
| Present | max(0, present − missPunch) | STATUS_BAR.PRESENT (positive) |
| Missed punch | missPunch | critical mixed 50% with surface (lighter red) |
| Half day | halfDay | warning |
| Absent | absent + lopDays | critical |
| On leave | onLeave | brand |

Slice length = value/total × circumference, minus a 2.5 gap; nothing drawn when total 0. Centre: `"{pct}%"` or `"–"`, caption "attendance". Below: 2-column list of the five rows (9 px swatch, opacity .35 when 0; label inkSoft 12; value 13/700, faint when 0). Footer: "**Pick a day** on the calendar to see its punches, hours and status."

### 2.7 `DayDetailPanel` (a day selected)

Inputs: the resolved day, and `correction` = the latest non-CANCELLED regularisation for that date from `regs` (map built by first occurrence in `regs`, which is newest-first), falling back to `day.correction` from the month payload.

Layout:
1. Heading `toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short',year:'numeric'})` + `StatusBadge`.
2. If holiday (only when kind HOLIDAY): `"🎌 {description}"` + `" (Optional)"` if `is_optional` (brand on brandTint).
3. If status WEEKLY_OFF: "Weekly Off" (faint on sunken).
4. If leave (LEAVE or HALF_LEAVE): `"On Leave — {leave.name}"` + for half day `" (Half day[, {half_session} half])"` (brandDeep on brandTint).
5. MISS_IN: "No punch-in was recorded for this day. Raise a regularisation with the right time." MISS_OUT: "No punch-out was recorded for this day. Raise a regularisation with the right time." (critical on warningTint).
6. HALF_DAY: "Marked half day — the first punch came after the shift's last allowed punch-in time." (warning on warningTint).
7. If `day.expected_in` and status not HOLIDAY/WEEKLY_OFF/ON_LEAVE: `"Shift {shift_code} · expected {expected_in}–{expected_out}"` (11.5 muted).
8. If a record exists (work_in or work_out present): grid (2 cols mobile, 4 desktop) of: In `fmtT(work_in)`, Out `fmtT(work_out)`, Worked `"{h}h {m}m"` from total_minutes (or "—"), Late `"{late_minutes||0}m"`, OT `"{overtime_minutes||0}m"`.
9. "PUNCH TIMELINE" heading; "Loading punches…" → "No raw punches recorded." or one row per punch: time `fmtT(punch_time)`, pill IN (positive on positiveTint) / OUT (critical on criticalTint), `source || '-'` (muted), `geofence_status` right-aligned (faint) when present.
   **Direct Supabase read (bypasses the API)** — `loadDayPunches(empId, date)`:
   ```ts
   supabase.from('attendance_punches')
     .select('punch_time, punch_type, source, geofence_status')
     .eq('employee_id', empId).eq('punch_date', date).order('punch_time', { ascending: true })
   ```
   RN should instead call `GET /api/ess/attendance?from=D&to=D&date=D` and read `day_punches` (same columns, same order — §4.1).
10. If `rec.regularized_at`: "Corrected through an approved regularisation." (positive on positiveTint).
11. If correction PENDING: `"Correction to {in}–{out} is waiting on {waiting_on.name || 'HR'}[ ({waiting_on.role})]."` (warning).
12. If correction REJECTED: `"Your correction was declined[ by {decided_by}]" + (review_remark ? ": {review_remark}" : ".")` (critical).
13. **Raise button** when `date < todayStr` AND status ∈ {MISS_IN, MISS_OUT, ABSENT, HALF_DAY, LATE, HALF_LEAVE} AND not `rec.regularized_at` AND correction status ∉ {PENDING, APPROVED}. Label "Raise again" if correction REJECTED, else "Raise regularisation". Primary button with background `C.warning`. Tap → `raiseDate = date` (shows §2.8).

### 2.8 `RegularisationForm` (single day, from the day panel)

Card titled "RAISE REGULARISATION". Fields (2-column grid):
* "Attendance date * (past dates only)" — read-only text `toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})` (the `editable` variant with a date input, `max` = yesterday, is never used).
* "Recorded IN" / "Recorded OUT" — read-only, `fmtT(rec.work_in)` or "Not recorded".
* "Actual IN *" / "Actual OUT *" — time pickers (HH:mm). Defaults: recorded time (via fmtT) → else the shift's `expected_in`/`expected_out` for that day (`monthData.dayMap.get(date)`) → else `09:00` / `18:00`.
* "Reason *" — single-line text, placeholder "Why was the punch missed?".
* Buttons: "Cancel" (outline; clears raiseDate) and "Submit request" ("Submitting…" while busy).

Client validation (in order, inline red text):
* no date → "Select the attendance date"
* `date >= today` → "Regularisation is allowed only for past dates, not the current day or future."
* missing time → "Enter both actual IN and OUT times"
* `in >= out` (string compare) → "Actual IN must be before Actual OUT"
* empty reason → "Reason is required"

Submit: `POST /api/ess/attendance` body `{ "date": "YYYY-MM-DD", "requested_in": "HH:mm", "requested_out": "HH:mm", "reason": "<trimmed>" }`.
Success: message `"Sent to {waiting_on.name} ({waiting_on.role}) for approval"` or `"Submitted — no approver is set for you, so HR will see it"`, then immediately `onDone` → reload requests + month and close the form (so on web the success line is effectively never seen). Error: server `error` shown inline (or "Could not submit").

### 2.9 `RegularisationList` — "MY REGULARISATION REQUESTS"

Source: `regs` (`regularisations` from GET — the employee's 30 most recent rows, any status, newest first, each with `waiting_on`/`decided_by`).

Grouping: one card per `(request_group || id) + status`; rows inside sorted by date; cards sorted by first row's `created_at` desc. Shows first **3** cards; if more, a dashed button `"Show all {n} requests"` / "Show fewer" (chevron rotates).

Status styles `[tint, colour]` and labels: PENDING [warningTint, warning] "PENDING"; APPROVED [positiveTint, positive] "APPROVED"; REJECTED [criticalTint, critical] "DECLINED"; CANCELLED [sunken, faint] "WITHDRAWN". Card: radius 12, border line, 3 px left border in colour, background gradient tint→surface.

Card content:
* Title: one day → `fmt(date)` ("19 Oct 2026" style, `en-IN day 2-digit month short year numeric`); several → `"{n} days · {dd Mon} – {dd Mon}"`. Status pill (surface bg, colour text and border).
* Several days: chips per day `"{dd Mon}"` plus `" · {in}–{out}"` when the group's times differ.
* One day: `"Recorded: IN {fmtT(recorded_in)|—} · OUT {fmtT(recorded_out)|—}"`.
* If all rows share times: `"Requested: {in} → {out}"` (HH:mm from the TIME string).
* Reason text.
* PENDING: `"Waiting on **{name}** · {role}"` or "No approver is set for you — HR has been shown this request."
* APPROVED / REJECTED: `"Approved — your attendance shows the corrected times"` | `"Declined"` + `" by {decided_by}"` + `" on {fmt(reviewed_at)}"` + `": “{review_remark}”"` (positive / critical).
* Footer: `"Submitted {fmtDT(created_at)}"` (`toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})`) and, for PENDING, a "Withdraw" / `"Withdraw all {n}"` button ("Withdrawing…" while busy).

Withdraw: `PATCH /api/ess/attendance` body `{ "id": "<request_group || id>" }` → reload list. Errors are swallowed silently (the list re-reads). Empty: "No regularisation requests yet."

---

## 3. Attendance log — `components/ess/attendance/AttendanceLog.tsx`

### 3.1 Collapsed state (default)
Card (radius 18, padding 18×20): title "Attendance log" (15/700), sub "Day-by-day punches, hours and status. Open it to review a range or correct several days at once." and button "View attendance log ⌄". Nothing is fetched while collapsed.

### 3.2 Expanded
Header title "Attendance log", sub "Every day in the range. Tick the days to correct — any days, they need not be in a row — and send them for approval together." Segmented range presets + "Hide log ⌃":

| Preset | Label | Range |
|---|---|---|
| week (default) | Last 7 days | today−6 … today |
| month | This month | 1st of month … today |
| last | Last month | 1st … last day of previous month |
| custom | Custom | two date inputs "From"/"To", `max = today`, default today−13 … today; hint "Up to 62 days." |

Client range errors (shown in red, no fetch): "The start date is after the end date." / "Pick at most 62 days at a time."

Fetch: `GET /api/ess/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD` (re-run on range change or after a submission/"Try again"). Fetch error: `"{message}"` + "Try again" button. Loading (no data yet): "Loading attendance…"; while a new range loads the old table dims to .6.

After each load, picked days not in range or no longer pickable are dropped.

Days are shown **newest first**.

Filter chips (only shown when count > 0, except "All"): All {days.length}, Needs attention {n}, Present, Late, Half day, Missed punch-in, Missed punch-out, Absent, Leave, Half-day leave, Weekly off, Holiday — each with its count; kind chips carry the KIND_META dot and, when active, KIND_META bg/fg/bar border. "Needs attention" = kind ∈ {ABSENT, MISS_IN, MISS_OUT, HALF_DAY, LATE} AND selectable. Empty filter: "Nothing needs correcting in this range." (Needs attention) or "No days match this filter.". Mobile: chips scroll horizontally.

`selectable(d, today)` (pure; copy it):
```
d.date >= today      → no, "Today is not over yet" | "This day has not happened yet"
HOLIDAY / WEEKLY_OFF → no, "{label} — nothing to correct"
LEAVE                → no, "On approved leave"
correction PENDING   → no, "A correction is already waiting[ on {waiting_on.name}]"
correction APPROVED or d.regularised → no, "Already regularised"
otherwise yes        (HALF_LEAVE, IN_PROGRESS-on-a-past-day, PRESENT etc. are pickable)
```

Desktop table columns: [checkbox — header checkbox selects/deselects every selectable shown row], Date (`toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})` + "TODAY" tag in brand), Shift (off-days `WO` for weekly off else `—`; otherwise `shift_code || —`), Expected in, Actual in, Expected out, Actual out, Work hours (`"{h}h {mm}m"` or "—" when null/≤0), Status (`KindBadge`), Correction.
* "off" = WEEKLY_OFF, HOLIDAY, LEAVE, UPCOMING: expected cells "—", actual cells "—" unless a punch exists.
* Actual in/out: IST `HH:mm` (`timeZone:'Asia/Kolkata'`, hour12 false). Missing value shows red "missing" when the day is MISS_IN (in cell) / MISS_OUT (out cell) and an expected time exists, else faint "—". IN_PROGRESS out cell: "at work" (info).
* Correction cell: PENDING → `"Pending[ · {waiting_on.name}]"` (warning); APPROVED or regularised → `"Regularised[ · {decided_by}]"` (positive); REJECTED → `"Declined[ · {decided_by}]"` (critical, tooltip = review_remark); else "—".
* Row tap toggles when selectable; selected row bg brandTint. Disabled checkbox tooltip = `why`.

Mobile cards: optional "Select every correctable day shown" checkbox; each day a card (3 px left border KIND_META bar; selected → border brand, bg brandTint) with checkbox, bold date, compact KindBadge, and for non-off days `"In {HH:mm|—} (exp {expected_in}) · Out {HH:mm|at work|—} (exp {expected_out}) · {hours}"`; correction line when there is one; else for non-selectable non-off days the `why` text (11px faint).

Selection bar (sticky bottom, when ≥1 picked and not reviewing): `"{n} day{s} selected"`, "Clear", "Regularise selected →" → opens Review.

### 3.3 Review panel (`ReviewPanel`)
* Title `"Regularise {n} day{s}"`; sub "Check the times for each day — recorded punches are kept, missing ones are filled from your shift. Your reporting manager approves it, and your attendance updates when they do."
* When n > 1: "Same times for all:" two time inputs (default first day's expected_in/out or 09:00/18:00) + "Apply to all".
* Per day row: date, compact KindBadge, `"recorded {in|no in} – {out|no out}"` or "no punches recorded", in → out time inputs. Default per day = `proposed(d)`: IST clock of work_in/work_out, else expected_in/out, else 09:00/18:00.
* "REASON (APPLIES TO EVERY DAY) *" textarea, 2 rows, maxLength 500, placeholder "e.g. Forgot to punch out; biometric was down; on client visit".
* Buttons: "Back to list" and `"Send {n} day{s} for approval"` ("Sending…").
* Validation: any day missing a time or `out <= in` → `"{date label}: the out time has to be after the in time."`; empty reason → "Give a reason — your approver reads it."
* Submit: `POST /api/ess/attendance` body
  ```json
  { "reason": "…", "days": [ { "date": "2026-10-12", "requested_in": "09:30", "requested_out": "18:30" } ] }
  ```
  Success text (green): `"✓ {filed} day{s} sent to {name} ({role}) for approval."` or `"✓ {filed} day{s} sent — no approver is set for you, so HR will see it for approval."` plus, if skipped: `" Left out: {date label} ({why}), …."`. After 1400 ms: close review, clear picks, reload the log and call `onFiled` (parent reloads month + requests). Error: server message inline.

---

## 4. `/api/ess/attendance` — exact contract

### 4.1 GET

Query (either):
* `?month=YYYY-MM` (invalid/missing → current IST month), or
* `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both must match the regex; else falls back to month mode). Errors: `400 {"error":"The end date is before the start date."}`, `400 {"error":"Pick at most 62 days at a time."}`.
* optional `&date=YYYY-MM-DD` → adds `day_punches` for that day.

Response (`Cache-Control: no-store`):
```ts
{
  month: string            // 'YYYY-MM' (range mode: from.slice(0,7))
  from: string; to: string; today: string   // IST today
  days: Array<{
    date: string
    mark: 'PRESENT'|'LATE'|'MISSING'|'ABSENT'|'LEAVE'|'HOLIDAY'|'WEEKLY_OFF'|'UPCOMING'   // coarse
    kind: 'PRESENT'|'LATE'|'HALF_DAY'|'MISS_IN'|'MISS_OUT'|'IN_PROGRESS'|'ABSENT'|'LEAVE'|'HALF_LEAVE'|'HOLIDAY'|'WEEKLY_OFF'|'UPCOMING'
    work_in: string|null; work_out: string|null      // timestamptz
    total_minutes: number|null
    late_minutes: number; overtime_minutes: number; punch_count: number
    status: string|null          // attendance_records.status raw
    lop: boolean                 // lop_applicable
    regularised: boolean         // regularized_at set
    note: string|null            // holiday description, else leave type name
    leave: { short_name: string; name: string; half_day: boolean; half_session: string|null } | null
    shift_code: string|null; expected_in: string|null; expected_out: string|null   // 'HH:mm'
    correction: { id: string; group: string|null; status: 'PENDING'|'APPROVED'|'REJECTED';
                  requested_in: string|null; requested_out: string|null;
                  waiting_on: {id,name,role}|null; decided_by: string|null; review_remark: string|null } | null
  }>
  day_punches?: Array<{ punch_time: string; punch_type: 'IN'|'OUT'; source: string|null; geofence_status: string|null }>
  shift: { code, name, start, end, grace_until, last_punch, break_minutes, overtime: boolean } | null   // in force today, else most recent
  weekly_offs: string[]            // dates in range
  weekly_off_weekdays: number[]    // ISO 1=Mon … 7=Sun
  holidays: Array<{ holiday_date, description, holiday_type, is_optional }>   // range only
  regularisations: Array<attendance_regularisation row + { waiting_on: {id,name,role}|null, decided_by: string|null }>  // last 30, any status
  pending_corrections: Record<date, approverName|null>
  summary: { present, late, missing, absent, leave, holiday, weekly_off, upcoming, worked_minutes, by_kind: Record<kind, number> }
  diagnostics: { noShift: boolean; noHolidayCalendar: boolean; noRecords: boolean }
}
```
`attendance_regularisation` row columns: `id, employee_id, attendance_date, recorded_in, recorded_out, requested_in (TIME), requested_out (TIME), reason, status ('PENDING'|'APPROVED'|'REJECTED'|'CANCELLED'), reviewed_by (name), reviewed_by_id, reviewed_at, review_remark, created_at, updated_at, request_group, current_approver_id`. `decided_by` = `reviewed_by` when APPROVED/REJECTED. `waiting_on.role` from `approverRole()` (§6.2).

`kind` rule (server `kindFor`, precedence):
1. holiday (any holiday on the employee's published calendar, optional included) → HOLIDAY
2. weekly off (`resolve_weekly_offs`) → WEEKLY_OFF
3. approved full-day leave → LEAVE
4. a record with IN or OUT: today & IN & no OUT → IN_PROGRESS; no IN → MISS_IN; no OUT → MISS_OUT; `status = 'HALF_DAY'` → HALF_DAY; `late_minutes > 0` → LATE; else PRESENT
5. approved half-day leave (no record) → HALF_LEAVE
6. date ≥ today → UPCOMING else ABSENT
7. Override: today, with an open punch (`punchState.open`), and kind not HOLIDAY/WEEKLY_OFF/LEAVE → IN_PROGRESS.

Coarse `mark`: HALF_DAY→LATE, MISS_IN/MISS_OUT→MISSING, IN_PROGRESS→PRESENT, HALF_LEAVE→LEAVE, rest identical.

The diagnostics are not rendered by the current web screen.

### 4.2 POST — file a regularisation

Refused in view-as: `403` "Your ESS session is not active, so there is no attendance record to regularise. Sign in again with your own ESS account." (no actor) or "A regularisation is recorded under your own name, so it cannot be done while you are viewing somebody else's portal. Open your own portal to regularise."

Body (any one form of dates):
```ts
{ reason: string,                                      // required, trimmed, max 500
  days?: { date, requested_in, requested_out }[],      // per-day times (list flow)
  requested_in?: 'HH:mm', requested_out?: 'HH:mm',     // common times (required if no valid days[])
  dates?: string[] | date?: string | from?: string, to?: string }
```
Validation (`fileRegularisation`, in order; all 400 unless noted):
* "Say why the punch is being corrected. Whoever reviews it reads this."
* per day: `"{dd Mon yyyy}: give both times as HH:mm."`, `"{dd Mon yyyy}: the out time has to be after the in time."` (entries with an invalid date are silently ignored)
* common: "Give both times as HH:mm.", "The out time has to be after the in time."
* "Pick the day to correct."
* "Regularise at most two months at a time." (> 62 dates)
* Per-date skips (collected in `skipped`, not errors): `today is not over yet` / `that day has not happened yet` / `it was {holiday description|a holiday}` / `it was a weekly off` / `you were on approved leave` (full-day only) / `it has already been regularised` (an APPROVED row exists).
* Nothing left: one skipped → `"{dd Mon yyyy}: {why}."`, else "None of those days can be regularised."
* DB missing migration → 500 "Attendance approvals are not switched on yet (migration 138 has not been run)."
Rows are upserted on `(employee_id, attendance_date)` (re-filing a REJECTED/CANCELLED day overwrites it), one random `request_group` per submission; the DB stamps `current_approver_id` (reporting manager, HR if none). Approver gets bell + e-mail; employee gets bell "reg_submitted" when routed.

Response 200: `{ ok: true, filed: number, dates: string[], skipped: {date, why}[], status: 'PENDING', group: string, waiting_on: {id,name,role}|null, unrouted: boolean }`.

### 4.3 PATCH — withdraw
Body `{ id }` = a row id **or** a `request_group` id (withdraws every PENDING row of yours in it). View-as → `403 "Attendance cannot be changed while viewing as somebody else."`. Errors: `400 "That is not a request id."`, `404 "Nothing pending to withdraw."`. Success `{ ok: true, status: 'CANCELLED' }`; approver is told by bell.

### 4.4 What approval does (server, for understanding only)
Approving writes `attendance_records` with `work_in/out` from the requested IST times, `total_minutes = out − in − lunch`, late vs shift start, OT past `max_out_punch` when OT applies, `status 'PRESENT'`, `lop_applicable false`, `source 'REGULARISED'`, `regularized_at now`. The calendar then shows the day as PRESENT/LATE with ✓.

---

## 5. Punch — `/api/ess/punch` (`lib/attendance/punch.ts`)

UI note: the portal's live punch control is the **PunchDial on the Today/Home tab** (`components/ess/today/PunchDial.tsx`, covered by the Home/Today spec). `PunchButton` in `EmployeePortal.tsx` is inside the old `Home` component, which is no longer rendered (`case 'home'` renders `Today`). The Attendance screen itself has no punch button. Contract:

* `GET /api/ess/punch` → `{ state: PunchState }` (no-store).
* `POST /api/ess/punch` body `{ kind: 'in'|'out', lat?: number, lng?: number }`.
  * 200: `{ ok: true, at: string /* punch_time actually stored */, result: { punch_id, punch_time, punch_type, geofence: 'INSIDE'|'OUTSIDE'|'UNKNOWN', processed: true }, state: PunchState }`
  * 409 (refused, with `state` so the UI adopts the truth): `"You are already punched in (since {hh:mm am/pm IST}). Punch out first."`; `"You already punched out at {hh:mm am/pm}. Punch in first."`; `"Punch in first."`
  * 400 `"kind must be in|out"`; 400 RPC error message; 401 `"unauthenticated"` (no employee row); 403 `"access ended"` (date_of_leaving in the past).
  * 403 view-as: "Your ESS session is not active, so there is nobody to punch for. Sign in again with your own ESS account." / "A punch lands on your own day, so it cannot be made while you are viewing somebody else's portal. Open your own portal to punch."
* `PunchState = { date: 'YYYY-MM-DD' (IST), open: boolean, first_in, last_in, last_out: string|null, punches: {punch_time, punch_type, source, geofence_status}[] }`.
* Rules: punches alternate; IN refused while open; OUT refused when not open; IN again after an OUT is allowed. The web never sends `lat/lng`; the RPC (`ess_punch`) measures geofence against the employee's branch when given coordinates, else stores `UNKNOWN`; source is stamped `ESS_APP`.
* The Today week strip (`WeekStrip.tsx`) reads `GET /api/ess/attendance?from=<Mon>&to=<Sun>` (same `kind`s) — again a Home/Today concern.

---

## 6. Leave screen — `LeaveSection` ({ emp, notify })

### 6.1 Load
`GET /api/ess/leave` (§7.1) on mount and after every successful write. Error → "{message}" + "Try again" (message default "Could not load leave."). Loading → skeleton (hero block + two panels), screen-reader text "Loading your leave…".

Derived values (client):
* `today` = device-local date. `floor` = earliest selectable date = `earliestApplyDate(backdate_days)`: `n = max(0, floor(backdate_days||0))`; if `n > 1` today − (n−1) days, else today. (Window counts today inclusive; 0 or 1 → today.)
* `holidays` = payload `holidays` (the employee's whole published calendar). `upcoming = holidays.filter(h => h.holiday_date >= today)`.
* `isWeeklyOff(key)` = within [today, today+366] → `weekly_offs.includes(key)`; otherwise `weekly_off_weekdays.includes(localDate(key).getDay())` (0=Sun…6=Sat; this list is 0-based here, unlike the attendance route's ISO list).
* `isNonWorking(key)` = isWeeklyOff || any holiday on that date (optional holidays included).

Layout: (1) Balance hero; (2) two columns on ≥880 px (stacked below): left "Apply for leave" panel; right column = "Your requests" then "Upcoming holidays".

### 6.2 Balance hero
* Label `"Leave balance · {fyLabel}"` (e.g. "Leave balance · FY 2026-27").
* Big number: `balance_total` (fallback: Σ `avail(b)`), animated count-up once (700 ms ease-out cubic, to 0.5 steps; skipped for reduced motion); shows `-` and "nothing loaded yet" when `balances` is empty, else "days available".
* Button "Apply for leave" → scroll to the Apply panel.
* Empty balances: "**No paid leave entitlement is set up for you in {fyLabel}.** HR sets it in Leave configuration. You can still apply for leave that needs no balance, such as Leave Without Pay."
* Else one tile per `balances[]` row: code `leave_types.short_name`, name `leave_types.name`; number `av` with `" / {total}"` where `total = opening + accrued`, `av = avail(b) = opening + accrued − used − encashed` (client-side, not clamped); `"{pending} pending approval"` when pending > 0; meter width `pct = total>0 ? round(av/total*100) : 0` (clamped 0–100) coloured `pct > 60` positive, `> 30` warning, else critical (light theme; the dark hero uses light mint/amber/rose). Meters animate from 0 on load.

`approverRole(emp, approverId)` (pure, `lib/leave/policy.ts`): L1 → "Reporting manager"; hr_manager → "HR manager"; L2 → "L2 manager"; hr_head → "HR head"; other → "Approver (delegate)"; missing → "Approver".

### 6.3 Apply panel ("Apply for leave")

**Leave type** ("Leave type" label): one chip per `types[]` in server order: bold `short_name` + `available` number when not null. Selected chip = brand fill / onAccent text. Ineligible chip = opacity .5, dashed border, tooltip = `reason`. Tapping:
* ineligible → note (warning colour) `"{name}: {reason || 'not available to you'}."`, selection unchanged;
* eligible → select it, clear half-day + session, clear note.
Hint under chips for the selected type: `"{name} · {available} day{s} left"` or `"{name} · no balance needed"` (available null), + `" · {pending} pending"` when pending > 0.

**Dates** ("Dates" label). Right of the label: `"{working} day{s} selected"` (when both dates set and valid) and "Clear" (when a start exists; clears both dates).
* Two date inputs "Start" (`min = floor`) and "End" (`min = from || floor`). Typed values are clamped: `setStart(v)`: empty → clear both; `d = max(v, floor)`; `to` = d if empty or earlier. `setEnd(v)`: empty → `to = from`; `d = max(v, floor)`; `from = from || d`; `to = d < from ? from : d`. Either jumps the calendar to that month. Typed dates are **not** checked against holidays client-side.
* Month calendar: header ‹ (disabled when showing the floor month) — `"{Month} {year}"` — "Today" (shown when not on the floor month; jumps to the floor month) — › (unlimited). Weekday row `S M T W T F S` (Sunday first). Cells:
  * past (`< floor`) → disabled, faint;
  * weekly off → text critical (red); holiday → text warning, 700 weight, and a small bar under the number; today → 2 px brand outline (never filled);
  * selected range (from…to, or from…hovered day on pointer devices) → brand band, rounded at range ends and week-row breaks; non-working days inside the band are struck through on a brandEdge fill ("not counted").
  * accessibility label: `"{weekday long} {day} {month long}[, {holiday description}][, already passed]"`.
* Tap rule `pickDay(key)`: `key < floor` → ignore. Non-working day → note `"{d MMMM} is {holiday description | 'a weekly off'}. Leave cannot start or end on it."` and ignore (so a range that spans a holiday is made by tapping working days either side). Otherwise: tapping the single already-chosen day clears it; nothing chosen or `key < from` → from = to = key; else to = key.
* Arrow-key roving focus (web only) clamps at floor.
* Legend: "Selected", "Today", "Weekly off", "Holiday", "Struck-through days sit inside your dates but are not counted", "Tap again to clear · a later day extends · an earlier one starts over".

**Summary box**:
* No start: "Tap a day in the calendar, or type the dates above. One day is one tap."
* Else: range label (`"12 Nov 2026"`; same month `"12 – 14 Nov 2026"`; else `"28 Nov – 02 Dec 2026"`) and `"{working} day{s}"`.
  Estimate (display only, pure; copy it): iterate from…to: `span++`; weekly off → `offs++`; else holiday → `offs++` and remember it. `working = half_day ? 0.5 : max(0, span − offs)`.
  Note line: half day → "Half day."; offs > 0 → `"{span} calendar day{s}, {offs} not counted ({holiday names joined ', '}). Confirmed when you submit."` (holiday part only if any); else `"{span} calendar day{s}, all working. Confirmed when you submit."`; then if `working > 0` and `balanceAfter ≥ 0`: `" You would have {balanceAfter} {short_name} left."` where `balanceAfter = round1((bookable ?? available) − working)` (null when the type is untracked).
  Alerts (warn, never block): `working <= 0` and not half day → "Every day here is a weekly-off or holiday, so there is nothing to apply for."; `balanceAfter < 0` → `"That is {|n|} day{s} more {short_name} than you can book[ (pending requests included)]. Submitting will offer to apply the extra days as Leave Without Pay."` (suffix when the type has pending > 0).

**Duration** (only if the selected type's `allow_half_day` and from === to): segmented "Full day" | "1st half" | "2nd half" → `half_day:false, half_session:''` / `true,'1st'` / `true,'2nd'`.

**Reason**: single-line input "Reason", placeholder "Brief reason for your manager" (optional; server trims to 500).

**Actions**: "Submit request" (disabled while busy or missing type/from/to; spinner + "Submitting…"). "Clear" (shown if type, from or reason set) → reset form and note.

Client checks before POST: missing type/dates → toast error "Select leave type and dates"; half day without session → "Select 1st half or 2nd half".

POST `/api/ess/leave` body:
```json
{ "leave_type_id": "<uuid>", "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD",
  "half_day": false, "half_session": "" , "reason": "…", "split_with_lwp": false }
```
(`half_session` is `'1st'|'2nd'` only when half_day, else `''`.)

Success toasts:
* split response: `"Sent as {d} day{s} {leave_type} + {d} day{s} {leave_type}[ to {waiting_on.name}] ✓"`
* else: `"{days} day{s} sent[ to {name} ({role})] for approval ✓"`
* if `unrouted`: then (replacing it) error toast "No approver is configured for you — HR will see it in their Requests list. Please tell HR."
Then reset form, clear split offer, reload.

Failure: if the error body has `can_split && split_preview` → show the **split offer** (below), else toast error `message || 'Could not submit'`.

**Split offer** (warning notice with icon; bound to the exact `type|from|to|half_day` it was made for — editing the form hides it):
`"{server reason} "` + (paid_days > 0 ? `"You can apply **{paid} day{s} as {short_name}** and the remaining **{lwp} as {lwp_type}** (unpaid)."` : `"You can apply all **{lwp} day{s} as {lwp_type}** (unpaid) instead."`). Buttons: `"Apply {paid} + {lwp} LWP"` / `"Apply as {lwp_type}"` → re-POST same body with `split_with_lwp: true`; "Change dates" → dismiss. `lwp_type` default "Leave Without Pay".

**No-approver notice** (when `diagnostics.noApprover`): "No reporting or HR manager is recorded against you, so a request may not reach anyone. Ask HR to set your manager before applying."

### 6.4 "Your requests"
Source `applications` (the 10 most recent, `applied_at` desc). Header meta `"Last {n}"`. Shows first **3**; `"Show all {n} requests"` / "Show fewer". Empty: "**No requests yet.** Anything you apply for will show here with its status."

Row (status = `status.toUpperCase()`; left rail + pill colours: PENDING warning/warningTint, APPROVED positive/positiveTint, REJECTED critical/criticalTint, CANCELLED lineStrong rail, muted on sunken pill; row has a faint tint wash of the same colour):
* top: tag `leave_types.short_name`; dates `"dd Mon"` or `"dd Mon – dd Mon"`; pill with the raw status text.
* sub: `"{days} day{s}"` + `" · half day[ ({half_session})]"` + `" · {leave_types.name}"` + (PENDING with `approval_stage`) `" · stage {L1|HR}"`.
* PENDING: `"Waiting on **{waiting_on.name}** · {role}"` or "No approver is set for you — HR has been shown this request."
* APPROVED/REJECTED with `approver`: `"Approved|Declined by **{approver}**[ on {dd Mon}]"` (resolved_at).
* `remark` box: bold approver name then remark.
* `cancel_status === 'REQUESTED'`: `"Cancellation requested — waiting on **{cancel_waiting_on.name || 'HR'}**"`.
* `cancel_status === 'DECLINED'`: box "**Cancellation declined[ by {cancel_decided_by}]**" + (`cancel_remark` || "The leave stands.").
* CANCELLED with `cancel_status === 'APPROVED'`: `"Cancelled[ — approved by {cancel_decided_by}]; the days are back in your balance."`
* **Request cancellation** (APPROVED, cancel_status ≠ REQUESTED, `from_date > today`): button "Request cancellation" → inline input (placeholder "Why cancel? (your approver reads this)") + "Send to approver" (danger) + "Keep it". Send → `PATCH /api/ess/leave` `{ "id": "<id>", "action": "cancel", "reason": "<text>" }` → toast `res.message || 'Cancellation requested'`, reload; error toast `message || 'Could not request cancellation'`.
* **Withdraw** (PENDING): "Withdraw" → inline "Withdraw this request?" + "Yes, withdraw" (danger) + "Keep it". Yes → `PATCH /api/ess/leave` `{ "id": "<id>" }` → toast "Leave request withdrawn", reload; error toast `message || 'Could not cancel'`.
All buttons disabled while busy.

### 6.5 "Upcoming holidays"
Header meta `"{n} ahead"`. List of `upcoming` (all future holidays, all published years), first **3**, then `"Show all {n} holidays"` / "Show fewer". Month group headers `"{Month} {yyyy}"` whenever the month changes. Row: date box (day number + short month), name `description`, meta chips: `holiday_type` (class by lowercase type: national → info/infoTint; festival, regional → brandDeep/brandTint; optional → warning/warningTint; others unstyled) and "Optional" (warning) when `is_optional`; right side `"today" | "tomorrow" | "in {n}d"`.
Empty: `diagnostics.noHolidays` → "**No holiday calendar published yet.** Once HR publishes it, your company's holidays appear here and stop counting against your leave." else "**Nothing left this year.** The next calendar will appear here when HR publishes it."

---

## 7. `/api/ess/leave` — exact contract

### 7.1 GET
Response:
```ts
{
  year: string                 // leave_balances.year key, FY start year ('2026' for Apr 2026–Mar 2027)
  fyLabel: string              // 'FY 2026-27'
  balances: Array<{            // headline types only (paid, ANY gender, EMPLOYEE mode, ACCRUAL, quota>0)
    leave_type_id, year, opening, accrued, used, encashed, pending,
    available: number|null, bookable: number|null,
    leave_types: { short_name, name } }>
  balance_total: number        // Σ headline available, 1 decimal
  types: Array<{               // active types except application_mode HR_MARK, sort_order
    id, short_name, name, application_mode: 'EMPLOYEE'|'EARN_AVAIL', allow_half_day: boolean,
    allow_without_balance: boolean, approval_by: 'L1'|'HR_MANAGER'|'ASSIGNED'|'BOTH',
    available: number|null, bookable: number|null, pending: number,
    policy: 'UNLIMITED'|'EARNED'|'PER_OCCURRENCE'|'ACCRUAL'|null,
    eligible: boolean, reason: string|null }>
  applications: Array<leave_applications.* + { leave_types: {short_name,name},
    waiting_on: {id,name,role}|null, cancel_waiting_on: {id,name,role}|null }>   // 10 most recent
  lwp_type: { id, name, short_name } | null
  holidays: Array<{ holiday_date, description, holiday_type, is_optional }>      // whole calendar
  weekly_offs: string[]          // exact dates, server-today … +366 days
  weekly_off_weekdays: number[]  // 0=Sun … 6=Sat
  backdate_days: number          // resolve_backdate_window(company); 0 = no backdating
  diagnostics: { noBalances, noHolidays, noApprover /* no l1 AND no hr manager */, noWeeklyOffs }
}
```
`leave_applications` columns: `id, employee_id, leave_type_id, from_date, to_date, days (NUMERIC 4,1), half_day, half_session ('1st'|'2nd'|''|null), reason, status ('PENDING'|'APPROVED'|'REJECTED'|'CANCELLED'), approver (name), approver_employee_id, remark, applied_at, resolved_at, current_approver_id, approval_stage ('L1'|'HR'|null), cancel_status ('REQUESTED'|'APPROVED'|'DECLINED'|null), cancel_reason, cancel_requested_at, cancel_approver_id, cancel_decided_at, cancel_decided_by, cancel_remark`.

Eligibility reasons (first one wins, shown as `reason`):
* gendered type not matching → "Not available for your gender" (or "Your gender is not on file. Ask HR to update it")
* on probation and `eligible_from = 'AFTER_PROBATION'` → "Available after confirmation"
* `AFTER_DAYS` and DOJ + `min_tenure_days` in the future → `"Available from {dd Mon yyyy}"`
* ACCRUAL type with quota ≤ 0, opening ≤ 0, available ≤ 0 → "No entitlement set up yet — ask HR"

Side effect: after responding, balances are re-synced into `leave_balances`.

### 7.2 POST — apply (validation order and exact strings)
View-as → 403 "Your ESS session is not active, so there is nobody to apply on behalf of. Sign in again with your own ESS account." / "Leave is applied for in your own name, so it cannot be submitted while you are viewing somebody else's portal. Open your own portal to apply."

1. 400 "Select a leave type." · 400 "Select valid from and to dates." · 400 `The "to" date cannot be before the "from" date.`
2. 404 "That leave type no longer exists." · 400 "That leave type is no longer active." · 403 "That leave type is marked by HR, not applied for."
3. Half day: 400 `"{short_name} cannot be taken as a half day."` · 400 "Choose 1st half or 2nd half." · 400 "A half day must start and end on the same date."
4. 404 "Employee record not found." · 403 `"{name} is not available for your gender record."` / `"{name} requires your gender on file. Please ask HR to update your record."` · 403 `"{name} is available only after confirmation."` · 403 `"{name} is available from {dd Mon yyyy}."` · 400 "That date is before your joining date." (ON_DOJ)
5. Backdating (from before today): window 0 → 400 "Leave cannot be applied for a past date. Ask HR if you need to claim an absence."; before the earliest → 400 `"Leave can only be backdated {n} day{s}. The earliest you can claim is {dd Mon yyyy}."`
6. Overlap with a PENDING/APPROVED request → **409** `"This overlaps a {pending|approved} request for {dd Mon yyyy}[ – {dd Mon yyyy}]."`
7. Lifetime cap (`max_times_in_tenure`) → 403 `"{name} may be taken {n} time(s) in your tenure."`
8. Calendar unreadable → **503** "The holiday and weekly-off calendar could not be read just now, so this request cannot be counted correctly. Please try again in a moment."
9. Start on non-working → 400 `"{dd Mon yyyy} is {holiday description | 'a weekly off'}, so leave cannot start on it.[ Pick the next working day.]"` (suffix omitted for half day). End on non-working → 400 `"{dd Mon yyyy} is {…}, so leave cannot end on it. Pick the previous working day."`
10. `days = half_day ? 0.5 : calendar days − non-working days in range`; ≤ 0 → 400 "That range contains only weekly-offs and holidays."
11. Balance (`checkRequest`, against the FY of `from_date`; pending counts against it) → **409**:
    ```json
    { "error": "<reason>", "bookable": n, "available": n, "pending": n,
      "can_split": boolean,
      "split_preview": { "paid_days": n, "lwp_days": n, "lwp_type": "Leave Without Pay" } | null }
    ```
    reasons: `"You have {n} day{s} of {short_name} you can book[ ({n} day{s} more already waiting for approval)]; this request is {n} day{s}."`; `"No {name} entitlement has been set up for you yet — HR sets it in Leave configuration."`; `"{name} covers up to {n} day{s} per occurrence; this request is {n} day{s}."`.
    `can_split` = an LWP type exists AND not half day AND policy ACCRUAL AND not (quota ≤ 0 and opening ≤ 0). `paid_days = min(floor(bookable), workingDays)`, `lwp_days = workingDays − paid_days`. With `split_with_lwp: true` and `can_split`, the server files two requests (paid part = first N working days, LWP part = the rest; each starts/ends on working days, same reason).
12. Insert error → 500 `{ error: <db message> }` (a half-filed split is rolled back).

Success 200:
```ts
{ ok: true, id: string, days: number, excluded: string[] /* non-working dates inside range */,
  unrouted: boolean, waiting_on: {id,name,role}|null,
  split: Array<{ id, leave_type /* short name */, from_date, to_date, days }> | null }
```
Approver gets bell + e-mail (with a balance line); the employee gets a "submitted" bell.

### 7.3 PATCH
View-as → 403 "Your ESS session is not active. Sign in again with your own ESS account to cancel this." / "A cancellation is recorded under your own name, so it cannot be done while you are viewing somebody else's portal. Open your own portal to cancel."
`400 "id is required"`.

**Withdraw** `{ id }` (PENDING → CANCELLED): 404 "Leave request not found" · 403 "That is not your leave request." · 409 "This leave is already approved — request a cancellation instead." · 409 `"Already {status lowercase}."` · success `{ ok: true, status: 'CANCELLED' }`.

**Request cancellation** `{ id, action: 'cancel', reason }` (`requestLeaveCancel`): 400 "That is not a leave request id." · 404 "Leave request not found." · 403 "That is not your leave request." · 409 "This request is still pending — withdraw it instead." · 409 `"Already {status}."` · 409 "This leave has already started, so it cannot be cancelled here. Ask HR to adjust it." (from_date ≤ IST today) · 409 "A cancellation for this leave is already waiting for approval." · 500 "Migration 138 has not been run yet." · success `{ ok: true, status: 'APPROVED', waiting_on, message }` with message `"Cancellation sent to {name}."` or "Cancellation requested. No approver is set for you, so HR will see it in their Requests list." Approver chosen: original approver → L1 → HR manager → L2 → HR head (never the employee). The days return only when the approver approves.

---

## 8. Business rules summary (balances, FY, "sandwich")

* **No sandwich charging**: weekly offs and holidays inside a range are never counted; a request may span them but may not start or end on one. Optional holidays count as holidays.
* **FY**: Indian FY April–March. `leaveYearOf(d)` = `d.getMonth() >= 3 ? year : year − 1` (string); `leaveFyLabel('2026') = 'FY 2026-27'`.
* **Policies** (`policyOf`): `allow_without_balance` → UNLIMITED (LWP, Sabbatical; never blocked, available null); `application_mode EARN_AVAIL` → EARNED (Comp Off; available null, not blocked; approver is told "confirm the off-day worked before approving"); `max_times_in_tenure` set and quota > 0 → PER_OCCURRENCE (Maternity/Paternity; available = quota per occurrence); else ACCRUAL.
* **ACCRUAL balance**: `available = max(0, floor1(opening + accrued − used − encashed))`; `bookable = max(0, floor1(available − pending))`. `accrued`: MONTHLY = Σ over FY months that have **ended** of `quota/12 × effectiveDays/daysInMonth` (joining/leaving months pro-rated; no DOJ → 0), floored to 1 decimal once; YEARLY = whole quota if employed any day of the FY; NONE = 0. `used` = Σ APPROVED days with from_date in the FY; `pending` = Σ PENDING days in the FY. `opening` and `encashed` come from HR's upload only (no employee encashment flow).
* Quota from `resolve_leave_quota(company, null, '2026-27')`, else `leave_types.annual_quota`.
* Approval re-check (`checkApproval`): approving can't overdraw (`days <= available`), else 409 `"Approving this would overdraw {short}: {n} day{s} left, request is {n} day{s}. Decline it, or ask {employee} to re-apply with the extra days as Leave Without Pay."`.
* Types with `approval_by = 'BOTH'`: manager approval moves `approval_stage` L1 → HR (still PENDING, now waiting on HR) unless the same person holds both stages.

---

## 9. Manager side (Tasks & Approvals — not on these screens)

Leave requests, cancellations and attendance corrections stamped to a manager appear in `GET /api/ess/approvals` → `{ items: PendingItem[], mine: number, chain? }` with `kind: 'LEAVE' | 'LEAVE_CANCEL' | 'REGULARISATION'`, `id` (for REGULARISATION the `request_group`), `who`, `what` (e.g. `"Leave request — 2 days (half day), 12 Nov 2026 – 13 Nov 2026"`, `"Cancel approved leave — …"`, `"Attendance correction — 3 days, …"`), `meta`, `stage`, `mine`, `actions` (`['Approve','Decline']` or `['View']`), `facts[]` (balance before → after, teammates off, per-day recorded → requested times), `alert`. Decide: `POST /api/ess/approvals` `{ kind, id, action: 'Approve'|'Decline', note?: string }` → `{ ok, status, stage?, waiting_on?, message? }` (regularisation message `"{n} day{s} approved|declined."`). Errors include "You cannot decide your own request.", "This request is not waiting on you.", `"Already {status}."`, "There is no cancellation waiting on this leave.". The UI belongs to the Approvals spec.

---

## 10. Direct Supabase access from these screens

Only one: `loadDayPunches` (§2.7) — `attendance_punches` select `punch_time, punch_type, source, geofence_status`, filters `employee_id = <emp>`, `punch_date = <date>`, order `punch_time asc`, on the anon key. Everything else goes through the API. Replace it with `GET /api/ess/attendance?from=D&to=D&date=D` → `day_punches`. No file uploads exist in Attendance or Leave.

---

## 11. Reusable TS modules

Pure and dependency-free — safe to import into React Native as is (copy or share via a workspace package):

```ts
import { leaveYearOf, leaveFyLabel, leavePolicyFy, leaveFyStartYear } from '@/lib/ess/leave-year'   // no imports
import { daysInMonth, effectiveDays, normaliseMode, monthlyAccrual, floor1, fyMonths,
         accruedAsOf, usedFrom, balanceFor, carryForward } from '@/lib/leave/accrual'               // no imports
import { policyOf, isHeadline, pendingFrom, computeTypeBalance, checkRequest, checkApproval,
         splitWithLwp, approverRole } from '@/lib/leave/policy'   // imports './accrual.ts' WITH the .ts extension — Metro/TS needs allowImportingTsExtensions or change to './accrual'
import { parseEssPath, essPath, essHref } from '@/lib/ess/routes'                                  // pure (pushUrl/atEss touch window but are guarded)
```
Unit tests: `lib/leave/__tests__/accrual.test.ts`, `policy.test.ts`, `lib/ess/__tests__/leave-year.test.ts`. The balances the client shows still come from the server; these are mainly for the estimate and wording.

NOT importable (copy the small pure pieces instead):
* `lib/supabase-attendance.ts` — imports `@/lib/supabase` and `lib/ess/api` → `lib/rms/client` (supabase + react). Copy its types (`AttendanceDay`, `DayKind`, `DayCorrection`, `RegularisationRequest`, `AttendanceRange`, `MonthlyData`), `resolveDay`, `CORRECTABLE`, and reimplement `loadMonthlyAttendance` / `loadAttendanceRange` on your own fetch.
* `components/ess/attendance/AttendanceLog.tsx` — `KIND_META` uses `lib/ui` CSS-variable colours; copy with the hex table (§0.4). `selectable`, `proposed`, `NEEDS_ATTENTION`, presets — copy.
* `EmployeePortal.tsx` — `monthStats`, `STATUS_STYLE`, `STATUS_FULL`, `STATUS_LABEL`, aliases — copy.
* `LeaveSection.tsx` — `avail`, `barClass`, `earliestApplyDate`, `rangeLabel`, estimate/`pickDay`/`setStart`/`setEnd` logic — copy.
* `lib/ess/api.ts`, `lib/auth-headers.ts`, `lib/ess-session-client.ts`, `lib/rms/client.ts` — browser (localStorage/atob/Supabase); reimplement.
* `lib/leave/notify.ts` (imports `next/server`, server Supabase, mail) — `fmtDay`, `fmtRange`, `fmtDates`, `daysWord` are one-liners to copy.
* Server-only: `lib/leave/workflow.ts` (node:crypto, service role), `lib/leave/ledger.ts`, `lib/leave/daily.ts`, `lib/attendance/punch.ts`, `lib/ess/session.ts`, `lib/ess/pending.ts`, `lib/ess/asked.ts`, `lib/api-auth.ts`, `lib/ui/*` (CSS variables / React DOM).
* `daysLabel` lives in `lib/config/workflow-templates.ts` (`(n) => \`${n} day${n === 1 ? '' : 's'}\``) — copy it.

---

## Implementation notes for React Native

* **Auth**: store the ESS token in `expo-secure-store`; send `Authorization: Bearer`, `Content-Type: application/json`, and `?employee_id=<own id>` on every call; keep the `api()` error contract (`message`, `status`, `body`) because the leave 409 split offer reads `body.can_split` / `body.split_preview`. Relative paths become `${API_BASE}/api/...` (production `https://ezer-hrms-chi.vercel.app`). On 401 send the user to login.
* **Time zone**: compute "today" in Asia/Kolkata (the web uses device-local date; HH:mm in the log uses `timeZone:'Asia/Kolkata'`, the calendar's `fmtT` uses device time). `Intl` with `timeZone` needs Hermes Intl support (available in current Expo) — otherwise offset by +05:30 manually.
* **Date & time pickers**: web uses `<input type="date">` (leave Start/End with `min`; log custom range with `max=today`) and `<input type="time">` (HH:mm, 24-hour). Use `@react-native-community/datetimepicker` (or the Expo UI picker) with the same min/max and clamping rules, emitting `YYYY-MM-DD` / `HH:mm` strings.
* **Calendars**: build both month grids yourself (Sunday-first, 7 columns, leading blanks). Hover-preview of a range, roving arrow-key focus, the 3D `TiltCard`, cell entrance waves, sheen and confetti are web-only decoration — skip them; keep the selected/today/holiday/weekly-off/struck-through visual states and the legends.
* **Charts**: the attendance ring and donut are SVG circles with `strokeDasharray` — use `react-native-svg` with identical maths (donut: r 66, stroke 18, 2.5 gap per slice, start at −90°).
* **Tooltips** (`title=`) for disabled checkboxes, cells and the declined remark have no RN equivalent — show the text inline or on long-press (the mobile web layout already prints `why` inline).
* **Sticky selection bar** in the log → a bottom-anchored view while picks exist.
* **Scroll-into-view** ("Apply for leave" in the hero) → ScrollView ref + `scrollTo`.
* **Reduced motion**: honour `AccessibilityInfo.isReduceMotionEnabled()` for the count-up and meter animations.
* **Refresh on focus**: the Today punch UI re-reads punch state on tab visibility (`visibilitychange`) and every 30 s at IST midnight; in RN use `AppState` + screen focus.
* **Geolocation**: the web never sends `lat/lng` on punch; the API accepts them and computes geofence INSIDE/OUTSIDE. Sending them (expo-location) would change stored data versus web — treat as an explicit product decision, not parity.
* **No file pickers, no downloads, no uploads** are needed for Attendance or Leave.
* **Theme**: implement light and dark palettes from §0.4 (the leave hero in dark is a fixed navy gradient `#0B1220 → #16223C → #22355E` with light text `#F6F9FF`).
