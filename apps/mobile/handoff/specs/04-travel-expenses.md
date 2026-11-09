# 04 — Travel & Expenses (employee side): functional spec for the React Native rebuild

Source of truth: repo `ezer-hrms`, branch `feat/mobile-app` (read on 19 Oct 2026). Entry: `app/ess/travel/page.tsx` -> `components/te/TeHome.tsx`. Everything under `components/te/{admin,finance,desk}/` and `components/te/TeStaffHome.tsx` is the back office (`/dashboard/expenses`) and is out of scope. One exception: `approve/TeClaimApproval.tsx` is shared by the employee Approvals screen and by Finance verification. This spec covers only the employee/manager-stage behaviour of that component.

How this document is laid out:

- Part 0: entry, session, navigation map and gating (this part)
- Part 1: shared infrastructure: the API client, errors, the snapshot, styling tokens, shared primitives
- Part 2: Home, the rail and tab bar, and the "New claim" entry flow (the screens owned by `TeHome.tsx`)
- Part 3: the trip planner, places and maps (group A)
- Part 4: trips, journeys (legs), live GPS recording, Start now (group B)
- Part 5: expenses, claims, advances, vehicles, files (group C)
- Part 6: approvals done by an employee who is an approver (group D)
- Part 7: inventory of `lib/te` and `lib/travel` modules and what React Native can import
- Part 8: implementation notes for React Native

Wording: the code says "leg" (`TeLeg`, `/api/te/legs`). Every string a user reads says **"journey"**. Migration 162 and engine patch P9 renamed it because users did not understand "leg". Keep that rule: identifiers say `leg`, UI text says `journey`.

---

# Part 0 — Entry, session, navigation map and gating

## 0.1 Entry page (`app/ess/travel/page.tsx`)

- Route: `/ess/travel`. The ESS portal (`components/ess/EmployeePortal.tsx`) has a nav section `{ k:'expenses', label:'Travel & Expenses', short:'T&E', desc:'Trips, legs, bills and claims: travel from planning to payout', items:[{ k:'expenses', href:'/ess/travel' }] }` in group "Time & pay". Selecting it calls `window.location` to leave the portal. It is not rendered inside the portal.
- Session check: a side effect only. Nothing is gated on it. It reads `localStorage['ezer_ess_session']`, parses the JSON and checks that `employee_id` is truthy. If not, it sets `window.location.href = '/ess-login'`. The module still renders meanwhile, so the first `/api/te/me` returns 401 and shows "Sign in to continue.".
- Renders `<TeHome onExit={() => window.location.href = '/ess-portal?tab=payslip'} />`. "Back to ESS" in the header and the 5th tab-bar button go to the ESS Payroll section.
- Deep link (notifications): the database writes links as `/ess?tab=claims&ref=<claim uuid>` (migration 147). The ESS portal forwards that pair to `/ess/travel?tab=claims&ref=<id>`. `TeHome.claimFromLink()` checks `tab === 'claims'` and that `ref` matches `/^[0-9a-f-]{36}$/i`. If both hold, the initial view is `{name:'claim', id: ref}` (the claim detail). TeHome also accepts the prop `initialClaimId`, which wins over the URL. **RN:** support a deep link / push payload `claims/<uuid>` that opens Claim detail directly.

## 0.2 Authentication

- Every call sends `Authorization: Bearer <ESS token>` (`lib/auth-headers.ts` -> `lib/ess-session-client.ts`). The token is `JSON.parse(localStorage['ezer_ess_session']).token`, an HMAC token in the form `<base64url payload>.<sig>`. The payload has `exp` in **milliseconds**. The client sends the token only if `Date.now() + 30000 < payload.exp`. Otherwise it falls back to a Supabase dashboard session; RN can ignore that path. No employee id is ever sent: the server resolves the employee from the token (`lib/travel/actor.ts` `resolveActor(req, null, {selfOnly:true})`, then `lib/te/server.ts` `teActor`).
- Every JSON call sets `Content-Type: application/json` and `cache: 'no-store'`. Uploads (multipart) must NOT set Content-Type by hand, so the boundary is written correctly (`uploadAuthHeaders()`).
- If the token is missing or expired the server answers 401 `{ error: 'Sign in to continue.' | <server sentence>, code: 'TE_SIGN_IN' }`. 503 + `TE_NOT_CONFIGURED` means ESS sessions cannot be verified on this deployment. A dashboard-only login with no employee gets 403 `TE_NO_EMPLOYEE`: "This sign-in is the shared dashboard login and is not linked to an employee, so it cannot act here. Sign in through ESS with your own account."
- RN: keep the token in SecureStore. Apply the same expiry check (30 s skew) and route to login on 401.

## 0.3 Navigation model

TeHome has no router. It keeps three pieces of state:

- `view`: the main page. One of `home | expenses | claims | limits | trips | advances | approvals | claim{id} | trip{id} | tripClaim{trip} | leg{tripId, leg}`.
- `sheet`: a modal drawer over the page. One of `null | new | kind{kind, way} | expense{line?, tripId?} | plan{kind, past, editing?} | startNow | addLeg{detail}`.
- `toast`: a single string, auto-cleared after **4000 ms**.

Data: `snap` (GET `/api/te/me`) and `queue` (GET `/api/te/queue`) are fetched together on mount and again whenever `reload()` bumps `tick`. A failed queue call is swallowed (`queue = []`). Screens never keep their own copy of server state. After any change the parent calls `reload()`. Trip and claim detail are the exceptions: they fetch their own one-record reads (`/api/te/trips/:id`, `/api/te/claims/:id`).

### 0.3.1 Screen map

Notation: `V:` = view (full page), `S:` = sheet (modal drawer), `->` = navigates to.

```
TeHome (module root; header "EZER · Travel and Expenses", Back to ESS, avatar + name + title/code)
├─ Left rail (desktop) / bottom tab bar (phone ≤860px)
│   Rail: [New claim] -> S:new ; [Approvals (n)] only if queue.length>0 -> V:approvals ;
│         Home, Trips, Other expenses (count unclaimed), My claims (count open), Advances, My limits and rates
│   Tab bar: Home | Expenses (red dot if unclaimed) | (+) New claim -> S:new | Claims (dot if any SENT_BACK) | ESS (onExit)
│
├─ V:home ........................ Part 2.2
│   ├─ 4 kind tiles: Local / Domestic / International -> S:kind{kind}; Other expense -> S:expense{}
│   └─ "Needs you" card: sent-back claims -> V:claim ; unclaimed bills -> V:expenses ; queue rows -> V:approvals
├─ TeLiveBar (on every view except V:leg, when one of my journeys is ACTIVE/PAUSED) -> V:leg ... Part 4
│
├─ S:new (step 1 "What") .......... Part 2.3   tiles as on Home
├─ S:kind{kind, way:null} (step 2 "How") ... Part 2.4
│   ├─ "Continue" rows (entry-flow continueItems) -> V:trip or V:leg
│   └─ Ways (FLOW_WAYS[kind]):
│       start    -> S:startNow ................. Part 4 (TeStartNow)  -> V:leg (or V:trip)
│       plan     -> S:plan{past:false} ......... Part 3 (TePlanner)    -> V:trip{new id}
│       past     -> S:plan{past:true}  (origin POST_FACTO)            -> V:trip{new id}
│       approved -> S:kind{kind, way:'approved'} (step 3) = TePickTrip  -> V:leg / V:trip   Part 4
│
├─ V:trips (TeTrips) ............... Part 4  -> V:trip ; "new" -> S:plan{kind, past:false}
├─ V:trip{id} (TeTripDetail) ....... Part 4
│   ├─ Back -> V:trips
│   ├─ Edit plan -> S:plan{kind: trip.scope, past: origin==='POST_FACTO', editing: trip}
│   ├─ open a journey -> V:leg{tripId, leg}
│   ├─ Add a journey -> S:addLeg{detail} (TeLegAdd)
│   ├─ Add a bill -> S:expense{tripId}
│   ├─ Claim this trip -> V:tripClaim{trip}
│   ├─ open a claim -> V:claim{id}
│   └─ Stay request dialog (TeStayRequest), inline
├─ V:leg{tripId, leg} — which screen depends on leg.status:
│   ├─ ACTIVE | PAUSED | PLANNED -> TeLegLive (GPS recording)   -> on end: toast "Journey ended. Add what it cost." -> V:trip
│   ├─ ENDED                     -> TeLegReport (fare + bill)   -> V:trip
│   └─ SUBMITTED | SKIPPED | CANCELLED (anything else) -> TeLegMissed -> V:trip
│   Back always -> V:trip{tripId}
├─ V:tripClaim{trip} (TeOtherExpenses with trip) ... Part 5  Back -> V:trip ; add/edit -> S:expense{tripId} ; submitted -> V:claim
├─ V:expenses (TeOtherExpenses, no trip) ............. Part 5  add -> S:expense{} ; edit -> S:expense{line} ; trip card -> V:trip ; submitted -> V:claim
├─ V:claims (TeClaimList) ............................ Part 5  -> V:claim
├─ V:claim{id} (TeClaimDetail) ....................... Part 5  Back -> V:claims ; fix a line -> S:expense{line, tripId}
├─ V:advances (TeAdvances) ........................... Part 5  -> V:trip
├─ V:limits (TeLimitsAndRates + TeVehicleAdd) ........ Part 5
├─ V:approvals (TeApprovals -> TeClaimApproval / TeTripApproval / TeLegEvidence) ... Part 6
│
├─ S:expense{line?, tripId?} (TeExpenseForm) ......... Part 5  saved -> close, toast, V:expenses
├─ S:plan{...} (TePlanner, 3 steps) .................. Part 3
├─ S:startNow (TeStartNow) ........................... Part 4
└─ S:addLeg{detail} (TeLegAdd) ....................... Part 4  added -> close, toast, reload
```

Callback contracts that TeHome implements. RN navigation must reproduce each one:

| Child | Callback | TeHome does |
|---|---|---|
| TeOtherExpenses (both modes) | `onSubmitted(claimId, message)` | toast(message); reload(); view = claim{claimId} |
| TeOtherExpenses (no trip) | `onOpenTrip(id)` | close sheet; view = trip{id} |
| TeOtherExpenses (trip) | `onBack()` | view = trip{trip.id} |
| TeLimitsAndRates | `onChanged(message)` | toast; reload |
| TeAdvances | `onOpenTrip(id)` | view = trip{id} |
| TeApprovals | `onToast(message)` | toast; reload (refreshes queue, so the rail count changes) |
| TeTrips | `onOpen(id)` / `onNew(kind)` | view = trip{id} / sheet = plan{kind, past:false} |
| TeLegLive | `onEnded()` | toast "Journey ended. Add what it cost."; reload; view = trip{tripId} |
| TeLegLive | `onChanged(message)` | toast; reload (stays on the leg view, but the `leg` prop object is the one captured when the view opened; see note below) |
| TeLegReport | `onFiled(message)` | toast; reload; view = trip |
| TeLegMissed | `onDone(message)` | toast; reload; view = trip |
| TeTripDetail | `onChanged(message)` | toast; reload (TeTripDetail refetches its own detail) |
| TeTripDetail | `onEdit(detail)` | sheet = plan{kind: detail.trip.scope, past: detail.trip.origin==='POST_FACTO', editing: detail.trip} |
| TeTripDetail | `onOpenClaim(id)`, `onOpenLeg(leg)`, `onAddLeg(detail)`, `onAddBill(tripId)`, `onClaim(detail)` | view claim / view leg / sheet addLeg / sheet expense{tripId} / view tripClaim{trip} |
| TeClaimDetail | `onChanged(message)` / `onFixLine(line, tripId)` | toast+reload / sheet = expense{line, tripId} |
| TePickTrip | `onStartLeg(legId, leg)` / `onOpenTrip(id)` | close sheet; view = leg{leg.tripId, leg} / view trip |
| TeLegAdd | `onAdded(legId, message)` | `done(message)` = close sheet, toast, reload |
| TeStartNow | `onStarted(tripId, legId, message)` | close; toast; reload; view = leg if `snap.journeys` already holds legId, else trip{tripId}. In practice it is almost always the trip, because the snapshot in hand predates the new leg. **RN improvement:** after reload, open the leg. |
| TePlanner | `onSaved(id, message)` / `onVehicleAdded()` | done(message) then view = trip{id} / reload() only (keeps the sheet open) |
| TeExpenseForm | `onSaved(message)` | done(message); view = expenses. This happens even when the form was opened from a trip or a claim fix. The web returns to Other expenses. Keep it for parity or improve it deliberately. |
| (any) | `openLeg(tripId, legId)` from Continue rows | if the leg is not in the snapshot: toast "That journey is no longer there. Open the trip to see what changed." |

Note on V:leg: the `leg` object is captured in the view state when it is opened. A reload does not replace it, so leg screens that need fresh state re-read it from `snap.journeys` by id or refetch it (see Part 4).

## 0.4 Gating: what a given employee sees

| Screen / control | Shown when | Source |
|---|---|---|
| Rail "Approvals" item, its count, "Needs you" queue rows, V:approvals | `queue.length > 0` (GET /api/te/queue returns ≥1 row where the caller is the effective approver, or a member of the Finance team for a finance step). An ordinary employee never sees it. | TeHome |
| Kind tile badge "On the way" (pulsing dot) | a `continueItems(kind)` row has tone `live` (one of my journeys of that scope is ACTIVE/PAUSED) | entry-flow |
| Kind tile badge "N to do" | `continueItems(kind).length` | entry-flow |
| Other expense tile badge "N unclaimed" | count of my `snap.expenses` with `!other && !tripId && status==='UNCLAIMED'` | TeHome |
| Way "I already travelled" (local) disabled: "Your company accepts local trips only with GPS." | `!snap.cfg.track.manualAllowed` | entry-flow wayOff |
| Way "I already travelled" (domestic/intl) disabled: "Your company needs approval before every trip." | `snap.cfg.postFacto === 'blocked'` | wayOff |
| Way "Start an approved trip" disabled: "No approved domestic trip yet. Plan one first." (kind name lowercased) | no trip of mine with that scope and `display` APPROVED or ONGOING | wayOff |
| Way "Submit saved bills" (other) disabled: "No saved bills yet. Add one first." | not reachable from TeHome today (the Other tile opens the expense form directly) | wayOff |
| TeLiveBar | one of my journeys is ACTIVE or PAUSED, and the current view is not `leg` | TeHome |
| Trip detail actions (edit, cancel, answer, start journey, add journey, add bill, claim) | per trip/leg status, owner vs co-traveller, `detail.can` | Part 4 |
| Claim detail actions (respond, recall, fix a line) | claim status, `detail.can`, `line.fix` | Part 5 |
| Approve/decide buttons | `detail.can.act`, stage manager vs finance | Part 6 |
| Planner limits: post-facto window, advance cap, approval needed, entitlements | server preview (`/api/te/trips/preview`) from company policy (`snap.cfg`) and grade | Part 3 |

Policy lives on the server: `snap.cfg` (TeConfig: limits per grade x city tier, modes, categories, checks, gps rules `track.*`, vehicle rules `vehx.*`, `postFacto`, `receiptAbove`, `billAgeDays`, …) and `snap.emp[snap.me].grade`. The client only words it.

---

# Part 1 — Shared infrastructure

## 1.1 API client (`lib/te/client.ts`)

All employee calls are listed below. Base path `/api/te/`. Every response is JSON. The server wraps every route in `teRoute()`, which answers `{ ok: true }` when a function returns null/undefined.

| Client fn | Method + path | Body / query | Response |
|---|---|---|---|
| `te.me()` | GET `me` | – | `Snapshot` (types.ts) |
| `te.queue()` | GET `queue` | – | `{ queue: TeQueueRow[] }` -> client returns `.queue` |
| `te.placeAdd(i)` | POST `places` | `PlaceInput` | `{ place_id, matched?: true }` |
| `te.stayRequest(i)` | POST `bookings/request` | `StayRequestInput` | `{ booking_id, booking_no, status:'REQUESTED' }` |
| `te.vehicleLookup(reg)` | GET `vehicles/lookup?reg=` | – | `VehicleLookup` union (`{off:true,reg}` / `{notFound:true,reg}` / `{reg, rc, type, typeName, ownerMasked, match, valid:{rc,ins,puc}}`) |
| `te.vehicleAdd(i)` | POST `vehicles` | `VehicleInput {reg, type?, whose?, rc_file_url?}` | `{ vehicle_id, vehicle_type_code, is_verified }` |
| `te.tripPreview(d)` | POST `trips/preview` | `TripDraft` | `TripPreview` |
| `te.tripSave(d)` | POST `trips` | `TripDraft` (with `id` to edit) | `{ trip_id, trip_no, status, warnings[] }` |
| `te.trip(id)` | GET `trips/:id` | – | `TeTripDetail` |
| `te.tripAnswer(id,text)` | POST `trips/:id/action` | `{action:'answer', text}` | `{ trip_id, status }` |
| `te.tripCancel(id)` | POST `trips/:id/action` | `{action:'cancel'}` | `{ trip_id, status:'CANCELLED', deleted }` |
| `te.tripRecordMissed(id,reason,note?)` | POST `trips/:id/action` | `{action:'record-missed', reason, note}` | `{ trip_id, status }` |
| `te.legAdd(tripId, leg)` | POST `trips/:id/legs` | `ExtraLegInput {from,to,mode,vehicleId?,why?}` | `{ leg_id, leg_no }` |
| `te.legStart(id, fix)` | POST `legs/:id/action` | `{action:'start', fix: GpsFix}` | `{ leg_id, status:'ACTIVE', start_off_m }` |
| `te.legPings(id, pings)` | same | `{action:'pings', pings: GpsPing[]}` (≤5000) | `{ leg_id, stored, total }` |
| `te.legStop(id, stop)` | same | `{action:'stop', stop: StopInput}` | `{ leg_id, stop_id, seq, status:'PAUSED' }` |
| `te.legContinue(id, minutes?, at?)` | same | `{action:'continue', minutes, at}` | `{ leg_id, stop_id, minutes, status:'ACTIVE' }` |
| `te.legEnd(id, fix)` | same | `{action:'end', fix}` | `{ leg_id, status:'ENDED', gps_km, end_off_m, stats: TeLegStats }` |
| `te.legPreview(id, report)` | same | `{action:'preview', report: LegReportInput}` | `LegPreview` |
| `te.legFile(id, report)` | same | `{action:'file', report}` | `{ leg_id, status:'SUBMITTED', expense_id, trip_status, eligible, flags }` |
| `te.legSkip(id, reason)` | same | `{action:'skip', reason}` | `{ leg_id, status:'SKIPPED', trip_status }` |
| `te.legNoGps(id, reason, note?)` | same | `{action:'no-gps', reason, note}` | `{ leg_id, status:'ENDED' }` |
| `te.expensePreview(i)` | POST `expenses/preview` | `ExpenseInput` | `ExpensePreview` |
| `te.expenseSave(i)` | POST `expenses` | `ExpenseInput` (`id` to edit) | `{ expense_id, expense_no, status, eligible, flags }` |
| `te.expenseDiscard(id)` | DELETE `expenses/:id` | – | `{ expense_id, status:'DISCARDED' }` |
| `te.upload(file, kind)` | POST `upload` (multipart `file`, `kind`) | kind ∈ BILL, TICKET, TOLL_SLIP, FASTAG_STATEMENT, OTHER, RC | `{ file: TeUploadedFile }` -> client returns `.file` |
| `te.fileUrl(path, claimId?)` | GET `upload?path=&claim_id=` | – | `{ url, expires_in: 3600 }` |
| `te.claimPreview(i)` | POST `claims/preview` | `ClaimInput {tripId?, lineIds?, note?, declared?}` | `ClaimPreview` |
| `te.claimSubmit(i)` | POST `claims` | `ClaimInput` | `{ claim_id, claim_no, status, stage, risk_band, chain_notes[] }` |
| `te.claim(id)` | GET `claims/:id` | – | `TeClaimDetail` |
| `te.claimRespond(id, text)` | POST `claims/:id/action` | `{action:'respond', text}` | `ClaimResult` |
| `te.claimRecall(id)` | POST `claims/:id/action` | `{action:'recall'}` | `{ claim_id, status:'CANCELLED' }` |
| `te.tripDecide(id, action, comment?)` | POST `trips/:id/decide` | `{action: approve|sendback|reject, comment}` | `{ trip_id, status }` |
| `te.claimDecide(id, action, o)` | POST `claims/:id/decide` | `{action, stage?, comment?, decisions?, fix?}` | `ClaimResult {claim_id, status, stage, net_amount?, advance_adjusted?}` |
| `te.flagResolve(id, status, note)` | POST `flags/:id` | `{status: dismissed|confirmed, note}` | `{ flag_id, status, risk_band? }` |

The request bodies of `te.*` mirror the TS input types exactly. Parts 3–6 give the per-screen detail and the server rules.

## 1.2 Errors

Every non-2xx response body is `{ error: string, code: string|null, field?: string, flags?: TeFlag[], issues?: TripIssue[] }` (`lib/te/errors.ts` `mapTeError`). The client throws `TeApiError` (message = `error`, or "Sign in to continue." for a bare 401, or "The request failed (HTTP n)."). The UI shows `errorText(e)` = `e.message` or "Something went wrong. Try again.".

| HTTP | code | Meaning / fixed text |
|---|---|---|
| 400 | `TE_BAD_REQUEST` | route validation: "`<What>` is missing or is not a valid id." · "`<what>` is required." · "`<what>` must be one of: a, b." · "The request body is not valid JSON." · "The request body must be a JSON object." |
| 400 | `TE_INVALID` | DB constraint: "One of the values is not allowed, or is already in use. Check the form and try again." |
| 401 | `TE_SIGN_IN` | "Sign in to continue." |
| 403 | `TE_FORBIDDEN`, `TE_NO_EMPLOYEE` | not allowed |
| 409 | `TE_TRIP`, `TE_LEG`, `TE_GPS`, `TE_EXPENSE`, `TE_CLAIM`, `TE_PLACE`, `TE_VEHICLE`, `TE_NOT_WAITING`, `TE_REFUSED`, … | the rules said no. `message` is the sentence to show. `field` is the form field to mark. `flags` are the blocking flags. `issues` is the full trip-plan issue list |
| 413 | `FILE_TOO_LARGE` | upload size |
| 400 | `FILE_TYPE` | upload type |
| 502 | `UPLOAD_FAILED` | "The file could not be stored. Try again." |
| 503 | `TE_NOT_CONFIGURED`, `MIGRATION_PENDING`, `TE_SERVICE_KEY` | deployment problem |
| 500 | `TE_INTERNAL` | "Something went wrong on our side. Nothing was saved. Try again; if it keeps happening, tell your admin the time it happened." |

`TeApiError.refused` is `status === 409 || 403`. Screens use it to show the message inline beside the action rather than as a generic failure.

First-use seeding: if a company has no `te_settings` row, the first call refuses with `TE_NOT_SET_UP`. The server then seeds the company (`te_seed_company`) and retries the call once, so the client never sees this.

## 1.3 The snapshot (`GET /api/te/me` -> `Snapshot`)

SQL `te_snapshot(employee)` (migrations 148 and 161) builds it for the caller only:

- `today`: the company's "today" (IST calendar date, `te_today`). Use it, not the device clock, for date defaults and for the "today's journey" logic.
- `me`: my employee id. `emp`: a map of the people the screens may name (me, my managers rm/rm2/hod/md, the Finance team, co-travellers, approvers on my steps). Look up my own record with `emp[me]` (`name`, `code`, `title`, `grade`, `base` city, masked `acct`, `ifsc`).
- `cfg`: `TeConfig`, the company policy. `masters`: `cities` (city -> [tier, state code]), `regions`, `hubs` (area -> air/rail hub place ids), `places` (company places plus mine).
- `trips`: my trips **and trips I was added to as co-traveller** (`te_trip_people`), from the last 400 days or still open (DRAFT, PENDING_APPROVAL, SENT_BACK, APPROVED, CLAIMED). Ordered newest first.
- `journeys`: all legs of those trips, ordered by trip and then leg_no. `track` is filled only for an ACTIVE/PAUSED leg (or the one asked for with `p_opts.leg_id`).
- `expenses`: my lines (last 400 days, any unclaimed or in-claim line, or any line on a trip in the list). It also holds up to 200 colleagues' lines that could be duplicates of mine, marked `other: true`. **Always filter `!x.other` before showing expenses.**
- `claims`: my claims (last 400 days, or not finished). `advances`: mine. `bookings`: those on my trips. `periods`: travel periods (month, status OPEN/CLOSED/LOCKED, label). `vehicles`: my active vehicles. `routes`: `'<from>|<to>' -> km`. `codes`: EMP CODE -> id, for co-travellers.

Derived values TeHome computes from the snapshot (exact formulas):

```ts
const me = snap.emp[snap.me]
const open      = snap.claims.filter(c => ['IN_APPROVAL','IN_VERIFICATION','ON_HOLD'].includes(c.status))
const coming    = snap.claims.filter(c => ['IN_APPROVAL','IN_VERIFICATION','ON_HOLD','VERIFIED'].includes(c.status))
                             .reduce((a, c) => a + (c.net ?? c.approved ?? c.claimed), 0)
const advance   = snap.advances.reduce((a, x) => a + (x.outstanding || 0), 0)
const unclaimed = snap.expenses.filter(x => !x.other && !x.tripId && x.status === 'UNCLAIMED')
const sentBack  = snap.claims.filter(c => c.status === 'SENT_BACK')
const liveLeg   = snap.journeys.find(j => j.emp === snap.me && (j.status === 'ACTIVE' || j.status === 'PAUSED')) ?? null
const placeName = (id) => snap.masters.places.find(p => p.id === id)?.s ?? ''
const modeName  = (id) => snap.cfg.modes.find(m => m.id === id)?.name ?? ''
const catName   = new Map(snap.cfg.cats.map(c => [c.id, c.name]))
initials = me.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
```

## 1.4 Formatting (`lib/te/format.ts`, pure, importable as is)

- `rs(n)`: `₹` plus Indian grouping (`toLocaleString('en-IN')`), rounded, no paise, `-₹` for negatives. Example: `₹1,58,840`. **RN:** Hermes supports `toLocaleString('en-IN')` only with Intl enabled (on by default in Expo SDK ≥ 50). Verify, or fall back to a hand-written lakh grouping.
- `day('2026-11-16')` -> `16 Nov` (string parse, no time zone). `when(iso)` -> `16 Nov, 09:47` in IST (fixed +5:30). `plural(n, 'journey')` -> `1 journey` / `6 journeys`. `todayIst(ms)`.
- `claimChip(c)` -> label and tone:

| status | label | tone |
|---|---|---|
| IN_APPROVAL | With manager | t-warn |
| IN_VERIFICATION | With Finance | t-warn |
| ON_HOLD | On hold with Finance | t-warn |
| SENT_BACK | Needs your answer | t-crit |
| VERIFIED | Approved, awaiting payout | t-info |
| SETTLED | Settled | t-pos |
| REJECTED | Rejected | t-crit |
| CANCELLED | Taken back | plain |
| other | status with `_` replaced by spaces, lower case | plain |

- `claimHolder(c)`: SETTLED -> `Settled <when(settledAt)>`. VERIFIED -> `Verified <when(verifiedAt)>. Paid in the next payout.`. SENT_BACK -> `Sent back to you`. REJECTED/CANCELLED -> ''. Otherwise `With <whoName || role>` of the first `pending` step in `[...chain, ...fin]`.
- `flagClass(f)` -> `'flag crit'` if `f.block`, else `'flag warn'`.

## 1.5 Styling tokens and tones

`components/te/te.css` is scoped under `.te`. It uses the repo theme tokens `--ez-*` (`lib/ui/theme.css`; in TS `C.*` from `@/lib/ui`) plus a few module tokens. RN should map them to the same theme values, light and dark:

| te.css tone class | Fill | Text / icon | lib/ui token |
|---|---|---|---|
| `t-pos` (done, positive) | `--ez-positive-tint` #ECFDF5 | `--ez-positive` #047857 | `C.positiveTint` / `C.positive` |
| `t-warn` (waiting) | `--ez-warning-tint` #FFFBEB | `--ez-warning` #B45309 | `C.warningTint` / `C.warning` |
| `t-crit` (wrong, blocking) | `--ez-critical-tint` #FEF2F2 | `--ez-critical` #C0201F | `C.criticalTint` / `C.critical` |
| `t-info` (context) | `--ez-info-tint` #F0F9FF | `--ez-info` #0369A1 | `C.infoTint` / `C.info` |
| `t-brand` | `--ez-brand-tint` | `--ez-brand` | `C.brandTint` / `C.brand` |
| `plain` | `--ez-sunken` | `--ez-ink-soft` | `C.sunken` / `C.inkSoft` |

Dark values: positive #34D399 on #10241D, warning #FBBF24 on #251C0D, critical #F87171 on #2A1414, info #7DD3FC on #10222B.

- `.chip`: pill (radius 99, padding 2px 9px, 11.5px/600) with a 6px dot before the label in the current colour. `.chip.plain` has no dot.
- `.flag.crit` / `.flag.warn` / `.flag.info` / `.flag.ok`: a row box with the tint fill and the icon in the tone colour. `.flag.off` is opacity .6.
- Kind colours (`.k-<kind>` sets `--te-k` and `--te-kt`): local = positive (green), domestic = brand (blue), international = info (cyan-blue), other = warning (amber). Used on the tile icon square, on list row icons and on the sheet title icon.
- Continue rows: `.cont.go` and `.cont.live` use the brand-tint fill with a brand-edge border. `.cont.warn` uses the warning tint with a border of warning at 35%.
- Hero gradient (Home header block and brand mark): `--te-hero-a #1E3A8A` -> `--te-hero-b #2563EB` -> `--te-hero-c #38BDF8`. Dark: #0B1B45 -> #1D4ED8 -> #0EA5E9. Text on it is `--ez-on-dark`.
- Toast: ink background, canvas text, radius 12, bottom centre. Above the tab bar on phones (bottom 86px + safe area). `.toast.err` is critical red with white text.
- Fonts: UI "DM Sans"; display "Fraunces" (trip names `.tname`, brand mark); mono (`ui-monospace`) for numbers like claim no / reg no. Radius `--te-r` 14 / `--te-r-sm` 10.
- Layout breakpoints: ≤860px hides the rail and shows the 5-button bottom tab bar. Drawers become full width with no radius. The RN app is phone-first: use the tab-bar layout. Drawers become full-screen modals or bottom sheets.

## 1.6 Shared primitives

- **TeSheet** (`components/te/TeSheet.tsx`): a native `<dialog class="drawer">` opened with `showModal()`. It traps focus; Escape calls `onClose`. Props:
  - `title` (h2, with an optional `titleIcon` square before it)
  - `lead` (muted small line under the title)
  - `crumb` (node above the title)
  - `back` (renders a "Back" link with a back icon above the title)
  - `bar` (strip under the header, used for TeSteps)
  - `wide` (760px instead of 560px on desktop)
  - `footer` (sticky footer, used for action buttons)
  - a close "X" button with aria-label "Close"
  RN: a full-screen modal with header (back, title, close), an optional step bar, a scroll body and a sticky footer.
- **TeSteps** ("What › How › Details"): three step buttons from `flowSteps(kind, way)`:
  - `{small:'What', label: kind ? KIND_NAME[kind] : 'Choose'}`
  - `{small:'How', label: chosen way title || 'Choose'}`
  - `{small:'Details', label: way==='approved' ? 'Choose the trip' : 'Fill the form'}`
  A past step shows a check icon instead of its number and can be tapped (`onTo(step)`). The current step is highlighted (`.on`). Future steps are disabled.
- **TeIcon**: 24-unit stroke SVG paths (stroke width 1.75, round caps). Sizes: default 18px, `sm` 15px, `lg` 22px. An unknown name falls back to `info`. Names: local, domestic, international, other, go, close, warn, info, play, cal, history, back, check, plus, home, claims, advances, limits, more, people, minus, flag, alert, target, pin, rightc, up, down, compass, plane, route, swap, shield, car, bus, train, clock, verify, bike, file, receipt. RN: copy the path strings into `react-native-svg` `<Path>` (they are plain `d` strings).
- **Toast**: one at a time, 4 s, `aria-live="polite"`.

---

# Part 2 — TeHome screens (`components/te/TeHome.tsx`)

## 2.1 Module shell (header, rail, tab bar, loading)

Loading/error state (before `snap` exists):

- The header shows only the brand ("E" mark, "EZER" with small "Travel and Expenses") and, when `onExit` is given, a button "Back to ESS" with a back icon.
- The body is a single card with the muted text `error || 'Loading Travel and Expenses…'`.
- When there is an error, a button "Try again" calls `reload()`.
- A 401 shows "Sign in to continue." here, and the page redirect to `/ess-login` happens in parallel.

Header (loaded):

- Left: the brand.
- Right: "Back to ESS" (only when `onExit` is given), then the avatar circle with the initials, then the name (bold) with `me.title || me.code` under it (small).
- Sticky top.

Rail (desktop). Items in order:

1. Primary wide button "New claim" (plus icon). Opens S:new.
2. "Approvals" (check icon) with count `queue.length`. Only when the queue is non-empty.
3. "Home" (home).
4. "Trips" (local).
5. "Other expenses" (other), count `unclaimed.length` when > 0.
6. "My claims" (claims), count `open.length` when > 0.
7. "Advances" (advances).
8. "My limits and rates" (limits).

The active item has `aria-current="page"`. Every rail tap closes any sheet.

Bottom tab bar (phone). Five buttons:

1. "Home"
2. "Expenses": a red dot when `unclaimed.length` > 0.
3. "New claim": a raised round brand button, 46px, with a plus icon.
4. "Claims": active on both `claims` and `claim` views. A red dot when `sentBack.length` > 0.
5. "ESS" with the "more" icon. Calls `onExit`. Without `onExit` it reads "More" and goes Home.

**Gap:** on a phone, Trips, Advances, My limits and rates and Approvals have no tab. They are reached only through Home ("Needs you" rows, tiles and sheets) or through links inside other screens. The RN app needs a "More" menu listing Trips, Advances, My limits and rates, Approvals (when the queue is non-empty) and Back to ESS, to reach parity with the desktop rail.

## 2.2 Home (`view = home`)

Order of sections:

1. **TeLiveBar**, if a journey is live (Part 4).
2. **Hero** (`section.hero`, gradient background):
   - h1 `Hello, <first word of me.name>`.
   - p "Where are you travelling today?".
   - Three KPIs, each a bold tabular number over a caption:
     - `rs(coming)` "coming to you"
     - `open.length` "claims in approval"
     - `rs(advance)` "advance with you"
3. **Kind tiles** (`.kinds`, 4 buttons; 2 columns on narrow screens). Each tile has:
   - a coloured icon square (`k-<id>`)
   - an optional badge at the top right
   - title (bold) and text (small; hidden at ≤720px)
   - foot: a grey chip with the foot text, then a go arrow

   | id | title | text | foot |
   |---|---|---|---|
   | local | Local trip | Office, factory, client or warehouse in your city. Back the same day. | Any travel except flight |
   | domestic | Domestic trip | Another city in India. Flights, trains, cabs, hotel and food in one trip. | Flight or any travel |
   | international | International trip | Any country. Flights, cabs abroad, hotel and food in one trip. | Any country |
   | other | Other expense | Client meal, courier, parking, printing. A bill with no travel. | Bill with no trip |

   Badge: if `live[kind]`, show `.kb.live` with a green dot and "On the way". Else if `todo[kind]`, show `.kb` with "`n` to do" (trip kinds) or "`n` unclaimed" (other).

   Tap: `other` opens S:expense{} (straight to the expense form, skipping step 2). Any other kind opens S:kind{kind, way:null}.
4. **"Needs you" card**. Shown only if `unclaimed.length || sentBack.length || queue.length`. Header row: "Needs you" and a count = `(unclaimed.length ? 1 : 0) + sentBack.length + queue.length`. Rows, in order:
   - For each sent-back claim: icon `other`; bold "Claim `<c.no>` was sent back to you."; muted "Correct the lines and answer."; right "Open" with arrow. Opens V:claim{c.id}.
   - Once, if there are unclaimed bills:
     - bold "`n` other expense is saved but not submitted." when n = 1, "`n` other expenses are saved but not submitted." otherwise;
     - muted `rs(sum of claimed)`;
     - right "Review and submit". Opens V:expenses.
   - For each queue row: icon `other` (claim) or `local` (trip). Bold "`Claim|Trip plan` `<ref_no>` from `<employee_name>` is waiting for you."; muted "`rs(amount)` · `<role_label>`"; right "Decide". Opens V:approvals.

   At ≤720px the right-hand text collapses to just the arrow.

There is no explicit empty state: with nothing pending, Home shows only the hero and the tiles.

## 2.3 Sheet "New claim" (step 1, `sheet = new`)

- TeSheet wide, title "New claim", lead "Three steps: what, how, then the form.", bar = TeSteps(on=1, kind=null, way=null).
- Body: the same four kind tiles as Home, with the same badges and taps.

## 2.4 Sheet "<Kind> trip" (step 2, `sheet = kind{kind, way:null}`)

- TeSheet wide:
  - title `KIND_NAME[kind]` ("Local trip" / "Domestic trip" / "International trip")
  - titleIcon: kind-coloured square with the kind icon
  - lead: the tile text
  - back: S:new
  - bar: TeSteps(on=2, kind, way). Tapping step 1 goes to S:new.
- **Section "Continue"** (only when `continueItems(kind, facts)` is non-empty). Rows are `.cont.<tone>`. Each row has:
  - eyebrow: the trip name
  - bold title
  - small muted sub line
  - a button with the btn text and a go arrow. Primary style for tone `go` or `live`, plain otherwise. Its action:
    - `openTrip`: V:trip{id}
    - `legOpen` / `legStart`: `openLeg(tripId, legId)`, which goes to V:leg

  `continueItems` covers one trip at a time: my own trips of that scope, a single row per trip, carrying the most urgent reason. Rule order:

  | Condition (first match) | tone | title | sub | btn | action |
  |---|---|---|---|---|---|
  | my running journey (ACTIVE/PAUSED) belongs to this trip | live | `On the way: journey <n>` | `<from> → <to>` | Open the journey | legOpen |
  | a journey of the trip is ENDED | warn | `Journey <n> ended. Save its report` | `<from> → <to>` | Save report | legOpen |
  | a PLANNED journey dated `snap.today` with no earlier journey still PLANNED/ACTIVE/PAUSED, and trip.display APPROVED or ONGOING | go | `Ready today: journey <n> of <count>` | `<from> → <to> · <mode name>` | `Check in` if leg.gps==='checkin' else `Start journey` | legStart |
  | trip.display COMPLETED | warn | Back. Send the claim | `<count> journey(s) closed` | Open trip | openTrip |
  | trip.display MISSED | warn | `Not travelled on <day(start)>` | Add the journeys without GPS, or remove it | Open trip | openTrip |
  | trip.display SENT_BACK | warn | Your approver asked a question | Answer and send it again | Open trip | openTrip |
  | trip.display DRAFT and origin POST_FACTO | '' | Recorded after travel: add the fares | `<count> journey(s)` | Open trip | openTrip |
- **Section heading**: "Or start something new" if there were continue rows, else "How do you want to start?". Below it, the **ways** of `FLOW_WAYS[kind]`. Each way is a button with:
  - an icon square
  - the bold title, plus a brand chip with the count when `wayCount > 0` (approved trips for "approved")
  - small text: the `wayOff` reason when disabled, else the way's text
  - the chips row (only when enabled)
  - a go arrow (only when enabled)

  The first way, when enabled, is styled primary (`way pri`). Disabled ways are `disabled`. Ways per kind (title, icon, text, chips):
  - local:
    - **Start now** (play): "Leaving now. Your phone records each journey, with stops, until you are back." chips "GPS on every journey", "No approval up to 75 km".
    - **Plan a trip** (cal): "For later today or another day. Add stops and the people going with you." chips "Approval above 75 km".
    - **I already travelled** (history): "The trip was not tracked and you want the reimbursement. Within 7 days." chips "Journeys without GPS", "Reason needed".
  - domestic:
    - **Plan a trip** (cal): "Flights, trains, cabs and hotel. It goes for approval, the Travel Desk books." chips "Approval before you leave", "Advance if needed".
    - **Start an approved trip** (play): "Your trip is approved. Start its first journey or check in at the airport." chips "GPS and check-ins".
    - **I already travelled** (history): "You travelled without approval and want the reimbursement." chips "HOD approves", "Reason needed".
  - international:
    - **Plan a trip**: "Any country. Flights, cabs abroad and hotel. RM and HOD approve." chips "Approval before you leave", "Advance if needed".
    - **Start an approved trip**: same text, chips "Check-ins abroad".
    - **I already travelled**: same as domestic.

  The "75 km" and "7 days" numbers are static copy in `FLOW_WAYS`. They do not come from `cfg`. The real thresholds are server policy (`cfg.track.*`, `cfg.graceDays` / post-facto window). Treat these as copy and keep them identical.

  Way taps:
  - `approved`: sheet = kind{kind, way:'approved'}
  - `plan`: S:plan{kind, past:false}
  - `past`: S:plan{kind, past:true}
  - `start`: S:startNow
  - anything else: toast "There is no screen for “`<id>`”." (unreachable)

## 2.5 Sheet "<Kind> trip", step 3 "Choose the trip" (`sheet = kind{kind, way:'approved'}`)

The same sheet header with back = step 2 and TeSteps(on=3). The body is **TePickTrip** (Part 4). It receives `scope`, `me`, `trips`, `journeys`, `today` and `placeName`:

- `onStartLeg(legId, leg)` closes the sheet and opens V:leg.
- `onOpenTrip` opens V:trip.

---

# Part 3 — Trip planner, places and maps

Scope of this part: the three-step trip planner (plan ahead, record a trip already taken, edit a saved or sent-back trip), the place picker (shared with Start now and Add a journey), the pin map, the Google Maps components, the schematic trip map, the "open in a map app" links, the pure helpers behind them, the three APIs they call (`POST /api/te/trips/preview`, `POST /api/te/trips`, `POST /api/te/places`), and the engine logic that produces every planner message, leg, estimate, advance cap and entitlement.

Conventions in this part: quoted strings are exact UI text. `{x}` marks a substituted value. "Issue key" means `TripIssue.k`. All money uses `rs()` from lib/te/format.ts (`₹` + Indian grouping, rounded, e.g. `₹12,300`). All short dates on the client use `day()` from lib/te/format.ts (`'16 Nov'`). `plural(n, word)` gives `"1 journey"` / `"3 journeys"`.

---

## Trip planner shell (components/te/plan/TePlanner.tsx)

### Purpose and entry
One component serves every planning flow: local / domestic / international, planned ahead (`origin: 'PRE_APPROVED'`) or already travelled (`origin: 'POST_FACTO'`), new or editing. TeHome opens it as sheet `{ name: 'plan', kind: TripScope, past: boolean, editing?: TeTrip }`:
- from the Trips list "new" button: `{ name:'plan', kind, past:false }`
- from the entry flow ("ways" tiles) way `plan` or `past`: `{ name:'plan', kind, past: w.id === 'past' }`
- from the trip screen Edit: `{ name:'plan', kind: d.trip.scope, past: d.trip.origin === 'POST_FACTO', editing: d.trip }`

Props:

| Prop | Type | Notes |
|---|---|---|
| `snap` | `Snapshot` | |
| `scope` | `TripScope` | ignored when `editing` is set (taken from the trip) |
| `origin` | `'PRE_APPROVED' \| 'POST_FACTO'` | TeHome passes `sheet.past ? 'POST_FACTO' : 'PRE_APPROVED'`; ignored when editing |
| `editing?` | `TeTrip` | read ONCE on mount (not watched) |
| `onClose()` | | TeHome: `setSheet(null)` |
| `onSaved(tripId, message)` | | TeHome: `done(message)` (closes sheet, shows toast, `reload()`), then `setView({ name:'trip', id })` — lands on the new/edited trip |
| `onVehicleAdded?()` | | TeHome passes `reload` only. Must NOT close the planner (the draft lives in planner state). |

### Draft context (`DraftContext`, memoised on `snap`)
- `today`: `snap.today`
- `officePlace`: id of the first `snap.masters.places` entry with `pt === 'corp'` and `city === snap.emp[snap.me].base`; else first with `pt === 'corp'`; else `''`.
- `vehicles`: `snap.vehicles.filter(v => v.verified || v.whose === 'self')` (note: not filtered by owner; the snapshot's vehicles are the employee's).
- `modes`: `snap.cfg.modes`
- `placeName(id)`: `snap.masters.places.find(p => p.id === id)?.s ?? ''`

(TePlanRoute rebuilds a near-identical context with `ctxOf(snap)`, whose `officePlace` is simply the first `corp` place. `officePlace` is only used when a brand-new draft is created, so the difference has no visible effect.)

### Local state

| State | Type | Initial |
|---|---|---|
| `draft` | `PlannerDraft` | `editing ? fromTrip(editing, ctx) : { ...newPlannerDraft({ scope, origin, lastWorkday: lastWorkday(snap.today) }, ctx), lockScope: true }` |
| `preview` | `TripPreview \| null` | `null` |
| `previewFailed` | boolean | false |
| `saving` | boolean | false |
| `toast` | string | `''` — auto-cleared 4200 ms after it is set |
| `picking` | `PickTarget \| null` | null — when set, the place picker replaces the whole sheet |

`edit(patch | fn)`: every change goes through `syncDraft(next, ctx)` (shape repair, see lib/te/trip-draft.ts). Changing the kind uses `setScope(d, s, ctx, lastWorkday(snap.today))` instead.

`payload = toTripDraft(draft)` (memo on `draft`).

`export function lastWorkday(today: IsoDate): IsoDate` — steps back one day at a time (UTC) from `today` until the day is not Saturday or Sunday. Pure. Used as the default date of a post-facto local trip.

### Live preview (the only validator)
- `useEffect` on `payload`: after **350 ms** debounce, `te.tripPreview(payload)` = `POST /api/te/trips/preview` with the `TripDraft` JSON body.
- A response arriving after the payload changed again is dropped (a `current` flag is cleared in the effect cleanup, which also clears the timer).
- Success: `preview = response`, `previewFailed = false`. Failure: `preview = null`, `previewFailed = true`.
- It runs on mount too (empty draft), so "Give the trip a name" etc. arrive from the server.
- Because `payload` is recomputed whenever any `draft` field changes (including `step`, `open`, `tried`), the preview also re-fires after navigation or opening/closing a route line, not only after data edits. A rebuild may deep-compare the payload; the observable result is the same.
- `issues = preview?.issues ?? []`.

### Layout (TeSheet, `wide`)
- **Title**:
  - editing: `"Edit {draft.name || 'trip'}"`
  - planning (origin not POST_FACTO): `"Plan a trip"`
  - post-facto: `"Record a trip you already did"`
- **Lead**:
  - editing and sent back (`draft.answerNeeded`): `"Change what your approver asked about, then send it again."`
  - editing otherwise: `"Change the plan."`
  - planning: `"Three short steps. Every journey, stop and bill stays inside this trip."`
  - post-facto: `"For a trip that was not tracked. The journeys are added without GPS and your approver sees why."`
- **Crumb** (TeSheet `crumb`, only when NOT editing): `<span class="fpath"><span class="fstep">Step 3 of 3</span>{KIND_LABEL} › {'Plan a trip' | 'I already travelled'}</span>` — "Step 3 of 3" refers to the entry flow (kind → way → planner). KIND_LABEL: local `"Local trip"`, domestic `"Domestic trip"`, international `"International trip"`. The `›` separator is wrapped in `span.muted` with spaces either side.
- **Bar** (TeSheet `bar`): `nav.wsteps` (aria-label "Steps") with three buttons `button.ws`:

  | n | Title (bold) | Sub (small) |
  |---|---|---|
  | 1 | "Trip" | "Name, reason, people" |
  | 2 | "Route" | "Places, stops, travel" |
  | 3 | "Review" | "Journeys, money, approval" |

  Class: `on` when current; `done` when `step > n` and the step has no error; extra `bad` when `stepHasError(n)` = `draft.tried && blockingOn(issues, n).length > 0`. Number bubble `span.wn` shows a check icon when done, else the number. Clicking a step chip calls `goStep(n)` **without validation** (only Next is gated; the save catches everything).
- **Body**: step 1 `TePlanTrip`, step 2 `TePlanRoute`, step 3 `TePlanReview`.
- **Toast**: inside the sheet, `div.toasts > div.toast.err` with a `warn` icon + text. (Every planner toast uses the error style, including the success message from adding a vehicle.)
- **Footer**:
  1. `div.tw-bar` summary line (see below).
  2. `div.row.tight` buttons:
     - left: step > 1 → `button.btn` "Back" (back icon) → `goStep(step-1)`; step 1 → `button.btn` "Cancel" → `onClose()`.
     - right: step < 3 → `button.btn.pri` `"Next: {next step title}"` (go icon) i.e. "Next: Route" / "Next: Review" → `next()`; step 3 → `button.btn.pri` `saving ? "Saving…" : sendLabel`, disabled while saving → `save()`.

  `sendLabel`:
  - editing & answerNeeded → `"Send again"`; editing otherwise → `"Save changes"`
  - post-facto → `"Save and add the fares"`
  - planning and `preview && !preview.needsApproval` → `"Save the plan"`
  - otherwise → `"Send for approval"`

### Footer summary (`summary(preview, pax, planning)`)
- No legs: `span.muted` `"Add the places to see the journeys"`.
- Else, concatenated: **`plural(legs.length, 'journey')`** (bold) + `" · {km} km"` where km = sum of `l.km` over non-flight legs, rounded to 1 decimal + (if flights) `" + {plural(flights, 'flight')}"` + (if planning and `estimateTotal` non-zero) `" · "` + **`rs(estimateTotal)`** + `" est."` + (if pax > 1) `" · {pax} people"`.
- Example: "3 journeys · 42.5 km + 1 flight · ₹12,300 est. · 2 people".

### Navigation
`goStep(n)`: sets `draft.step = n` (through syncDraft). Arriving on step 2 while `draft.open === undefined` sets `open = firstOpenLine(issues)` (opens the first route line with a blocking issue). Also scrolls the body to top.

`next()`:
1. No preview yet → toast `previewFailed ? "Could not check this plan just now. Try again in a moment." : "Checking the plan…"`; stay.
2. `blocking = blockingOn(issues, step)` (blocking issues owned by this step via `stepOfIssue`). If any → `tried = true` (and on step 2 `open = firstOpenLine(issues)`); toast = the issue text if exactly one, else `"{n} things to fill on this step. They are marked in red."`; stay.
3. Else `goStep(step + 1)`.

`save()` (step 3 primary):
1. No preview → same two toasts as above.
2. Any blocking issue at all → `tried = true`, `step` = lowest step owning a blocking issue; toast `"A few things are missing. They are marked in red."`.
3. Else `saving = true`; `te.tripSave(payload)` = `POST /api/te/trips` with the same `TripDraft` body. Success → `onSaved(r.trip_id, "{r.trip_no} saved.")` (e.g. "TRP-0042 saved."). `r.status` and `r.warnings` are not used. Failure → toast `errorText(e)`. `saving = false` in finally.

### Place picker hand-off
When `picking` is set, the planner renders `<TePlacePicker snap target={picking} onCancel={() => setPicking(null)} onChosen=...>` instead of the sheet. `onChosen(placeId, pt?)`:
- target `kind:'point'`: `points[index] = { ...points[index], place: placeId, pt: pt || points[index].pt }`, and `open = 'p{index}'` (keeps that line open).
- target `kind:'hub'`: `segs[index].xfer.hubA` (side A) or `.hubB` (side B) = placeId.
Both through `edit()` (syncDraft).

Known gap: a place created inside the picker (GPS or typed address) is not in `snap.masters.places` until TeHome reloads the snapshot, and the planner does not trigger a reload after `placeAdd`. The server preview resolves it (its snapshot is loaded with the draft's place ids), but the route line shows its placeholder text until the next snapshot reload. A rebuild should insert the returned place locally or reload.

---

## Planner step 1 — Trip (components/te/plan/TePlanTrip.tsx)

Props: `snap`, `draft`, `issues`, `edit`, `setScope(s)` (planner wraps `setScope()` from trip-draft). Field errors: `err(key) = errorFor(issues, key, draft.tried)`; each is rendered as `div.ferr` (warn icon + text) directly under its section, only after the person has tried to move on.

Sections in order:

1. **Name** (`div.sec.namefirst`)
   - Label "Trip name"; `input`, `maxLength = MAX_NAME (60)`, autocomplete off.
   - Placeholder by scope: local `"Like Manesar plant audit"`, domestic `"Like Mumbai client review"`, international `"Like Dubai distributor summit"`.
   - onChange: `edit({ name: value, nameTouched: !!value.trim() })` — clearing the field hands the name back to the generator.
   - Helper `small.muted`: `nameTouched ? "Your own name for the trip." : "Filled in from where you go. Type to change it."`
   - Error key `name`.
   - Auto-name: see `autoName()` in trip-draft (e.g. "Mumbai client meeting").

2. **Kind**
   - `draft.lockScope` (new trip from the entry flow): a read-only row `div.kindrow.k-{scope}` with the scope icon, bold `"{KIND.name}"` + `", already travelled"` when post-facto, and small `"{tag} · {desc}"`.
   - Otherwise (editing): heading `h4` "What kind of trip" and three `button.scopec` (aria-pressed when selected) for local/domestic/international, each: icon, bold name without " trip" ("Local", "Domestic", "International"), `small` desc, `small.muted` tag. Click → `setScope(s)`.
   - KIND table:

     | scope | name | tag | desc |
     |---|---|---|---|
     | local | "Local trip" | "Any travel except flight" | "In the city or nearby, back the same day" |
     | domestic | "Domestic trip" | "Flight or any travel" | "Another city in India, or a night away" |
     | international | "International trip" | "Any country" | "Any country, city and address" |
   - Error key `scope` (e.g. "A place is outside India. Choose International.").

3. **Why**: `h4` "Why"; option buttons `button.opt` (aria-pressed) for each of `PURPOSES`: "Client meeting", "Site or plant visit", "Dealer or partner visit", "Delivery or collection", "Audit or inspection", "Training or event", "Bank or government work", "Other". Click → `edit({ purpose })`. Error key `purpose`. Then field "Client or project", placeholder "Optional" → `edit({ project })`.

4. **Who is travelling** (`div.ppl`)
   - Head: people icon, bold "Who is travelling", small "Count yourself too. Each person claims their own expenses."
   - Stepper (`div.stepper`, aria "People travelling"): minus (aria "One less", disabled at pax ≤ 1), number + `"person"`/`"people"`, plus (aria "One more", disabled at pax ≥ `MAX_PEOPLE` = 20). `pax ± 1` via edit; syncDraft resizes `people` to `pax - 1` rows.
   - Row 1 (`ppl-row.me`): "1", bold employee name (`snap.emp[snap.me].name`), `span.small.muted.mono` code, chip `span.chip.plain.t-brand` "You".
   - Rows 2..pax (one per `draft.people[i]`): number `i+2`; field "Employee ID" (placeholder "SRS0533", autocapitalize characters, autocomplete off); field "Name" (placeholder "Full name"); remove button (close icon, aria "Remove person {i+2}") → removes that row and sets `pax = max(1, pax-1)`.
   - Row status (`div.ppl-st`), from the typed code `code = id.trim().toUpperCase()`:
     - empty → nothing
     - equals my own code → `span.pst.bad` "That is you. You are already counted."
     - found → `span.pst.ok` check icon + `"{name} · {grade} · found in EZER"`
     - not found → `span.pst.warn` "Not found in EZER. Your approver will check."
   - Lookup: `snap.codes[code] → employee id → snap.emp[id]`. Typing a code that is found fills the name when the name is empty or was itself auto-filled (`autoName` flag); typing in the name clears that flag, so a typed name is never overwritten.
   - Link button `button.addp` "Add a person" (plus icon), disabled at 20 → pax + 1.
   - Error key `pax`.

   Important data caveat: the client snapshot (`GET /api/te/me`) only contains `codes`/`emp` entries for colleagues already on the employee's trips. A colleague typed for the first time therefore shows "Not found in EZER…" on the client even if they exist; the server preview (which loads the snapshot with the typed codes) resolves them and emits no warning. Parity rebuilds inherit this; a lookup endpoint would fix it.

Co-traveller payload: `toTripDraft` sends `people: [{ id: CODE_UPPERCASED, name: trimmed }]`, dropping rows where both are empty. The server resolves codes to employee ids (`trip.co`); those people cannot approve the trip or its claim. lib/te/co-traveller.ts is NOT used by the planner (it serves trip/claim screens for co-travellers).

---

## Planner step 2 — Route (components/te/plan/TePlanRoute.tsx)

Props: `snap`, `draft`, `issues`, `preview`, `edit`, `onPick(PickTarget)`, `onVehicleAdded(message)`. `local = scope === 'local'`, `planning = origin !== 'POST_FACTO'`. Places looked up in `snap.masters.places`; place-type names in `snap.cfg.ptypes`.

### Header
- `h4` "Route" and a segmented control (`div.seg.sm`, aria "Way back"): "One way" (go icon, pressed when no return point) → `setPattern(d,'oneway')`; "Round trip" (swap icon, pressed when a return point exists) → `setPattern(d,'round')`. (Multi-city is not chosen here; it follows from adding stops/destinations.)

### Dates row (`div.rdate`)
- Date input labelled: local → planning "Date of the trip" / past "Date you travelled"; else planning "Leave on" / past "Left on". Value `points[0].leave`. `min = snap.today` when planning; `max = snap.today` when post-facto. Sets `points[0].leave`.
- Only when the route has a return point: date input "Back at the start on", value `retPoint.arrive`, `min` = latest `leave` among non-return points, else `points[0].leave`; `max = today` when post-facto. Sets `arrive` on the return point. Optional: left empty, the server derives the end date from the last place left. Shown for local trips too.
- `p.small.muted`: `"{PATTERN_WORD}{', N stop(s)' if stops>0}. Tap a line to change it."` PATTERN_WORD: oneway "Single", round "Round trip", multi "Multi-city". stops = (number of destinations) − 1. Example: "Multi-city, 1 stop. Tap a line to change it."
- Error key `d0` below.

### Route list (`div.rlist`): for each point i, then the segment after it
Labels from `pointLabel(draft, i)`: "Start" (i=0), "Back to" (return), "Stop {no}" (any destination before the last), "Destination" (last destination).

**"Add a stop"** — rendered just before the last destination's row (when `i === L.last && L.last > 0`): `button.raddstop` "Add a stop" (plus icon) + `span.small.muted` `"on the way to {last destination's short name || 'the destination'}"`. Action: `addStop(d, L.last - 1)` — inserts a blank point right before the last destination and opens it.

**Point row** `div.rrow` (+`stop`, `ret`, `bad` when a blocking issue exists and tried, `open`):
- Marker: `span.mk.a` "A" for start or a return locked to the start; `span.mk.s` with the stop number for stops; `span.mk.b` flag icon (title "Destination") for destinations/return.
- Head button (`aria-expanded`), toggles `open = 'p{i}'` / null:
  - `small` label; bold place short name `pc.s`, or placeholder in `span.ph0`: i=0 "Choose where you start"; return "Choose where you come back to"; stop "Choose the stop"; else "Choose where you go".
  - Sub line `span.rsub`, parts joined by " · ":
    - return locked to start (`ret && retSame`): "Same as the start", then the "when" text;
    - otherwise: place-type name (if a place and pt are set), `what` (non-start, non-return), "when".
    - "when": return → `"Back on {day(p.arrive)}"` if typed, else `"Back on {day(arrival from preview)}"`, else ''. Local non-return → ''. Destinations (non-local) → `"{arrive} to {leave}"` (each via `day()`, leave omitted if equal to arrive or empty).
    - Arrival comes from the preview: `preview.legs.find(l => l.to === point.place)?.date`.
  - Issue line when the row is closed: the first blocking issue with key `p{i}` (or `d{i}` for i>0) is shown as `span.rsub.bad` (after tried) or `span.rsub.todo` (before tried, only when a place is already chosen), alert icon + text.
- Remove button `button.rx` (close icon, aria/title "Remove {label}") on stops only → `removePoint(d, i)` (closes all lines).

**Point editor** (when open, `div.redit`):
1. Return point only: checkbox "Same as the start" bound to `retSame`.
2. Unless the return is locked to the start:
   - Location button `button.locb`: marker "A" (i=0) or "B"; `small` = `locLabel`: "Where you start" / "Where you come back to" / "Where you stop" / "Where you go", plus ", in any country" for international non-start; then the place name and `span.ad` address (`addr || name`), or the placeholder. Click → `onPick({ kind:'point', index:i, title: pickTitle(i), intl: scope==='international' && i>0 && !ret })`.
   - `pickTitle`: i=0 "Where the trip starts"; return "Where you come back to"; multi pattern `"Destination {i}"`; else "Destination".
   - Links: "Use my current location" (target icon) → `onPick({ kind:'point', index:i, title, useGps:true })`; "Enter the address" (pin icon) → `onPick({ kind:'point', index:i, title, address:true, intl })`.
3. Error key `p{i}`.
4. When a place is chosen and not locked (`div.rp-det`):
   - Select "Type of place": option "Choose" (value '') only while pt is empty, then `snap.cfg.ptypes.filter(t => t.on)` as `{id → name}`. Engine default ptypes: corp "Corporate office", branch "Branch or regional office", factory "Factory or plant", warehouse "Warehouse or depot", client "Client site", dealer "Dealer or distributor", vendor "Vendor or supplier", site "Project site", event "Event, expo or training venue", govt "Bank or government office", airport "Airport", station "Railway or bus station", hotel "Hotel or stay", home "Home", other "Other" (admin can rename/disable).
   - Destinations and stops (not start, not return): text field labelled "Why you stop here" (stop, placeholder "Pick up samples, meet the dealer") or "What you will do there" (placeholder "Meeting, audit, delivery") → `what`.
   - Non-local destinations/stops: date field labelled "Stay until, if you stay" (the last destination of a one-way trip) or "Leave on"; `min = arrival`; helper `small` `"Arrive {day(arrival)}"` (or a blank space) → `leave`.
5. Error key `d{i}` (i>0).
6. Footer `div.rfoot`: for destinations when there are 2+ destinations: "Earlier" (up icon, disabled when i ≤ 1) → `movePoint(d,i,-1)`; "Later" (down icon, disabled when i ≥ last destination) → `movePoint(d,i,1)`; then `button.btn.sm.pri` "Done" (check icon) → closes the line.

After the list: error key `pr` ("Choose where you return to.").

### Segment row (SegRow, defined outside the parent) — travel between point i and i+1
State: `addingVehicle` (bool, false). `s = draft.segs[i]`; `md = cfg.modes.find(id === s.mode)`; `mine = snap.vehicles.filter(v => v.emp === snap.me)`. Error = first blocking issue with key `m{i}`.

- Head button `button.rshead` (toggles `open = 's{i}'`): mode icon (MODE_ICON: own/company/cab/auto/rental → car; public/bus → bus; train → train; flight → plane; else route), bold mode name or "Choose how you travel", `span.rsub` bits joined by " · ": vehicle registration (own vehicle) and, when desk-bookable, "You book" (`bookedBy === 'self'`) or "Travel Desk books"; tag `span.rtag` "Check-ins" (target icon, when `md.gps === 'checkin'`) or "GPS" (route icon).
- Closed + error + tried: `div.ferr` alert icon + error text.
- Open (`div.redit.sg`):
  1. **Mode chips** (`div.rs-modes`, aria `"How you travel from {A} to {B}"`): `snap.cfg.modes.filter(m => m.on && m.scopes.includes(draft.scope))`; each `button.mchip` (aria-pressed), title `"{name}: {PAY_WORDS[basis]}"`. Click → `mode = m.id`, `vehicleId = m.id === 'own' ? (s.vehicleId || snap.vehicles[0]?.id || '') : ''`.
     PAY_WORDS: km "Paid per km", bill "Paid on your bill", nobill "Fare, no bill needed", ticket "Paid on the ticket", none "Not paid, only logged".
     Default engine modes and scopes:

     | id | name | basis | scopes | gps | stops |
     |---|---|---|---|---|---|
     | own | Own vehicle | km | local, domestic | track | yes |
     | company | Company vehicle | none | local, domestic | track | yes |
     | cab | Cab or taxi | bill | all three | track | yes |
     | auto | Auto-rickshaw | nobill | local, domestic | track | yes |
     | public | City bus or metro | nobill | all three | track | no |
     | rental | Rental car | bill | domestic, international | track | yes |
     | train | Train | ticket | all three | track | no |
     | bus | Intercity bus | ticket | domestic, international | track | no |
     | flight | Flight | ticket | domestic, international | checkin | no |
  2. **Own vehicle** (`mode === 'own'`, `div.vpick`): chips `button.vchip` for each of `mine` (aria-pressed when selected): car/bike icon, mono reg, small `vehicleSubtitle(v, snap.cfg.vehicles, snap.cfg.fuelPrice)` + `" · HR to check"` when unverified → `vehicleId = v.id`. If the employee has vehicles, a chip `vchip.add` "Another vehicle" / small "Any vehicle, by its number" toggles `addingVehicle`. When `addingVehicle` or no vehicles at all: inline `<TeVehicleAdd snap first={!mine.length} onClose={mine.length ? close : undefined} onAdded={(vehicleId, message) => …}>` (documented by the vehicles writer). onAdded: closes the form; every segment that is this one, or is `own` without a vehicle, gets `mode:'own', vehicleId`; then `onVehicleAdded(message)` → planner toasts the message and calls TeHome `reload()`.
  3. **Who books** — shown when `md.basis === 'ticket'` and not post-facto and not local: segmented "Travel Desk books" (pressed unless `bookedBy === 'self'`) → `bookedBy:'desk'`; "I book and claim" → `bookedBy:'self'`. (syncDraft forces `bookedBy:'self'` on local trips; the server stores `booked_by='self'` for non-ticket modes.)
  4. **Airports / stations** — when mode is `flight` or `train` and scope is not local: two `button.locb.hubb` (class `need` when unset), side A then B. Word = "airport" (flight) / "station" (train). Text: small `"The {word} you {leave from|arrive at}{', ' + city}"`; set → bold hub short name + `span.ad` "Chosen by you. Tap to change"; unset → bold `"Choose the {word}"` + `"No {word} is set up for {city || 'this city'}"`. City = `city.city || city.s`. Click → `onPick({ kind:'hub', index:i, side, title: "Airport in {city}" | "Railway station in {city}", hub: 'airport'|'station' })`. Note: the buttons are always shown for flight/train, even when the engine already knows a hub for the city (HUBS / a place of type airport/station); in that case the engine's hub wins and these choices are ignored by the engine.
  5. Note line `div.rs-note` (icon target/route): `" {PAY_WORDS[basis]}. "` + (check-in mode: "Check-in by GPS at both ends. No stops on the way.") or ("GPS records the route." + (md.stops ? " Stops can be added on the way." : " Stops are the operator’s.")).
  6. Error (tried) `div.ferr`.
  7. Footer: "Done" (`btn.sm.pri`, check icon) closes the line.

---

## Planner step 3 — Review (components/te/plan/TePlanReview.tsx)

Props: `snap`, `draft`, `issues`, `preview`, `edit`, `onGoStep(n)`. Nothing is computed here; all numbers are from `preview`.

### Section "Journeys"
- `h4` "Journeys"; `p.small.muted` "Each journey is tracked and paid on its own: GPS on the road, check-ins at airports and abroad."
- If `preview.legs` is empty: `div.empty` bold "Choose the places" + "The journeys appear here, with how each one is tracked."
- Else:
  1. `<TeTripMap legs={legs.map(l => ({from,to,mode}))} points={draft.points.map(p=>p.place).filter(Boolean)} places={Map of snap.masters.places → {id,s,lat,lng}} label={"Map of " + (name || 'the trip')}>`
  2. `<TeMapLinks points={draft.points.map(p => places.get(p.place))} scope={draft.scope} label={name || 'the trip'}>`
  3. Leg list `div.tw-legs`, one row per leg: number `l.n`; mode icon; bold `"{fromPlace.s || '—'} → {toPlace.s || '—'}"`; muted line = (non-local: `"{day(l.date)} · "`) + mode name (from cfg.modes, else id) + (`", Travel Desk"` if bookedBy desk) + `" · {km} km"` + (`" by air"` for flight) + `" · check-ins"` or `" · GPS"` + kind suffix (`first` " · to the airport or station", `last` " · from the airport or station", `extra` " · added during the trip"); right side `rs(l.estimate)` or "—".

### Section 2 heading
`h4`: planning "Stay, money and approval"; post-facto "Why it was not tracked".

**Post-facto only** — `div.form`:
- Select labelled (local) "Why was GPS not used?" / (other) "Why was there no prior approval?"; first option "Choose a reason" (''), then:
  - local (NO_GPS): "Forgot to start the travel", "Phone battery was low", "No network or GPS signal", "The app did not work", "Other"
  - other (NO_APPROVAL): "Urgent client call", "Verbal approval by my manager", "Same-day travel", "Other"
  → `pfReason`.
- Text field labelled (local) "What happened" (placeholder "Needed for Other") / (other) "Evidence, if any" (placeholder "Meeting invite, e-mail from the client") → `pfNote`. Note: nothing enforces the note for "Other" (neither client nor engine), despite the placeholder.
- Error key `pf`.

**Planning only**:
1. `<TePlanStay draft foodBudget={preview?.estimate.meals ?? 0} nights={nightsBetween(preview?.start, preview?.end)} edit>` (asked for every scope, local included).
2. `div.form`:
   - when `stayWanted`: select "Hotel booked by": "Me, I claim it later" (`self`), "Travel Desk, company pays" (`desk`) → `stayBy`.
   - non-local: number field "Advance needed (₹)", min 0, step 500, value `draft.advance` ('' allowed) → `advance` ('' or Number); helper "Leave empty if you do not need one."
3. Error key `adv`.

**Then (`div.stack`)**:
- Entitlements card (when `preview.entitlements` and not local): `div.card.flat.tint`, `h3` "Your limits on this trip" + chip `chip plain t-brand` `"Grade {ent.grade}"`; table columns "City", "Hotel a night", "Food a day", "Local a day"; one row: bold `preview.to || '—'` + muted `ent.tier`, `rs(ent.hotel)`, `rs(ent.meals)`, `rs(ent.conv)`.
- Money (`dl.kv`, when preview and planning). Each line omitted when its value is 0:
  - "Travel you pay" = `estimate.travel`
  - "Tickets the Travel Desk books" = `estimate.desk`
  - "Hotel" = `estimate.hotel`
  - "Food" = `estimate.meals`
  - "Local rides at the destination" = `estimate.conv`
  - always: "Total estimate, your share" = `rs(estimateTotal)` (class `tot`)
  - non-local: "Paid by you, reimbursed later" = `rs(selfEstimate)`; "Advance you can ask" = `"up to {rs(advanceCap)}"`.
- If pax > 1: `p.small.muted` `"{pax} people travel. Each person claims their own expenses against their own limits."`
- Blocking issues box (any blocking issue): `div.flag.crit` (after tried) or `div.flag.info`; claims icon; bold `"{n} things to fix"` (tried) or "Still to fill"; then for each step 1..3 that has blocking issues a paragraph: link button with the step name ("Trip"/"Route"/"Review") → `onGoStep(n)`, followed by `": "` + the issue texts joined by a single space.
- Each warning (non-blocking issue): `div.flag.warn` alert icon + bold text.
- Approval box `div.sunk` (when preview and no blocking issues):
  - muted label: post-facto "The trip and its claim go to"; needs approval "This plan goes to"; else "No approval is needed before you leave".
  - when approval needed or post-facto: chain row — for each `preview.chain` step: arrow icon (except first), avatar `span.av.sm` with initials of `name || role` (first letters of words, max 2, uppercase), bold `name || team || role`, muted small `role`.
  - else (local, no approval): `"Local, {round(sum of all leg km)} km in all. Start leg 1 on the day. The claim goes to your manager after the last leg."`

### Section "For your approver" (only when `draft.answerNeeded`, i.e. editing a SENT_BACK trip)
`h4` "For your approver"; textarea labelled "What did you change?" → `answer`. No client check; if empty the SQL refuses with "Tell your approver what you changed." (shown as the save toast). The preview does not flag it.

---

## Stay and food panel (components/te/plan/TePlanStay.tsx)

Props: `draft`, `foodBudget` (= `preview.estimate.meals`), `nights` (= `nightsBetween(preview.start, preview.end)`), `edit`. Pure display + edits; it never changes money (the hotel estimate stays the engine's; "No" to a stay removes the hotel line on the server).

### Card 1 — stay (`div.card.flat.tint`)
- `h3` "Do you need a place to stay?" + chip `chip plain` "1 night away" / "{n} nights away" when nights > 0.
- Segmented Yes / No (aria "Do you need a stay") → `stayWanted: true|false`. Initially undefined (neither pressed) for a new trip.
- No: `p.small.muted` "No hotel on this trip, so none is estimated for it."
- Yes:
  - `p.small.muted` "Name 3 hotels you would be happy with and paste the page you found each on. The Travel Desk picks one and books it."
  - Three cards (always 3 rows, `draft.stayOptions`), each: `h4` `"Hotel {i+1}"` + `" — your first choice"` for the first; chip with `platformOf(url)` (hostname without www) when parseable. Fields: "Hotel" (placeholder "The name of the hotel"), "Where it is" (placeholder "Area, or near what"), "Link" (full width, placeholder "https://www.makemytrip.com/hotels/…") with helper: when `badUrl(url)` → `small.bad` "That does not look like a web address. Paste the whole link, starting with https://", else `small` "Any booking site. The desk and your approver can open it."; "A night, roughly (₹)" (number, min 0; '' or Number) with helper "Optional. For the desk to compare; it does not change the trip estimate."
  - Note from `stayOptionsNote(stayOptions)`: `div.note.warn` (warn icon) or `div.note` (check icon):
    - 0 named: "Name at least 3 hotels you would be happy with, so the desk can compare rates." (warn)
    - 1–2: "{n} of 3 named. You can send it like this, and your approver will see that fewer than 3 were given." (warn)
    - 3: "3 hotels named. The desk picks one and books it."
  - Fewer than 3 never blocks.

### Card 2 — food
- `h3` "Will you spend on food?"; Yes / No (aria "Will you spend on food") → `foodWanted`.
- Yes: `div.note` info icon:
  - foodBudget > 0: bold `rs(foodBudget)` + " is set aside for food on this trip — your company’s daily food limit for your grade, for each day you are away. There is nothing to fill in now. Add each food and drink bill while you are travelling, with a remark, and it comes off this budget as you go."
  - else: "No food budget applies to this trip yet. It is worked out from your company’s daily food limit once the dates and places are set."
- No: `p.small.muted` "No food bills expected. You can still add one later if that changes."
- `foodWanted` is stored only (`food_wanted`); it does not change the estimate.

---

## Place picker (components/te/plan/TePlacePicker.tsx)

### Purpose and callers
Choose a place in one of three ways: phone GPS, a place already in the snapshot, or a complete typed address with a pin. It replaces the caller's whole sheet while open. Used by:
- **TePlanner** (route points and airport/station hubs) — targets built in TePlanRoute.
- **start/TeStartNow.tsx** — passes its own `picking` target; on chosen sets `points[index].place` and `pt` (`pt || p.pt`) on its draft.
- **leg/TeLegAdd.tsx** — target `{ kind:'point', index:0, title: side === 'from' ? 'Where the journey starts' : 'Where the journey goes' }`; on chosen sets from/to and clears its error.

### Types
```ts
export type PickTarget =
  | { kind: 'point'; index: number; title: string; intl?: boolean; address?: boolean; useGps?: boolean }
  | { kind: 'hub'; index: number; side: 'A' | 'B'; title: string; hub: 'airport' | 'station' }
```
- `index`: which point (or which segment, for hubs) the result goes back to — interpreted by the caller.
- `title`: sheet title.
- `intl`: place may be in any country (changes search placeholder and the address form: Country field, Postal code, no PIN rule).
- `address`: open with the address form already expanded.
- `useGps`: ask for the location immediately on open.
- `hub`: pre-fills the search with "airport" / "station".

Props: `snap`, `target`, `onCancel()`, `onChosen(placeId, pt?)` — `pt` is passed only when an existing snapshot place is picked (`p.pt ?? undefined`); new GPS/typed places return no pt.

### Local state

| State | Initial |
|---|---|
| `q` (search text) | hub: `'airport'` or `'station'`; else `''` |
| `typing` (address form open) | `!!(point && target.address)` |
| `addr: PlaceInput` | `{ src:'address', country: intl ? '' : 'India', city:'', line:'', area:'', pin:'', state:'' }` (+ `label` when typed) |
| `busy` | false |
| `note` (status / error line) | '' |
| `pin: {lat,lng} \| null` | null |
| `view: PinView` | centre = first place with `pt==='corp'` and a lat, else first place with a lat, else 28.4595, 77.0266 (Gurugram); `span: 8` km |

`typedAddressAllowed = snap.cfg.track.typedAddress !== false`.

### Layout (TeSheet `wide`, title = `target.title`, `back` and `onClose` both = `onCancel`)
- Lead: "Use the phone’s GPS, pick a place, or enter the complete address."
- Big action `button.act.pri` (disabled while busy): target icon, bold "Use my current location", small "Reads this phone’s GPS and fills the address from the map" → `locate()`.
- Status: when `note` non-empty, `div.note` info icon + note.
- Section `h4` "Search or pick a place":
  - input `.inp`, placeholder intl "Search a place, an area or a city, in any country" / else "Search a place, an area or a PIN code".
  - Matching: `snap.masters.places` whose lowercase `"{s} {name} {addr} {city} {pin}"` contains the trimmed lowercase query (all when empty), first **8** when there is a query, first **9** when not. Split into:
    - "Your places" header (`div.pkh`) — places with `src !== 'saved'`: icon home (pt home) / target (src gps) / pin; bold `s`; small `addr || name`; chip `chip plain` from SRC_WORD (`gps` "GPS", `address` "Typed address", `pin` "Pin on map", `search` "Map search"; none for other src such as `hub`).
    - "Company places" header — `src === 'saved'`: icon home/pin; chip `chip plain t-brand` "Your home" (pt home) or "Company place".
    - Click → `onChosen(p.id, p.pt ?? undefined)`.
  - No match: `div.empty` — typed address allowed: "No place matches. Enter the complete address below." / else "No place matches. Use your current location or ask the admin to add this place."
  - (Hub targets only pre-fill the query; results are not filtered by place type.)
- If typed addresses are allowed: section `h4` "Or enter the complete address":
  - collapsed: `button.btn` "Enter the address" (pin icon) → `typing = true`.
  - expanded `div.form`:
    - "Name of the place" (full width, placeholder "Company, shop or person. Optional") → `label`
    - "Building and street" (full, placeholder "Flat or office number, building, street") → `line`
    - "Area or locality" (placeholder "Sector, colony or landmark") → `area`
    - intl only: "Country" (placeholder "Country") → `country`
    - "City" → `city`
    - "PIN code" (domestic: inputMode numeric, maxLength 6, no placeholder) / "Postal code" (intl: inputMode text, maxLength 12, placeholder "If the country uses one") → `pin`
    - full-width `<TePinMap pin view onPin={setPin} onView={setView}>`
- Else: `div.note` shield icon "Your company accepts only GPS and saved places as start and end points." (Client-side only; `POST /api/te/places` does not enforce this setting.)
- Footer: `button.btn` "Back" → `onCancel`; when `typing`: `button.btn.pri` (pin icon) `busy ? "Saving…" : "Use this address"`, disabled while busy → `saveTyped()`.

### GPS — `locate()`
1. If `'geolocation' in navigator` is false → note "This device cannot read its location."; stop.
2. `busy = true`, note "Reading your location…".
3. `navigator.geolocation.getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 12000 })` (no maximumAge → browser default 0).
4. Success → `te.placeAdd({ src:'gps', lat: coords.latitude, lng: coords.longitude, acc: coords.accuracy })` → `onChosen(r.place_id)`. API error → note `errorText(e)`, busy false.
5. Error → busy false; note: `PERMISSION_DENIED` → "Location is switched off for this site. Pick a place or type the address."; anything else → "Could not read your location. Pick a place or type the address."

When `target.useGps` (point targets), `locate()` is called once on open via `setTimeout(locate, 0)`.

### Typed address — `saveTyped()`
Client checks, first failure wins, shown in the note line:
1. intl and no country → "Choose the country."
2. no `line` → "Enter the building and street."
3. no `area` → "Enter the area or locality."
4. no `city` → "Enter the city."
5. domestic and pin not `/^\d{6}$/` → "Enter the 6-digit PIN code."
6. no pin on the map → "Tap the exact spot on the map before you use this address."
Then `busy = true`, `te.placeAdd({ ...addr, src:'address', lat: pin.lat, lng: pin.lng })` → `onChosen(r.place_id)`; error → note `errorText(e)`, busy false. `state` is sent as `''` (the form has no state field).

A pin is mandatory on the client because no client geocoder exists; the server can geocode only if `GOOGLE_MAPS_API_KEY` is configured, and the client never relies on it.

---

## Pin map (components/te/plan/TePinMap.tsx)

Props: `pin: {lat,lng} | null`, `view: PinView`, `onPin(p)`, `onView(v)`. Used only inside the place picker's address form.

### With a browser Maps key (`hasMapKey()` true)
- `<TeGoogleMap pin onPin label="Drag the pin, or tap where the place is.">` (height 260, zoom 15).
- Row: muted "Drag the pin, or tap the map." + `button.btn.sm` (target icon) `"Use my location"` / `"Reading…"` while asking (disabled while asking) → `useMyLocation(onPin).ask()`; message paragraph under it (see TeGoogleMap).
- The schematic panel and the nudge row below are rendered with the `hidden` attribute.
- Known gap: if the Maps script fails to load (bad key, blocked), TeGoogleMap renders nothing but the schematic stays hidden, so there is no map to tap — only "Use my location". A rebuild should fall back to the grid on failure.

### Without a key — schematic grid
- SVG `svg.jmap`, viewBox 640 × 220, scaled by CSS; aria "Place the pin on the map"; title "Tap to move the pin".
- Background rect `--ez-sunken`; grid lines every 80 px (W/8) both ways, stroke `--ez-line`, opacity .6.
- Pin: halo circle r 16 `--ez-brand` opacity .18, dot r 7 `--ez-brand` with `--ez-surface` stroke 2.5. No pin: centred text "Tap where the place is" (13px, `--ez-muted`).
- Scale bar bottom-left: 80 px line, label `"{round1(span/8)} km"`.
- Tap: client coordinates → viewBox coordinates (`(clientX - left)/width*640`, same for y with 220) → `pixelToPin(x, y, view, 640, 220)` → `onPin`.
- Row: muted "Tap the map or use the arrows to move the pin." + nudge group (aria "Move the pin") buttons "↑" (Move north), "←" (Move west), "↓" (Move south), "→" (Move east), disabled when no pin, → `onPin(nudgePin(pin, dir, view))`; "Zoom in" (plus) → `onView(zoomPin(view,'in'))`; "Zoom out" (minus) → `zoomPin(view,'out')`.

### Status (both modes)
- Pin set: `div.flag.ok` check icon, bold `"Pin at {lat.toFixed(5)}, {lng.toFixed(5)}"`, p "The route and the distance are measured to this point."
- No pin: `div.flag.warn` alert icon, bold "This address has no position yet", p "Tap the exact spot on the map. Without it the distance to this place cannot be measured."

---

## Google Maps components (components/te/plan/TeGoogleMap.tsx)

### Key and loading
- `mapsKey() = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || undefined`; `hasMapKey() = !!mapsKey()`. Build-time public key, separate from the server's `GOOGLE_MAPS_API_KEY` (used server-side for Directions distances, geocoding and reverse geocoding). The public key should be referrer-restricted to the Maps JavaScript API. In Expo use `react-native-maps` with platform keys instead.
- `useGoogleMaps(): { ready, failed }` — if no key: never ready. If `window.google.maps` already exists: ready. Otherwise reuses `<script id="ezer-gmaps">` if present (listens for load/error), else appends to `<head>`:
  `https://maps.googleapis.com/maps/api/js?key={encodeURIComponent(key)}`, `async`. No `libraries=` parameter, no `callback`, no Places library, no client-side geocoding or autocomplete anywhere. `load` → ready; `error` → failed.

### `useMyLocation(onFix?)` → `{ fix, state, ask, message }`
- Never runs on mount; only `ask()`.
- No `navigator.geolocation` → state `'unavailable'`.
- `getCurrentPosition(success, error, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 })`.
- Success → `fix = {lat,lng}`, state `'ok'`, calls the latest `onFix(fix)` (held in a ref).
- Error → `'denied'` for PERMISSION_DENIED, else `'unavailable'`.
- `message`: asking "Reading your location…"; denied "Location is blocked for this site. Allow it in your browser, or drop the pin by hand."; unavailable "Your location could not be read. Drop the pin by hand instead."; else ''.

### Default export `TeGoogleMap({ pin, onPin, height = 260, zoom = 15, label })`
- Renders `div.gmap` (inline height, role "application", aria `label || "Map. Drag the pin, or tap where the place is."`); returns null when no key or `failed`.
- Built once when ready: `new google.maps.Map(div, { center, zoom: pin ? zoom : 4, mapTypeControl:false, streetViewControl:false, fullscreenControl:false, clickableIcons:false })` with center = pin or India (20.5937, 78.9629); one `new google.maps.Marker({ position: center, map, draggable: true })` (classic Marker, not AdvancedMarker).
- `dragend` on marker → `onPin(latLng)`; `click` on map → move marker there, `onPin(latLng)`.
- When `pin` changes from outside (e.g. "Use my location"): `marker.setPosition(pin)`, `map.panTo(pin)`.

### `TeGoogleRoute({ points, legs?, height = 220, label })`
- Returns null without key, on failure, or with no points. `div.gmap`, role img, aria `label || "Map of the route"`.
- Redrawn (a new Map) whenever the coordinate signature `JSON.stringify([points lat/lng, legs modes])` changes.
- Map options: same three controls off, `clickableIcons:false`, `zoom: 5`, `center: points[0]`.
- One Marker per point, label `{ text: 'A','B',… (index letter; number beyond Z), color: computed value of CSS var --ez-on-accent (fallback 'white'), fontWeight: '700', fontSize: '12px' }`, `title: point name`.
- One Polyline per leg, `path: [from, to]` (straight; no Directions call from the client):
  - flight: `geodesic: true`, `strokeOpacity: 0`, `strokeWeight: 2`, dashed via `icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, scale: 3 }, offset: '0', repeat: '12px' }]`
  - other: `strokeOpacity: 0.85`, `strokeWeight: 4`; no strokeColor (Google default).
- More than one point → `fitBounds(bounds of all points, 36)`; exactly one → `setZoom(13)`.

---

## Trip schematic map (components/te/plan/TeTripMap.tsx)

Props: `legs: MapLeg[]` ({from,to,mode} place ids), `points: string[]` (point place ids in order), `places: Map<id, MapPlace>`, `height?`, `label?`.
1. `g = tripMapGeometry({ legs, points, places, height })`; null (nothing has a position) → render nothing.
2. If `hasMapKey()`: build `pts` (each point with a non-zero position, in order, duplicates kept — so a round trip's return gets its own letter on the real map, unlike the schematic) and `lines` (legs with both ends positioned) → `<TeGoogleRoute points={pts} legs={lines} height label>`.
3. Else SVG `svg.jmap` viewBox `{g.width} × {g.height}` (640 × 220 default), aria `label || "Map of the trip"`:
   - rect `--ez-sunken`; grid path `--ez-line` width 1 opacity .6
   - ground legs (`g.plan`): stroke `--ez-brand` opacity .4, width 5, round caps, dasharray "1 9" (dotted)
   - flights (`g.flights`): stroke `--ez-ink-soft` opacity .75, width 2, dasharray "7 6", drawn as bowed arcs
   - marks: circle r 10, fill `--ez-positive` for "A" else `--ez-ink`, stroke `--ez-surface` 2.5; letter 11px bold `--ez-surface`; name label 12px bold `--ez-ink-soft` with a `--ez-sunken` halo (stroke 3, paint-order stroke), anchored start/end per geometry
   - scale bar bottom-left from `g.scale.px`, label `"{g.scale.km} km"`.

---

## Open-in-map links (components/te/plan/TeMapLinks.tsx)

Props: `points: (MapPoint | null | undefined)[]`, `scope?`, `label?`. Needs no key.
- `{ google, apple, stops, appleShort } = routeLinks(points, scope)`; both null → render nothing.
- `div.maplinks` row: `a.btn.sm` (pin icon) "Open in Google Maps" (aria `"Open {label || 'this trip'} in Google Maps"`) and `a.btn.sm` (compass icon) "Open in Apple Maps"; `target="_blank" rel="noopener noreferrer"`. In RN use `Linking.openURL`.
- Note `small.muted` from `mapLinksNote(stops, appleShort)`:
  - 1 stop: "Opens the place in your map app."
  - 2 stops: "Opens the route in your map app."
  - 3+: "Google gets all {stops} stops. Apple Maps has no multi-stop routes, so it opens start to destination only."

---

## lib/te/trip-draft.ts — planner draft model (pure)

Dependency-free: imports only `type`s from `./types.ts` and values from `./trip-stay.ts` (pure). Imports use explicit `.ts` extensions (Metro/TS config must allow `allowImportingTsExtensions` or the imports must be rewritten).

### Types
- `DraftPoint { place: string ('' until chosen); pt: string; leave: IsoDate|''; arrive?: IsoDate|'' (return point only); what: string; ret?: true }`
- `DraftSeg { mode: string; vehicleId: string; bookedBy: 'desk'|'self'; xfer: { first: string; last: string; hubA?: string; hubB?: string } }`
- `DraftPerson { id: string (employee code); name: string; autoName?: boolean }`
- `PlannerDraft { step: 1|2|3; origin; scope; pattern (derived); name; nameTouched; purpose; project; pax; people; points; segs (always points.length-1); retSame; stayBy: 'self'|'desk'; stayWanted?: boolean; foodWanted?: boolean; stayOptions: StayOption[] (always 3 rows); advance: number|''; pfReason; pfNote; open?: string|null ('p0','s1'…; undefined = auto-open first needing work; null = all closed by the person); tried?: boolean; editId?: Uuid; answerNeeded?: boolean; answer?: string; lockScope?: boolean }`
- `DraftContext { today; officePlace; vehicles: {id}[]; modes: TeMode[]; placeName(id) }`

### Constants
- `PURPOSES` (8, listed in step 1). `MAX_PEOPLE = 20`, `MAX_NAME = 60`.
- PURPOSE_NOUN (for auto-names): Client meeting → "client meeting"; Site or plant visit → "visit"; Dealer or partner visit → "dealer visit"; Delivery or collection → "delivery"; Audit or inspection → "audit"; Training or event → "training"; Bank or government work → "bank work"; anything else → "trip".

### Functions
- `autoName(purpose, placeNames[]): string` — names = non-empty place names joined with " and ". No names → purpose (unless '' or "Other" → ''). Else `"{names} {noun}"`; longer than 60 → first 59 chars + "…".
- `defaultMode(scope, ctx)`: local → `'own'` if the context has a vehicle else `'cab'`; otherwise `'flight'`.
- `newSeg(mode, vehicleId)`: `{ mode, vehicleId: mode==='own' ? vehicleId : '', bookedBy:'desk', xfer:{ first:'cab', last:'cab' } }`.
- `newPlannerDraft({scope, origin, lastWorkday}, ctx)`: step 1, pattern 'round', three points — start `{ place: officePlace, pt:'corp', leave: start }`, a blank destination, return `{ place: officePlace, pt:'corp', leave:'', arrive:'', ret:true }` — two default segs, `retSame: true`, `stayBy:'self'`, `advance:''`, pax 1, 3 empty stay options. Start date: local → (post-facto ? lastWorkday : today); other scopes → ''. Passed through `syncDraft`.
- `fromTrip(trip, ctx)` (editing): `step = 3` when `status === 'SENT_BACK'` else 1; `nameTouched: true`; points copied (`arrive` kept only on the return point); segs copied (`bookedBy` 'self' or 'desk'; xfer first/last default 'cab'); `retSame` = return place equals start place; stay/food answers (`null → undefined`); 3 stay rows (price `?? ''`); `advance || ''`; `editId = trip.id`; `answerNeeded = SENT_BACK`; `lockScope: false` (kind can be changed).
- `syncDraft(d, ctx)` — run after every edit:
  1. if `retSame`, the return point copies the start's place and pt;
  2. segs rebuilt to `points.length - 1`, each reusing `d.segs[i]`, else `d.segs[i-1]`, else `newSeg(defaultMode)`;
  3. any seg whose mode is unknown, switched off, or not allowed for the scope is reset to `defaultMode` (vehicle = first context vehicle if own); own with no vehicle gets the first; local forces `bookedBy:'self'`;
  4. pattern = 'multi' if more than one destination (non-start, non-return), else 'round' if a return point exists, else 'oneway';
  5. pax clamped to 1..20 (integer); people padded/truncated to pax-1;
  6. name = typed name if `nameTouched`, else `autoName(purpose, chosen destination names)`.
- `setScope(d, scope, ctx, lastWorkday)`: to local → start leave kept or defaulted (post-facto lastWorkday / today), every other point's `leave` cleared (return `arrive` kept); from local to another kind while planning → a start date equal to today is cleared. Always clears `pfReason` and `pfNote`.
- `setPattern(d, 'oneway'|'round', ctx)`: oneway removes the return point; round appends `{ place/pt of start, leave:'', arrive:'', ret:true }` and sets `retSame: true`.
- `addStop(d, i, ctx)`: inserts a blank point after index i, copies seg i as the new seg, `open = 'p{i+1}'`.
- `removePoint(d, i, ctx)`: removes point i and seg i, `open = null`.
- `movePoint(d, i, dir, ctx)`: swaps destination i with i+dir (never the start or the return), segs stay by position, `open = 'p{j}'`.
- `pointLabel(d, i) → { label, isStop, no, destinations (indices), last (index of last destination) }` — labels "Start" / "Back to" / "Stop {no}" / "Destination".
- `stepOfIssue(k)`: `scope|purpose|name|pax` → 1; `p\d+`, `m\d+`, `d\d+`, `pr` → 2; everything else (incl. `adv`, `pf`, empty) → 3.
- `errorFor(issues, k, tried)`: '' unless tried; else text of first blocking issue with key k.
- `blockingOn(issues, step)`: blocking issues whose key maps to that step.
- `firstOpenLine(issues, after?)`: among blocking issues with keys `p\d+`, `m\d+`, `d[1-9]\d*`, maps `m{i}` → line `s{i}`, others → `p{i}`; position = 2i (+1 for m/s); returns the lowest after `after`, or null.
- `toTripDraft(d): TripDraft` (payload for preview and save):
  - `id` only when editing; `name` trimmed; `scope`, `pattern`, `origin`, `purpose`, `project || ''`
  - `points: [{ place, pt, what, leave, arrive? (return point only, when set), ret? }]`
  - `segs: [{ mode, bookedBy, vehicleId: vehicleId || null, xfer }]`
  - `pax: Number(pax) || 1`; `people` (codes uppercased, both trimmed, all-empty rows dropped)
  - `stayBy`: local without a stay → 'self', else `d.stayBy`
  - `stayWanted` / `foodWanted` only when answered (omitted when undefined)
  - `stayOptions`: `usableStayOptions(...)` when stayWanted, else `[]`
  - `advance`: local → 0, else `Number(advance) || 0`
  - `pfReason`, `pfNote` ('' default); `answer` only when non-empty.

---

## lib/te/trip-map.ts — schematic geometry and pin maths (pure)

Dependency-free (type import only).

Constants: `KM_PER_DEG = 111`; grid steps (km) `[1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]`; `LABEL_MERGE_PX = 18`; `LABEL_FLIP_PX = 150`.

- `arcPoints(a, b, steps = 28)`: quadratic Bézier from a to b with control point = midpoint shifted by `(-dLng*0.18, +dLat*0.18)` (lat, lng); returns steps+1 points.
- `tripMapGeometry({ legs, points, places, width = 640, height = 220 }) → TripMapGeometry | null`:
  - a place counts only with finite lat/lng and not (0,0);
  - drawn legs: both ends positioned and from ≠ to; flight → `arcPoints`, else the straight pair;
  - pins = positioned points; nothing at all → null;
  - bounds over all route points and pins; `kx = 111 * cos(midLat)`; `wk = max(3, lngSpan*kx)`, `hk = max(3, latSpan*111)` (3 km floor); scale `sc = min(W/(wk*1.3), H/(hk*1.45))`;
  - `X = W/2 + (lng - centreLng)*kx*sc`, `Y = H/2 - (lat - midLat)*111*sc` (rounded to 0.1);
  - grid km = first step with `step*6 > W/sc` (else 1000); grid lines start at `(W/2) % stepPx`;
  - marks: one per distinct place in visiting order, letters A, B, C…; a pin within 18 px of an earlier pin gets no label, the first carries all nearby names joined by " · "; pins within 150 px of the right edge put their label left (`anchor 'end'`, x − 15), else right (x + 15);
  - returns `{ width, height, grid, plan (ground legs path), flights (path), marks, scale: { px, km } }`.
- `PinView { lat; lng; span (km across the panel) }`.
- `pinToPixel(p, view, w, h)`: `pxPerKm = w/span`, `kx = 111*cos(view.lat)`; `x = w/2 + (lng - view.lng)*kx*pxPerKm`, `y = h/2 - (lat - view.lat)*111*pxPerKm`.
- `pixelToPin(x, y, view, w, h)`: exact inverse.
- `nudgePin(p, dir, view)`: moves `span/16` km north/south/east/west (east-west scaled by cos(p.lat)).
- `zoomPin(view, 'in'|'out')`: span /2 or ×2, clamped to [1, 96] km.
- `mapHeight(scope, narrow)`: narrow 150; local 180; else 220 (not used by the planner screens).

---

## lib/te/map-links.ts — deep links (pure)

Dependency-free (type import only). Coordinates are always used, never names, rounded to 6 decimals (`"{lat},{lng}"`).

- `hasPosition(p)`: numbers, finite, not (0,0), |lat| ≤ 90, |lng| ≤ 180.
- `mappable(points)`: positioned points in order, consecutive duplicates (same rounded pair) collapsed.
- `googleRouteUrl(points, scope?)`: none → null; one → `googlePlaceUrl`; else
  `https://www.google.com/maps/dir/?api=1&origin={lat,lng}&destination={lat,lng}[&waypoints={p1}|{p2}…]&travelmode={flight if international else driving}` (URLSearchParams encoding: `,` → `%2C`, `|` → `%7C`).
- `googlePlaceUrl(p)`: `https://www.google.com/maps/search/?api=1&query={lat,lng}`.
- `appleRouteUrl(points)`: none → null; one → `applePlaceUrl`; else `https://maps.apple.com/?saddr={first}&daddr={last}&dirflg=d` (middle stops dropped).
- `applePlaceUrl(p)`: `https://maps.apple.com/?ll={lat,lng}&q={name trimmed || lat,lng}`.
- `appleDropsStops(points)`: mappable count > 2.
- `routeLinks(points, scope?) → { google, apple, stops: mappable count, appleShort: count > 2 }`.
- `mapLinksNote(stops, appleShort)`: texts quoted under TeMapLinks; 0 → null.

---

## lib/te/trip-stay.ts — planner parts (pure)

Dependency-free (type imports only). Caveat for RN: `platformOf` uses `new URL(...).hostname`; older React Native URL implementations throw on `hostname`, so add `react-native-url-polyfill` (or a regex) to keep the same behaviour.

- `StayOption { name; location; url; price?: number | '' }`; `SavedStayOption` (price a number or absent).
- `STAY_OPTIONS_WANTED = 3`; `emptyStayOption()` → all '' (price '').
- `stayOptionFilled(o)`: name non-blank.
- `usableStayOptions(options)`: filled rows, all strings trimmed, `price` included only when `Number(price) > 0`.
- `stayOptionsNote(options)`: texts quoted under TePlanStay (`warn` true for 0–2).
- `platformOf(url)`: trimmed; '' → null; hostname without leading "www."; unparseable → null.
- `badUrl(url)`: non-blank and `platformOf` is null.
- `nightsBetween(start, end)`: whole days between the two ISO dates (rounded), never negative; missing → 0.
- (Food balance, stay decision and reject helpers in the same file are for the trip screen and Travel Desk, documented elsewhere.)

## lib/te/co-traveller.ts — planner relevance

Not imported by any planner file. The planner's co-traveller behaviour is entirely the employee-ID rows in step 1 plus the server's resolution of codes (`trip.co`). The file (pure, type import only) serves trip/claim screens: `tripRole`, `onTrip`, `isCoTraveller`, `isShared`, `otherNames`, `withText`, `coTravellerNote`, `canBillTrip`, `myClaims` — documented by the trip-screen writer.

---

# Part 4 — Trips, journeys (legs), live GPS recording, Start now

Scope of this part: the trips list, the approved-trip picker, the trip detail screen (with the stay request form), the four journey screens (live recorder, report, not-recorded, live bar), the "add a journey" sheet and the "Start a local trip" sheet, plus the four pure helper libraries they use and the server behaviour behind their API calls.

Vocabulary: the code calls a leg a "leg" (`TeLeg`, `/api/te/legs`), and the UI always calls it a **"journey"**. The engine also calls it a journey (`EZ.journey`). The two words mean the same thing.

How TeHome decides which leg screen to show (`components/te/TeHome.tsx`, view `{ name: 'leg', tripId, leg }`). The **leg's own status** decides, not the caller:

| `leg.status` | Screen |
|---|---|
| `ACTIVE`, `PAUSED`, `PLANNED` | TeLegLive |
| `ENDED` | TeLegReport |
| anything else (`SUBMITTED`, `SKIPPED`, `CANCELLED`) | TeLegMissed |

TeHome's callbacks for the leg screens:
- TeLegLive: `onBack` goes back to the trip view `{name:'trip', id: tripId}`. `onEnded(stats)` sets toast `'Journey ended. Add what it cost.'`, calls `reload()` and goes back to the trip (it ignores `stats`). `onChanged(msg)` sets the toast to `msg` and calls `reload()`.
- TeLegReport: `onFiled(msg)` sets the toast, calls `reload()` and goes back to the trip.
- TeLegMissed: `onDone(msg)` sets the toast, calls `reload()` and goes back to the trip.

`placeName(id)` for the leg screens is `snap.masters.places.find(p => p.id === id)?.s ?? ''`.

> **IMPORTANT: stale-leg defect in the web app (do NOT copy).** `view.leg` is a copy of the leg taken when the view was opened. `reload()` refetches the snapshot but never refreshes `view.leg`. So after `start` the TeLegLive screen still sees `status: 'PLANNED'` and keeps showing "Ready to start". After `stop` it still sees `ACTIVE`, so "Continue the journey" never appears. The user has to go back to the trip and open the journey again. The RN app should keep only `legId` in the view and resolve the leg from the freshest snapshot (or trip detail) on every render. The same applies to TeTripDetail, which keeps its own `detail` and is not refetched after a TeHome `reload()`, for example after the Add-a-journey sheet closes. See "Known defects" at the end.

---

## Shared helper libraries (lib/te/trips-list.ts, lib/te/co-traveller.ts, lib/te/trip-stay.ts, lib/te/leg-tracking.ts)

All four are **dependency-free**: they use only `import type` from `./types.ts` / `./format.ts`, and trips-list imports `onTrip` from co-traveller. The RN app can import them unchanged. The only exception is `platformOf` in trip-stay, which uses the global `URL` (in RN it needs a URL polyfill such as `react-native-url-polyfill`).

### lib/te/trips-list.ts

- `type TripGroupId = 'now' | 'next' | 'claim' | 'done'`
- `TRIP_GROUPS`, in this order: `now` "Now and today", `next` "Coming up", `claim` "Back, to close and claim", `done` "Done".
- `tripGroup(trip: Pick<TeTrip,'display'|'start'>, today: string): TripGroupId`
  - `display === 'ONGOING'` gives `now`.
  - `APPROVED` with `start` set and `start <= today` gives `now`.
  - `APPROVED`, `PENDING_APPROVAL` or `SENT_BACK` gives `next`.
  - `COMPLETED`, `MISSED` or `DRAFT` gives `claim`.
  - Everything else (`EXPIRED`, `CLAIMED`, `CLOSED`, `CANCELLED`, `REJECTED`) gives `done`.
- `tripChip(trip: Pick<TeTrip,'display'|'chain'>): { label, tone }`. The table is below. `APPROVED` is special: the label is `'Approved'` if `chain.length > 0`, else `'Ready, no approval needed'`, and the tone is `t-brand`. A status missing from the table falls back to `String(st).replace(/_/g,' ').toLowerCase()` with tone `plain`.

  | display | label | tone |
  |---|---|---|
  | DRAFT | "Draft" | t-info |
  | PENDING_APPROVAL | "Waiting for approval" | t-warn |
  | SENT_BACK | "Sent back to you" | t-warn |
  | APPROVED | "Approved" / "Ready, no approval needed" | t-brand |
  | ONGOING | "On the trip" | t-info |
  | COMPLETED | "Back, close and claim" | t-info |
  | MISSED | "Missed" | t-warn |
  | EXPIRED | "Expired" | t-crit |
  | CLAIMED | "Claimed" | t-brand |
  | CLOSED | "Closed" | t-pos |
  | CANCELLED | "Cancelled" | plain |
  | REJECTED | "Rejected" | t-crit |

- `tripMoney(trip, claims, expenses): { value, label }`. The first rule that applies wins:
  1. A claim with `tripId === trip.id` and `status !== 'CANCELLED'`: value is `claim.approved ?? claim.claimed`, label is `'paid'` if the status is `SETTLED`, else `'claimed'`.
  2. Expenses on the trip with `status === 'UNCLAIMED'`: value is the sum of `Number(claimed)||0`, label `'to claim'`.
  3. Otherwise: value is `trip.selfEstimate ?? 0`, label `'estimate'`.
- `scopeCounts(trips)` returns `{ all, local, domestic, international }`.
- `groupTrips(trips, today)`: the groups in `TRIP_GROUPS` order, with empty groups dropped.
- `myTrips(trips, me, scope|null)`: trips where `onTrip(t, me)` is true (owner **or** co-traveller), filtered by scope if given, sorted by `start` descending (string compare, null treated as '').
- `linesWaitingInTrips(...)` is used elsewhere (Other expenses, another group). Not used in this part.

### lib/te/co-traveller.ts

- `tripRole(trip:{emp, co[]}, me)` returns `'owner'` if `trip.emp === me`, else `'co'` if `trip.co.includes(me)`, else `'none'`.
- `onTrip` means role is not `none`. `isCoTraveller` means role is `co`. `isShared` means `co.length > 0`.
- `otherNames(trip, me)`: `trip.people`, minus anyone with `p.emp === me`, names trimmed, empty names dropped.
- `withText(trip, me)`:
  - no other names: `''`
  - one name: `"With A"`
  - two names: `"With A and B"`
  - three or more: `"With A and N others"`, where N = count − 1.
- `coTravellerNote(trip, me, plannerName)`: null unless the viewer is a co-traveller. Otherwise: `` `${who} planned this trip and you are travelling on it. The route, the dates and the journeys are theirs to change — your own bills are yours to add, and you claim them yourself.` `` where `who = plannerName.trim() || 'A colleague'`.
- `canBillTrip(trip & {status}, me)`: `onTrip(trip, me)` and the **stored** `trip.status` is not `CANCELLED` or `REJECTED`.
- `myClaims(claims, me)`: `claims.filter(c => c.emp === me)`.

### lib/te/trip-stay.ts (the parts used here)

- `foodBudget(trip)` returns `Number(trip.estimate?.meals) || 0`.
- `foodSpent(expenses, tripId, me)`: sum of `claimed` over expenses where `tripId` matches, `emp === me`, `cat === 'meals'` and `status !== 'DISCARDED'`.
- `foodBalance(budget, spent)` returns `{budget, spent, left, over, pct, tone}`:
  - `b = max(0, budget)` and `s = max(0, spent)`
  - `over = max(0, s − b)` and `left = max(0, b − s)`
  - `pct = b > 0 ? min(100, round(s/b·100)) : (s > 0 ? 100 : 0)`
  - `tone = over > 0 ? 'over' : (b > 0 && s/b >= 0.8 ? 'close' : 'ok')`
- `foodBalanceText(f, rs)`:
  - budget 0 and spent > 0: `"₹S on food so far. No food budget is set for this trip."`
  - budget 0 and nothing spent: `"No food budget is set for this trip."`
  - over: `"₹S of ₹B. That is ₹O over — your approver will see it and may ask why."`
  - nothing spent: `"₹B for food on this trip. Add each bill as you go and this comes down."`
  - otherwise: `"₹S of ₹B used. ₹L left."`
- `stayDecisionText(stay)`:
  - null when `stay` is missing or `status === 'NONE'`.
  - `CHOSEN` gives `{tone:'ok', text: "The Travel Desk picked {name || 'one of these'}{ — byName}.{ “remark”}"}`.
  - `REJECTED` gives `{tone:'bad', text: "The Travel Desk turned these down{ — byName}. {remark || 'No reason was given.'}"}`.
- The planner-side helpers (`StayOption`, `stayOptionsNote`, `badUrl`, `nightsBetween`, `rejectReady`, `stayWaiting`) belong to the planner and desk groups.

### lib/te/leg-tracking.ts (the GPS queue)

- `interface TrackRules { pingSec?: number; minAccuracy?: number; maxSpeed?: number; [k]: unknown }`. The caller passes `snap.cfg.track`.
- `MAX_BUFFER = 20`.
- `num(v, fallback)` returns `v` if it is a finite number, else `fallback`.
- `acceptFix(fix:{accuracy_m?}, rules)`:
  - keeps the fix if `accuracy_m == null` (the device reported no accuracy);
  - otherwise keeps it only if `accuracy_m <= num(rules.minAccuracy, 50)` (metres).
- `shouldFlush(bufferSize, lastSentMs, nowMs, rules)`:
  - false if `bufferSize === 0`;
  - true if `bufferSize >= 20`;
  - otherwise true if `nowMs − lastSentMs >= num(rules.pingSec, 30)·1000`.
- `queueKey(legId)` returns `` `te.leg.${legId}.pings` `` (the localStorage key).
- `interface PingStore { getItem; setItem; removeItem }`. Any localStorage-like store; null means no storage.
- `readQueue(legId, store)`: parses JSON at the key, keeps only valid pings (`lat` and `lng` are numbers and `recorded_at` is a string). Returns `[]` on a missing store, missing key, corrupt data or any exception.
- `writeQueue(legId, pings, store)`: `setItem(JSON)` if there are pings, else `removeItem`. Exceptions such as quota errors are swallowed.
- `mergePings(existing, incoming)`: appends incoming pings whose `recorded_at` is not already present (dedupe by timestamp string), then sorts ascending by `recorded_at`.
- `withoutSent(queue, sent)`: drops every queued ping whose `recorded_at` is in `sent`.
- `haversineKm(a, b)`: Earth radius 6371 km, standard haversine (asin with min(1, ·)).
- `trailKm(points)`: sum of haversine distances between consecutive points, rounded to 0.1 km.
- `toPing(pos)` returns:
  - `{ lat: coords.latitude, lng: coords.longitude, accuracy_m: coords.accuracy }`
  - `speed_kmh`: `round(coords.speed·3.6)` if `speed` is a number ≥ 0, else undefined;
  - `recorded_at: new Date(pos.timestamp).toISOString()`.
- `silentMinutes(lastFixAt, nowMs)`: `floor((now − Date.parse(lastFixAt))/60000)`, floored at 0. Returns 0 when `lastFixAt` is null or unparseable.
- `isGap(lastFixAt, nowMs, rules)`: `silentMinutes >= num(rules.gapMin, 5)`.
- There is **no client-side mock detection, speed filter, jump filter or backoff** in this file. `maxSpeed` is declared on `TrackRules` but never read on the client.

Formatting helpers from lib/te/format.ts used throughout (lead documents these):
- `rs(n)`: `₹` plus the en-IN grouped integer, with a minus sign if negative.
- `day(iso)`: `"7 Dec"`.
- `when(iso)`: `"16 Nov, 09:47"` in IST.
- `plural(n, w)`: `"1 journey"` / `"2 journeys"`.
- `errorText(e)`.
- `flagClass(f)`: `'flag crit'` if `f.block`, else `'flag warn'`.

Helpers from lib/te/entry-flow.ts (the entry-flow group documents them):
- `legsOf(trip, journeys)`: legs of the trip sorted by `n`.
- `routeText(trip, placeName)`: the point names joined with `' → '`, with `'…'` for a missing name.
- `tripDates(trip)`: `''` if there is no start; `day(start)` if `start === end`; else `"{day(start)} to {day(end)}"`.
- `currentLeg(legs)`: the first leg that is ACTIVE, PAUSED or ENDED, else the first PLANNED leg, else null.
- `approvedTrips(scope, {me, trips})`: trips where `t.emp === me` (owner only), `t.scope === scope` and `display` is `APPROVED` or `ONGOING`.
- `KIND_NAME`: local "Local trip", domestic "Domestic trip", international "International trip".

---

## Trips list (components/te/trip/TeTrips.tsx)

**Purpose.** Every trip the viewer planned or travels on, grouped by what it needs from them. This is TeHome view `'trips'`.

**Props:**
- `snap: Snapshot`
- `onOpen(tripId)`: TeHome sets view `{name:'trip', id}`.
- `onNew(scope)`: TeHome opens the planner sheet `{name:'plan', kind: scope, past: false}`.

**State:** `scope: TripScope | null`, default `null` (meaning All).

**Derived values:**
- `all = myTrips(snap.trips, snap.me, null)`
- `shown = myTrips(..., scope)`
- `counts = scopeCounts(all)`
- `groups = groupTrips(shown, snap.today)`
- `placeName(id)` reads `snap.masters.places[].s`.

**Layout, in order:**
1. Page header `.ph`: h1 **"Trips"**, then p **"Every trip, local or abroad, holds its route, its journeys with GPS and stops, and every bill you spent on it."**
2. Kind tiles (`.kinds.compact`, role list). There are three buttons, in the order local, domestic, international (`.kind.k-{scope}`). Each has:
   - icon `TeIcon name={scope} size lg`
   - bold **"Local trip"** / **"Domestic trip"** / **"International trip"**
   - a footer with `"New"` and a `go` icon.
   - Tap: `onNew(scope)`.
3. Scope filter (`.seg.scopes`, `aria-pressed`). Buttons: **"All"** `{counts.all}`, **"Local"** `{counts.local}`, **"Domestic"** `{counts.domestic}`, **"International"** `{counts.international}`. The count is rendered in `.muted`. Tap sets `scope`.
4. Groups: one `.card.pad0` per non-empty group. The header `.day` shows the group title on the left and `g.trips.length` on the right, followed by TripRow for each trip.
5. Empty state (`.card` > `.empty`):
   - bold `"No trips yet"`, or `"No {local|domestic|international} trip yet"` when a scope is selected;
   - then the text `"Plan one above, and its legs, stops and bills all live inside it."`

**TripRow** (defined outside the parent). The whole row is a button (`.li.click`). Enter and Space also call `onOpen(trip.id)`.
- `legs = snap.journeys.filter(j => j.tripId === trip.id)`
- Left icon: `.ico.sc-{scope}` with `TeIcon {scope}`.
- Line 1 (bold): `trip.name || trip.to`.
- Line 2 (small muted): `routeText(trip, placeName)`.
- Line 3 (small muted): `"{tripDates(trip)} · {plural(legs.length,'journey')}"`, plus `" · {km} km by road"` when km > 0. Here `km = round1(sum(plannedKm) over legs where mode !== 'flight')`.
- Chips row:
  - Scope chip: `chip plain sc sc-{scope}` with icon and "Local" / "Domestic" / "International".
  - Pattern chip: `chip plain`, mapping `oneway` "One way", `round` "Round trip", `multi` "Multi-city" (falls back to the raw pattern).
  - If the viewer is a co-traveller (`isCoTraveller`): chip `t-info` with a people icon and `"On {planner}’s trip"`, where `planner = snap.emp[trip.emp]?.name`. If there is no planner name: `"You were taken on this trip"`. Otherwise, if `trip.pax > 1`: chip plain `"{pax} people"`.
  - One chip per distinct `mode` among legs whose `kind` is not `first` or `last`. Icon by mode:
    - own, company, cab, auto, rental: `car`
    - public, bus: `bus`
    - train: `train`
    - flight: `plane`
    - anything else: `route`
    - Label: `snap.cfg.modes.find(id)?.name ?? id`.
  - If `trip.origin === 'POST_FACTO'`: chip `plain t-warn` **"Recorded after travel"**.
- Right column `.amt`:
  - `rs(money.value)` in bold, then the small muted `money.label`. `money = tripMoney(trip, snap.claims, snap.expenses)`; those lists hold only the viewer's own records.
  - Below that, `chip {tripChip.tone}` with `tripChip.label`.

There are no API calls on this screen.

---

## Pick an approved trip (components/te/trip/TePickTrip.tsx)

**Purpose.** Step 3 of the entry flow when the chosen way is "approved" (start an approved trip). It is rendered inside TeHome's entry-flow TeSheet, below the TeSteps bar (on 3).

**Props:**
- `scope`, `me`, `trips` (`snap.trips`), `journeys` (`snap.journeys`), `today`, `placeName`.
- `onStartLeg(legId, leg)`: TeHome closes the sheet and sets view `{name:'leg', tripId: leg.tripId, leg}`, which lands on TeLegLive. The leg is still PLANNED; the user presses Start there.
- `onOpenTrip(tripId)`: TeHome closes the sheet and opens the trip view.

**Layout:**
- `.sec` > h4 `"Approved {local trip|domestic trip|international trip}s"`, i.e. `KIND_NAME[scope].toLowerCase() + 's'`.
- `.card.pad0` containing one row per trip in `approvedTrips(scope, {me, trips})`. This list holds owner trips only, not trips the viewer was taken on.
  - Icon `.ico.k-{scope}`.
  - Bold `t.name`.
  - Small muted `routeText(t)`.
  - Small muted `"{tripDates(t)} · {plural(legs.length,'journey')}"`, plus `" · next: journey {next.n}, {day(next.date)}"` if there is a next leg. `legs = legsOf(t, journeys)` and `next = currentLeg(legs)`.
  - Buttons:
    - Shown only if `canStart = next && next.status==='PLANNED' && next.date <= today`: `btn pri sm` with a play icon. Label `"Check in"` if `next.gps === 'checkin'`, else `"Start journey {n}"`. Tap: `onStartLeg(next.id, next)`.
    - Always shown: `btn sm` **"Open"**, which calls `onOpenTrip(t.id)`.
- Empty row: `"No approved {local trip|...} right now."` (muted small).
- Footer text: `"A journey can start on its date. Before that, open the trip to see its journeys and bookings."`

There is no API call; everything comes from the snapshot.

---
## Trip detail (components/te/trip/TeTripDetail.tsx)

**Purpose.** One trip in every state it can be in. The card near the top changes with `trip.display`. This is TeHome view `'trip'`.

### Props, and what TeHome wires to each

- `tripId`, `me` (`snap.me`), `today` (`snap.today`).
- `onBack()`: goes to view `'trips'`.
- `onChanged(message)`: sets the toast and calls TeHome `reload()`.
- `onEdit(detail)`: opens the planner sheet `{name:'plan', kind: d.trip.scope, past: origin==='POST_FACTO', editing: d.trip}`.
- `onOpenClaim(claimId)`: goes to view `{name:'claim', id}`.
- `onOpenLeg(leg)`: goes to view `{name:'leg', tripId, leg}`. TeHome then picks the screen from the leg's status.
- `onAddLeg(detail)`: opens the sheet `{name:'addLeg', detail}`, which is TeLegAdd.
- `onAddBill(tripId)`: opens the expense sheet `{name:'expense', tripId}` (another group's form).
- `onClaim(detail)`: goes to view `{name:'tripClaim', trip: detail.trip}` (the trip claim review screen, another group).

### Data

- On mount, and whenever the local `tick` changes, it calls **`GET /api/te/trips/{tripId}`** (`te.trip`), which returns `TeTripDetail`.
- The server runs `te_trip_detail(p_trip_id, p_actor, p_admin)`.
  - It refuses with 403 `"You cannot open this trip."` unless the caller is the owner, a co-traveller, on the approval chain, in the Finance team, or holds the role (`teOpen` retries with `p_admin=true` for Travel Claims or Finance view).
  - The route validates the id: `"Trip is missing or is not a valid id."`.
- Fields read: `trip` (TeTrip), `employee.name` (the planner), `places{id: {s, lat, lng, ...}}`, `legs[]`, `expenses[]` (everyone's lines on the trip, except DISCARDED), `claims[]` (every claim on the trip), `advance`, `bookings[]`, `messages[] {name, text}`, `timeline[] {at, name, role, text, internal}`, and `can {act, why, own}`.
  - `can.own = (actor == trip.employee_id)`. This screen uses `can.own` as the "mine" guard. `can.act` means "may approve" and is never used here.
- Local `reload()` increments `tick`.

### Loading and error states

While `detail` is null the screen shows:
- a `btn sm` back button with a back icon and the label **"Trips"**;
- a card with muted `error || 'Loading the trip…'`;
- if there was an error, a `btn sm` **"Try again"** button, which calls `reload`.

### Local state

| name | type | default |
|---|---|---|
| detail | TeTripDetail \| null | null |
| error | string | '' |
| busy | '' \| 'answer' \| 'missed' \| 'cancel' \| 'delete' | '' |
| answer | string | '' |
| missedReason | string | '' |
| missedNote | string | '' |
| confirming | 'cancel' \| 'delete' \| null | null |
| tick | number | 0 |
| asking | boolean | false (whether the stay-request form is open) |

### Derived values

| name | definition |
|---|---|
| `t` | `detail.trip` |
| `st` | `t.display` |
| `mine` | `detail.can.own` |
| `legs` | `detail.legs` sorted by `n` |
| `chip` | `tripChip(t)` |
| `pname(id)` | `detail.places[id]?.s ?? ''` |
| `started` | some leg has `startedAt` or `manual` |
| `note` | `coTravellerNote(t, me, detail.employee.name)` |
| `riding` | `isCoTraveller(t, me)` |
| `withWho` | `withText(t, me)` |
| `canBill` | `canBillTrip(t, me)` |
| `decided` | `stayDecisionText(t.stay)` |
| `canAskStay` | `can.own` and stored `t.status` is not `CANCELLED`, `REJECTED`, `CLAIMED` or `CLOSED` |
| `myLines` | if `canBill`: `detail.expenses` with `emp === me` and `status === 'UNCLAIMED'`; else `[]` |
| `food` | if `canBill && t.foodWanted`: `foodBalance(foodBudget(t), foodSpent(detail.expenses, t.id, me))`; else null |
| `claims` | `myClaims(detail.claims, me)` |
| `openLegs` | legs whose status is not `SUBMITTED`, `SKIPPED` or `CANCELLED` |
| `nextLeg` | the first leg that is ACTIVE, PAUSED or ENDED, else the first PLANNED leg, else null |
| `isDraftPostFacto` | `st === 'DRAFT' && t.origin === 'POST_FACTO'` |

### `act(what, run)`

1. Sets `busy = what` and clears `error`.
2. Awaits `run()`, which returns the success message.
3. On success: `setConfirming(null)`, then `onChanged(message)`. If `what` is `cancel` or `delete` it calls `onBack()`; otherwise it calls `reload()`.
4. On failure: `error = errorText(e)`.
5. Finally: `busy = ''`.

### Layout, in render order

Each item appears only when its condition holds.

1. **Top row.**
   - `btn sm`, back icon, **"Trips"**. Tap: `onBack`.
   - Mono muted `t.no`.

2. **Header card.**
   - `h1.tname` `t.name`.
   - Muted route: `points.map(pname || '…').join(' → ')`.
   - Small muted dates: `'No dates yet'` if there is no start; `day(start)` if it is one day; else `"{day(start)} to {day(end)}"`. Then `" · {purpose}"` if set, then `" · {project}"` if set.
   - If `t.pax > 1`, a small muted line: `"{pax} people travel. Each claims their own expenses."`, plus `" {withWho}."` if `withWho` is set.
   - Chips on the right:
     - scope chip `chip plain sc sc-{scope}` with an icon (Local / Domestic / International);
     - pattern chip (One way / Round trip / Multi-city);
     - `chip plain t-warn` **"Recorded after travel"** if the trip is POST_FACTO;
     - `chip {chip.tone}` `{chip.label}`.

3. **Co-traveller banner** (if `note`): `.flag.info` with a people icon, bold **"You are travelling on this trip"**, then p `{note}`.

4. **Error line** (if `error`): `.ferr` with an alert icon and the text.

5. **Approval card** (screens 53 and 68). Shown if `st` is `PENDING_APPROVAL` or `SENT_BACK`.
   - Header: h3 **"Approval"** and `chip {chip.tone}` `{chip.label}`.
   - One row per `t.chain` step `s`:
     - avatar `.av.sm` with initials of `s.whoName || s.role` (the first letter of each word, first 2, uppercase);
     - bold `s.whoName || s.role`, then small muted `s.role`;
     - chip `t-brand` **"Approved"** if `s.status === 'approved'`, else `t-warn` **"Pending"**.
   - If `t.why.length`: small muted `"Added by the workflow: {why.join('; ')}."`.
   - If `st === 'SENT_BACK' && mine`:
     - If `detail.messages.length`: a `.thread` with one `.msg` per message: `<small>{m.name} asked</small>{m.text}`. All trip messages are labelled "asked", including the employee's own earlier answers; this is how the web app behaves.
     - `btn pri wide`, back icon, **"Edit the plan and send again"**. Tap: `onEdit(detail)`.
     - A collapsible `<details class="more">` with summary **"Answer without changes"**. Inside:
       - label **"Your answer"**, a textarea, placeholder **"Explain what your approver asked about"**;
       - `btn wide` labelled **"Send the answer"** (or **"Sending…"** while busy). It is disabled when the answer is blank or `busy==='answer'`.
     - Sending calls `act('answer')` with **`POST /api/te/trips/{id}/action {action:'answer', text: answer.trim()}`**. The response is `{trip_id, status:'PENDING_APPROVAL'}`. Success message: **"Your answer was sent."**
     - Server refusals: `"Nothing to answer."` (not the owner, or not SENT_BACK); `"Write your answer."` (TE_COMMENT); route `"text is required."`.

6. **Expired card** (screen 69e). Shown if `st === 'EXPIRED'`.
   - h3 **"Request expired"** and chip `t-crit` **"Expired"**.
   - Text: **"The trip dates passed before it was approved, so it can no longer be approved or booked."**

7. **Missed card** (screen 69a). Shown if `st === 'MISSED' && mine`.
   - h3 `"Not travelled on {day(t.start)}"` and chip `t-warn` **"Missed"**.
   - Text: **"No journey was started on the day, so there is no GPS record."**
   - Select labelled **"Why was GPS not used?"**. First option `""` **"Choose a reason"**, then: "Forgot to start the travel", "Phone battery was low", "No network or GPS signal", "The app did not work", "Other".
   - Input labelled **"What happened"**, placeholder **"Needed for Other"**.
   - `btn pri wide` **"Record the journeys without GPS"** (**"Recording…"** while busy). Disabled when there is no reason or `busy==='missed'`. The client does **not** require the note for "Other"; the server does.
   - Tap: **`POST /api/te/trips/{id}/action {action:'record-missed', reason, note?: note.trim()||undefined}`**. The response is `{trip_id, status}`. Success message: **"Recorded. Add each journey without GPS, then claim."**
   - Server behaviour: `te_trip_record_missed` refuses `"This trip is not missed."` unless the caller is the owner and the display is MISSED. It then runs `te_leg_no_gps` on every PLANNED leg, in `leg_no` order, so each refusal of that function can surface here. Examples: `"Tell your approver what happened."` when the reason is "Other" without a note; `"Older than 7 days. It can no longer be added."`; `"You have added N journeys without GPS in {Month}. The limit is 5."`; `"Your company accepts journeys only with a GPS record."`. Every PLANNED leg becomes ENDED with `manual=true`, so the trip then shows those legs as **"Ended, report to save"**.

8. **Ready or on-the-way card** (screens 52, 54, 61). Shown if `st` is `APPROVED` or `ONGOING`.
   - h3, by the first rule that applies:
     - **"On the road"** if any leg is ACTIVE or PAUSED;
     - **"Next journey"** if `st === 'ONGOING'`;
     - `"Starts {day(start)}"` if `start > today`;
     - otherwise **"Ready to go"**.
   - Beside it: `chip {chip.tone}` `{chip.label}`.
   - If there is a `nextLeg`:
     - a row with a mode icon (`.ico-b sm`), bold `"Journey {n}: {pname(from)} → {pname(to)}"`, and small muted `"{mode} · {plannedKm} km · {'check-ins'|'GPS'}"` (the raw mode id is shown here, not its name);
     - a `btn pri wide` with a play icon. The label is `"Check in and go"` (checkin) or `"Start this journey"` (track) when `status === 'PLANNED' && date <= today`. It is `"Save the journey report"` when the leg is ENDED, and `"Open the journey"` otherwise. Tap: `onOpenLeg(nextLeg)`. The button never starts anything itself; it only opens the leg screen.
   - If `start > today`: small muted `"The first journey can start on {day(start)}."`.
   - If `!started && mine`, a row:
     - `btn sm grow` **"Change the plan"**, shown only if `t.chain` is empty (a trip that needed no approval). Tap: `onEdit(detail)`.
     - `btn dan sm grow` **"Cancel trip"**. Tap: `confirming = 'cancel'`.

9. **Recorded-after-travel draft card** (screens 39 and 39b). Shown if `isDraftPostFacto && mine`.
   - h3 **"Recorded after travel"** and chip `t-info` **"Draft"**.
   - Text: **"Open each journey to add its fare, add your other bills, and submit. A draft that is not needed can be deleted."**
   - Buttons: `btn sm grow` **"Edit the trip"** (calls `onEdit`) and `btn dan sm grow` **"Delete draft"** (sets `confirming='delete'`).

10. **"Close every journey" card.** Shown if `st === 'COMPLETED' && openLegs.length && mine`.
    - h3 **"Close every journey"** and chip `plain t-warn` `"{plural(openLegs.length,'journey')} open"`.
    - Text: **"The claim goes once each journey has its report, was added without GPS, or was skipped."**
    - One `.act.flat` button per open leg: a mode icon, bold `"Journey {n}: {from} → {to}"`, and small `LEG_STATE[status]`. Tap: `onOpenLeg(l)`.

11. **Claim card** (screen 65). Shown if all of these hold:
    - `mine`;
    - `openLegs.length === 0`;
    - `st === 'COMPLETED'` or `isDraftPostFacto`;
    - none of the viewer's own claims has a status other than CANCELLED or REJECTED.

    Content:
    - h3 **"Claim for this trip"** and chip `plain t-brand` **"Every journey is closed"**.
    - Text: **"Check what each line is worth, add any other bills, and send it."**
    - `btn pri wide` **"Review and submit the claim"** with a go icon. Tap: `onClaim(detail)`.

12. **"What you spent on this trip"** card. Shown if `canBill`. This is the only entry point for hotel and meals bills.
    - h3 plus, if there are lines, chip `plain t-brand` `"{plural(n,'bill')} saved"`.
    - Text when there are lines: `"{rs(sum claimed)} saved so far"`, then (if `riding`) `", in a claim of your own rather than {employee.name}’s"`, then `". Add the rest as you go."`.
    - Text when there are no lines: `"The hotel, food, cabs and anything else you paid for"`, then either (if `riding`) `". They go in a claim of your own, not {employee.name}’s"` or (otherwise) `". Add them as you go rather than from memory afterwards"`, then a closing `"."`.
    - Buttons:
      - `btn pri grow` with a plus icon, **"Add a bill"**. Tap: `onAddBill(t.id)`.
      - If there are lines: `btn` `"See all {n}"` with a go icon. Tap: `onClaim(detail)`.
    - Food meter (if `food`): the wrapper class is `meter` (tone ok), `meter close` or `meter over`. It shows the label **"Food budget"**, the number `"{rs(spent)} of {rs(budget)}"`, a bar `<i style=width:{pct}%>` and a muted `foodBalanceText(food, rs)`.

13. **"Hotels you asked for"** card. Shown if `t.stayOptions.length`.
    - h3 and chip plain `"{plural(n,'option')}"`.
    - If `decided`: `.flag.ok` (check icon) or `.flag.warn` (alert icon) with `decided.text`.
    - Otherwise, small muted text: **"The Travel Desk picks one of these and books it."** if `t.stayBy === 'desk'`, else **"You book one of these yourself and claim it back."**
    - One row per option `o` at index `i`:
      - the row gets class `row tight picked` if `stay.status === 'CHOSEN' && stay.chosen === i`;
      - a home icon;
      - bold small `"{i+1}. {o.name}"`, plus chip `t-pos` **"Chosen"** if it is the chosen one;
      - small muted `[o.location, o.price ? "about {rs(price)} a night" : ''].filter(Boolean).join(' · ')`, or **"No other details given"** when both are empty;
      - if `o.url`: `TeFileLink path={o.url} name="Open" small` (an external link).

14. **Route card** (always shown).
    - h3 **"Route"**, then on the right a muted `plural(legs.length,'journey')`.
    - If `mine && (st === 'ONGOING' || st === 'COMPLETED')`: `btn sm` with a plus icon, **"Add a journey"**. Tap: `onAddLeg(detail)`.
    - `TeTripMap` (schematic; props `legs {from,to,mode}`, `points` place ids, `places` Map, `label "Map of {name}"`).
    - `TeMapLinks` (`points` = `detail.places` for each point, `scope`, `label`). Both belong to the plan group.
    - One row per leg (`.tw-leg.click`, role button; Enter or Space opens it):
      - `.ln` `{n}` and a mode icon;
      - bold small `"{from} → {to}"`;
      - small muted: `"{day(date)} · "` (omitted for local trips), then `{mode}`, then `", Travel Desk"` if `bookedBy==='desk'`, then `" · {plannedKm} km"`, then `" · {check-ins|GPS}"`, then `" · {LEG_KIND[kind]}"` when it applies;
      - chip plain `LEG_STATE[status]`.
      - Tap: `onOpenLeg(l)`.
    - `LEG_KIND`: first "to the airport or station"; last "from the airport or station"; extra "added during the trip".

15. **Estimate card.** Shown if `t.origin !== 'POST_FACTO' && t.estimateTotal`.
    - h3 **"Estimate"**, then muted small **"from the plan and your limits"**.
    - A `dl.kv` with one row per non-zero key of `t.estimate`:
      - travel "Travel you pay"
      - desk "Tickets the Travel Desk books"
      - hotel "Hotel, Travel Desk books" if `stayBy==='desk'`, else "Hotel"
      - meals "Food"
      - conv "Local rides at the destination"
    - A final `dt.tot` **"Total"** row with `rs(estimateTotal)`.

16. **Claim cards.** One per claim in `claims` (the viewer's own only).
    - h3 `"Claim "` plus mono muted `c.no`; chip plain `c.status.replace(/_/g,' ').toLowerCase()`.
    - `dl.kv`: **"Claimed"** `rs(c.claimed)`; **"Approved"** `rs(c.approved)`.
    - If `c.net != null`: a total row labelled **"Paid to you"** when `net >= 0`, else **"Balance on advance"**, with the value `rs(|net|)`.
    - `btn wide sm` **"Track this claim"**. Tap: `onOpenClaim(c.id)`.

17. **"Stays and tickets"** card. Shown if `detail.bookings.length || canAskStay`.
    - h3. If `canAskStay && !asking`: `btn sm` **"Ask for a stay"**, which sets `asking = true`.
    - One `.flag` per booking:
      - Class `flag` if the booking is CANCELLED, `flag info` if REQUESTED, else `flag ok`. Icon `close`, `clock` or `check` to match.
      - Bold `b.vendor`.
      - p: **"Asked the Travel Desk"** if REQUESTED; **"Cancelled"** if CANCELLED; otherwise `"Booking {pnr}"` (when `kind==='hotel'`) or `"PNR {pnr}"`. Then `" · {rs(amount)}"`, plus `" expected"` if requested, plus `" · {day(check_in)}"` and `" to {day(check_out)}"` when those dates exist.
      - Small muted `[details.address, details.room, details.note].join(' · ')` when any of them exists.
      - If `b.ticket`: a `TeFileLink`. Its name is `"Open on {details.platform || 'the booking site'}"` for a request, else **"Open the ticket"**.
    - If `asking`: render **TeStayRequest** (below). `onCancel` sets `asking = false`. `onDone(msg)` sets `asking = false`, calls `onChanged(msg)` and `reload()`.

18. **Advance card.** Shown if `detail.advance`.
    - h3 **"Advance"** and chip plain `advance.display`.
    - kv rows: **"Asked"** `requested`; **"Approved"** (only if not null); **"Still with you"** `outstanding`.

19. **History card.** Shown if `timeline.length`.
    - h3 **"History"**.
    - One row per entry where `!e.internal`: bold small `e.text`; small muted `e.name ?? 'System'` plus `" · {role}"` when there is a role; on the right `when(e.at)`.

20. **Confirm card.** Shown if `confirming` is set.
    - h3 **"Delete this draft?"** or **"Cancel this trip?"**.
    - Text for delete: **"The draft and its journeys are removed. Nothing has been claimed against it, so nothing else changes."**
    - Text for cancel: **"The plan is cancelled and its journeys are dropped. Any advance asked for is cancelled with it. This cannot be undone."**
    - Buttons: `btn grow` **"Keep it"** (sets `confirming = null`), and `btn dan grow` labelled **"Delete the draft"** / **"Cancel the trip"** (**"Working…"** while busy; disabled while busy).
    - The danger button calls `act(confirming)` with **`POST /api/te/trips/{id}/action {action:'cancel'}`**. The response is `{trip_id, status:'CANCELLED', deleted}`. Message: **"The draft was deleted."** if `deleted`, else `"{t.no} was cancelled."`. Then the screen calls `onBack()`.
    - Server `te_trip_cancel` refusals:
      - `"Trip not found."`
      - `"Only the employee or an approver of this trip can cancel it."` (403)
      - draft: `"This trip has a claim. Recall the claim first."`
      - non-draft: `"This trip is {status lowercased with spaces} and can no longer be cancelled."` when the status is not PENDING_APPROVAL, SENT_BACK or APPROVED
      - non-draft: `"This trip has started and can no longer be cancelled. Skip the journeys you did not take."`
      - non-draft: `"This trip has a claim. Recall the claim first."`
    - Effects of a cancel: UNCLAIMED lines become DISCARDED; open legs become CANCELLED; pending steps are cancelled; the advance becomes RECOVERY_DUE if money is outstanding, else CANCELLED. `deleted` is true for a POST_FACTO draft.

### Leg status labels (LEG_STATE, used on this screen)

| status | label |
|---|---|
| PLANNED | "Not started" |
| ACTIVE | "On the road" |
| PAUSED | "Stopped" |
| ENDED | "Ended, report to save" |
| SUBMITTED | "Done" |
| SKIPPED | "Skipped" |
| CANCELLED | "Cancelled" |

### Actions available, by display status

All of these are owner-only (`can.own`) unless the row says otherwise.

| display | Cards and actions |
|---|---|
| DRAFT (POST_FACTO) | "Edit the trip", "Delete draft"; once every leg is closed and there is no live claim, the Claim card |
| PENDING_APPROVAL | Approval chain only; no actions |
| SENT_BACK | Chain, messages, "Edit the plan and send again", "Answer without changes" |
| APPROVED | Next-journey card with the open-leg button; before any leg has started: "Change the plan" (only when there is no chain) and "Cancel trip". "Add a journey" is **not** shown, although the server allows it during the trip dates |
| ONGOING | Next-journey card; "Add a journey" on the Route card; "Change the plan" / "Cancel trip" only if no leg has started or been added manually (once a leg has started the server refuses the cancel anyway) |
| COMPLETED | "Close every journey" list while legs are open; the Claim card once all are closed; "Add a journey" |
| MISSED | The Missed form (record without GPS) |
| EXPIRED | Info card only |
| CLAIMED / CLOSED | Claim cards (Track this claim); the bills card is still shown (late bills go into a supplementary claim); "Ask for a stay" is hidden |
| CANCELLED / REJECTED | Header, route, history only; no bills card |
| any status, co-traveller | Banner; bills card (unless CANCELLED or REJECTED); their own claim cards; every owner action hidden |

The leg rows on the Route card open the leg screen in **every** state, for anyone who can view the trip. See the routing table at the top of this part.

---

## Ask the desk to book a stay (components/te/trip/TeStayRequest.tsx)

**Purpose.** An inline card inside TripDetail's "Stays and tickets" card. The employee asks the Travel Desk to book a hotel they have found. It creates a booking with status **REQUESTED**: no PNR and no expense line.

**Props:**
- `detail` (TeTripDetail)
- `placeName` (TripDetail's `pname`)
- `onDone(message)`
- `onCancel()`

### State

`points = detail.trip.points`.

| field | default |
|---|---|
| `seq` (index into points) | 1 if `points.length > 1`, else 0 |
| vendor | '' |
| amount | '' (string) |
| link | '' |
| checkIn | `points[1]?.arrive \|\| ''` |
| checkOut | `points[1]?.leave \|\| ''` |
| address, room, note | '' |
| busy | false |
| error | '' |

`ready = vendor.trim() !== '' && Number(amount) > 0`.

`pickStop(i)` sets `seq`. It fills `checkIn` from `points[i].arrive` and `checkOut` from `points[i].leave` **only if** each field is currently empty.

### Layout

- `.card` with h3 **"Ask the desk to book a stay"**, then a `.form` containing:
  - Only if `points.length > 1`: select labelled **"Where you are staying"**. Options are each point: `placeName(p.place) || "Stop {i+1}"`, with `" (where you start)"` appended for index 0.
  - **"Hotel"**: input, placeholder **"The name of the hotel"**.
  - Two-column `.g2`: **"Check in"** (date input) and **"Check out"** (date input, `min = checkIn`).
  - **"What you expect it to cost (₹)"**: number input, min 0. Helper below: `"About {rs(amount)} for the stay."` when amount > 0, else **"The desk books against this, so an estimate is enough."**
  - **"Link to the hotel"**: placeholder **"https://www.makemytrip.com/hotels/…"**. Helper: `"From {platform}. The desk and your approver can open it."` when a platform can be parsed, else **"Any booking site. Paste the page you found."** `platformOf(url)` is `new URL(url.trim()).hostname` without a leading `www.`, or null when it cannot be parsed.
  - **"Address, if you have it"**: input.
  - `.g2`: **"Room"** (placeholder **"Standard, twin, …"**) and **"Anything else"** (placeholder **"Near the client office"**).
  - `.note` with an info icon: `"This asks the Travel Desk to book it. Nothing is charged to the trip until they do, and"`, then `" it is recorded against {placeName(point.place) || 'this stop'}."` when a point is selected, or `" it is recorded against this trip."` otherwise.
  - `.ferr` with the error, if any.
  - Buttons: `btn` **"Never mind"** (calls `onCancel`) and `btn pri` **"Ask the desk"** (**"Sending…"** while busy; disabled unless ready and not busy).

### Send

**`POST /api/te/bookings/request`** with body:

```
{ trip_id, point_seq: seq, vendor: vendor.trim(), amount: Number(amount),
  ticket_url?: link.trim(),
  details: { address?, room?, check_in?, check_out?, note?, platform? } }
```

Empty fields are omitted. `platform` is taken from the link. The response is `{booking_id, booking_no, status:'REQUESTED'}`. Success message: `"Asked the Travel Desk to book {vendor} · {booking_no}"`.

**Route validations** (400, in `app/api/te/bookings/request/route.ts`, after authentication):
- `"amount must be a number."`
- `"trip_id is missing or is not a valid id."`
- `"vendor is required."` (vendor is capped to 120 chars)
- link: `"That booking link is not a web address."`, or `"A booking link must start with http:// or https://."`
- details are trimmed and capped: address 240, room 80, platform 60, check_in 10, check_out 10, note 400.

**SQL `te_booking_request` refusals:**
- `"Trip not found."`
- 403 `"You can only ask for a stay on your own trip."`
- `"This trip is {cancelled|rejected|closed|claimed}. There is nothing left to book for it."`
- `"Enter the name of the hotel."`
- `"Enter what you expect the stay to cost."`
- `"That stop is not on this trip."` (`point_seq` is 0-based and matches `te_trip_points.seq`)
- `"You have already asked for a stay here. Change that request instead."` (a REQUESTED hotel booking already exists for the same `point_seq`)

On a successful request the server writes the trip log entry `"Asked the Travel Desk to book {vendor} for about ₹X"`, plus `". Link attached."` when a link was given. An error is shown in the card's `.ferr`.

---

## Journey recorder: live GPS (components/te/leg/TeLegLive.tsx)

**Purpose.** Starting a journey, recording GPS fixes while it runs, adding stops on the way, continuing after a stop, and ending it. Prototype screens 55–58.

**Reached from:** TeHome view `{name:'leg', tripId, leg}` when `leg.status` is `PLANNED`, `ACTIVE` or `PAUSED`. Route in from any of:
- trip detail ("Start this journey" / "Check in and go" / "Open the journey");
- a Continue row ("Open the journey", "Start journey", "Check in");
- TePickTrip;
- TeLiveBar.

**Props:** `snap`, `leg`, `placeName`, `onBack` (to the trip), `onEnded(stats)`, `onChanged(message)`.

**Derived:** `rules = snap.cfg.track`. `running = leg.status === 'ACTIVE'`. `paused = leg.status === 'PAUSED'`.

> Stale-leg defect (see the box at the top of Part 4). `leg` is the object captured when the view opened, and `reload()` does not replace it. In the web app, pressing Start changes nothing on this screen: it stays on "Ready to start", the watcher never starts (it is gated on `running`), and the user must go Back and reopen the journey before fixes are collected. The same applies after "Record the stop": the screen still thinks the leg is ACTIVE, so "Continue the journey" does not appear until it is reopened. **RN:** derive the status from the freshest snapshot (by `leg.id`), or set it optimistically from the response (`status:'ACTIVE'` / `'PAUSED'`).

### Layout, top to bottom
1. **Row:** a small button "Trip" with a back icon (calls `onBack`), then mono muted "Journey `<n>`".
2. **Header card.** Class `card live` while running, else `card`.
   - Eyebrow "Journey `<n>`".
   - h1 (display font) "`<placeName(from)>` → `<placeName(to)>`".
   - Muted mode name: `cfg.modes.find(id===leg.mode)?.name ?? leg.mode`.
   - Right side, two chips:
     - a brand plain chip with a route icon: "Check-ins" if `leg.gps==='checkin'`, else "GPS tracked";
     - a state chip:

| state | text | tone |
|---|---|---|
| running | Travelling now | `chip t-pos` |
| paused | Stopped | `chip t-warn` |
| else (PLANNED) | Not started | `chip plain` |

3. **Note** (only while running, info icon): "Keep this screen open. A phone browser stops reading location when the screen locks or you switch apps, and those minutes are missing from the trail."
4. **Permission-denied flag** (`flag crit`, alert icon). Shown when geolocation is missing or `PERMISSION_DENIED`.
   - Bold "Location is switched off for this site".
   - Text "Nothing is being recorded. Turn location on for this site and reload, or end the journey and add it without GPS — your approver sees the reason either way."
5. **Gap warning** (`flag warn`). Shown while running and `isGap(lastFixAt, now, rules)` holds, i.e. no fix for at least `cfg.track.gapMin` minutes (default 5).
   - Bold "No new position for `<quiet>` minutes".
   - Text "If the phone was locked or another app was in front, those minutes are a gap in the trail and your approver will see it."
   - Note: `lastFixAt` is only set by fixes received in this screen session. It starts as null, so no gap is shown until at least one fix has arrived.
6. **Error line** (`.ferr`, alert icon): the last action error.
7. **Three tiles** (`g6 five`; label / value / small note):

| label | value | note |
|---|---|---|
| Distance so far | `${trailKm(trail)} km` | an estimate from this phone |
| Points recorded | `trail.length + sentCount` | `${trail.length} waiting to send` |
| Last position | `${silentMinutes} min ago`, or "—" when there is no fix | "while this screen is open" when running, else "not recording" |

   - `trail` is the **queue still held locally** (unsent fixes). After a flush it is replaced by what is left, so "Distance so far" covers only unsent fixes. Display quirk: it drops after every flush. RN can keep a separate running total if desired.
   - `sentCount` is the number of fixes acknowledged in this session.
8. **While running, not stopping:** a row of two buttons.
   - "Add a stop" (pin icon): sets `stopping = true`.
   - Primary "End this journey" ("Ending…" while busy).
9. **While running and stopping:** a card with h3 "Why are you stopping?".
   - Select "Reason": placeholder "Choose a reason", then `snap.cfg.stopReasons.filter(r => r.on)` as `{id, name}`.
   - Input "Note", placeholder "Optional".
   - Buttons:
     - "Never mind": closes the card.
     - Primary "Record the stop" ("Recording…" while busy). Disabled until a reason is chosen.
10. **While paused:** a primary wide button "Continue the journey" with a play icon ("Starting…" while busy).
11. **When PLANNED:** a card.
    - h3 "Check in to start" (checkin mode) or "Ready to start".
    - Small muted text:
      - checkin: "Your position is recorded at both ends of this journey rather than along the way."
      - track: "Your position is recorded along the way until you end the journey. Keep this screen open while you travel."
    - The error line again.
    - Primary large wide button with a play icon. Text: "Check in and go" (checkin), "Start this journey" (track), or "Reading your location…" while busy.

### Actions and API calls
`run(what, fn)` sets `busy = what`, clears the error, awaits `fn()`, then calls `onChanged(returned message)`. On error it shows `errorText(e)` in `.ferr`.

**Getting a fix for an action**, `here()`:

```ts
navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
-> { lat, lng, accuracy_m }      // no recorded_at, no address, no is_mock, no device
```

- Without geolocation: "This device cannot read its location."
- On failure: "Could not read your location. Check that location is on, then try again."

**Start.** `fix = await here()`, then `POST /api/te/legs/:id/action {action:'start', fix:{lat,lng,accuracy_m}}`. Response `{leg_id, status:'ACTIVE', start_off_m}`.
- Message: checkin -> "Checked in."; track -> "Journey `<n>` started. Keep this screen open."
- Server (`te_leg_start`, mig 162) refuses with, in this order:
  - not PLANNED: "This journey cannot be started."
  - no lat/lng: TE_GPS "Your location is needed to start. Turn on location and try again."
  - trip status not APPROVED/ONGOING: "The trip is waiting for approval." (PENDING_APPROVAL) · "The day of this trip has passed. Add it without GPS." (MISSED) · "The trip is not open for travel."
  - an earlier journey still PLANNED/ACTIVE/PAUSED: "Finish or skip journey `<n>` first."
  - `today > trip.end_date + 1`: "The trip dates are over. Add this journey without GPS, or skip it."
  - `leg_date > today`: "This journey is planned for `<Dy, D Mon>`."
  - any of my journeys ACTIVE/PAUSED: `TE_LEG_RUNNING` "End the journey that is running first."
- On success the server:
  - sets `started_at` (fix.recorded_at or now()) and `leg_date = today`;
  - stores start lat/lng/accuracy/address/device and `start_off_m` = metres from the planned start place (haversine);
  - inserts ping #1;
  - logs "Checked in at …" or "Journey started at `<place>`. GPS fix within `<acc>` m, `<off>` m from the planned point."

**Pings** (the watcher). Runs only while `running` (status ACTIVE as captured; see the defect above):

```ts
navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
```

- **There is no sampling interval of our own.** Every position the browser delivers is processed.
- `onFix(pos)`:
  1. `fix = toPing(pos)` -> `{lat, lng, accuracy_m: coords.accuracy, speed_kmh: round(coords.speed*3.6) | undefined, recorded_at: ISO(pos.timestamp)}`.
  2. **Accuracy filter:** drop the fix if `accuracy_m > cfg.track.minAccuracy` (default 50 m). Keep it if accuracy is null.
  3. Append it to an in-memory `buffer`.
  4. **Persist before sending:** `merged = mergePings(readQueue(leg.id), [fix])`, written to `localStorage['te.leg.<legId>.pings']` (deduped by `recorded_at`, sorted). Update `trail` and `lastFixAt`.
  5. If `shouldFlush(buffer.length, lastSent, now, rules)`, empty the buffer and call `flush()`. That is true when buffer ≥ 20, **or** when `now - lastSent ≥ cfg.track.pingSec` seconds (default 30). `lastSent` starts at 0, so the first fix flushes immediately.
- `onErr`: `PERMISSION_DENIED` sets `denied`. Other errors (timeout, unavailable) are ignored.
- **Periodic tick:** while running, `setInterval(15000)` updates `now` (for the "quiet N min" counter) and calls `flush()`.
- **Also flush on** `window 'online'` and `'pagehide'`.
- On mount, the queue left by a previous session (closed tab, crash) is read into `trail`. It is sent on the next flush.

`flush()`:
- Never overlaps itself (`sending` ref).
- Reads the queue. If empty, does nothing.
- Sends `batch = queue.slice(0, 200)` (**max 200 per request**; the server limit is 5000) as `POST /api/te/legs/:id/action {action:'pings', pings: GpsPing[]}`. Each ping is `{lat, lng, accuracy_m?, speed_kmh?, recorded_at}`.
- On success: writes back `withoutSent(queue, batch)` (by `recorded_at`), `sentCount += batch.length`, `lastSent = now`.
- On any failure (offline, 4xx, 5xx) it silently keeps the queue. **No backoff, no retry counter.** The next fix or tick retries.
- The server (`te_leg_pings_add`):
  - refuses "Journey not found." (not mine) and "This journey is not recording." (status not ACTIVE/PAUSED/ENDED, or not started);
  - silently ignores pings without lat/lng/recorded_at, pings before `started_at` or after `ended_at`, and duplicate timestamps;
  - answers `{leg_id, stored, total}`.

So pings are accepted after END too, up to `ended_at`, until the report is filed. **No mock-location detection on the client:** `is_mock` is never set by the web (the column exists; RN should send `is_mock: location.mocked` on Android). No client speed or jump filter: jumps are judged on the server at end.

**Background behaviour (web):** none. The watcher stops when the screen locks, the tab is hidden or the app is switched. The text warns about this. TeLiveBar on other screens says "Not recording here". **RN must do better:** background location (see Part 8).

**Stop.** Pressing "Record the stop": `at = await here()`, then:

```
POST {action:'stop', stop:{reason_code, note?: string, lat, lng, accuracy_m}}
```

- Response `{leg_id, stop_id, seq, status:'PAUSED'}`. The form resets. Message "Stop recorded. The clock is paused."
- Server (`te_leg_stop_add`) refusals:
  - already PAUSED: "You are already at a stop. Tap Continue first."
  - not ACTIVE: "Start the journey first."
  - mode does not allow stops (`te_modes.stops_allowed = false`, i.e. `TeMode.stops`):
    - flight: "A stop cannot be added during a flight. A connecting flight is a journey of its own."
    - otherwise: "On a `<mode name lowercased>` the stops are the operator’s. If you get off, end this journey and start a new one."
  - unknown or inactive reason: "Choose why you stopped."
  - reason `other` with no note: "Say why you stopped."
  - no lat/lng: TE_GPS "Your location is needed to add a stop."

  **RN:** hide "Add a stop" when `!mode.stops`, rather than letting it fail. The web shows it for every mode.
- Stop reasons come from `cfg.stopReasons` (`{id, name, biz, dwell, on}`). `biz` marks a business stop: it adds to the route allowance (`viaKm`). A non-business stop longer than `track.stopMaxMin` (90) raises flag G11.

**Continue.** `POST {action:'continue'}` (no `minutes`, no `at`). The server closes the last stop at now() and computes its minutes. Response `{leg_id, stop_id, minutes, status:'ACTIVE'}`. Message "On the way again.". Refusal: "You are not at a stop." The API also accepts `minutes` (stop end = start + minutes) or `at`; the web never sends them.

**End.** Pressing "End this journey":
1. `await flush()`. The last stretch is usually still queued, and pings after the report is filed are refused.
2. `fix = await here()`.
3. `POST {action:'end', fix:{lat,lng,accuracy_m}}`.
4. On success, clear the local queue, call `onEnded(r.stats)`, then the message "Journey `<n>` ended. `<gps_km>` km recorded.".
   - TeHome's `onEnded` sets the toast "Journey ended. Add what it cost.", reloads and navigates to the trip. The `run()` wrapper then calls `onChanged` with the second message, which replaces the toast. **The user sees "Journey `<n>` ended. `<km>` km recorded."**

Server, `legEnd` in te-service:
- refuses "Your location is needed to end the journey." when lat/lng is missing;
- loads the snapshot with this leg's full trail;
- `A.legEndStats` refuses "Journey not found." / "This journey is not running.";
- then `te_leg_end`:
  - if PAUSED, it first closes the open stop;
  - inserts the end fix as the last ping;
  - computes `end_off_m`;
  - stores `gps_km`, `route_km`, `gps_points`, `gps_gap_max_sec`, `gps_max_speed_kmh`, `moving_minutes` and `stats`;
  - logs "Journey ended at `<place>`. `<km>` km recorded from `<n>` location points. `<off>` m from the planned point." (checkin: "Checked in at `<place>` on arrival. `<km>` km by air./on the map.");
  - answers `{leg_id, status:'ENDED', gps_km, end_off_m}`, plus `stats` from te-service.

**What the server computes at end (`legEndStats` -> engine `jStats`, `lib/te/engine/te-engine.js`)**
- The track is `[first fix … , end fix]`. For `gps==='checkin'` it is only `[start check-in, end fix]`. Time `t` is in seconds since `startedAt`. An open stop gets `dwell = max(1, round((end.t - stop.t)/60))` minutes.
- **checkin mode:**
  - `gpsKm = payBase = leg.plannedKm` (map or air distance, not measured);
  - `dur` = end `t`; `moving = dur - stopMin*60`;
  - `startOff` / `endOff` = haversine metres from the planned from/to places.
- **track mode.** Over consecutive points (segments that start at a stop index are skipped):
  - `d` = haversine km, `dt` = s, `sp = d/dt*3600`. `gpsKm += d`.
  - If `sp > maxSpeed` (`track.maxSpeed` = 130 km/h; `max(130, 200)` for train), count a **jump**: `jumps++`, `jumpKm += d`.
  - Else if `dt > gapMin*60` (`gapMin` = 5; `trainGapMin` = 30 for train or bus), count a **gap**: `gaps++`, `gapKm += d`, `gapMaxMin`.
  - `payBase = round1(gpsKm - jumpKm)`. `moving = dur - stopMin*60`. `avg` km/h.
  - The final `pings = n` (the real number of fixes).
- **Flags these feed later** (raised in the journey report and the claim; G-layer):

| code | trigger | title |
|---|---|---|
| G1 | `startOff > startRadius` (300 m; `hubRadius` 2000 m when the place type is airport or station) | "Journey started away from the planned start point" / checkin: "Check-in away from the start point" |
| G2 | `endOff > endRadius` (300 m / hub 2000 m) | "Journey ended away from the planned destination" / "Arrival check-in away from the destination" |
| G3 | own vehicle: payBase > `viaKm × (1 + routeTol/100)` (15%); capped when the check's action is `cap` | "GPS distance is above the shortest route" |
| G4 | track: `gaps > 0` | "No location for part of the journey" |
| G5 | track: `jumps > 0` | "Impossible speed or location jump" |
| G7 | journey added without GPS | "Journey without a GPS record" / "Journey without GPS check-ins" |
| G8 | fare above `max(mode.ceil × km, mode.minFare)` (× `abroadFactor` 6 abroad) | "Fare is above the ceiling for the distance" |
| G9 / G12 / G13 | vehicle not verified / not in own name / RC or insurance expired on the date | see Part 5 |
| G10 | own-vehicle km over the daily cap (`maxKmDay` 150, or `maxKmDayOut` 500 off a local trip) | "Daily distance cap reached" |
| G11 | personal stop longer than `stopMaxMin` (90 min) | "Long stop for a personal reason" |

**`cfg.track` keys** (seeded defaults, migration 149/162 `te_settings.gps_rules`):
- gpsRequired: true
- manualAllowed: true. Whether journeys without GPS are accepted.
- intlTrack: false
- pingSec: 30. Client flush interval, s.
- minAccuracy: 50. Client accuracy filter, m.
- startRadius: 300, endRadius: 300, hubRadius: 2000 (m)
- routeTol: 15 (%)
- gapMin: 5, trainGapMin: 30 (min)
- maxSpeed: 130 (km/h)
- stopMaxMin: 90
- preApproveKm: 75. A local trip up to this is auto-approved. That is the "No approval up to 75 km" copy.
- maxKmDay: 150, maxKmDayOut: 500
- localMaxKm: 120. Local range; an extra journey beyond it is refused.
- localMealCap: 300
- abroadFactor: 6
- provider: "Google Maps"
- retentionDays: 180
- journeyClaim: "instant"
- pastDays: 7. A journey without GPS on a local trip must be within this many days.
- pastPerMonth: 5. Local journeys without GPS per month.
- typedAddress: true

The client reads `pingSec`, `minAccuracy`, `gapMin` and `manualAllowed`. The rest is server-side.

---

## Journey report (components/te/leg/TeLegReport.tsx)

**Purpose.** The money side of a journey that has ENDED: fare, bill and reason. Prototype screens 59, 60, 62.

**Reached from:** view leg with `leg.status === 'ENDED'`. Routes in:
- trip detail: "Save the journey report", or the rows under "Close every journey";
- a Continue row: "Save report".

Props: `snap`, `leg`, `placeName`, `onBack`, `onFiled(message)`.

**Form shape from the mode's basis.** `mode = cfg.modes.find(m => m.id === leg.mode)`; `basis = mode?.basis ?? 'bill'`.
- `needsFare = basis ∉ {km, none}`
- `needsBill = basis ∈ {bill, ticket}`
- `isTicket = basis === 'ticket'`

| basis | chip (PAY_WORD) | fields |
|---|---|---|
| km (own vehicle) | Paid per km | none. Text: "Nothing to enter. An own-vehicle leg is paid on the distance above at your vehicle’s rate a kilometre." |
| bill (cab, rental) | Paid on your bill | Fare (₹), Paid by, Who you paid; attach the bill |
| nobill (auto, bus) | Fare, no bill needed | Fare (₹), Paid by, Who you paid; text "No bill is needed for this one; the fare is enough." |
| ticket (flight, train) | Paid on the ticket | Ticket fare (₹), Paid by, PNR or ticket number, Class; attach the ticket |
| none (company vehicle) | Not paid, only logged | none. Text: "Nothing to enter. A company vehicle is not paid to you; the leg is recorded so the trip is complete." |

### Layout
1. **Row:** "Trip" back button, mono "Journey `<n>`".
2. **Header card:**
   - eyebrow "Journey `<n>` ended";
   - h1 "`<from>` → `<to>`";
   - muted "`<mode name>`", plus " · ended `<when(endedAt)>`" when there is an end time.
3. **Stats tiles.** `stats = preview?.stats ?? leg.stats`, shown when present. Values are rounded to 0.1.

| label | value | note |
|---|---|---|
| GPS distance | `gpsKm` km | measured by the phone |
| Paid on | `payBase` km | after the checks |
| Time on the road | `dur` min (as the server sends it; the engine's `dur` is in seconds, so the web shows seconds labelled "min". **Defect: show `round(dur/60)`**) | start to end |
| Stops | `stops` | "`stopMin` min stopped", or "none" |
| Points | `pings` | "`gaps` gap(s)", or "no gaps" |

4. **Card "What it cost"** with the basis chip, then the fields:
   - `fare`: number, min 0, inputMode decimal. Label "Ticket fare (₹)" or "Fare (₹)".
   - `payMode`: select from `['UPI', 'Personal card', 'Cash', 'Company card']`, default `'UPI'`. Label "Paid by".
   - ticket only:
     - `ref`, label "PNR or ticket number";
     - `cls`, label "Class", placeholder "Economy, 3A".
   - otherwise: `merchant`, label "Who you paid", placeholder "Driver, operator or app".
   - **Attach** (when `needsBill`): a label-button.
     - Text "Attach the ticket" / "Attach the bill". "Attaching…" while uploading. Once attached: "`<file_name>` attached · choose another to replace".
     - A hidden `<input type=file accept="image/*,application/pdf">`. No `capture` attribute. No compression or HEIC conversion on the client: the server accepts HEIC.
     - Upload: `POST /api/te/upload` multipart `file`, `kind` = `TICKET` if ticket else `BILL`. Response `.file` (TeUploadedFile). Only one file; a new one replaces it.
     - If OCR returned `ocr.amount` and the fare is empty or 0, the fare is set to it. OCR is not configured today, so this is null.
   - **Reason** textarea, label "Why", placeholder "Your approver reads this". Shown only when `preview.needsReason`.
5. **Card "What you will be paid"** (when the preview is priced, i.e. not `{none:true}`). A dl:
   - "You paid" `rs(claimed)`;
   - if `claimed !== eligible`: "Over the limit" `rs(eligible - claimed)` (negative);
   - "Eligible" `rs(eligible)` as the total row.

   If `mileage` is present: "`<payKm>` km at `<rs(rate)>` a km`, <vehicle.reg>`." plus " The shortest route is `<mapKm>` km." when `payKm !== mapKm`.

   Then each flag as a `flagClass` box with a warn icon: bold "`<code>` `<title>`", then `evidence`.
6. Error line.
7. Primary large wide button "Save the journey report" ("Saving…"). Disabled when `preview.blocked`. Under it, when blocked: "Fix what is marked above before this can be saved."

### API
- **Live preview.** On every change of the input (form plus file), debounced **350 ms**, with stale answers dropped:

  ```
  POST /api/te/legs/:id/action {action:'preview', report: LegReportInput}
  ```

  - `LegReportInput`: `{fare?, merchant?, ref?, cls?, payMode, reason?, files?: [TeUploadedFile]}`. The web never sends `curr`, `fxAmt`, `fxRate`, `gstin` or `billNo` from this screen.
  - Response `LegPreview`: `{ none:true, stats }` when nothing is claimable, else `{ flags, eligible, claimed, mileage: MileageView|null, blocked, needsReason, stats }`.
  - "Nothing is claimable" means basis none, or a ticket booked by the desk with a live booking.
  - Errors set the preview to null, silently.
  - The server can refuse with "Journey not found.".
- **Save.**

  ```
  POST {action:'file', report}
  ```

  - Server: if the preview is priced and blocked, "Fix the blocked items first." (`flags`). If it needs a reason, "Add a reason where one is asked." (`flags`).
  - Then `te_leg_file`:
    - "End the journey first." (not ENDED);
    - "Add what you paid for this journey." (no expense payload when one is needed).
    - Otherwise it writes an expense line (paid_by self, date = leg date, vehicle, from/to) and sets the leg SUBMITTED.
  - Response `{leg_id, status:'SUBMITTED', expense_id, trip_status, eligible, flags}`.
  - Success message: "Journey `<n>` saved. `<rs(eligible)>` is eligible." when eligible > 0, else "Journey `<n>` saved.". Then back to the trip.

---

## Journey not recorded (components/te/leg/TeLegMissed.tsx)

**Purpose.** For a journey whose GPS was not recorded:
- "I travelled it, but it was not recorded" pays it on the planned distance (`no-gps`);
- "I did not travel this journey" pays nothing (`skip`).

Prototype screens 69b–d.

> **Reachability defect (web).** TeHome sends a leg here only when its status is NOT PLANNED/ACTIVE/PAUSED/ENDED, i.e. SUBMITTED, SKIPPED or CANCELLED. But both server actions require `status = 'PLANNED'`. The server answers "This journey cannot be added now." / "Only a journey that has not started can be skipped.". So in the web app this screen's actions always fail, and a PLANNED journey that was missed opens the live recorder instead, where Start fails with "The day of this trip has passed. Add it without GPS." / "The trip dates are over. Add this journey without GPS, or skip it.". **RN fix:** route a PLANNED leg here when it can no longer be started: its date is before today, or the trip display is COMPLETED/MISSED. At minimum, offer "Not recorded?" from the live screen. For SUBMITTED/SKIPPED/CANCELLED legs show a read-only summary instead.

Props: `snap`, `leg`, `placeName`, `onBack`, `onDone(message)`.

### Layout
1. Row: "Trip" back button, mono "Journey `<n>`".
2. Card:
   - eyebrow "Journey `<n>`";
   - h1 "`<from>` → `<to>`";
   - muted "Not recorded. `<plannedKm>` km were planned." (the second sentence only when `plannedKm` is set).
3. **Choice** (`choice === ''`):
   - If `snap.cfg.track.manualAllowed !== false`: an `act pri` button with a route icon.
     - Bold "I travelled it, but it was not recorded".
     - Small "Paid on the planned distance`, <plannedKm> km`. Your approver sees why there is no GPS."
   - Otherwise a `flag warn`:
     - bold "Your company accepts local travel only with a GPS record";
     - text "This journey cannot be added without one. It can be skipped, or the trip recorded again with GPS."
   - Always an `act` button with a close icon.
     - Bold "I did not travel this journey".
     - Small "Nothing is paid for it. The rest of the trip can still be closed and claimed."
4. **Reason card** (once a choice is made):
   - h3 "Why was it not travelled?" (skip) or "Why was GPS not used?" (no-gps), and a "Change" button that resets everything.
   - Select "Reason", placeholder "Choose a reason":
     - no-gps (`NO_GPS`): "Forgot to start the travel", "Phone battery was low", "No network or GPS signal", "The app did not work", "Other";
     - skip (`SKIP`): "The meeting was cancelled", "Someone else went instead", "Travelled a different way", "The plan changed", "Other".
   - Input:
     - label "What happened", placeholder "Needed for Other" when the reason is Other;
     - otherwise label "Anything to add", placeholder "Optional".
   - Info note:
     - skip: "The journey is marked as not travelled and nothing is paid for it."
     - no-gps: "The journey is paid on its planned distance` of <plannedKm> km` rather than a recorded one. Your approver sees this reason on the claim."
   - Error line.
   - Primary wide button "Skip this journey" / "Add it without GPS" ("Saving…"). Enabled when a reason is chosen and, for Other, the note is non-empty.

### API
- **Skip:** `POST /api/te/legs/:id/action {action:'skip', reason}`. `reason` = `"<reason>: <note>"` when there is a note, else `<reason>`. Response `{leg_id, status:'SKIPPED', trip_status}`. Message "Journey `<n>` skipped.".
  - Server refusals:
    - "Only a journey that has not started can be skipped."
    - "The trip is not open for travel." (trip not APPROVED)
    - TE_COMMENT "Say why this journey was not needed."
- **No GPS:** `POST {action:'no-gps', reason, note?: trimmed note}`. Response `{leg_id, status:'ENDED'}`. Message "Journey `<n>` added without GPS. Add its fare next." The leg is then ENDED and manual, and goes on to the Journey report.
  - Server (`te_leg_no_gps`) refusals:
    - "This journey cannot be added now." (not PLANNED)
    - "The trip is waiting for approval." / "The trip is not open for travel." (trip not APPROVED)
    - "This journey is in the future."
    - "Your company accepts journeys only with a GPS record." (manualAllowed false)
    - TE_COMMENT "Say why GPS was not used." / "Tell your approver what happened." (Other with no note)
    - local only: "Older than `<pastDays>` days. It can no longer be added." and "You have added `<n>` journeys without GPS in `<Month>`. The limit is `<pastPerMonth>`."
  - Stored reason: `"<reason>: <note>"`. Log "Added without GPS. Reason: …".

Related trip-level action (in trip detail, Part 4): `POST /api/te/trips/:id/action {action:'record-missed', reason, note?}` for a MISSED trip. Refuses "This trip is not missed.".

---

## Add a journey (components/te/leg/TeLegAdd.tsx)

**Purpose.** Add a journey the plan did not have to a trip under way: a detour, or a cab back. Prototype screen 63.

**Reached from:** trip detail "Add a journey", which opens sheet `{name:'addLeg', detail}`. Props: `snap`, `detail: TeTripDetail`, `onClose`, `onAdded(legId, message)` (TeHome: close the sheet, toast, reload). **Trip detail is not refetched by that reload.** See the stale-detail note in Part 4. RN: refetch the trip.

**State:**
- `from`, `to`: place ids;
- `mode`;
- `vehicleId`;
- `why`;
- `picking: 'from' | 'to' | null`.

**Lists:**
- `modes = cfg.modes.filter(m => m.on && m.scopes.includes(trip.scope))`.
- `known` = the trip's own places (`detail.places` entries -> `{id, s}`).
- `name(id) = detail.places[id]?.s ?? masters.places.find(...)?.s ?? ''`.

**Ready** when:
- `from` and `to` are set and different,
- a mode is chosen,
- `why.trim()` is non-empty,
- and, for mode `own`, a vehicle is chosen.

### Layout (TeSheet wide)
- Title "Add a journey", lead "A journey on this trip that was not in the plan.".
- Footer: "Cancel" and primary "Add the journey" ("Adding…"). The primary is disabled until ready.
1. **Section "Where".** For each side (From = marker A, To = marker B):
   - a row button: small "From" / "To", then the bold place name or placeholder "Choose a place", then a right chevron. It opens **TePlacePicker** full-sheet (Part 3) with target `{kind:'point', index:0, title: 'Where the journey starts' | 'Where the journey goes'}`. `onChosen(id)` sets the side; `onCancel` returns.
   - under it, chips of the trip's known places (pin icon, bold short name). Tapping sets that side. `aria-pressed` marks the chosen one.
   - If from === to: `.ferr` "A journey has to go from one place to a different one."
2. **Section "How".** Mode chips (`mchip`, pressed state).
   - Icon by mode id: train -> train; public or bus -> bus; flight -> plane; else car.
   - Choosing `own` preselects `vehicleId || snap.vehicles[0]?.id`. Other modes clear it.
   - For `own`, vehicle chips follow: bike icon when `v.type === 'bike'` else car, and the mono reg number.
3. **Section "Why it was not planned".**
   - Input "Reason", placeholder "The train was cancelled, a second site was added".
   - Hint "Your approver sees this: the trip they approved has changed."
4. Error line.

### API

```
POST /api/te/trips/:tripId/legs  { from, to, mode, vehicleId: id|null, why }
```

Response `{ leg_id, leg_no }`. Message "Journey `<leg_no>` added. Start it when you set off."

Server:
- engine `planExtraLeg` refusals:
  - "Trip not found."
  - "Choose where the journey starts and ends."
  - "Start and end are the same place."
  - "Choose a way of travel allowed on this trip."
  - "Choose your vehicle."
  - local: "That is beyond the local travel range of `<localMaxKm>` km." (map km from the trip's start place to `to` > `localMaxKm`)
- `te_leg_add` adds "Journeys can be added only during the trip."

The engine computes:
- `gps_mode` (track or checkin per scope and mode) and `planned_km`;
- the insert position: after the last non-PLANNED journey;
- if the next planned journey does not start from the new `to`, it re-plans that journey's km and gps mode from `to`.

---

## Live journey bar (components/te/leg/TeLiveBar.tsx)

**Purpose.** A pointer back to the recorder from every other view while one of my journeys is ACTIVE or PAUSED (TeHome renders it above the page content, except on the leg view). It starts no watcher and sends nothing. Prototype screen e3.

Props: `leg`, `tripName` (`snap.trips.find(t.id === leg.tripId)?.name`), `placeName`, `onOpen(leg)` (-> V:leg).

Layout: a whole-row button (role button; Enter or Space activates). Contents:
- a pulsing live dot (`dotlive`);
- bold state:

| condition | text |
|---|---|
| leg PAUSED | At a stop |
| gps checkin, mode `flight` | In flight |
| gps checkin, other mode | On the way |
| otherwise | Travelling now |

- small " `<tripName>` · journey `<n>`: `<from>` → `<to>`";
- at the right, small "Open" (checkin) or "Not recording here" (track), with a go arrow.

RN: with background location (Part 8) the recorder keeps running when its screen is closed. Then the right-hand text should read "Recording" rather than "Not recording here". Decide deliberately; this is a known web limitation, not a business rule.

---

## Start a local trip (components/te/start/TeStartNow.tsx)

**Purpose.** "Leaving now." One form that creates a local trip from where the phone is and starts its first journey. Prototype screens 30–33.

**Reached from:** step 2 of the Local trip sheet, way "Start now" (sheet `{name:'startNow'}`). Props: `snap`, `onClose`, `onStarted(tripId, legId, message)`.

**Draft.** It uses `lib/te/trip-draft.ts` (documented in Part 3):
- `newPlannerDraft({scope:'local', origin:'PRE_APPROVED', lastWorkday: snap.today}, ctx)`.
- `ctx` (`DraftContext`):
  - `today`;
  - `officePlace` = the first `masters.places` with `pt === 'corp'`;
  - `vehicles` = `snap.vehicles` filtered `verified || whose === 'self'`;
  - `modes` = `cfg.modes`;
  - `placeName`.
- Every edit runs `syncDraft(next, ctx)`.
- `setPattern(d, 'oneway' | 'round', ctx)`.
- `toTripDraft(draft)` gives the API payload.
- `PURPOSES` is the purpose option list.

### On open: read the location
`navigator.geolocation.getCurrentPosition(…, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })`.

On success:

```
POST /api/te/places { src:'gps', lat, lng, acc }
```

- Response `{ place_id, matched? }`.
- The server (`placeAdd`) returns one of my own places within **150 m**, if there is one (`matched: true`). Otherwise it reverse-geocodes and saves a new place named after the geocode or "GPS point", address "… (lat, lng)".
- It refuses "This place has no position on the map." for an empty fix.
- Start point = that place. The `whereFrom` line reads "GPS ±`<accuracy>` m · your location now".

Failures set the `whereFrom` text:
- no geolocation: "This device cannot read its location. Choose where you are starting from."
- denied or failed: "Could not read your location. Choose where you are starting from."
- placeAdd failed: the server message.

`locating` shows "Reading your location…" as the start placeholder until this finishes.

### Live preview
`POST /api/te/trips/preview` with `toTripDraft(draft)`, debounced **350 ms** on every change. Errors set the preview to null.
- `issues` = `preview.issues`.
- Field error `err(k)` = the first blocking issue with `i.k === k`. It is shown only after a failed Start (`tried`).
- Keys used: `name`, `p0`, `p1`, `purpose`, `m0`.

### Layout (TeSheet wide)
- Title "Start a local trip", lead "Your phone records each journey from now until you are back.".
- Crumb: pill "Step 3 of 3" then "Local trip › Start now".
- **Footer bar** (`tw-bar`):
  - when the preview has legs: bold "`<n>` leg(s)" (the word here is "leg", from `plural(legs.length,'leg')`; **RN should say "journey"**), then " · `<sum of leg.km rounded 0.1>` km", then " · **`<rs(estimateTotal)>`** est." when there is an estimate;
  - otherwise muted "Choose where you are going".
  - Buttons "Cancel" and primary "Start and go" with a play icon ("Starting…").
1. **Trip name** (`namefirst`):
   - input "Trip name", maxLength 60, placeholder "Like Udyog Vihar client meeting". Typing sets `nameTouched` to whether it is non-empty.
   - helper: "Your own name for the trip." when touched, else "Leave it empty and it is named from the place and the reason.".
   - error `err('name')`.
2. **Where** (h4), with a segmented control (aria "Way back"):
   - "One way" (go icon) -> `setPattern('oneway')`, pressed when there is no return point;
   - "Round trip" (swap icon) -> `setPattern('round')`.

   Then one row per `draft.points`, each with a marker (A for the start and the return, B for the destination):
   - **start** (i = 0): small "Start", bold place short name or placeholder ("Reading your location…" while locating, else "Choose where you start"), and `whereFrom` with a target icon;
   - **destination**: "Destination", placeholder "Choose where you go";
   - **return** (`p.ret`): "Back to", sub "Same as the start". Not tappable.
   - Tapping a non-return row opens TePlacePicker with `{kind:'point', index:i, title:'Where you are starting from' | 'Where you are going'}`. `onChosen(placeId, pt)` sets `points[i].place` (and `pt`).
   - Errors `err('p0')`, `err('p1')`.
3. **Why** (h4): option buttons from `PURPOSES` (pressed = `draft.purpose`). Error `err('purpose')`.
4. **How** (h4): mode chips from `cfg.modes.filter(m => m.on && m.scopes.includes('local'))`.
   - Icon: train -> train; public or bus -> bus; else car.
   - Choosing sets **every** segment's mode to it (one mode for the whole trip). `own` presets `vehicleId` to the segment's existing one or `snap.vehicles[0]?.id`.
   - There is no vehicle picker on this screen. With several vehicles the first is used. RN parity: same, or add a picker as in TeLegAdd.
   - Error `err('m0')`.
5. Error line.
6. Info note: "Keep the next screen open while you travel. A phone browser stops reading location when the screen locks or you switch apps."

### Start and go
1. With no preview yet: error "Checking the trip…". Stop.
2. With blocking issues: `tried = true` (reveals the per-field errors). Error = the single issue text, or "`<n>` things to fill. They are marked in red.". Stop.
3. `POST /api/te/trips` (`toTripDraft`) -> `{trip_id, trip_no, status, warnings}`. Engine/SQL refusal: the first blocking issue text (`TE_TRIP`, with `field` and `issues`).
4. `GET /api/te/trips/:trip_id`, and take the journey with the lowest `n`. If there is none: `onStarted(tripId, '', "<trip_no> created, but it has no journeys to start.")`.
5. `currentFix()`: a fresh `getCurrentPosition` with the same options and the same error texts as the recorder.
6. `POST /api/te/legs/:firstId/action {action:'start', fix}`. All of TeLegLive's Start refusals apply. Notably, if the plan needed approval (local trip over `preApproveKm`), the trip is PENDING_APPROVAL and the start fails with "The trip is waiting for approval.". The trip still exists, and the error stays on the sheet.
7. `onStarted(tripId, legId, "<trip_no> started. Keep the journey screen open while you travel.")`. TeHome lands on V:trip, because the new leg is not yet in the held snapshot (see Part 0 callbacks).

---

## Known defects and deliberate departures (journeys)
1. **Stale `leg` in the leg view.** After start, stop or continue, the screen does not change state (above). RN: resolve the leg by id from fresh data.
2. **Stale trip detail after Add a journey** and other sheet actions. TeTripDetail keeps its own fetched `detail`, and TeHome's reload does not refetch it. RN: refetch on focus, or after any child action.
3. **TeLegMissed is unreachable for PLANNED legs** (above).
4. **"Time on the road"** shows seconds labelled "min". Divide by 60.
5. **The web records nothing in the background.** RN must (Part 8).
6. **`is_mock` and `device` are never sent.** RN should send `is_mock` (Android `mocked`) and `device` (`{os, model, appVersion}`) on start; both columns exist.
7. **No backoff on ping failures.** RN: flush on an interval with exponential backoff while offline, keep the persisted queue, and flush before End.
8. The Start-now footer says "leg". The UI rule is "journey".

---

# Part 5 — Expenses, claims, advances, vehicles, files

Covers: `components/te/TeExpenseForm.tsx`, `components/te/TeOtherExpenses.tsx` (two views), `components/te/TeClaims.tsx` (list + detail), `components/te/TeFileLink.tsx`, `components/te/claim/TeAdvances.tsx`, `components/te/vehicle/TeLimitsAndRates.tsx`, `components/te/vehicle/TeVehicleAdd.tsx`, `lib/te/vehicle.ts`, plus the server behaviour behind their API calls.

Conventions used below: "chip t-warn" = class names in te.css; `rs()`, `day()`, `when()`, `plural()`, `errorText()`, `flagClass()`, `claimChip()`, `claimHolder()` are from `lib/te/format.ts` (summarised in "Shared helpers used by this part" at the end). All JSON calls go through `te.*` in `lib/te/client.ts` (`/api/te/<path>`, Bearer ESS token, `cache: 'no-store'`); errors arrive as `TeApiError`. The single exception is `te.upload` (multipart; see "Bill / RC upload").

---

## Wiring summary (from components/te/TeHome.tsx)

| View / sheet | Rendered as | Props passed by TeHome | What the callbacks do in TeHome |
|---|---|---|---|
| sheet `{name:'expense', line?, tripId?}` | `<TeExpenseForm key={sheet.line?.id ?? 'new'} snap line tripId onClose onSaved>` | opened from: Home kind tile "other" (`{name:'expense'}`), Other expenses "Add an expense" / row click, trip claim "Add an expense" / row click (`tripId` = trip id), trip detail "add bill" (`onAddBill(tripId)`), claim detail "Fix this line" (`{line, tripId}`) | `onClose` -> `setSheet(null)`. `onSaved(message)` -> `done(message)` (close sheet, toast message, `reload()`), then **always** `setView({name:'expenses'})` — even when the bill was on a trip or was a send-back fix (quirk: the user lands on Other expenses, not back on the trip claim / claim detail). |
| view `'expenses'` | `<TeOtherExpenses snap onAdd onEdit onSubmitted onOpenTrip>` (no `trip`) | rail item "Other expenses" | `onAdd` -> sheet `{name:'expense'}`; `onEdit(line)` -> sheet `{name:'expense', line}`; `onSubmitted(id,msg)` -> toast msg, `reload()`, view `{name:'claim', id}`; `onOpenTrip(tripId)` -> opens the trip view |
| view `'tripClaim'` (`{name:'tripClaim', trip}`) | `<TeOtherExpenses snap trip onBack onAdd onEdit onSubmitted>` | trip detail `onClaim(detail)` -> `{name:'tripClaim', trip: detail.trip}` | `onBack` -> view `{name:'trip', id: trip.id}`; `onAdd` -> sheet `{name:'expense', tripId}`; `onEdit(line)` -> sheet `{name:'expense', line, tripId}`; `onSubmitted` as above. No `onOpenTrip`. |
| view `'claims'` | `<TeClaimList snap onOpen>` | rail "My claims" / bottom tab "Claims" | `onOpen(id)` -> view `{name:'claim', id}` |
| view `'claim'` (`{name:'claim', id}`) | `<TeClaimDetail claimId catName onBack onChanged onFixLine>` | from list, home "needs you" rows, after submit, deep link `?tab=claims&ref=<uuid>` | `catName` = `new Map(snap.cfg.cats.map(c=>[c.id,c.name]))`; `onBack` -> view `'claims'`; `onChanged(msg)` -> toast msg + `reload()`; `onFixLine(line, tripId)` -> sheet `{name:'expense', line, tripId}` |
| view `'advances'` | `<TeAdvances snap onOpenTrip>` | rail "Advances" | `onOpenTrip(id)` -> view `{name:'trip', id}` |
| view `'limits'` | `<TeLimitsAndRates snap onChanged>` | rail "My limits and rates" | `onChanged(msg)` -> toast msg + `reload()` |

Toasts: TeHome shows one toast string in `.toasts > .toast` (aria-live polite) and clears it after 4000 ms.

---

## Add / change an expense (components/te/TeExpenseForm.tsx)

### 1. Purpose and entry
A single bill line: either a "loose" monthly bill (no trip, saved under Other expenses) or a bill on a trip (hotel, meals, tickets...). Every change is checked live on the server; the form computes nothing about eligibility itself.

Props: `snap: Snapshot`, `line?: TeExpense` (edit an existing saved line; omitted = new), `tripId?: Uuid` (the trip this bill belongs to), `onClose()`, `onSaved(message: string)`.

Rendered inside `TeSheet` with:
- `title`: `line ? 'Change this expense' : 'Add an expense'`
- `crumb`: `tripName ? \`${tripName} › Add a bill\` : 'Other expense › Add a bill'` (same crumb text when editing)
- `lead`: with trip: `` `Saved against ${tripName} and claimed with that trip, not with your monthly expenses.` ``; without: `'No travel. It is saved under Other expenses until you submit your claim.'`
- `tripName` = `snap.trips.find(t => t.id === tripId)?.name ?? 'This trip'` when `tripId` is set, else `''`.
- `footer` (left to right): `Remove` (`btn dan`, only when `line` is set; disabled while any busy), `Cancel` (`btn`, calls `onClose`), `Save expense` / `Saving…` (`btn pri`; disabled when `!ready || busy`).

### 2. Layout, in order

**Section "What did you spend on?"** (`.sec > h4`) — a row of option buttons (`.opts > button.opt`, `aria-pressed` = selected). One button per category, label = `c.name`. **Disabled when editing** (`line` set): category cannot change on an existing line.

Category list = `snap.cfg.cats.filter(c => c.on && c.id !== 'mileage' && (tripId ? true : !c.needsTrip))`, in snapshot order (te_categories `sort_order`). Seeded categories (migration 162 seed, identical to engine `CATS`):

| id | name | needsTrip | proof | group | Offered off-trip | Offered on a trip |
|---|---|---|---|---|---|---|
| air | Air travel | true | always | Travel | no | yes |
| train | Train | true | always | Travel | no | yes |
| bus | Bus ticket | true | always | Travel | no | yes |
| hotel | Hotel stay | true | always | Stay | no | yes |
| meals | Meals | true | above | Food | no | yes |
| cab | Cab or taxi | false | above | Local travel | yes | yes |
| local | Local conveyance, no bill | false | none | Local travel | yes | yes |
| mileage | Own vehicle | false | none | Local travel | **never** (comes from a leg's GPS distance) | **never** |
| toll | Toll and parking | false | above | Local travel | yes | yes |
| client | Client entertainment | false | always | Other | yes | yes |
| comm | Courier and communication | false | above | Other | yes | yes |
| misc | Miscellaneous | false | above | Other | yes | yes |

`proof`: `always` = a bill file is required; `above` = required when bill amount > `cfg.receiptAbove` (default 200); `none` = never. `group` is not used by this form (no grouping in the UI). An admin can rename / switch off categories (`on`).

**Section "Bill"** — a `label.drop` wrapping a hidden file input:
- Bold text: `fileName || 'Attach the bill'` (`fileName` starts as `line?.file?.name ?? ''`).
- Small muted text: `'Uploading…'` while uploading; else if a new file was uploaded in this session: `` `Stored. Fingerprint ${file.sha256.slice(0, 10)}` ``; else `'A photo or a PDF, up to 10 MB.'` (also shown for an edited line that already has a bill).
- Button-looking span (`btn sm`): `fileName ? 'Replace' : 'Choose file'`.
- `<input type="file" className="vh" accept="image/*,.pdf">` — **single file** (no `multiple`), **no `capture` attribute**, no thumbnail/preview, no client-side size check, no compression/resizing (no canvas), no HEIC conversion (`heic2any` is in package.json but used only by `components/profile/PhotoUploader.tsx`, not T&E). HEIC is accepted as-is by the server. The input's value is never reset, so re-choosing the same file does not fire `onChange` (web quirk). There is no "open the existing bill" link in this form.

**Section "Details"** (`.form` grid of `label.fld` = `<span>label</span><input>`):

| Order | Label | Control | Shown when | Bound to | Notes |
|---|---|---|---|---|---|
| 1 | "Date" | `type=date`, `max={snap.today}` | always | `f.date` | default `snap.today` |
| 2 | "Merchant" | text | always | `f.merchant` | |
| 3 | "Bill or invoice number" | text | always | `f.billNo` | |
| 4 | "Amount on the bill (₹)" | `type=number min=0 inputMode=decimal` | always | `f.bill` (string while typing) | |
| 5 | "Amount you claim (₹)" | `type=number min=0 inputMode=decimal`, placeholder `"Same as the bill"` | always | `f.claimed` | empty = server uses the bill amount |
| 6 | "Merchant GSTIN" | text, `maxLength=15`, `autoCapitalize=characters`, value upper-cased on change | always | `f.gstin` | helper `<small>`: "Optional. Checked for format and state." |
| 7 | "Client company" | text | `f.cat === 'client'` | `f.client` | |
| 8 | "Number of people" | `type=number min=1` | `f.cat === 'client'` | `f.attendees` | |
| 9 | "Check in" | date | `f.cat === 'hotel'` | `f.checkIn` | |
| 10 | "Check out" | date, `min={f.checkIn}` | `f.cat === 'hotel'` | `f.checkOut` | helper: `nights > 0 ? \`${plural(nights,'night')}. The limit is per night.\` : 'The limit is counted per night.'` |
| 11 | checkbox (`label.check small`) "A shared room. More than one of you stayed in it, so the limit covers all of you rather than one person." | checkbox | `f.cat === 'hotel'` | `f.shared` | |
| 12 | "PNR" | text, `autoCapitalize=characters`, upper-cased on change | `f.cat === 'air' \|\| 'train'` | `f.pnr` | |
| 13 | "Class" | select: `""` = "Not stated", then air: `Economy`, `Premium Economy`, `Business`; train: `SL`, `3A`, `2A`, `1A` | `f.cat === 'air' \|\| 'train'` | `f.cls` | helper: "Checked against what your grade allows." Ladders are the engine's `AIR` / `RAIL` order (entitlement order). |
| 14 | "Paid by" | select: `UPI`, `Personal card`, `Cash` | always | `f.payMode` | default `'UPI'` |
| 15 | "Note" | text, `.fld.full` | always | `f.desc` | required (A1) for `local` and `misc` |

Not present in this form (do NOT add for parity): foreign currency (`curr`/`fxAmt`/`fxRate` — only the leg report has those), own-vehicle mileage fields (`vehicleId`/`from`/`to`/`km`), `ref` (cab trip ID / FASTag), meal attendees.

**Section "Reason"** — shown when `askReason = !!shown && (shown.needsReason || shown.flags.length > 0 || !!f.reason)` (i.e. as soon as the preview has any flag at all, or a reason was already typed):
- `label.fld`: "Explain this line to your approver" + `<textarea>` bound to `f.reason`.
- Checkbox, only when `canAskException = shown.flags.some(x => x.action === 'cap')`: "Ask for an exception instead of accepting the cap. The workflow adds Head of department as an approver." bound to `f.wantException`. (Engine: an over-limit policy flag with `wantException` and a non-empty reason becomes a `justify` flag with `exception: true` and no capping; the claim's `exception` sets the HOD level in the default workflow.)

**Section "Check"**:
- If `!ready`: `p.small.muted` "Choose what you spent on, the date and the amount. The checks run as you type."
- If a preview is shown (`shown = ready ? preview : null`):
  - Row: left "Eligible for reimbursement" (small muted) over `rs(shown.eligible)` (`.num b`); right a chip:
    | condition | chip class | text |
    |---|---|---|
    | `shown.blocked` | `chip t-crit` | "Cannot be saved yet" |
    | else `shown.flags.length` | `chip t-warn` | "Saved with notes" |
    | else | `chip t-pos` | "No issues" |
  - One block per flag (`key = code+title`), class `flagClass(x)` (`flag crit` if `x.block`, else `flag warn`), icon `warn`, `<b><span class="code">{code}</span> {title}</b>`, `<p>{evidence}</p>`.
- Ready but preview not yet arrived (or preview call failed): nothing is shown in this section (no spinner, no text).
- Error (save/upload/discard failure): `div.flag.crit[role=alert]` with icon `warn` and `<b>{error.text}</b>` at the bottom of this section. `error.field` (from `TeApiError.field`) is stored but **not** used to highlight a field.

### 3. Local state

| name | type | default |
|---|---|---|
| `f` | `ExpenseInput` | edit: `fromLine(line)`; new: `{ cat:'', date: snap.today, bill:'', claimed:'', payMode:'UPI', ...(tripId ? {tripId} : {}) }` |
| `file` | `TeUploadedFile \| null` | null (only set by an upload in this session) |
| `fileName` | string | `line?.file?.name ?? ''` |
| `preview` | `ExpensePreview \| null` | null |
| `busy` | `'' \| 'upload' \| 'save' \| 'delete'` | `''` |
| `error` | `{ text, field } \| null` | null |

`fromLine(x: TeExpense): ExpenseInput` copies: `id, tripId, cat, date, merchant, billNo, gstin, bill, claimed, payMode (|| 'UPI'), desc, reason, wantException, client, attendees (?? undefined), checkIn (?? undefined), checkOut (?? undefined), pnr, cls, shared`. (Every settable field must round-trip, otherwise A1 fires on reopen.)

Every field change goes through `set(k, v)` which also clears `error`.

`input` (what is sent) = `file ? { ...f, files: [file] } : f`. `files` is sent ONLY when a new bill was uploaded; omitting it keeps the bill the saved line already has (adapter: `if (input.files !== undefined) x.file = ...`).

`ready = !!f.cat && !!f.date && Number(f.bill) > 0`.

`nights` (client, for the hint only) = `Math.round((Date(checkOut) - Date(checkIn)) / 86_400_000)`, floored at 0 if not > 0; 0 when either date is empty.

### 4. Actions and API calls

**Live preview** — `POST /api/te/expenses/preview`, body = `input` (`ExpenseInput`: `id?, tripId?, cat, date, merchant?, gstin?, billNo?, pnr?, cls?, bill, claimed, payMode, desc?, reason?, wantException?, client?, attendees?, checkIn?, checkOut?, shared?, files?`). Fires 350 ms after the last change of `input`, and only while `ready`. Each new change cancels the pending timer; an answer to an older request is dropped (`current` flag). On success `preview = response`; on failure `preview = null` (no error shown). When editing a saved line `ready` is usually true on mount, so a preview fires 350 ms after opening. Response `ExpensePreview` fields read: `flags[] (code, title, evidence, block, action)`, `eligible`, `blocked`, `needsReason`. (`claimed`, `mileage` unused here.)

**Attach** (input onChange with the first picked File) — `te.upload(file, 'BILL')`, see "Bill / RC upload". busy `'upload'`. On success: `file = stored`, `fileName = stored.file_name`; if `stored.ocr?.amount` and the bill field is empty/0, sets `bill = ocr.amount` (OCR never overwrites typing; no OCR provider is configured today so this never fires). On failure: `error = { text: errorText(e), field: null }`.

**Save expense** — `POST /api/te/expenses`, body = `input` (with `id` when editing). Response `{ expense_id, expense_no, status, eligible, flags }`. Success: `onSaved(\`Saved ${r.expense_no}. ${rs(r.eligible)} is eligible.\`)`. Failure: if `TeApiError` with `flags.length`, the Check section is replaced by those flags with `blocked: true` (keeps previous eligible or 0); `error = { text: errorText(e), field: e.field }`. The Save button is NOT disabled by a blocked preview — the server refuses.

**Remove** (edit only) — `DELETE /api/te/expenses/{line.id}`. Response `{ expense_id, status: 'DISCARDED' }`. Success: `onSaved(\`Removed ${line.no}.\`)`. Failure: error block. (Row is kept as DISCARDED server-side for audit/duplicate checks.)

**Cancel** — `onClose()`; nothing saved.

### 5. Validation / refusals

Client side: only the `ready` gate (category, date, bill > 0) for preview and Save; date `max=today`; check-out `min=checkIn`.

Server, `expenseSave` (te-service.js): when the engine says blocked -> 409 `TE_EXPENSE` "Fix the blocked items first." with `flags` (claimant wording: where a flag carries `evEmp`, it replaces `evidence`).

SQL `te_expense_save` (migration 161):
- "You can only add your own expenses." (403 TE_FORBIDDEN)
- "Your access to Travel and Expenses ended on your last working day." (TE_EMPLOYEE_EXITED)
- "Expense not found."
- "This was booked and paid by the company. It cannot be changed here."
- "This line is in a claim and cannot be changed now." (editing is allowed only when the line is UNCLAIMED, or its claim is SENT_BACK and the line is marked `needs_fix` or the claim `fix_all`)
- "That trip is not yours and you are not on it."
- "This trip was cancelled or rejected. Nothing can be added to it."
- "`<Category name>` belongs to a trip. Add it inside the trip."
- On edit, the line's trip never changes (server keeps `prev.trip_id`).

SQL `te_expense_discard` (migration 162): "Expense not found." / "Only a saved line that is not in a claim can be removed." / "This line is the report of a journey. Change the fare in the journey instead." (The Remove button is shown on any edited line, including a send-back fix line; the server then refuses.)

Route validation: `DELETE` id -> "Expense is missing or is not a valid id."

### 6. Line checks an employee can see (engine `lineFlags`, `mileage`, `policy`, `setFlags`)

Each flag: `{ code, title, evidence, action, sev, block, needsReason }`. `action` from the check config (admin-configurable per check): `block` (cannot save/submit), `warn`, `justify` (needs a reason -> `needsReason` true until `reason` is non-empty), `cap` (eligible reduced). A check switched off (`on:false`) never fires. Exact titles/evidence as raised:

| Code | Default action | Title shown (exact) | Evidence (pattern) |
|---|---|---|---|
| A1 | block | "Missing: " + list joined by ", " — items: `date`, `amount`, `merchant` (proof ≠ none), `PNR` (air/train), `check-in and check-out` (hotel), `client and attendees` (client), `description` (local, misc), `bill (always needed for this category)` / `bill (needed above ₹<receiptAbove>)`, `a trip (this category needs an outstation trip)`, `the amount you claim, more than ₹0`, mileage: `vehicle`, `from, to and distance`, `a GPS record (typing the distance is switched off by your company)` | "Add these before you continue." |
| A2 | block | "Bill date is in the future" / "Bill is older than N days" (N = `cfg.billAgeDays`, default 90) | "<date> is after today." / "Dated <date>, <n> days ago." |
| A3 | warn | "Airline PNR should be 6 letters or digits" / "Rail PNR should be 10 digits" | "Typed: <pnr>" |
| A4 | warn | "GSTIN format or checksum is wrong" | "Typed: <gstin>" |
| A5 | justify | "Typed amount differs from the bill" (only with OCR) | "Bill reads ₹x, typed ₹y." |
| A6 | block | "Claimed amount is more than the bill" | "Claimed ₹x against a bill of ₹y." |
| B1 | block | "This exact file was uploaded before" | names the earlier line; for a colleague's line the claimant sees "This bill has already been claimed by someone else." |
| B2 | warn | "Looks like a re-photographed copy of an earlier bill" | claimant variant "This looks like a copy of a bill already claimed." |
| B3 | block | "Same merchant and invoice number already claimed" | claimant variant "Invoice <no> has already been claimed by someone else." |
| B4 | warn | "Possible duplicate of your own line" | "Same date, amount and category as <merchant> on <ref>." |
| B5 | warn | "Another employee claimed the same merchant, date and amount" | claimant sees "Another employee claimed the same merchant, date and amount." |
| B6 | block | "This reference was claimed before" | "<ref> has already been claimed by someone else." (colleague) |
| B7 | block | "This ticket was booked and paid by the company" | "PNR … is Travel Desk booking … on trip … for ₹…." |
| C1 | justify | "You were on approved leave on this date" | |
| C2 | warn | "Attendance shows an office punch on this outstation day" | |
| C3 | warn | "Date is outside the trip" | "Trip runs <a> to <b>. This line is dated <d>." (±1 day tolerance) |
| C4 | warn | "Dated on a holiday" / "Dated on a weekly off" (no-trip lines only; Sat/Sun) | |
| C5 | warn | "Merchant is registered in another state" (hotel/meals/client on a domestic/local trip, GSTIN state vs trip states) | |
| C6 | block | "Check-out must be after check-in" / "Hotel nights exceed trip nights" / "Overlaps another hotel stay" | |
| C11 | block | "A local trip has no flight" | "Plan it as a domestic trip to claim this." |
| D1 | cap | "Distance is above the map distance" (mileage typed km) | |
| D2 | warn | "Several bills from one merchant on one day" (set-level) | |
| D4 | warn | "Repeated round amounts without bills" (≥3 no-file lines, multiples of ₹100) | |
| D8 | warn | "Cash payment above ₹10,000 to one merchant" (payMode `Cash`, bill > 10000) | "Finance will check how this was paid." |
| D9 | warn | "Restricted items found on the bill" (OCR text) | |
| E1 | warn | "Image was saved from editing software" (server file metadata) | "File metadata names <software>." |
| E2 | warn | "PDF came from a bill-generator tool" | "PDF producer field: <producer>." |
| G3/G7/G9/G10/G12/G13 | (mileage / journey lines only — see part B) | | |
| POL | per `cfg.breach[key]`: default `cap` for hotel, meals, conv, misc, comm, nobill; `justify` for client and cls | "Over the hotel limit", "Over the daily food limit" (or "Over the food pool" when `basis.meals = 'pooled'`), "Over the daily local conveyance limit", "Over the no-bill limit", "Over the per-head limit", "Over the miscellaneous cap", "Over the courier and communication cap", "Travel class above entitlement" | cap: "₹x over <limitTxt>. Capped to the limit."; justify: "₹x over <limitTxt>. A reason is needed and HOD approval is added."; exception requested: "Exception requested for ₹x over the limit. Reason: …" |

Policy limits (engine `policy`): hotel limit = `limits[grade][tier].hotel × max(1, nights) × (shared ? pax : 1)` with `pax = 1 + trip.co.length`; meals and conveyance (cab + local) per day per city tier (local trips: meals capped at `cfg.track.localMealCap`, default 300); no-bill `local` lines ≤ `cfg.noBillPerDay`/day; client ≤ `clientPerHead × max(1, attendees)`; misc ≤ `miscPerClaim` and comm ≤ `commPerClaim` per claim; class above `cfg.airClass[grade]` / `cfg.trainClass[grade]`. Shown to the user only through the flags and `eligible`.

---

## Bill / RC upload (POST /api/te/upload) — used by TeExpenseForm and TeVehicleAdd

Client: `te.upload(file: File, kind = 'BILL')` builds `FormData` with fields `file` (the File) and `kind` (`'BILL' | 'TICKET' | 'TOLL_SLIP' | 'FASTAG_STATEMENT' | 'OTHER' | 'RC'`), `POST /api/te/upload` with `uploadAuthHeaders()` (the Bearer header, **no Content-Type** so the multipart boundary is set by the platform), `cache: 'no-store'`. Response `{ file: TeUploadedFile }`; returns `file`. Errors -> `TeApiError`.

Server rules (app/api/te/upload/route.ts):
- Bucket `onboarding-docs` (private). Path `te/bills/<employee id>/<KIND>_<Date.now()>_<safeName>`; `safeName` = original name with `[^\w.\-]+` -> `_`, last 80 chars, default `bill`.
- Max 10 MB (`10 * 1024 * 1024`). Body that cannot be parsed -> 413 `FILE_TOO_LARGE` "That file could not be read, or is too large. Keep it under 10 MB: a photo of the bill is enough." Over limit -> 413 `FILE_TOO_LARGE` "That file is X.X MB. The limit is 10 MB: a photo of the bill is enough." (X.X = size/1048576 to 1 decimal).
- No `file` field -> 400 "Attach the file in a form field named \"file\"." Empty -> 400 "That file is empty." Bad kind -> "kind must be one of: BILL, TICKET, TOLL_SLIP, FASTAG_STATEMENT, OTHER, RC."
- Type is **sniffed from the bytes**, never from the name/MIME: `%PDF-` -> pdf; `FF D8 FF` -> jpeg; PNG signature; `RIFF....WEBP` -> webp; `....ftyp` + brand matching `/hei[cfx]|mif1|msf1|hevc/` -> heic. Anything else -> 400 `FILE_TYPE` "Attach a photo (JPEG, PNG, WebP, HEIC) or a PDF." Allowed: image/jpeg, image/png, image/webp, image/heic, image/heif, application/pdf.
- Storage failure -> 502 `UPLOAD_FAILED` "The file could not be stored. Try again."
- Response `TeUploadedFile`: `kind` (RC is stored/returned as `'OTHER'`), `storage_path`, `file_name` (original name), `mime_type` (sniffed), `file_size`, `sha256` (server-computed, used for B1), `phash` (null; OCR only), `ocr` (null today — no OCR provider configured), `metadata` (`{software, producer}` heuristic for E1/E2; null for RC).
- Upload does NOT attach the file to anything. The client must send the returned object back unchanged in `files: [file]` of `POST /api/te/expenses` (or a leg report), or pass `storage_path` as `rc_file_url` to `POST /api/te/vehicles`.

RN note: send a multipart form with a `{ uri, name, type }` file part named `file`; do not set Content-Type manually. Picking from camera or library is fine (the web `accept="image/*,.pdf"` lets mobile browsers offer the camera); HEIC need not be converted; enforce nothing client-side beyond what the web does (server is authoritative), though a client 10 MB pre-check is harmless.

---

## Opening a stored file (components/te/TeFileLink.tsx)

Purpose: a button that opens a bill or RC photo stored in the private bucket. Props: `path` (te_expense_files.storage_path or a vehicle's rc_file_url), `name?` (button text), `claimId?` (needed when the file is not the caller's own), `kind?`, `small?` (`btn sm` vs `btn`).

Rendering:
- `!path` -> renders nothing (Travel Desk booked lines carry a stand-in file with no path).
- `path` matches `/^https?:\/\//i` -> plain external link `<a class="btn[ sm]" href=path target=_blank rel="noopener noreferrer">` with icon `go` and text `name || 'Open the booking page'` (a requested stay's booking URL). Not signed.
- Otherwise a button (icon `file`): text `'Opening…'` while busy, else `name || (kind === 'RC' ? 'Open the RC photo' : 'Open the bill')`. Below it, on error, `p.small.muted` with the error text.

Action: on click, synchronously `window.open('', '_blank', 'noopener,noreferrer')` (to avoid the popup blocker), then `GET /api/te/upload?path=<path>[&claim_id=<claimId>]` -> `{ url, expires_in: 3600 }`; sets `tab.location.href = url`. If `tab` is null -> error "Your browser blocked the new tab. Allow pop-ups for this site to open the file." On API failure closes the tab and shows `errorText(e)`. (Web caveat: with the `noopener` feature `window.open` returns null in standards-compliant browsers, so this branch can trigger even when a tab opened. RN: just fetch the URL then `Linking.openURL(url)` / `expo-web-browser`.)

Server refusals (GET): `path` missing -> "path is required."; not under `te/bills/` or contains `..` -> 400 "That is not a Travel and Expenses file."; someone else's file without a valid `claim_id` -> 403 "You can only open your own files."; claim not openable -> "You cannot open this claim."; file not a bill of that claim -> 403 "That file is not part of this claim."; signing failed -> 404 "That file is no longer available." Signed URL lifetime 60 × 60 s.

---

## Other expenses — loose bills and their monthly claim (components/te/TeOtherExpenses.tsx, view 'expenses')

### 1. Purpose
Lists the employee's saved, unclaimed lines that belong to no trip, shows the live claim review (totals, flags, approvers) and submits them as one claim. Props (no `trip`): `snap`, `onAdd()`, `onEdit(line)`, `onSubmitted(claimId, message)`, `onOpenTrip?(tripId)`.

### 2. Layout, in order
- Page header (`.ph`): `h1` "Other expenses"; `p` "Client meals, courier, parking, printing and other work spends with no travel. Saved lines wait here until you submit them together as one claim."; button `btn pri` "Add an expense" -> `onAdd()`.
- Two columns (`.cols`): main `.stack` and `.aside`.

Main column:
1. Card `card pad0` with header row (`.day`): "Not submitted yet" and the count `lines.length`.
   - Empty: `div.empty` with `<b>Nothing waiting</b>` + "Add a bill and it appears here."
   - One row per line (`li click`, role button, Enter key also opens) -> `onEdit(x)`:
     - icon `other`;
     - title (`.b`): `x.merchant || catName(x.cat) || x.cat`;
     - sub (`small muted`): `[catName(x.cat), x.desc, x.billNo].filter(Boolean).join(' · ')`;
     - chips for this line's flags from the claim preview (`review.lines.find(l => l.id === x.id).flags`): `chip t-crit` if `block` else `chip t-warn`, text `` `${code} ${title}` ``;
     - right (`.amt b`): `rs(x.claimed)`.
2. Card "Waiting inside trips" (only when not a trip claim and there are any): header `.day` "Waiting inside trips" + count. One row per trip from `linesWaitingInTrips(snap.expenses, snap.trips)`: icon `route`; `.b` trip name (or "A trip" if the trip is not in the snapshot); sub `` `${plural(count,'bill')} · claimed with that trip, not here` ``; right `rs(total)` plus, when `onOpenTrip` exists, `span.nr-go` "Open" + icon `go`. Row is clickable only when `onOpenTrip` is given -> `onOpenTrip(tripId)`.
3. Note (`.note`, icon `info`): "Travelled within the city? Start a local trip instead. It records the route and works out the amount for you."

Aside, card:
- Header `.ch`: `h3` "This month’s claim"; chip `chip plain t-brand` with the label of the first OPEN period (`snap.periods.filter(p => p.status === 'OPEN')[0].label`), when any.
- When `review` (preview present AND there are lines):
  - `dl.kv`: "You paid" `rs(review.claimed)`; "Eligible under policy" `rs(review.eligible)` only when `eligible !== claimed`; "Advance with you" `rs(-review.outstanding)` only when `outstanding > 0` (always 0 off-trip); total row (`dt.tot`/`dd.tot`) "Expected to be paid" `rs(review.net)`.
  - If `review.chain.length`: `p.small.muted` `` `Goes to ${review.chain.map(c => c.name || c.role).join(', then ')}.` `` (Finance steps are named "Finance team").
  - Stops list: every flag in `[...review.blockers, ...review.needs]` (`key = lineId-code`): `flagClass`, icon `warn`, `<b><span class="code">code</span> title</b>`, `<p>` = `fl.block ? fl.evidence : 'Open the line and add a reason.'`. Then each sentence in `review.stop` as `flag crit` with `<b>`.
  - Declaration checkbox (`label.check small`): "I confirm these expenses are genuine, were incurred for company work and have not been claimed elsewhere." (`declared`, default false; not reset after an error).
  - Button `btn pri lg wide`: `'Sending…'` while busy else "Submit claim"; disabled when `busy || !declared || stops.length > 0 || review.stop.length > 0`.
- When no `review`: `p.small.muted` = `lines.length ? 'Checking your lines…' : 'Saved expenses are added up here.'`.
- Error (`flag crit`, role alert): `<b>{error.text}</b>` followed by one `<p>` per returned flag `` `${code} ${title}` ``.
- Note below the card: `` `Bills older than ${snap.cfg.billAgeDays} days cannot be claimed.` ``

### 3. State and derived values
- `lines = snap.expenses.filter(x => !x.other && x.status === 'UNCLAIMED' && !x.tripId)` (colleagues' lines carry `other: true` and are never shown).
- `catName = Map(cfg.cats id -> name)`.
- `preview: ClaimPreview | null`, `declared: boolean = false`, `busy: boolean`, `error: { text, flags: TeFlag[] } | null`.
- `signature = lines.map(x => \`${x.id}:${x.claimed}:${x.reason}\`).join('|')`.

### 4. Actions / API
- **Claim preview** — `POST /api/te/claims/preview` body `{}` (no trip). Fires on mount and whenever `signature` changes (no debounce); not called when there are no lines. Late answers dropped. On failure: `preview = null` and `error = { text: errorText(e), flags: [] }` (this error is not cleared by a later successful preview — only by Submit). Response `ClaimPreview` fields read: `claimed, eligible, outstanding, net, lines[].{id, flags}, blockers[], needs[], stop[], chain[].{name, role}`. Server picks the lines itself: every UNCLAIMED own line of that trip / with no trip.
  - Caveat: the preview re-runs only when ids/claimed/reason change. Attaching a bill, changing a date, merchant etc. through the form does not change the signature, so the aside can show a stale blocker until the view is re-mounted. An RN port can simply re-run the preview whenever `snap` changes.
- **Submit claim** — `POST /api/te/claims` body `{ declared }` (`declared: true` because the button requires it). Response `{ claim_id, claim_no, status, stage, risk_band, chain_notes }`. Success: `onSubmitted(c.claim_id, \`Claim ${c.claim_no} sent.\`)` (TeHome opens the new claim). Failure: `error = { text, flags: e.flags }`.

### 5. Server refusals (submit)
te-service `claimSubmit`: "One of these lines is not yours, or no longer exists. Refresh and try again."; "Add at least one expense line."; "Fix the blocked lines first." (+flags); "Add a reason where one is asked." (+flags); "Accept the declaration to submit."; first `stop` sentence. SQL `te_claim_submit` (migration 162): "You can only submit your own claims." (403); "Add at least one expense line."; "One of these lines is already in a claim, or does not belong here. Refresh and try again."; "Fix the blocked lines first."; "Add a reason where one is asked."; "Accept the declaration to submit."; "The claim could not be checked. Try again."; "Nobody is set up to verify claims. Ask your admin to add a Finance team member or a fallback approver." (TE_NOT_SET_UP). Plus te_assert_active.

---

## Claim for one trip (components/te/TeOtherExpenses.tsx, view 'tripClaim')

Same component with `trip: TeTrip` and `onBack`. Differences from the Other expenses view:

- Top row (only when `trip && onBack`): `btn sm` with icon `back` + "Trip" -> `onBack()`; `span.mono.muted` `trip.no`.
- `h1`: `` `Claim for ${trip.name}` ``; `p`: "Every bill and every journey of this trip, in one claim. Check what each line is worth, then send it."
- `lines = snap.expenses.filter(x => !x.other && x.status === 'UNCLAIMED' && x.tripId === trip.id)` — includes journey (mileage / fare) lines filed from legs and company-paid lines of the trip.
- Empty text: if `isCoTraveller(trip, snap.me)` (viewer is in `trip.co` and not the owner): "Add what you paid for on this trip and it appears here."; else "Close the trip’s journeys and add any other bills, and they appear here."
- No "Waiting inside trips" card, no local-trip note.
- Aside heading `h3` "This claim".
- "Advance with you" row appears when the trip's advance is PAID / PART_SETTLED / RECOVERY_DUE with outstanding > 0; `net = eligible − outstanding` (can be negative = to be recovered).
- Preview body `{ tripId: trip.id }`; submit body `{ tripId: trip.id, declared }`.
- Extra submit refusals for trips (SQL): "That trip is not yours and you are not on it."; trip not claimable: PENDING_APPROVAL -> "The trip is waiting for approval. Send the claim once it is approved."; SENT_BACK -> "The trip plan was sent back to you. Answer that first."; other -> "This trip was <status lower-case>. Nothing can be claimed on it." (claimable: APPROVED, CLAIMED, CLOSED, or DRAFT + POST_FACTO); open journey of the caller -> "Close every journey first. Journey N is " + "waiting for its report." (ENDED) / "not recorded: add it without GPS or skip it." (PLANNED) / "still running." (ACTIVE/PAUSED). Post-facto trips: blocking trip issues are re-checked and returned in `stop[]`.
- Claim-level flags that need a reason (engine `assess`): `LATE` "Submitted after the claim deadline" (today > trip end + `claimDeadlineDays`, default 15; evidence "The deadline was <d>, N days after the trip. This is M days late.") and `D10` "Claim is above the approved estimate" (pre-approved trips, claimed > self-estimate × (1 + estimateTol%)). Both have `needsReason = !(claimNote).trim()`. **This UI never sends a claim `note`**, so when either fires the flag sits in `needs`, is shown with "Open the line and add a reason." (but there is no line to open), and Submit stays disabled. Open issue for the lead — parity port will reproduce a dead end; a `note` field on `ClaimInput` exists server-side.

---

## My claims — list (components/te/TeClaims.tsx, export TeClaimList, view 'claims')

Props: `snap`, `onOpen(claimId)`.

- Header `.ph`: `h1` "My claims"; `p` "Every claim you sent, for local travel, outstation trips and other expenses. See who holds it, what was approved and why."
- One card `card pad0`, rows in `snap.claims` order (server: newest `created_at` first; claims created in the last 400 days, plus any still open). **No grouping, filters, search or paging.**
- Empty: `div.empty` `<b>No claims yet</b>` + "A claim appears here the moment you submit it."
- Row (`li click`, role button, Enter opens) -> `onOpen(c.id)`:
  - icon `other`;
  - `.b`: trip name (`snap.trips` by `c.tripId`) or "Other expenses", then `span.mono.muted` `c.no`;
  - sub `small muted`: `claimHolder(c)`;
  - right `.amt`: `<b>{rs(c.net ?? c.approved ?? c.claimed)}</b>` and below a chip `chip <tone>` with `claimChip(c).label`.

### Claim status -> chip (lib/te/format.ts `claimChip`)

| status | label | tone class |
|---|---|---|
| IN_APPROVAL | "With manager" | t-warn |
| IN_VERIFICATION | "With Finance" | t-warn |
| ON_HOLD | "On hold with Finance" | t-warn |
| SENT_BACK | "Needs your answer" | t-crit |
| VERIFIED | "Approved, awaiting payout" | t-info |
| SETTLED | "Settled" | t-pos |
| REJECTED | "Rejected" | t-crit |
| CANCELLED | "Taken back" | plain |
| anything else (DRAFT, IN_PAYOUT, PAID) | status with `_` -> space, lower-cased (e.g. "in payout") | plain |

### Holder line (`claimHolder`)

| status | text |
|---|---|
| SETTLED | `` `Settled ${when(c.settledAt)}` `` |
| VERIFIED | `` `Verified ${when(c.verifiedAt)}. Paid in the next payout.` `` |
| SENT_BACK | "Sent back to you" |
| REJECTED, CANCELLED | "" |
| otherwise | first step with `status === 'pending'` across `[...c.chain, ...c.fin]`: `` `With ${s.whoName || s.role}` ``; none -> "" |

---

## Claim detail (components/te/TeClaims.tsx, export TeClaimDetail, view 'claim')

### 1. Purpose and props
One claim with its tracker, lines, flags, legs (GPS evidence), totals, owner actions (answer a send-back, take it back), plain approver/Finance decision buttons, and history. Props: `claimId`, `catName: Map<string,string>`, `onBack()`, `onChanged(message)`, `onFixLine?(line: TeExpense, tripId?: string)`.

### 2. Loading
`GET /api/te/claims/{claimId}` -> `TeClaimDetail` (`claim, employee, trip, lines, bookings, legs, decisions, advance, messages, timeline, can`). Re-fetched whenever `tick` changes (after every successful action). Late answers dropped. If `d.trip`, also `GET /api/te/trips/{trip.id}` and keep `places` (`TeTripDetail.places`, id -> `TePlaceBrief`) for the leg evidence names; failure -> `{}` silently.

Before data: `div.card` with `p.muted` = error text or "Loading the claim…", and `btn sm` "My claims" -> `onBack()`. Refusals: "Claim is missing or is not a valid id." (400), "You cannot open this claim." (403).

If a leg's evidence is open (`evidence` = leg id found in `d.legs`), the whole screen is replaced by `<TeLegEvidence leg places onBack={() => setEvidence(null)}>` (component `components/te/approve/TeLegEvidence.tsx`, documented by another part).

### 3. Layout, in order
1. Row: `btn sm` "My claims" -> `onBack()`; `span.mono.muted` `c.no`.
2. Card:
   - `h1`: `d.trip?.name || 'Other expenses'`.
   - `p.muted`: `[d.employee.name, claimHolder(c), c.period ? \`${c.period} period\` : ''].filter(Boolean).join(' · ')` (`period` is 'YYYY-MM').
   - Right: chip from `claimChip(c)`.
   - **Tracker** (`.trk`, each step `div.st.<state>` with `<b>` + `<span>`):
     - "Submitted" — always `done`; span `when(c.submittedAt)`.
     - One per step of `[...c.chain, ...c.fin]`: `<b>{s.role}</b>`, span `` `${s.byName || s.whoName || ''}${s.at ? ` · ${when(s.at)}` : ''}` ``. State: `approved` -> `done`; `pending` -> `now` if it is the first pending step and the claim is not stopped (REJECTED/CANCELLED/SENT_BACK), else `todo`; `skipped` -> `todo`; anything else (rejected, sent_back, cancelled) -> `bad`.
     - "Payout" — `done` if SETTLED, `now` if VERIFIED, else `todo`; span `c.paidRef || ' '`.
     - "Settled" — `done` if SETTLED else `todo`; span `when(c.settledAt)` when settled.
3. Columns. Main:
   - Lines table (`table.tbl` inside `.tw`), header row: "Date", "Expense", "Claimed" (right), "Approved" (right), "Why". One row per `d.lines` (row class `bad` when `x.fix`):
     - Date: `day(x.date)` ('16 Nov').
     - Expense: `<b>{x.merchant || catName(x.cat) || x.cat}</b>`; sub `small muted` `catName(x.cat) || x.cat` + `' · paid by company'` when `x.pay === 'company'`; `TeFileLink path={x.file.path} name={x.file.name} kind={x.file.kind} small` when the line has a stored file (no `claimId` passed); when `x.fix && onFixLine && d.can.own`: button `btn sm pri` icon `receipt` "Fix this line" -> `onFixLine(x, d.trip?.id)`.
     - Claimed: `'—'` for company-paid, else `rs(x.claimed)`.
     - Approved (bold): `'—'` for company-paid; `'…'` when `x.approved === null`; else `rs(x.approved)`.
     - Why (small): `x.dreason || (x.fix ? 'Needs your correction' : '')`.
   - Open flags: every `c.flags` with `status === 'open'`: `flagClass(f)`, icon `warn`, `<b><span class="code">code</span> title</b>`, `<p>evidence</p>`.
   - "Travel on this claim" card (only if `d.legs.length`): header `.day` "Travel on this claim" + count. One `button.li.click` per leg -> open evidence: icon `route`; `.b` `` `Journey ${l.n}` ``; sub `[l.mode, \`${l.payKm ?? l.plannedKm} km\`, l.gps === 'checkin' ? 'check-ins' : null, l.stats?.gaps ? plural(l.stats.gaps, 'gap') : null, l.manual ? 'added without GPS' : null].filter(Boolean).join(' · ')`; right `span.nr-go` "Evidence" + icon `go`.
4. Aside:
   - Totals card `dl.kv`: "Claimed" `rs(c.claimed)`; "Approved" `rs(c.approved)`; "Advance adjusted" `rs(-c.advanceAdjusted)` only when > 0; total row label `c.status === 'SETTLED' ? 'Paid' : 'To be paid'`, value `rs(c.net ?? c.approved)`.
   - Action card, shown when `(d.can.own && (status SENT_BACK || IN_APPROVAL)) || d.can.act`:
     - **Answer a send-back** (own && SENT_BACK): `label.fld` "Your answer" + textarea (`text`); button `btn pri wide` "Send answer", disabled while busy or `!text.trim()`.
     - **Take back** (`d.can.own`, any status that reached this card): button `btn wide` "Take this claim back" -> confirm state. Confirm: `flag crit` icon `warn`, `<b>` `` `Take ${c.no} back?` ``, `<p>` "It leaves the approval chain and becomes yours to change again. Sending it back in starts the approvals from the beginning."; buttons `btn` "Never mind" (cancel confirm) and `btn dan` "Take it back" / "Taking it back…" (disabled while busy).
     - **Approver / Finance** (`d.can.act`): `p.small.muted` `` `You are deciding as ${d.can.role}. To reduce or refuse single lines, or to answer a check, open this claim from the Approvals desk.` ``; `label.fld` "Comment" + textarea (shared `text` state); `btn pri wide` "Verify" if `d.can.stage === 'finance'` else "Approve"; row: `btn sm` "Send back" and `btn sm dan` "Reject" (both disabled while busy or empty comment).
   - Note (`.note`, icon `info`) with `d.can.why` when `!can.act && can.why && !can.own`.
   - Error: `flag crit` role alert with `<b>{error}</b>`.
   - History card `card pad0`: header `.day` "History" + `d.timeline.length`; one `li` per entry (newest first, as returned): `small muted` `` `${when(h.at)}${h.name ? ` · ${h.name}` : ''}${h.internal ? ' · internal' : ''}` `` over `<div>{h.text}</div>`. Internal entries are only returned to staff (Finance/admin).

Not rendered (present in the response): `d.messages`, `d.advance`, `d.decisions`, `d.bookings`, `c.flags` other than open ones, `c.band/score`. Advance netting is visible only via "Advance adjusted" and the net.

### 4. Actions / API
All go through `run(label, act)`: busy on, error cleared; on success `text = ''`, `tick++` (refetch), `onChanged(label)` (TeHome toasts it and reloads the snapshot); on failure `error = errorText(e)`.

| Button | Call | Body | Success message |
|---|---|---|---|
| Send answer | `POST /api/te/claims/{id}/action` | `{ action: 'respond', text }` | "Answer sent." |
| Take it back | `POST /api/te/claims/{id}/action` | `{ action: 'recall' }` | "Claim taken back." |
| Approve | `POST /api/te/claims/{id}/decide` | `{ action: 'approve', comment: text }` | "Approved." |
| Verify | same | `{ action: 'verify', comment: text }` | "Verified." |
| Send back | same | `{ action: 'sendback', comment, stage: 'finance' \| 'manager' }` | "Sent back." |
| Reject | same | `{ action: 'reject', comment, stage }` | "Rejected." |
| Fix this line | none (opens the expense form via `onFixLine`) | | |

Respond response `ClaimResult { claim_id, status, stage, net_amount?, advance_adjusted? }`; recall response `{ claim_id, status: 'CANCELLED' }`.

### 5. Send-back respond flow
1. Approver sends back (optionally marking lines `fix` / whole claim `fixAll`). Claim status SENT_BACK, chip "Needs your answer", marked lines highlighted (`tr.bad`, "Needs your correction").
2. Employee taps "Fix this line" -> expense form on that line (category locked); saving is allowed because the claim is SENT_BACK and the line is marked (or fix_all). After save TeHome navigates to Other expenses (quirk) — the user must reopen the claim.
3. Employee writes an answer and taps "Send answer". Server re-assesses every line of the claim: te-service "Claim not found." (as `{error}` from the engine path when the claim is not in the snapshot), "Fix the blocked lines first." (+flags), "Add a reason where one is asked." (+flags); SQL `te_claim_respond`: "Nothing to answer." (not SENT_BACK / not own), "Write your answer." (TE_COMMENT), same two blocking messages. Route: "text is required.", "action must be one of: respond, recall.".

### 6. Recall gating
UI: the "Take this claim back" button shows to the owner whenever the action card shows, i.e. status SENT_BACK or IN_APPROVAL (it does not check whether a step was already approved). Server `te_claim_recall`: allowed only if status SENT_BACK, or IN_APPROVAL with no approval step `approved`; else "An approver has already acted."; not own -> "Claim not found.". Effect: lines back to UNCLAIMED (decisions, eligible/approved, fix marks cleared), pending steps cancelled, claim CANCELLED ("Taken back"), trip returns from CLAIMED to its previous state.

### 7. Known gaps to keep or fix
- `TeFileLink` in the lines table gets no `claimId`, so an approver opening a colleague's bill from this screen gets "You can only open your own files." (the employee's own bills work).

---

## Advances (components/te/claim/TeAdvances.tsx, view 'advances')

Read-only. Props: `snap`, `onOpenTrip(tripId)`.

Data: `mine = snap.advances.filter(a => a.emp === snap.me)` (server order: newest first). `TeAdvance` fields used: `id, no, tripId, requested, approved, outstanding, status, display, due, paidOn, ref`.

Layout:
1. Header: `h1` "Advances"; `p` "Money the company paid you before a trip. It is set against that trip’s claim; anything left over is returned."
2. Three tiles (`.g3 > .tile` with `.l` label, `.v` value, `.s` sub):
   - "Still with you" — `rs(sum of outstanding)`; sub `` `across ${n} advance${n === 1 ? '' : 's'}` `` where n = count with outstanding > 0.
   - "Waiting on Finance" — `rs(sum of (approved ?? requested))` over status REQUESTED or APPROVED; sub `` `${k} not paid out yet` `` or "nothing pending".
   - "You can ask for" — `` `up to ${snap.cfg.advanceMaxPct}%` `` (default 80); sub "of what you will pay yourself".
3. Overdue banner (`flag crit`, icon `alert`) when any advance has `outstanding > 0 && due && due < snap.today` (client rule; no grace days): `<b>` "An advance is past its date" (1) or `` `${n} advances are past their date` ``; `<p>` "Submit the trip’s claim to set it off, or return the balance. Finance can also recover it from payroll."
4. Card "Every advance" (`.day` + count). Row (`li`, clickable with Enter/Space when `tripId`) -> `onOpenTrip(a.tripId)`: icon `advances`; `.b` trip name (from `snap.trips`) or `a.no`; sub: `span.mono` `a.no` + `` ` · paid ${day(paidOn)}` `` + `` ` · due ${day(due)}` `` + `` ` · ${ref}` `` (each only when present); right: `<b>{rs(a.outstanding)}</b>`, `small muted` "still with you", and a chip.
   - Empty: `<b>No advances</b>` + "Ask for one while planning a trip, on the last step."
5. Note: "An advance is set against the claim for its own trip. If the claim is smaller than the advance, the difference is recovered."

Chip: class `chip ${TONE[a.status] ?? 'plain'}`, text `a.display || a.status.replace(/_/g,' ').toLowerCase()`.

| status (te_advances) | tone |
|---|---|
| REQUESTED | t-warn |
| APPROVED | t-brand |
| PAID | t-pos |
| PART_SETTLED | t-info |
| SETTLED | t-pos |
| RECOVERY_DUE | t-crit |
| REJECTED | t-crit |
| CANCELLED | plain |

`display` comes from SQL `te_advance_status()`: returns `'RECOVERY_DUE'` when status is PAID/PART_SETTLED, outstanding > 0, and today > due_date + `grace_days`; otherwise the raw status. Because `display` is always a non-empty upper-case code, the chip text in practice is the raw code (e.g. "PAID", "RECOVERY_DUE"), and the tone follows the stored `status` (so an overdue PAID advance shows "RECOVERY_DUE" in t-pos). Parity note for the lead: likely unintended; a port may want to map `display` through a label table and use `TONE[display]`.

---

## My limits and rates (components/te/vehicle/TeLimitsAndRates.tsx, view 'limits')

Props: `snap`, `onChanged(message)`. Everything is read from `snap.cfg` / `snap.masters`; only the embedded vehicle form writes.

Derived: `grade = snap.emp[snap.me]?.grade || snap.cfg.defaultGrade`; `limits = snap.cfg.limits[grade] ?? {}`; `types = cfg.vehicles.filter(v => v.on)`; `mine = snap.vehicles.filter(v => v.emp === snap.me)`; `rates = types.map(t => ratePerKm(t, cfg.fuelPrice)).filter(r => r > 0)`.

Layout:
1. Header: `h1` "My limits and rates"; `p` `` `These limits apply to you as grade ${grade}. They come from the policy your company has published.` ``
2. Limits table (`table.tbl`), columns: "City group", "Cities", "Hotel a night" (r), "Food a day" (r), "Local conveyance a day" (r). Rows for each tier present in `limits`, in this order:
   | tier id | label | Cities cell |
   |---|---|---|
   | metro | "Metro" | cities whose `masters.cities[city][0] === 'metro'`, joined ", ", or "—" |
   | tier1 | "Tier 1" | same for tier1 |
   | rest | "Rest of India" | same for rest |
   | intlA | "International, group A" | first 7 of `cfg.zoneA` joined ", " + `` ` and ${n-7} more countries` `` if more than 7 |
   | intlB | "International, group B" | "Every other country" |
   Values: `rs(limits[tier].hotel)`, `rs(.meals)`, `rs(.conv)`. (Seed defaults per grade E1/M1/M2/L1, e.g. E1 metro 3500 / 900 / 600.)
3. Tiles (`.g3`):
   - "Travel class" — `` `${cfg.airClass[grade] ?? '—'} · ${cfg.trainClass[grade] ?? '—'}` ``; sub "Flight and train".
   - "Own vehicle" — `` `${rs(min(rates))} to ${rs(max(rates))} a km` `` or "Not offered"; sub "By vehicle type, on the GPS distance". (`rs` rounds to whole rupees.)
   - "Advance" — `` `Up to ${cfg.advanceMaxPct}%` ``; sub "of the self-paid estimate".
4. Card `#my-vehicles`: header `h3` "My vehicles" + toggle button: closed -> `btn sm pri` icon `plus` "Add a vehicle"; open -> `btn sm` icon `close` "Close". Paragraph (small muted): "Every vehicle you drive for work is added by its number. Its RC sets the type and the rate a km, so a hatchback is not paid as an SUV."
   - When open: `<TeVehicleAdd snap first={!mine.length} onClose={close} onAdded={(_id, message) => { close; onChanged(message) }}>`.
   - Vehicle rows (`.vrow`): icon `bike` if `v.type === 'bike'` else `car`; `b.mono` `v.reg`; chips: verified -> `chip plain t-pos` icon `verify` + ("RC checked by HR" if `v.vby === 'hr'` else "RC checked"); not verified -> `chip plain t-warn` "HR to check the RC"; when `v.whose` not 'self' -> `chip plain` `WHOSE_LABEL[v.whose] ?? v.whose`; sub `vehicleSubtitle(v, cfg.vehicles, cfg.fuelPrice)`; when `v.rc`, the RC marks (`.vvalid > span.vok.<ok|bad|mute>`, icon `check` for ok, `alert` for bad, none for mute) from `rcMarks(v.rc, snap.today)`.
   - Empty: `<b>No vehicle yet</b>` + "Add one to claim travel by your own vehicle."
5. Card "Rules that apply to every claim" (`.g2` of `flag info` items, icon, `<b>` title, `<p>` note):
   | icon | title | note |
   |---|---|---|
   | clock | `` `Bills older than ${billAgeDays} days are not accepted` `` | "Counted from the bill date." |
   | cal | `` `Submit within ${claimDeadlineDays} days of return` `` | "After that, a reason is asked." |
   | receipt | `` `A bill is needed above ${rs(receiptAbove)}` `` | "Hotel, air, train and client bills always need one." |
   | pin | `` `No-bill local conveyance up to ${rs(noBillPerDay)} a day` `` | "Auto and metro rides without a receipt." |
   | people | `` `Client entertainment up to ${rs(clientPerHead)} a head` `` | "Name the client and the number of people." |
   | receipt | "Caps on each claim" | `` `Miscellaneous ${rs(miscPerClaim)}, courier and communication ${rs(commPerClaim)}.` `` |

---

## Add a vehicle (components/te/vehicle/TeVehicleAdd.tsx)

Used in "My limits and rates" and embedded in the trip planner (own-vehicle mode; see part B). Props: `snap`, `first?` (no vehicles yet), `onAdded(vehicleId, message)`, `onClose?`.

### Layout (`.vform`)
1. Header `.vform-h`: icon `verify`; `<b>` `first ? 'Add the vehicle you drive' : 'Add a vehicle'`; `<small>` "Your own, a family member’s or another. EZER reads its RC (registration certificate) to confirm what it is, and pays by that."; close icon button (aria "Close") when `onClose`.
2. "1. What vehicle is it?" — option buttons (`.opts.sm`, `aria-pressed`) per active vehicle type (`cfg.vehicles.filter(v => v.on)`), icon `bike`/`car`, label `t.name`. Seed: bike "Two-wheeler", hatch "Hatchback", sedan "Sedan", suv "SUV", ev "Electric car".
3. "2. Vehicle number, as on the RC" — text input (`mono`, `autoCapitalize=characters`, `autoComplete=off`, `spellCheck=false`, `maxLength=16`, placeholder "HR26 DK 4821 or 22 BH 1234 AA"); button `btn pri` icon `verify` "Check RC" / "Checking…" (disabled only while checking). Typing in the number clears the lookup result, `whose`, photo and error.
4. Result branch A — not found / check off (`found` has `notFound` or `off`):
   - `flag warn` icon `alert`: `<b>` "The RC check is switched off" (off) or `` `Vahan could not find ${showReg(reg)}` ``; `<p>` `(off ? 'Attach' : 'Check the number once more. If it is right, attach')` + " a photo of the RC, front and back. HR checks it and confirms the type before the vehicle is paid."
   - "Whose vehicle is it?" options `self`/`family`/`other` (labels "Mine", "A family member’s", "Someone else’s") + `<small>` `ownerNote(cfg.vehx)` (class `pst bad` when `vehx.owner === 'self'`, else `muted`).
   - Photo picker `label.vphoto[.on]`: icon `check` (attached) / `file`; text "Attaching…" / `` `${photo.name} attached · choose another to replace` `` / "Attach the RC photo"; hidden `<input type=file accept="image/*,application/pdf">` (single file, no capture). Upload `te.upload(file, 'RC')`; keeps `{ name: file_name, url: storage_path }`.
   - Error `div.ferr` (icon `alert`).
   - Footer `.rfoot`: `btn pri` "Add and send to HR" / "Adding…" (not gated on photo or whose; server refuses).
5. Result branch B — found on Vahan (`found.rc`):
   - RC card `.rccard` (`.rccard.bad` when the save gate is blocking): icon by `rc.type`; `<b>` `${rc.maker} ${rc.model}`; sub `` `${rc.cls} · ${rc.body} · ${rc.fuel} · registered ${longDate(rc.regd)}` `` (longDate = '7 Dec 2026'); chip `chip plain t-pos` icon `check` "Found on Vahan".
   - Type check `.vcheck.ok|bad`: same type -> `` `Matches: you said ${typeName(type)}, the RC says ${rc.body.toLowerCase()}.` ``; different -> "You said <typeName>. The RC says <body lower>[, a two-wheeler]. You are paid as **<found.typeName>**."
   - `dl.kv.sm`: "Owner on the RC" -> `found.ownerMasked` (real name only when it matches the employee; else masked, e.g. "R•••• K••••") + chip: match -> `t-pos` "Your name"; partial -> `t-warn` "Same surname"; no -> `t-warn` "Another name". "Paid as" -> `<b>{found.typeName}</b> · ${rs(rate(rc.type))} a km`.
   - RC marks from `rcMarks(rc, today)`.
   - Gate message `div.ferr` (or `ferr warn` when not blocking) from `saveGate`.
   - Whose options `family`/`other` only when `found.match !== 'match'`.
   - Error `div.ferr`.
   - Footer: `btn pri` icon `check` "Add and use this vehicle" / "Adding…", disabled when `!gate.canSave` or saving.
6. If no result yet and an error exists: `div.ferr`.

### Actions / API
- **Check RC**: client checks first: no type -> "First say what vehicle it is."; `!isRegValid(reg)` -> `REG_FORMAT_MESSAGE` "Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA." Then `GET /api/te/vehicles/lookup?reg=<normaliseReg(reg)>` -> `VehicleLookup` = `{ off: true, reg }` | `{ notFound: true, reg }` | `{ reg, rc: RcChecked, type, typeName, ownerMasked, match: 'match'|'partial'|'no', valid: {rc, ins, puc} }`. On a found RC the input is rewritten to `showReg(rc.no)`. Server: bad format -> 409 TE_VEHICLE same message (`field: 'reg'`); `cfg.vehx.rcCheck` false -> `off`; no Vahan provider or not found -> `notFound` (today no provider is wired, so every number is `notFound` unless configured). Route: "reg is required.".
- **Attach RC photo**: `POST /api/te/upload` kind `RC` (see upload section).
- **Add**: `POST /api/te/vehicles` body `VehicleInput { reg: normaliseReg(reg), type, whose: whose || 'self', rc_file_url?: photo.storage_path }`. Response `{ vehicle_id, vehicle_type_code, is_verified }`. Success message: `is_verified ? \`Added ${showReg(reg)}. RC checked: paid as ${typeName(r.vehicle_type_code)}.\` : \`Added ${showReg(reg)}. HR will check the RC.\`` -> `onAdded(r.vehicle_id, message)`. Failure -> error text (busy cleared only on failure).
  - The server looks the RC up again (never trusts the client). SQL `te_vehicle_add` refusals: "You can only add your own vehicles."; access ended; format message; "<REG> is already in your vehicles."; "<REG> is already added by another employee. Ask HR to move it to you."; "Choose what vehicle it is."; "Your company does not pay for a <type name lower>."; "Attach a photo of the RC. HR checks it before the vehicle is paid." (no RC and rcCheck on and no photo); "The RC of <REG> has expired. It cannot be used for paid travel."; "The RC is in another name. Say whose vehicle it is." / "Say whose vehicle it is." (unreachable from this UI because it always sends `whose || 'self'`; quirk: an unmatched RC with no choice is saved as 'self'); "Your company pays only for a vehicle registered in your name." (owner=self); "Your company pays only for your own vehicle or a family member’s." (owner=family); "The insurance of <REG> has expired. Renew it, then add the vehicle." (insurance=block). The RC type wins over the declared type; ownership is forced to 'self' when the RC name matches.

---

## lib/te/vehicle.ts (pure; imports only `type` from ./types.ts and `day` from ./format.ts — dependency-free, safe to import in RN)

| Export | Signature | Logic |
|---|---|---|
| `VehicleRules` | `{ owner?: 'self'\|'family'\|'any'\|string; insurance?: string; [k]: unknown }` | shape of `cfg.vehx` (`rcCheck`, `owner`, `insurance`) |
| `WHOSE_LABEL` | `Record<string,string>` | `self` "Mine", `family` "A family member’s", `other` "Someone else’s" |
| `REG_FORMAT_MESSAGE` | string | "Enter the vehicle number as on the RC, like HR26 DK 4821, or 22 BH 1234 AA." |
| `normaliseReg(input)` | `string -> string` | upper-case, strip everything but A–Z0–9 ('hr26 dk 4821' -> 'HR26DK4821') |
| `showReg(input)` | `string -> string` | upper-case, collapse whitespace to single spaces, trim |
| `isRegValid(input)` | `string -> boolean` | on the normalised value: `/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/` (state-district-series-number) or `/^\d{2}BH\d{4}[A-Z]{1,2}$/` (Bharat series). Same regex as engine `rcFmtOk`. |
| `rcMarks(rc, today)` | `(Pick<RcChecked,'rcValid'\|'insValid'\|'pucValid'> \| null, IsoDate) -> RcMark[]` | `[]` for null. Marks for RC (required), Insurance (required), PUC (not required). Empty date: required -> omitted; PUC -> `{tone:'mute', text:'PUC: not needed'}`. Else `expired = until < today` (string compare): `{tone: expired?'bad':'ok', text: \`${label} ${expired?'expired':'till'} ${longDay(until)}\`}` e.g. "Insurance till 7 Dec 2026". |
| `longDay(iso)` | `string -> string` | `` `${day(iso)} ${iso.slice(0,4)}` `` ('7 Dec 2026'), '' for empty |
| `saveGate({rc, rules, today})` | `-> { canSave, message, blocking }` | no rc -> can save, no message. RC expired (`rcValid < today`) -> cannot save, blocking, "The RC expired on <longDay>. This vehicle cannot be used for paid travel." Insurance expired: `rules.insurance === 'block'` -> cannot save, blocking, "The insurance expired on <d>. Renew it, then add the vehicle."; otherwise can save, non-blocking, "The insurance expired on <d>. You can add it; your approver will see this on every claim." Else OK. |
| `ownerNote(rules)` | `-> string` | owner 'self': "Your company pays only for a vehicle in your name."; 'family': "Your company pays for your own or a family member’s vehicle."; else "Allowed. Your approver sees whose vehicle it is." |
| `ratePerKm(vt, fuelPrice)` | `(TeVehicleType \| undefined, Record<string,number>) -> number` | undefined -> 0; `method === 'fixed'` -> `vt.rate`; otherwise (`'fuel'`): `price = fuelPrice[vt.fuel] ?? 0`, `kmpl = vt.kmpl || 0`; `kmpl ? round2(price / kmpl + (vt.wear || 0)) : vt.rate` (round2 = `Math.round(x*100)/100`). Seed: bike 4, hatch 9, sedan 11, suv 13 (fixed); ev fuel: 9 / 7 + 3 = 4.29. (Engine `vehRate` differs only in using `max(1, kmpl)` instead of falling back to `rate` when kmpl is 0.) |
| `vehicleSubtitle(v, types, fuelPrice)` | `-> string` | `[vt?.name ?? 'Vehicle', \`₹${ratePerKm(vt)} a km\` (raw number, not rs, e.g. "₹4.29 a km"), v.rc ? \`${maker} ${model}, ${fuel}\` : 'RC photo with HR']` + `` `you said ${declared type name}` `` when `v.declared && v.declared !== v.type`; joined " · ". |

Engine helpers behind the lookup (server only): `rcType(rc)` = class contains "2W" -> bike; fuel Electric -> ev; body Hatchback -> hatch; Sedan -> sedan; else suv. `nameMatch(owner, me)`: tokens of letters; first and last tokens equal -> 'match'; last equal -> 'partial'; else 'no'. `maskName`: each word -> first letter + '•' × max(2, len−1).

---

## Shared helpers used by this part (lib/te/format.ts — pure, `import type` only; RN-safe)

- `rs(amount)`: `Math.round(Number(amount)||0)`, Indian grouping via `toLocaleString('en-IN')`, prefix `₹`, leading `-` for negatives (e.g. `rs(-1200)` -> "-₹1,200"). RN: Hermes `toLocaleString('en-IN')` needs Intl; verify or hand-roll lakh grouping.
- `day(iso)`: 'YYYY-MM-DD…' -> 'D Mon' (no time-zone shift); '' if not a date.
- `when(iso)`: timestamp shown in IST (+5:30 fixed): 'D Mon, HH:MM'.
- `plural(n, word)`: `${n} ${word}` + 's' unless n === 1.
- `claimChip`, `claimHolder`, `currentStep` — tables above.
- `flagClass(f)`: `f.block ? 'flag crit' : 'flag warn'`.
- `errorText(e)`: `e.message` if an Error with a message, else "Something went wrong. Try again."
- `lib/te/trips-list.ts` `linesWaitingInTrips(expenses, trips)` (pure, `import type`): groups `expenses` with `!other && status === 'UNCLAIMED' && tripId` by trip -> `{ tripId, name (trip name or 'A trip'), count, total (sum claimed) }`, sorted by name (`localeCompare`).
- `lib/te/co-traveller.ts` `isCoTraveller(trip, me)` (pure): `tripRole === 'co'` where owner = `trip.emp === me` wins, co = `trip.co.includes(me)`.

Browser APIs in this part: `window.open` (TeFileLink only), `FormData`/`fetch` multipart (upload), `<input type=file>`. No geolocation, storage, canvas or FileReader.

---

# Part 6 — Approvals inside ESS Travel & Expenses (employee who is an approver)

Scope of this part: `components/te/approve/*` (TeApprovals, TeTripApproval, TeClaimApproval, TeLegEvidence), the pure helpers `lib/te/claim-decide.ts` and `lib/te/flag-review.ts`, and the API/SQL behind them (`te_queue`, `te_trip_detail`, `te_claim_detail`, `te_trip_decide`, `te_claim_decide`, `te_claim_finance`, `te_flag_resolve`, `te_claim_reopen`).

The client never works out who may act on what. Two server answers decide it: the queue (`te_queue`) and the `can` object on each detail read. The screens only render those answers.

---

## Gating: who sees which approval screen or action

### G1. The "Approvals" entry points in TeHome (components/te/TeHome.tsx)
- On every `reload()`, TeHome calls `te.queue()` (GET `/api/te/queue`) next to `te.me()`. If the queue call fails, the error is swallowed and the queue is set to `[]`. The comment says "The queue is empty for most people; a failure here must not hide the rest of the screen."
- **Desktop rail.** A rail button `Approvals` (icon `check`, with count badge `<span class="ct">{queue.length}</span>`) is rendered **only when `queue.length > 0`**. It sits above the normal RAIL items and calls `goto('approvals')`, which closes any open sheet and sets view `{ name: 'approvals' }`.
- **Phone tab bar.** The `.tabbar` (Home, Expenses, New claim, Claims, ESS/More) has **no Approvals tab**. On a phone the only way in is the Home "Needs you" card, below.
- **Home "Needs you" card** (`card pad0 needs`). Shown when `unclaimed.length || sentBack.length || queue.length`. The header count is `(unclaimed.length ? 1 : 0) + sentBack.length + queue.length`. Each queue row is a `li click needrow` button:
  - icon: `other` for a claim, `local` for a trip
  - bold text: `"{Claim|Trip plan} {ref_no} from {employee_name} is waiting for you."` ("Claim" when `entity_type === 'claim'`, else "Trip plan")
  - muted text: `"{rs(amount)} · {role_label}"`
  - right side: `Decide` + `go` icon
  - click: `setView({ name: 'approvals' })`. This opens the list, not the particular item.
- TeHome renders `<TeApprovals onToast={message => { setToast(message); reload() }} />` when `view.name === 'approvals'`. So every decision both toasts (TeHome's toast clears after 4000 ms) and reloads `me` and the queue. Once the queue is empty, the rail item disappears, but the current view stays on Approvals and shows its empty state.
- **Deep links.** The server's "waiting for you" notifications link to `/ess?tab=approvals&ref=<entity id>`, or `/dashboard/finance?ref=…` for Finance-team steps. TeHome's `claimFromLink()` only understands `?tab=claims&ref=<uuid>`. The `tab=approvals` link lands on the generic ESS "Tasks & Approvals" tab (HrisShell), not on T&E Approvals. If the RN app wants push or deep-link parity, decide whether `tab=approvals&ref=` should open T&E Approvals (it does not today).

### G2. Which rows the queue contains (SQL `te_queue`, 148_te_functions_read.sql)
`te_queue(p_actor)` returns rows of view `v_te_pending_approvals` (145_te_functions_core.sql) where **all** of these hold:
1. `q.employee_id <> p_actor`. Your own trip or claim is never in your queue.
2. One of these is true:
   - `q.approver_id = p_actor` (you are the named approver of the current step), or
   - `q.effective_approver_id = p_actor`. Here `te_effective_approver(approver_id)` = `ess_effective_approver(approver_id, now())`: the live delegate from `ess_role_delegations` (where `role_id IS NULL` and `starts_at <= now < ends_at`, newest first, one hop only), otherwise the approver themself. So a delegate sees the delegator's steps. The delegator **also** still sees them, because `approver_id = p_actor`.
   - `q.team_code is not null` (only value used: `'finance'`) and `p_actor = any(te_finance_members(company_id))`. Finance members are rows of `finance_team` with `is_active` and `can_approve`, for an active employee.
3. `te_step_block_reason(step, p_actor) = ''`. The four-eyes rules are applied (see G4), so every row in the queue can be acted on.
4. Ordered by `waiting_since` ascending (oldest first).

The view itself gives **one row per entity: its current step**, meaning the lowest-numbered `pending` step across all stages. The entity must also be in the right state:
- **claim**: joined only when `(stage='manager' and claim.status='IN_APPROVAL')` or `(stage='finance' and claim.status in ('IN_VERIFICATION','ON_HOLD'))`. A `SENT_BACK` claim is therefore **not** in anyone's queue while the employee is fixing it.
- **trip**: joined only when `trip.status='PENDING_APPROVAL'` and `te_trip_status(id) <> 'EXPIRED'`. A plan whose start date passed while it waited drops out. A `SENT_BACK` trip is not in the queue.

Row fields (type `TeQueueRow`, lib/te/types.ts):

| field | source |
|---|---|
| `step_id` | te_approval_steps.id (used as React key) |
| `company_id` | step company |
| `entity_type` | `'claim'` or `'trip'` |
| `entity_id` | claim id or trip id |
| `step_no`, `stage` (`manager`/`finance`), `role_label` | the step |
| `approver_id`, `effective_approver_id`, `team_code`, `due_at` | the step |
| `waiting_since` | max `acted_at` of earlier steps of the entity, else the step's `created_at` |
| `ref_no` | claim_no / trip_no |
| `employee_id`, `emp_code`, `employee_name` | the claimant |
| `amount` | claim: `claimed_total`. trip: `estimate_total`. |
| `entity_status` | claim.status / trip.status |
| `risk_band` | claim risk band; `null` for a trip |
| `flag_count` | number of current open flags on the claim; `0` for a trip |
| `trip_name`, `scope` | the trip (the claim's trip, if any) |

The screens read only `step_id`, `entity_type`, `entity_id`, `ref_no`, `employee_name`, `role_label`, `waiting_since` and `amount`.

**An ESS employee who is in the Finance team** (finance_team active and can_approve) gets the Finance-team claim steps in this same ESS queue. They then see the **finance-stage** version of TeClaimApproval (Verify / Hold / Send back / Reject, plus answering flags) inside ESS, not only in the back office. The RN app must support the finance stage too.

### G3. How an approval chain is built (te_resolve_chain), relevant to "co-traveller" and "own" rules
Chains are built when a trip is saved or a claim is submitted, and rebuilt when a sent-back claim comes back with a higher total. They are written into `te_approval_steps`. The rules, in order:
1. A level whose conditions (`when`: amount, scope, postFacto, exception, risk) do not apply is skipped.
2. `rm` / `rm2` / `hod` come from `te_org_chain(employee)` (l1, l2, hod). `person` is the named employee. An inactive approver counts as nobody.
3. **Co-traveller / claimant rule.** If the resolved approver is the claimant or any co-traveller (`te_trip_co(trip)`):
   - a `person` level goes to the company fallback approver (`te_settings.fallback_approver_id`);
   - a positional level (rm/rm2/hod) walks up that approver's own `l1` up to 6 times, while check `F1` is enabled (default true). The label gets `" (rerouted)"` if the person changed.
4. A level nobody fills goes to the fallback approver, with label `" (fallback)"`. The fallback itself is moved up its own `l1` line if it is a traveller.
5. A step that would land on the claimant is dropped.
6. A person on two manager levels is asked once, at the **later** level. The earlier level's condition note moves to the later one.
7. Finance levels (claims only; a trip has no finance level) come last and are never merged:
   - a "Finance team" level becomes a team step (`team_code='finance'`, `approver_id null`) if the team has anyone other than the claimant, otherwise it goes to the fallback approver with `" (fallback)"`;
   - a named finance `person` level is that person if they are active and not the claimant, otherwise the fallback.

Each step gets `due_at = now() + te_settings.escalate_days` (default 5 days).

### G4. `te_step_block_reason(step, actor)`: the exact refusal sentences
These return `''` when the actor may take the step. Otherwise they return one of the sentences below, which appear as `can.why` on detail screens and as the TE_NOT_WAITING message on decide.

| condition | sentence |
|---|---|
| no step (`step.id is null`) | `"Nothing is waiting here."` |
| named step and actor is neither `approver_id` nor its live delegate | `"This is waiting for {approver name} ({role_label})."` |
| team step and actor not in finance members | `"This is waiting for the Finance team ({role_label})."` |
| finance stage: actor acted on an earlier finance step of this entity | `"You verified an earlier finance level of this claim. Another person verifies this one."` |
| finance team step on a claim: actor's `finance_team.approval_limit` is not null, `approved_total > limit`, and another active can_approve member (not the claimant) has no limit or a limit ≥ amount | `"This claim is above your approval limit of {te_rs(limit)}. A senior Finance member verifies it."` |
| finance team step on a claim: actor approved it at a manager step, and another finance member (not the actor, not the claimant) exists | `"You approved this claim as a manager. Another Finance team member verifies it."` |
| finance team step: actor is the named approver of a LATER pending finance step | `"You are the {later role_label} on this claim. Another Finance team member verifies first."` |

### G5. Who may open a detail (GET trip/claim)
`te_can_view(type, id, actor)` (latest definition is in 161_te_co_travellers.sql) returns true for:
- the owner;
- any finance member of the company;
- (trip) anyone in `te_trip_people` of the trip, i.e. a co-traveller (read only);
- (claim) the actor's own claim on a trip they were taken on;
- anyone on the entity's approval steps: `approver_id`, `acted_by`, or live delegate of `approver_id`;
- the approver (or actor) of a trip's steps may open the claims of that trip, and the approver of a claim's steps may open its trip. This lets TeClaimApproval fetch the trip for place names.

If this returns false, the RPC raises TE_FORBIDDEN (403): `"You cannot open this trip."` / `"You cannot open this claim."`. The route then (`teOpen`, lib/te/server.ts) retries with `p_admin=true` only if the caller's role grants `Travel Claims` or `Finance` permission on that company's record.

### G6. The `can` object
**Trip** (`TeTripDetail.can = { act, why, own }`):
- `act` = `te_step_block_reason(te_current_step('trip', id), actor) = ''` AND `trip.status = 'PENDING_APPROVAL'` AND `actor <> trip.employee_id`
- `why` = that block reason when the trip is `PENDING_APPROVAL`, otherwise `''`. For your own pending trip, `why` is the block reason, e.g. "This is waiting for X (...)", not an "own" sentence.
- `own` = `actor = trip.employee_id`

**Claim** (`TeClaimDetail.can = { act, why, stage, role, own, staff }`):
- Only when `claim.status in ('IN_APPROVAL','IN_VERIFICATION','ON_HOLD')`:
  - `st` = current pending step of stage `'manager'` if `IN_APPROVAL`, else `'finance'`;
  - `why` = `"Nobody acts on their own claim."` if the actor is the claimant, else `te_step_block_reason(st, actor)`.
- Otherwise `st` is null and `why` is `''`.
- `act` = `st.id is not null and why = ''`
- `stage` = `st.stage` (`'manager'` / `'finance'` / `null` when not in an active state)
- `role` = `st.role_label` (not read by the ESS screens)
- `own` = actor is the claimant
- `staff` = admin read, or actor is a finance member. This controls whether internal timeline entries are included, and whether the owner-view evidence text is used.

### G7. What the UI shows from `can`
- `can.act === false`: an info banner `"This is not yours to decide"` with text `can.why || "It is with somebody else at the moment."`. **No** decision card, no per-line Reduce/Refuse/Ask to fix buttons, no flag buttons. The rest of the screen is read-only.
- Claim, `can.stage === 'finance'`: verbs `Verify`, `Hold`, `Send back`, `Reject`; flags can be answered (Dismiss/Confirm).
- Claim, `can.stage === 'manager'` or `null`: verbs `Approve`, `Send back`, `Reject`; flags are read-only context.
- Trip: always `Approve`, `Send back`, `Reject` when `can.act`.

---

## Approvals list (components/te/approve/TeApprovals.tsx)

**Purpose.** The approver's working list. Opening an item shows its decision screen. After a decision, the **next** item opens automatically.

**Props.** `onToast(message: string)`. In ESS, TeHome passes `message => { setToast(message); reload() }`. TeStaffHome (back office) also uses this component.

**Local state.**

| name | type | default |
|---|---|---|
| `queue` | `TeQueueRow[] \| null` | `null` (loading) |
| `openId` | `Uuid \| null` (entity_id of the open item) | `null` |
| `error` | string | `''` |
| `tick` | number (reload counter) | 0 |

**Data.** On mount and on every `reload()` (tick change): `te.queue()` → GET `/api/te/queue` → response `{ queue: TeQueueRow[] }` (the client unwraps `.queue`). On success, `queue = rows` and `error = ''`. On failure, `queue = []` and `error = String(e)` (the error text itself is not shown). A `current` flag drops stale responses.

**Routing inside the component.** `open = rows.find(r => r.entity_id === openId)`. If `open` is set:
- `entity_type === 'trip'` → `<TeTripApproval tripId={open.entity_id} onBack={() => setOpenId(null)} onDecided={afterDecision} />`
- otherwise → `<TeClaimApproval claimId={open.entity_id} onBack={() => setOpenId(null)} onDecided={afterDecision} />`

**afterDecision(message).**
1. `onToast(message)`.
2. `at` = index of the open row in the current (pre-reload) `rows`. `next = rows[at+1] ?? rows.find((r,i) => i !== at) ?? null`. So it takes the following row, or wraps to the first other row.
3. `setOpenId(next && next.entity_id !== openId ? next.entity_id : null)`, then `reload()`.
4. If the next row disappears in the reloaded queue (e.g. it was decided elsewhere), `open` becomes null and the list shows.

**Parity bug to avoid.** Both children are rendered without a `key`. When one claim is followed by another claim (or trip by trip), React reuses the same component instance with a new id prop. Its local state is **not** reset: `busy` stays `true` (it is only reset on error), and the typed comment, the chosen action, the line draft and `tried` all carry over. The `detail` of the previous item also stays on screen until the new one loads. The RN app should mount a fresh screen per entity, e.g. key by `entity_id`.

**Layout (list view).**
1. Page header (`ph`): `h1` `"Approvals"`. Paragraph: `"Trips and claims waiting on you. Deciding one opens the next."`
2. If `error`: a card with muted `"Could not load your queue."` and a `btn sm` `"Try again"` that calls `reload()`.
3. Card `card pad0`:
   - day header: `"Waiting on you"` with count `rows.length`.
   - `queue === null`: `<div class="empty"><b>Loading…</b></div>`.
   - rows (`li click` buttons, key `step_id`, click `setOpenId(entity_id)`):
     - icon: `ico sc-local` with icon `local` for a trip; `ico` with icon `other` for a claim
     - bold: `"{Trip plan|Claim} {ref_no} from {employee_name}"`
     - small muted: `role_label`, plus `" · waiting since {when(waiting_since)}"` when `waiting_since` is set
     - right `amt`: `<b>{rs(amount)}</b>`, small muted `"estimate"` (trip) or `"claimed"` (claim)
   - empty (loaded, 0 rows): `<div class="empty"><b>Nothing waiting</b>Trips and claims appear here when it is your turn to decide.</div>`

Formatting helpers: `rs` (rounds to rupees, `₹` + en-IN grouping, minus sign before ₹) and `when` (IST `"16 Nov, 09:47"`) from lib/te/format.ts. The lead documents these.

---

## Trip plan approval (components/te/approve/TeTripApproval.tsx)

**Purpose.** Decide a trip **plan** before travel: approve, send back, or reject. There are no lines to cut.

**Props.** `tripId: Uuid`, `onBack()` (back to the list), `onDecided(message)` (TeApprovals.afterDecision).

**Local state.**

| name | type | default |
|---|---|---|
| `detail` | `TeTripDetail \| null` | null |
| `action` | `'approve' \| 'sendback' \| 'reject'` | `'approve'` |
| `comment` | string | `''` |
| `busy` | bool | false |
| `error` | string | `''` |
| `tick` | reload counter | 0 |

**Load.** `te.trip(tripId)` → GET `/api/te/trips/{id}` → `TeTripDetail` (RPC `te_trip_detail`). On error: `error = errorText(e)`.

**Loading / error state.**
- Row with `btn sm` back button (icon `back`, text `"Approvals"`).
- Card with muted `error || "Loading the trip…"`.
- When there is an error, a `btn sm` `"Try again"` (reload).

**Fields read.**
- `trip.{id, no, name, points[].place, start, end, purpose, origin, display, chain, scope, estimate.{travel, desk, hotel, meals, conv}, estimateTotal, advance, why[]}`
- `employee.{name, code}`
- `places[id].s`
- `legs[].{id, n, from, to, date, mode, bookedBy, plannedKm, gps}`
- `can.{act, why}`

**Layout, in order.**
1. Row: back button `"Approvals"` (icon `back`), then `<span class="mono muted">{trip.no}</span>`.
2. Card header (`row sp top`):
   - `h1.tname` = `trip.name`
   - muted line: `"{employee.name} · {employee.code}"`
   - small muted route: `trip.points.map(p => places[p.place]?.s || '…').join(' → ')`
   - small muted dates:
     - no `start` → `"No dates"`
     - `start === end` → `day(start)`
     - otherwise → `"{day(start)} to {day(end)}"`
     - then `" · {plural(legs.length,'journey')}"` (e.g. "3 journeys"), then `" · {purpose}"` when there is a purpose
   - right chips:
     - `"Already travelled"` (class `chip plain t-warn`) when `origin === 'POST_FACTO'`
     - status chip `chip {tone}` with label from `tripChip(trip)` (lib/te/trips-list.ts, table below)
3. If `!can.act`: banner `flag info`, icon `info`, `<b>This is not yours to decide</b>` and `<p>{can.why || 'It is with somebody else at the moment.'}</p>`.
4. Card `"What it is expected to cost"` (h3), a `dl.kv` where each row appears only if its value is non-zero:
   - `"Travel they pay"` = `rs(estimate.travel)`
   - `"Tickets the Travel Desk books"` = `rs(estimate.desk)`
   - `"Hotel"` = `rs(estimate.hotel)`
   - `"Food"` = `rs(estimate.meals)`
   - `"Local rides"` = `rs(estimate.conv)`
   - total (class `tot`): `"Total estimate"` = `rs(estimateTotal)`

   Then:
   - If `trip.advance` (non-zero): banner `flag warn`, icon `alert`, `<b>An advance of {rs(advance)} is asked for</b>`, and `<p>Approving the trip releases this before the travel. It is set against the claim afterwards, and anything left over is recovered.</p>`
   - If `trip.why.length`: small muted `"Added by the workflow: {why.join('; ')}."` (the chain notes saying why extra levels applied)
5. Card `card pad0` "Journeys": day header `"Journeys"` / `legs.length`. Legs are sorted by `n` ascending. Each row `li`:
   - `<span class="ln">{n}</span>`
   - bold `"{place(from)} → {place(to)}"`
   - small muted: `day(date) + " · "` (omitted when `scope === 'local'`), then `mode`, then `", Travel Desk"` if `bookedBy === 'desk'`, then `" · {plannedKm} km"`, then `" · check-ins"` if `gps === 'checkin'` else `" · GPS"`
6. If `can.act`: card `"Your decision"` (h3):
   - segmented control `seg` (role group, aria-label "Decision") with buttons `"Approve"`, `"Send back"`, `"Reject"`. The pressed one has `aria-pressed`. Clicking sets `action` and clears `error`.
   - field `fld` textarea. Label is `"Comment, if any"` when approving, else `"What they need to know"`. Typing clears `error`.
   - consequence `note` (icon `info`):
     - approve with advance: `"Approves the trip and releases the {rs(advance)} advance."`
     - approve without advance: `"Approves the trip. They can start its first journey on the day."`
     - sendback: `"Goes back for them to change and send again."`
     - reject: `"The trip is refused. Any advance asked for is cancelled with it."`
   - error line `ferr` (icon `alert`) when `error`.
   - main button `btn pri lg wide` (for reject: `btn dan lg wide`), disabled while `busy`. Label is `"Sending…"` while busy, else `"Approve the trip"` / `"Send it back"` / `"Reject the trip"`.

**Trip status chip (`tripChip`, lib/te/trips-list.ts), keyed by `trip.display`.**

| display | label | tone |
|---|---|---|
| DRAFT | Draft | t-info |
| PENDING_APPROVAL | Waiting for approval | t-warn |
| SENT_BACK | Sent back to you | t-warn |
| APPROVED | "Approved" if `chain.length` else "Ready, no approval needed" | t-brand |
| ONGOING | On the trip | t-info |
| COMPLETED | Back, close and claim | t-info |
| MISSED | Missed | t-warn |
| EXPIRED | Expired | t-crit |
| CLAIMED | Claimed | t-brand |
| CLOSED | Closed | t-pos |
| CANCELLED | Cancelled | plain |
| REJECTED | Rejected | t-crit |
| other | status with `_` → space, lower-cased | plain |

The labels are worded for the employee ("Sent back to you"); the approver sees the same words.

**Send.**
- Client check: if `action !== 'approve'` and `comment.trim()` is empty, set `error` and stop:
  - reject: `"A rejected trip needs a reason."`
  - sendback: `"Say what needs changing."`
- Then `busy = true` and call `te.tripDecide(trip.id, action, comment.trim() || undefined)` → **POST `/api/te/trips/{id}/decide`** with body `{ action: 'approve'|'sendback'|'reject', comment?: string }`. The response `{ trip_id, status }` is not used.
- Success → `onDecided(message)`. `busy` is not reset.
  - approve: `"{trip.no} approved."`. This is said even when more levels remain and the trip is still PENDING_APPROVAL.
  - sendback: `"{trip.no} sent back to {employee.name}."`
  - reject: `"{trip.no} rejected."`
- Failure → `error = errorText(e)` and `busy = false`.

**Server: route + `te_trip_decide` (146_te_functions_trips.sql).**
- Route checks:
  - `needUuid(id,'Trip')` → 400 `"Trip is missing or is not a valid id."`
  - `needOneOf(action, ['approve','sendback','reject'], 'action')` → 400 `"action must be one of: approve, sendback, reject."`
  - comment goes through `optText` (trimmed, empty → null)
- SQL refusals, in order:

  | condition | code | message |
  |---|---|---|
  | trip missing | TE_TRIP (409) | `"Trip not found."` |
  | `te_trip_status = 'EXPIRED'` | TE_TRIP | `"The trip dates have passed. Ask the employee to record it as I already travelled."` |
  | status ≠ PENDING_APPROVAL | TE_NOT_WAITING | `"This trip is not waiting for you."` |
  | actor is owner | TE_FORBIDDEN (403) | `"Nobody approves their own trip."` |
  | block reason of current step non-empty | TE_NOT_WAITING | the block reason sentence (G4) |
  | unknown action | TE_TRIP | `"Unknown action."` |
  | action ≠ approve and comment empty | TE_COMMENT (409) | `"Write a comment so the employee knows why."` |

- **approve**:
  - The step is set to `approved` with `acted_by`, `acted_at`, `comment`, and `delegated_from` = approver_id when the actor is a delegate. Logged `"Approved as {role}: {comment}"` or `"Approved as {role}."`.
  - If no pending steps remain:
    - `te__trip_mark_approved`: status APPROVED, `approved_at`, frozen `policy_snapshot` and `policy_version`.
    - Logs `"Trip approved. Policy version frozen."`, plus `" Sent to Travel Desk."` when stay_by is desk or any leg is booked by desk, plus `" Advance sent to Finance."` when a live advance exists.
    - Notifies the employee: TRAVEL_APPROVED, `"Trip approved: {name}"`, `"Your trip plan is approved."`.
    - Returns `{trip_id, status:'APPROVED'}`.
  - Otherwise the next step's holder is notified (`"Trip plan from {emp}"`, `"{name} is waiting for your approval."`) and it returns `{status:'PENDING_APPROVAL'}`.
- **reject**:
  - The step becomes `rejected` and the other pending steps `cancelled`. The trip becomes REJECTED.
  - Advances: `RECOVERY_DUE` if `outstanding_amount > 0`, else `CANCELLED` (excluding ones already REJECTED/CANCELLED/SETTLED).
  - PLANNED legs → CANCELLED. Logged `"Rejected: {comment}"`.
  - Employee notified, HIGH priority: `"Trip not approved: {name}"` with the comment as the body.
  - Returns `{status:'REJECTED'}`.
- **sendback**:
  - The **step stays pending**, so the same approver sees the plan again after the employee answers.
  - Trip status becomes SENT_BACK. The comment is stored as a `te_messages` row. Logged `"Sent back: {comment}"`.
  - Employee notified, HIGH: `"Trip plan needs your answer: {name}"`.
  - Returns `{status:'SENT_BACK'}`.

---

## Claim approval / verification (components/te/approve/TeClaimApproval.tsx)

**Purpose.** Decide a claim line by line. Managers approve. Finance verifies and can hold. Finance also answers flags here. In ESS it opens from TeApprovals. In the back office, `finance/TeVerification.tsx` and `TeStaffHome.tsx` reuse it with the same props.

**Props.** `claimId: Uuid`, `onBack()`, `onDecided(message)`.

**Local state.**

| name | type | default | purpose |
|---|---|---|---|
| `evidence` | `Uuid \| null` | null | leg id whose evidence screen is open |
| `detail` | `TeClaimDetail \| null` | null | |
| `draft` | `DecisionDraft` | `emptyDecision()` = `{comment:'', lines:{}, fix:[]}` | |
| `action` | `DecideAction \| null` | null | null means the first verb for the stage (no flash of "Approve" for Finance) |
| `busy` | bool | false | |
| `error` | string | `''` | shared by decide and flag errors |
| `tried` | bool | false | whether Send was pressed while blocked |
| `tick` | reload counter | 0 | |
| `resolving` | `{id, verdict} \| null` | null | the one flag being answered |
| `note` | string | `''` | reason for the flag answer |
| `flagBusy` | bool | false | |
| `places` | `Record<Uuid, TePlaceBrief>` | `{}` | place names for leg evidence |

**Load.**
1. `te.claim(claimId)` → GET `/api/te/claims/{id}` → `TeClaimDetail` (RPC `te_claim_detail`, latest in 153_te_booking_request.sql). On success, `detail = d` and `error = ''`.
2. If `d.trip` is set, also call `te.trip(d.trip.id)` → GET `/api/te/trips/{tripId}` and keep only `.places`. On failure `places = {}`, silently.
3. On error of the first call: `error = errorText(e)`.

Reload (tick) re-runs both, after a flag is answered.

**Loading / error state.** Same pattern as the trip screen: back button `"Approvals"`, muted `error || "Loading the claim…"`, and `"Try again"` when there is an error.

**Derived values.**
- `c = detail.claim`
- `lines = detail.lines.map(l => ({ id: l.id, eligible: l.eligible ?? 0 }))`. An unpriced line counts as 0.
- `eligibleOf(id)` looks up that eligible value.
- `flagsFor(lineId) = c.flags.filter(f => f.lineId === lineId)`
- `chip = claimChip(c)`
- `sums = decidedTotal(lines, draft.lines)`
- `mayAct = can.act`
- `verbs = actionsForStage(can.stage)`
- `chosen = action ?? verbs[0].action`, so the default is `approve` for a manager and `verify` for Finance
- `blocked = whyNotReady(chosen, draft, lines)`
- `who = detail.employee.name`

**Fields read from TeClaimDetail.**
- `claim.{id, no, band, status, stage, claimed, flags[].{id, status, lineId, code, title, evidence, block, claimLevel, note}}`
- `employee.{name, code, title, dept}`
- `trip?.{id, name}`
- `lines[].{id, merchant, cat, desc, date, eligible, file?.{path, name, kind}, files}`
- `bookings[].{id, kind, vendor, pnr, amount, status, ticket, paidBy, details.{check_in, check_out, address, room, note, platform}}`
- `legs[]`: the full TeLeg goes to TeLegEvidence; the list uses `id, n, mode, payKm, plannedKm, gps, stats.gaps, manual`
- `timeline[].{text, name, at, internal}`
- `can.{act, why, stage}`

Not shown on this screen: `decisions`, `advance`, `messages`, `can.role/own/staff`.

**Layout, in order.**
1. Row: back `btn sm` `"Approvals"` (icon `back`), then `<span class="mono muted">{c.no}</span>`.
2. Header card:
   - `h1.tname` = employee name
   - muted: `"{trip ? trip.name : 'Other expenses'} · {N} line"` or `"… lines"` (singular when N = 1)
   - small muted: `"{employee.code} · {employee.title || employee.dept}"`
   - right chips:
     - risk chip when `c.band` is set: `"{band} risk"`, class `t-crit` for High, `t-warn` for Medium, `t-pos` otherwise
     - status chip `claimChip(c)` (table below)
3. If `!mayAct`: `flag info` banner `"This is not yours to decide"` / `can.why || "It is with somebody else at the moment."`.
4. **Lines card** (`card pad0`): day header `"Lines"` / `lines.length`. For each line `l` (with `d = draft.lines[l.id]`, `touched = isTouched(d)`, `marked = draft.fix.includes(l.id)`):
   - row class `li bad` when touched or marked, else `li`; icon `other`
   - bold: `l.merchant || l.cat`
   - small muted: `[l.cat, l.desc, l.date].filter(Boolean).join(' · ')`. The date is the raw ISO `YYYY-MM-DD`, not formatted.
   - evidence: if `l.file?.path`, a `TeFileLink` (path, name, kind, `claimId = c.id`, small), plus small muted `"+{files-1} more on this line"` when `files > 1`. Otherwise small muted `"No bill attached."`. TeFileLink, in brief: a non-http path mints a signed URL via `te.fileUrl(path, claimId)` (GET `/api/te/upload?path=…&claim_id=…` → `{url, expires_in}`) and opens it in a tab that was opened before the request. An `http(s)` path is an outbound link. The default label is `"Open the bill"`; it shows `"Opening…"` while busy; if the popup is blocked: `"Your browser blocked the new tab. Allow pop-ups for this site to open the file."`
   - flag chips for this line: `chip {flagTone(status, block)}` with text `"{code} {title}"`
   - if `mayAct`, line buttons (`row tight`):
     - `"Reduce"` (`btn sm`, aria-pressed when `d.amount !== undefined`) → `setLine(id, { amount: d?.amount ?? eligible, reject: undefined })`. It starts the amount at the eligible value.
     - `"Refuse"` (`btn sm dan`, aria-pressed when `d.reject`) toggles `reject` between `'refile'` and undefined, and sets `amount: undefined`.
     - only when `chosen === 'sendback'`: `"Ask to fix"` / `"Marked to fix"` (`btn sm`, aria-pressed when marked) toggles the id in `draft.fix`.
     - when touched: `"Undo"` → removes the line entry entirely, including its reason. Undo does **not** remove the id from `fix`.
   - when touched, a `form` with:
     - if `amount !== undefined`: `fld sm` labelled `"Approve this much (₹)"`, a number input (min 0, max eligible; an empty value becomes 0), and small `"Eligible: {rs(eligible)}"`
     - if `reject`: `fld sm` labelled `"Can it be claimed again?"`, a select with `refile` → `"Yes, with a correction"` and `final` → `"No, this is final"`
     - always: `fld sm` labelled `"Why"`, input placeholder `"The employee reads this"` → `reason`
   - right `amt`: `<b>{rs(reject ? 0 : amount ?? eligible)}</b>`. Under it, the eligible amount struck through (`<s>{rs(eligible)}</s>`) when refused or when the amount differs from eligible. Otherwise small muted `"eligible"`.
5. **"Checks that fired" card**, only if `c.flags.length` (`card pad0`):
   - day header `"Checks that fired"` / `openFlags(flags) || 'all answered'`. A count of 0 shows "all answered".
   - per flag `fl`, with `offers = flagOffers(fl.status, can.stage, mayAct)`:
     - icon `alert` if `fl.block`, else `verify`
     - bold: `<span class="code">{code}</span> {title}`
     - small muted: `[evidence, line ? "on {line.merchant || line.cat}" : fl.claimLevel ? "about the whole claim" : null].filter(Boolean).join(' · ')`
     - when there are no offers and `status !== 'open'`: small muted `flagResolvedText(status, note)`. Example: "Dismissed: duplicate of another bill" / "Confirmed." / "Dismissed.".
     - offer buttons (Finance stage, `mayAct`, flag open only): `"Dismiss"` (`btn sm`) and `"Confirm"` (`btn sm dan`, grave). The pressed one is the current `resolving.verdict`. Clicking toggles `resolving` to `{id: fl.id, verdict}` (or null if already chosen) and clears `note` and `error`.
     - when this flag is being resolved, a `form` with:
       - consequence box: class `flag crit` (grave) or `note`, icon `alert`/`info`, text `offer.effect` (see flag-review)
       - `fld sm` labelled `"Why the check was wrong"` (dismiss) or `"Anything to add"` (confirm). Placeholder: `"Kept on the flag and counted in the flag report"` (dismiss) or `"Optional"` (confirm).
       - buttons: `"Never mind"` (`btn`) clears resolving and note. Submit (`btn dan` when grave, else `btn pri`) reads `"Saving…"` while `flagBusy`, else the offer label. It is disabled when `flagBusy || whyFlagNotReady(verdict, note) !== ''`.
     - right: chip `flagTone(status, block)` with text `"blocking"` / `"open"` for an open flag (by `block`), else the raw `status` ("dismissed", "confirmed").
6. **"Stays and tickets" card**, only if `detail.bookings?.length` (`card pad0`): day header `"Stays and tickets"` / count. Per booking `b` (`asked = status === 'REQUESTED'`, `off = status === 'CANCELLED'`, `d = b.details ?? {}`):
   - icon `pin` for `kind === 'hotel'`, else `plane`
   - bold: `vendor`
   - small muted: `[ first, dates, d.address, d.room, d.note ].filter(Boolean).join(' · ')`, where:
     - first = `"Asked for by the employee"` if asked; `"Cancelled"` if off; `"Booking {pnr}"` (hotel) or `"PNR {pnr}"` (others) if pnr; else `"Booked"`
     - dates = `"{day(check_in)}"` + `" to {day(check_out)}"` when check_in is set
   - if `b.ticket`: `TeFileLink` with name `"Open on {d.platform || 'the booking site'}"` (asked) or `"Open the ticket"`, `claimId = c.id`, small
   - right:
     - `<b>{rs(amount)}</b>`
     - small muted: `"expected"` if asked, `"company paid"` if `paidBy === 'company'`, else empty
     - status chip: `chip plain` (cancelled), `chip t-warn` (requested) or `chip t-pos` (others), text `status.toLowerCase()`
7. **"Journeys on this trip" card**, only if `detail.legs?.length`: day header `"Journeys on this trip"` / count. Each leg is an `li click` button that sets `evidence = l.id`:
   - icon `route`
   - bold `"Journey {n}"`
   - small muted: `"{mode} · {payKm ?? plannedKm} km"`, then `" · check-ins"` if `gps === 'checkin'`, then `" · {gaps} gap"` or `" · {gaps} gaps"` if `stats.gaps`, then `" · added without GPS"` if `manual`
   - right `nr-go`: `"Evidence"` + `go` icon
8. **"Your decision" card**, only if `mayAct`:
   - segmented control with `verbs` labels (see `actionsForStage`). Clicking sets `action` and `tried = false`.
   - `fld` textarea `draft.comment`. Label `"Comment, if any"` for approve/verify, otherwise `"What the employee needs to know"`.
   - `dl.kv`:
     - `"Claimed"` = `rs(c.claimed)`
     - `"Eligible under policy"` = `rs(sum of lines.eligible)`
     - `"Cut by you"` = `rs(-sums.cut)`, only if cut
     - `"Refused by you"` = `rs(-sums.rejected)`, only if rejected
     - total (`tot`): label `"Will be approved"` (approve/verify) or `"Would be approved"`; value `rs(chosen === 'reject' ? 0 : sums.total)`
   - `note` (icon `info`): `describe(chosen, draft, lines)`
   - `ferr` with `blocked`, only when `tried && blocked`. A second `ferr` with `error` when `error` is set. Because `send()` also copies `blocked` into `error`, a blocked send shows the same sentence **twice**.
   - main button `btn pri lg wide` (reject: `btn dan lg wide`), disabled while busy. Label: `"Sending…"` while busy, else `"{verb label} the claim"`, giving `"Approve the claim"`, `"Verify the claim"`, `"Hold the claim"`, `"Send back the claim"` or `"Reject the claim"`.
9. **"History" card**, if `detail.timeline?.length`: h3 `"History"`, a stack of `timeline.filter(e => !e.internal)` (the server sends newest first). Each entry shows bold small `e.text`, small muted `e.name ?? 'System'`, and right-aligned small muted `when(e.at)`. The card can render empty when every entry is internal.

**Claim status chip (`claimChip`, lib/te/format.ts).**

| status | label | tone |
|---|---|---|
| IN_APPROVAL | With manager | t-warn |
| IN_VERIFICATION | With Finance | t-warn |
| ON_HOLD | On hold with Finance | t-warn |
| SENT_BACK | Needs your answer | t-crit |
| VERIFIED | Approved, awaiting payout | t-info |
| SETTLED | Settled | t-pos |
| REJECTED | Rejected | t-crit |
| CANCELLED | Taken back | plain |
| other | status with `_` → space, lower-cased | plain |

**Send (decide).**
1. If `blocked` is non-empty: `tried = true`, `error = blocked`, stop.
2. `busy = true`. Call `te.claimDecide(c.id, chosen, toDecideInput(chosen, draft))` → **POST `/api/te/claims/{id}/decide`** with body:
   ```
   { action: 'approve'|'verify'|'hold'|'sendback'|'reject',
     comment?: string,                                   // trimmed, omitted if empty
     decisions?: { [lineId]: { amount?: number, reject?: 'final'|'refile', reason?: string } },  // touched lines only
     fix?: Uuid[] }                                       // only on sendback with marked lines
   ```
   The client never sends `stage`. Response `ClaimResult { claim_id, status, stage, net_amount?, advance_adjusted? }` is not used.
3. Success → `onDecided(...)`. `busy` is not reset.

   | action | toast |
   |---|---|
   | approve | `"{no} approved."` |
   | verify | `"{no} verified. It joins the next payout."` |
   | hold | `"{no} put on hold."` |
   | sendback | `"{no} sent back to {employee.name}."` |
   | reject | `"{no} rejected."` |

4. Failure → `error = errorText(e)`, `busy = false`.

**Answer a flag (resolveFlag).**
1. `why = whyFlagNotReady(verdict, note)`. If non-empty, `error = why` and stop. The button is already disabled in that case.
2. `flagBusy = true`. Call `te.flagResolve(flagId, verdict, note.trim())` → **POST `/api/te/flags/{id}`** with body `{ status: 'dismissed'|'confirmed', note: string }`. Response `{ flag_id, status, risk_band? }` is not used.
3. Success: clear `resolving` and `note`, then `reload()`. The claim is re-read so the band, chips and count are fresh. No toast, no `onDecided`.
4. Failure: `error = errorText(e)`, shown in the "Your decision" card.

**Parity bug: Confirm with an empty note.** The route requires the note for both verdicts: `needText(body.note, 'note')` → 400 `"note is required."`. The SQL also refuses an empty note: TE_COMMENT `"Give a reason."`. The client, however, allows Confirm with an empty note (`whyFlagNotReady` only requires a note for Dismiss) and sends `""`. So **"Confirm" with no note fails with "note is required."** The RN app should decide whether to copy this or require a note for Confirm as well.

**Server: route stage resolution (app/api/te/claims/[id]/decide/route.ts).**
- `claimId` = `needUuid(id,'Claim')` → `"Claim is missing or is not a valid id."`
- `action` = `needOneOf(action, [approve, verify, hold, sendback, reject], 'action')` → `"action must be one of: approve, verify, hold, sendback, reject."`
- `stage`:
  - if a body `stage` is given, it must be `'manager'` or `'finance'` (`"stage must be one of: manager, finance."`);
  - else `verify`/`hold` → finance, `approve` → manager;
  - else (sendback/reject) read `te_claims.status`: `IN_VERIFICATION`/`ON_HOLD` → finance, anything else → manager.
- finance + `approve` → 400 TE_BAD_REQUEST `"At a finance level the action is one of: verify, hold, sendback, reject."`
- manager + `verify`/`hold` → 400 `"At an approval level the action is one of: approve, sendback, reject."`
- finance → RPC `te_claim_finance`; manager → RPC `te_claim_decide`. Both receive `p_comment`, `p_decisions` and `p_fix` (null when absent).

**Server: `te_claim_decide` (manager stage, 147_te_functions_claims.sql).**

| order | condition | code | message |
|---|---|---|---|
| 1 | claim missing | TE_CLAIM | `"Claim not found."` |
| 2 | status ≠ IN_APPROVAL | TE_NOT_WAITING | `"This claim is not waiting for you."` |
| 3 | actor is claimant | TE_FORBIDDEN | `"Nobody approves their own claim."` |
| 4 | block reason of current manager step | TE_NOT_WAITING | G4 sentence |
| 5 | unknown action | TE_CLAIM | `"Unknown action."` |
| 6 | action ≠ approve and empty comment | TE_COMMENT | `"Write a comment so the employee knows why."` |

- **approve**:
  - Apply the line decisions (`te__apply_decisions`, below), mark the step approved (with `delegated_from` when the actor is a delegate), and log `"Approved as {role}: {comment}"` or `"…."`.
  - If no manager step is pending, call `te__enter_verification`:
    - sets `stage = 'finance'` and recalculates;
    - computes the random sample F4: `every = round(100 / sample_pct)`, and the claim is sampled when `serial % every = 0`;
    - if band is **High** or the claim is sampled → **ON_HOLD**, logged internally (`"Risk band is High. Placed on hold for Finance audit."` / `"Picked by the random audit sample. Placed on hold."`), Finance queue notified;
    - else if band is **Low** and the claim is in policy (no current non-dismissed flag with code POL, severity medium/high, or action justify) and `claimed_total <= fast_track_amount` → auto-verified: finance steps set to `auto`, then `te__finalize`;
    - else → **IN_VERIFICATION** and Finance notified.
  - Otherwise the next manager is notified: `"Claim {no} from {emp}"` / `"{te_rs(claimed)} is waiting for your approval."`.
- **sendback**:
  - `te__mark_fix(fix)`: the self-paid lines in `fix` get `needs_fix = true`. With an empty list, **every** self-paid line is editable and `fix_all = true`.
  - Status SENT_BACK, `sent_back_from = 'manager'`. The comment is stored as a message. Logged `"Sent back: {comment} Lines to fix: a, b."` or `"… Every line can be edited."`.
  - Employee notified, HIGH: `"Claim {no} needs your answer"`.
  - When the employee answers: if the total went up, the chain is rebuilt from the first approver; otherwise the claim returns to `IN_APPROVAL`.
- **reject**: the step becomes `rejected`, then `te__reject_claim`:
  - pending steps cancelled; all lines `REJECTED_FINAL` with approved 0;
  - claim REJECTED with `rejected_from = stage` and `reject_reason`; logged `"Rejected: {comment}"`;
  - employee notified, HIGH: `"Claim {no} rejected"`;
  - trip status updated (REJECTED for a post-facto trip with no other live claims, else CLOSED where applicable);
  - a paid advance with an outstanding amount becomes RECOVERY_DUE.
- Response: `{ claim_id, status, stage, net_amount }`.

**Server: `te_claim_finance` (finance stage).**

| order | condition | code | message |
|---|---|---|---|
| 1 | missing | TE_CLAIM | `"Claim not found."` |
| 2 | status not IN_VERIFICATION/ON_HOLD | TE_NOT_WAITING | `"This claim is not in verification."` |
| 3 | actor is claimant | TE_FORBIDDEN | `"Nobody can verify their own claim."` |
| 4 | block reason of current finance step | TE_NOT_WAITING | G4 sentence |
| 5 | unknown action | TE_CLAIM | `"Unknown action."` |
| 6 | verify on ON_HOLD with empty comment | TE_COMMENT | `"An audit note is mandatory for a claim on hold."` |
| 7 | hold/sendback/reject with empty comment | TE_COMMENT | `"Write a comment so the employee knows why."` |

The client does **not** pre-check row 6. Verifying a held claim with no comment reaches the server and shows its message.

- **verify**:
  - Apply decisions, mark the step approved, and log `"Verified as {role}…"` (or `"Audit cleared as {role}…"` when it was ON_HOLD).
  - If another finance step is pending: status IN_VERIFICATION, log `"Next: {role}, {Finance team | name}."`, notify the next holder.
  - Otherwise `te__finalize`:
    - recalculate; net the approved total against the outstanding trip advance: `adj = min(approved, outstanding)`, `net = approved - outstanding`;
    - update the advance (SETTLED or RECOVERY_DUE) and record a settlement;
    - lines with REJECTED_REFILE go back to UNCLAIMED without their files (`"Returned: …"`);
    - other lines get their final status;
    - `net > 0` → **VERIFIED**, employee notified `"{te_rs(net)} will be paid in the next payout."`;
    - else **SETTLED** with `"Nothing to pay. The advance covers this claim."` or `"Nothing to pay. No amount was approved."`.
- **hold**: status ON_HOLD, logged internally `"Held for audit: {comment}"`. The employee is not notified.
- **sendback**: as for the manager stage, but `sent_back_from = current status` (IN_VERIFICATION/ON_HOLD), so the claim returns to Finance when answered.
- **reject**: as for the manager stage.
- Response: `{ claim_id, status, stage, net_amount, advance_adjusted }`.

**Server: line decisions (`te__apply_decisions`), run on approve/verify only.**

On sendback and reject, any `decisions` sent are ignored. Everything is checked before anything is written. For each `lineId → d`:

| condition | message (code TE_DECISION, 409) |
|---|---|
| line not in this claim (`claim_id = claim`) | `"A line in this decision is not part of the claim."` |
| amount < 0 | `"An amount cannot be negative."` |
| amount > current `approved_amount`, line has a current G3/G10 flag, amount ≤ claimed, no reason | `"Say why you accept the longer route."` |
| amount > approved_amount on a G3/G10 line above claimed | `"You can raise it up to the amount claimed, {te_rs(claimed)}."` |
| amount > approved_amount on any other line | `"An approver cannot increase an amount."` |
| reject set, or amount < approved_amount, with empty reason | `"Give a reason for every reduced or rejected line."` |

How each decision is applied:
- **reject**: approved 0; `line_decision` REJECTED_REFILE or REJECTED_FINAL; logged `"Rejected line {name}: {reason}"`.
- **raise** (G3/G10): `accept_above_cap`, logged `"Accepted {name} above the cap, ₹a to ₹b: …"`.
- **reduce**: PARTLY_APPROVED, logged `"Reduced {name} from ₹a to ₹b: {reason}"`.
- **amount equal to current**: no-op.

Afterwards: `te__claim_recalc`. `approved_total` = sum of approved amounts of **self-paid** lines. `risk_score` = sum of `te_settings.risk_weights[severity]` over current, non-dismissed flags with a severity. Band is High when score ≥ `risk_bands.high` (default 8), Medium when ≥ `risk_bands.medium` (default 3), else Low.

Client/server differences the RN app should know:
- The client caps a Reduce at the line's `eligible` (`whyNotReady`). The server compares against the line's **current `approved_amount`**:
  - It **allows** raising a G3/G10-capped line up to the claimed amount. The client blocks this ("cannot be approved above its eligible amount").
  - It **refuses** an amount between a previous approver's reduced value and `eligible` (`"An approver cannot increase an amount."`). The client cannot see a prior cut, because the amount field starts at `eligible`.
- `te_claim_detail.lines` also returns the trip's **company-paid** lines (`x.trip_id = claim.trip_id and paid_by = 'company'`), even when they are not on the claim. The client counts their `eligible` in "Eligible under policy" and "Will be approved". The server's `approved_total` counts only self-paid lines. If such a line is not on the claim, a Reduce/Refuse on it gets `"A line in this decision is not part of the claim."`.

**Server: `te_flag_resolve` (route `POST /api/te/flags/[id]`).**
- Route checks:
  - `needUuid(id,'Flag')` → `"Flag is missing or is not a valid id."`
  - `needOneOf(status, [dismissed, confirmed], 'status')` → `"status must be one of: dismissed, confirmed."`
  - `needText(note,'note')` → `"note is required."`
- SQL refusals:

  | condition | code | message |
  |---|---|---|
  | flag missing | TE_FLAG | `"Flag not found."` |
  | bad status | TE_FLAG | `"Choose dismiss or confirm."` |
  | empty note | TE_COMMENT | `"Give a reason."` |
  | actor is claimant or not a finance member | TE_FORBIDDEN (403) | `"Only Finance can dismiss or confirm a flag."` |
  | claim not IN_VERIFICATION/ON_HOLD | TE_NOT_WAITING | `"This claim is not in verification."` |

  It does **not** apply `te_step_block_reason`, so any finance member can answer flags.
- Effect: the flag's `status`, `resolve_reason`, `resolved_by` and `resolved_at` are set; `te__claim_recalc` runs (a dismissed flag stops counting towards risk); an internal log entry `"Dismissed flag X: …"` / `"Confirmed flag X: …"` is written.
- Response: `{ flag_id, status, risk_band }`.

**Reopen (POST `/api/te/claims/[id]/reopen`). Not reachable from the ESS screens.**
`te.claimReopen` is only called from the back-office `finance/TeVerification.tsx`, on its "Rejected" list (toast `"{claim_no} reopened. It goes back into approval."`). It does not appear in TeApprovals or TeClaimApproval. For reference:
- body `{ reason }` (route: `"reason is required."`)
- SQL `te_claim_reopen` refusals:
  - `"Only a rejected claim can be reopened."` (TE_CLAIM)
  - `"Give a reason."` (TE_COMMENT)
  - `"Nobody reopens their own claim."` (TE_FORBIDDEN)
  - `te_assert_finance`: `"Only the Finance team can do this."` / `"Your Finance role can view this but not act on it."`
  - `"This claim was copied from the old travel module and cannot be reopened here."`
  - `"The period is locked."` (TE_PERIOD_LOCKED)
- Effect: lines are restored to their last decision, steps reset to pending, status goes to IN_VERIFICATION (if rejected by finance) or IN_APPROVAL.
- Response `{ claim_id, status }`.

**Back-office-only notes.** When reused by TeVerification and TeStaffHome, the screen is identical. The finance-stage parts (Verify/Hold verbs, flag Dismiss/Confirm, internal timeline entries since `staff = true`) appear wherever `can.stage === 'finance'` and the viewer may act. In ESS that means a Finance-team employee (G2). The back button still reads "Approvals" there.

---

## Leg evidence (components/te/approve/TeLegEvidence.tsx)

**Purpose.** Shows the evidence behind one journey (leg) of the claim's trip: the planned route on a map and the GPS numbers the server derived. It gives no verdict.

**Reached from.** TeClaimApproval → "Journeys on this trip" row → `setEvidence(leg.id)`. TeClaimApproval then returns `<TeLegEvidence leg={openLeg} places={places} onBack={() => setEvidence(null)} />` in place of itself. The half-made decision draft is kept, because the state lives in TeClaimApproval.

**Props.** `leg: TeLeg` (from `TeClaimDetail.legs`), `places: Record<string, TePlaceBrief>` (from the trip detail; may be `{}`), `onBack()`.

**No API calls.** Everything comes from the leg.

**Layout, in order.**
1. Row: `btn sm` back (icon `back`) labelled `"Claim"`, then `<span class="mono muted">Journey {n}</span>`.
2. Header card:
   - `eyebrow` `"Journey {n}"`
   - `h1.tname` `"{places[from]?.s ?? ''} → {places[to]?.s ?? ''}"` (blank names when the places fetch failed)
   - muted: `mode`, then `" · started {when(startedAt)}"`, then `" · ended {when(endedAt)}"`, each only when set
   - right chips:
     - `"Added without GPS"` (`chip t-warn`) if `manual`
     - `"Check-ins"` (`chip plain`) if `gps === 'checkin'`
     - `chip t-warn` with the text of `noGps` when `noGps` is non-empty
3. If `leg.manual || !leg.stats`: a `flag warn` banner (icon `alert`):
   - title `"This journey was not recorded"` (manual) or `"No GPS record for this journey"`
   - body `noGps || skipReason || "It is paid on the planned distance rather than a measured one."`, plus `" The plan was {plannedKm} km."` when `plannedKm` is set

   Otherwise:
   - **Map card**: `<TeTripMap legs={[{from, to, mode}]} points={[from, to]} places={Map(id → {id, s, lat, lng})} label="Journey {n} on the map" />`. TeTripMap (components/te/plan/TeTripMap.tsx, documented by the trip-planning writer) draws real tiles via `TeGoogleRoute` (components/te/plan/TeGoogleMap) when `hasMapKey()`, else an SVG schematic from `tripMapGeometry` (lib/te/trip-map.ts). It renders nothing when no place has a position. Below it, small muted: `"The straight line between the two places. The recorded trail itself is held against the leg and is what the distance below was measured from."`
   - **The GPS trail is NOT drawn.** The detail RPCs build legs with `te_leg_json(l, false)`, so `track` is always `[]`. TeLegEvidence never uses `track` or `stops` and does not decode any polyline. Only the from→to line is drawn. Parity requires only that line plus the numbers.
   - **Tiles** (`g6 five`, each tile is `.tile` with `.l` label, `.v num` value, `.s` note):

     | label | value | note |
     |---|---|---|
     | GPS distance | `{r1(stats.gpsKm)} km` | "measured by the phone" |
     | Planned | `{r1(plannedKm)} km` | "shortest route" |
     | Paid on | `{r1(stats.payBase)} km` | "after the checks" |
     | Time | `{stats.dur} min` | `"{stats.moving} min moving"` |
     | Average speed | `{r1(stats.avg)} km/h` | `"peak {r1(stats.maxSp)} km/h"` |

     `r1(n) = Math.round((n ?? 0) * 10) / 10`.
   - **"What the checks found" card** (h3), `dl.kv`:
     - `"Points recorded"` = `stats.pings`
     - `"Gaps in the trail"` = `"{gaps}, longest {gapMaxMin} min ({r1(gapKm)} km)"` or `"none"`
     - `"Impossible jumps"` = `"{jumps} ({r1(jumpKm)} km)"` or `"none"`
     - `"Stops"` = `"{stops}, {stopMin} min in all"` or `"none"`
     - `"Started from"` = `"{round(startOff)} m from the place"` or `"—"` when `startOff == null`
     - `"Ended at"` = `"{round(endOff)} m from the place"` or `"—"`

     When there are gaps or jumps, a `note` (icon `info`): `"A phone browser stops reading location when the screen locks or another app comes forward, so a gap is as often a pocketed phone as anything else. The employee can be asked."`
4. If `leg.expenseId`: card `"What was claimed for it"` (h3), `dl.kv`:
   - `"Paid on"` = `"{r1(payKm ?? 0)} km"`
   - `"Shortest route"` = `"{r1(routeKm)} km"`, only when `routeKm != null`

`TeLegStats` fields used: `gpsKm, payBase, dur, moving, avg, maxSp, pings, gaps, gapMaxMin, gapKm, jumps, jumpKm, stops, stopMin, startOff, endOff`. These are computed by the engine and server, not the client.

Browser APIs: none directly. Google Maps JS is used only inside TeTripMap/TeGoogleMap.

---

## lib/te/claim-decide.ts (pure helper)

**Dependencies.** None. It has only `import type { DecideInput, Uuid } from './types.ts'`, so the RN app can import it directly. The `.ts` extension on the type import may need bundler support.

```ts
export type DecideAction = 'approve' | 'verify' | 'hold' | 'sendback' | 'reject'
export interface LineDecision { amount?: number; reject?: 'final' | 'refile'; reason?: string }
export interface DecisionDraft { comment: string; lines: Record<Uuid, LineDecision>; fix: Uuid[] }
export const emptyDecision = (): DecisionDraft => ({ comment: '', lines: {}, fix: [] })
```

- `actionsForStage(stage: 'manager'|'finance'|null): {action, label}[]`
  - `'finance'` → `[verify 'Verify', hold 'Hold', sendback 'Send back', reject 'Reject']`
  - anything else (manager or null) → `[approve 'Approve', sendback 'Send back', reject 'Reject']`
- `isTouched(d?: LineDecision): boolean` = `!!d && (d.amount !== undefined || !!d.reject)`
- `decidedTotal(lines: {id, eligible}[], decisions): { total, cut, rejected }`. For each line:
  - rejected → `rejected += eligible` (contributes 0 to total);
  - amount set → `a = max(0, amount)`, `total += a`, `cut += max(0, eligible - a)`;
  - otherwise → `total += eligible`.

  All three results are rounded to 2 decimals: `Math.round(n*100)/100`.
- `whyNotReady(action, draft, lines): string`. Returns `''` when the decision can be sent. Checks in this exact order:
  1. sendback with empty `comment.trim()` → `"Say what needs fixing. The employee sees this and nothing else."`
  2. reject with empty comment → `"A rejected claim needs a reason."`
  3. hold with empty comment → `"Say why it is on hold, so whoever picks it up knows."`
  4. for each touched line, in insertion order:
     - empty `reason.trim()` → `"Say why the line is refused."` (if reject) or `"Say why the amount was changed."`
     - amount set and (`!isFinite(amount)` or `< 0`) → `"An approved amount cannot be negative."`
     - amount set and `> line.eligible` → `"A line cannot be approved above its eligible amount of {eligible}."` (plain number, no ₹)
  5. sendback with `fix.length === 0` and no touched lines → `"Mark at least one line to fix, so the employee knows where to look."`

  A Reduce left at the eligible amount still counts as touched and still needs a reason.
- `toDecideInput(action, draft): DecideInput`. Builds `decisions` only from touched lines. Each entry has `amount` if set, `reject` if set, and `reason` (trimmed) if non-empty. The result includes:
  - `comment` (trimmed) if non-empty
  - `decisions` if any
  - `fix` only when `action === 'sendback'` and `fix.length`
- `describe(action, draft, lines): string`
  - reject → `"The whole claim is refused. Nothing is paid."`
  - hold → `"Parked for an audit. The employee is not asked for anything yet."`
  - sendback → `"Goes back to the employee with {n} line to fix."` / `"… {n} lines to fix."` when lines are marked, else `"Goes back to the employee."`. Only `fix` is counted, not touched lines.
  - approve/verify with no cut and no rejection → `"Passes as it stands."`
  - otherwise → `"{Verifies|Approves} {total}, with {cut} cut and {rejected} refused."`, including only the parts that are non-zero. Numbers are plain (no ₹, no grouping), e.g. `"Approves 2350, with 150 cut."`.

## lib/te/flag-review.ts (pure helper)

**Dependencies.** No imports at all. Safe for RN.

```ts
export type FlagVerdict = 'dismissed' | 'confirmed'
export interface FlagOffer { verdict: FlagVerdict; label: string; effect: string; grave: boolean }
```

- Offers:
  - DISMISS = `{ verdict: 'dismissed', label: 'Dismiss', grave: false, effect: 'The check was wrong about this claim. The flag stops counting against it, and your reason is kept on the flag.' }`
  - CONFIRM = `{ verdict: 'confirmed', label: 'Confirm', grave: true, effect: 'The check was right. The flag stays on the claim and counts towards its risk.' }`
- `isFlagOpen(status) = status === 'open'`
- `openFlags(flags) = count where status === 'open'`
- `flagOffers(status, stage, mayAct)` → `[]` unless `mayAct && stage === 'finance' && status === 'open'`; then `[DISMISS, CONFIRM]`
- `flagNoteRequired(verdict) = verdict === 'dismissed'`
- `whyFlagNotReady(verdict, note)` → for a dismissal with empty `note.trim()`: `"Say why the check was wrong. The flag report counts dismissals, and one with no reason cannot be told from a check that should be switched off."`; otherwise `''`. As noted above, the server requires a note for Confirm too.
- `flagResolvedText(status, note)`:
  - dismissed → `"Dismissed: {note}"` or `"Dismissed."`
  - confirmed → `"Confirmed: {note}"` or `"Confirmed."`
  - otherwise → the trimmed note
- `flagTone(status, blocking)`:
  - dismissed → `'plain'`
  - confirmed → `'t-crit'`
  - open/other → `'t-crit'` if blocking, else `'t-warn'`

---

## API summary for this part

All calls go through `te` in lib/te/client.ts.

| client fn | method + path | body | response used |
|---|---|---|---|
| `te.queue()` | GET `/api/te/queue` | none | `{ queue: TeQueueRow[] }` → rows |
| `te.trip(id)` | GET `/api/te/trips/{id}` | none | `TeTripDetail` (trip screen); `.places` only (claim screen) |
| `te.claim(id)` | GET `/api/te/claims/{id}` | none | `TeClaimDetail` |
| `te.tripDecide(id, action, comment?)` | POST `/api/te/trips/{id}/decide` | `{action, comment}` | ignored (`{trip_id, status}`) |
| `te.claimDecide(id, action, o)` | POST `/api/te/claims/{id}/decide` | `{action, comment?, decisions?, fix?}` (+ optional `stage`, never sent) | ignored (`ClaimResult`) |
| `te.flagResolve(id, status, note)` | POST `/api/te/flags/{id}` | `{status, note}` | ignored (`{flag_id, status, risk_band}`) |
| `te.fileUrl(path, claimId)` (via TeFileLink) | GET `/api/te/upload?path=&claim_id=` | none | `{url, expires_in}` |
| `te.claimReopen(id, reason)` | POST `/api/te/claims/{id}/reopen` | `{reason}` | back office only |

Status codes for the refusals above: TE_FORBIDDEN is 403. TE_NOT_WAITING, TE_COMMENT, TE_DECISION, TE_TRIP, TE_CLAIM and TE_FLAG are 409. Route validation errors are 400.


---

# Part 7 — `lib/te` / `lib/travel` module inventory: what React Native can import

The repo's `tsconfig.json` sets `"allowImportingTsExtensions": true` and `"moduleResolution": "bundler"`. The pure modules import each other with explicit `.ts` extensions (`from './types.ts'`), so an RN/Metro project that copies or links them needs either the same TS option or a Babel resolver that accepts `.ts` specifiers. Each of these files has a unit test in `lib/te/__tests__/*.test.ts`. Port the tests along with the files.

## 7.1 Pure: import into RN as they are

Each imports only types or other pure modules. None uses browser, React, Next or Supabase APIs.

| Module | Import lines | What RN uses it for |
|---|---|---|
| `lib/te/types.ts` | none (types only) | every request/response shape |
| `lib/te/format.ts` | `import type { TeClaim, TeFlag, TeClaimFlag, TeStep } from './types.ts'` | `rs`, `day`, `when`, `plural`, `claimChip`, `claimHolder`, `currentStep`, `flagClass`, `errorText`, `todayIst`, type `Tone` |
| `lib/te/entry-flow.ts` | `import type { IsoDate, TeLeg, TeTrip, TripScope, Uuid } from './types.ts'` · `import { day, plural } from './format.ts'` | Continue rows, ways, `wayOff`, `flowSteps`, `KIND_NAME`, `legsOf`, `legTitle`, `routeText`, `tripDates`, `currentLeg`, `approvedTrips` |
| `lib/te/trips-list.ts` | `import type { TeClaim, TeExpense, TeTrip, TripDisplayStatus, TripScope, Uuid } from './types.ts'` · `import type { Tone } from './format.ts'` · `import { onTrip } from './co-traveller.ts'` | trips list grouping/sorting, `tripChip` (Part 4) |
| `lib/te/co-traveller.ts` | `import type { TeTripPerson, Uuid } from './types.ts'` | `isCoTraveller`, `canBillTrip`, `coTravellerNote`, `myClaims`, `withText`, `onTrip` (Parts 3/4) |
| `lib/te/trip-draft.ts` | `import type { IsoDate, TeMode, TeStayOption, TripDraft, TripIssue, TripOrigin, TripPattern, TripScope, Uuid } from './types.ts'` · `import { emptyStayOption, usableStayOptions, type StayOption } from './trip-stay.ts'` | the planner's in-progress state -> `TripDraft` (Part 3) |
| `lib/te/trip-stay.ts` | `import type { IsoDate, TeExpense, Uuid } from './types.ts'` | stay options, food budget/balance, stay decision text (Parts 3/4) |
| `lib/te/trip-map.ts` | `import type { TripScope } from './types.ts'` | the keyless schematic trip map layout (Part 3) |
| `lib/te/map-links.ts` | `import type { TripScope } from './types.ts'` | deep links to Google Maps (Part 3) |
| `lib/te/leg-tracking.ts` | `import type { GpsPing } from './types.ts'` | the GPS fix queue. Storage is injected ("anything resembling localStorage"), so RN passes an adapter over AsyncStorage/MMKV (Part 4) |
| `lib/te/vehicle.ts` | `import type { RcChecked, TeVehicle, TeVehicleType } from './types.ts'` · `import { day } from './format.ts'` | `ratePerKm`, `rcMarks`, `vehicleSubtitle`, `WHOSE_LABEL` (Part 5) |
| `lib/te/claim-decide.ts` | `import type { DecideInput, Uuid } from './types.ts'` | approver line decisions -> `DecideInput` (Part 6) |
| `lib/te/flag-review.ts` | none | resolving a flag (Part 6) |
| `lib/te/engine/te-engine.js`, `te-adapter.js` (+ `.d.ts`) | CommonJS `require('./te-engine.js')`, no other deps | **Not needed on the client.** The server runs every preview. It is pure ("No database, no network, no clock"), so it could run on device for offline previews later. The web app does not do that. |

Staff-only pure modules, not needed for the employee app: `lib/te/admin-edit.ts` (type import), `lib/te/finance-desk.ts`, `lib/te/csv.ts`.

## 7.2 Not importable as is (web/server bound)

| Module | Why | RN replacement |
|---|---|---|
| `lib/te/client.ts` | imports `authHeaders, uploadAuthHeaders` from `@/lib/auth-headers` (which imports `@/lib/supabase` and `@/lib/ess-session-client`, both reading `localStorage`). It calls relative URLs `fetch('/api/te/...')`. `te.upload` takes a DOM `File`. `admin.reportCsv` uses `window.location.origin` | Copy the file. Change `call()` to prefix an absolute base URL (`https://<host>/api/te/`). Swap `authHeaders()` for a SecureStore token reader. Change `upload()` to append `{ uri, name, type }` to RN `FormData`. Keep `TeApiError` and every `te.*` signature unchanged. |
| `lib/auth-headers.ts`, `lib/ess-session-client.ts` | `localStorage`, `atob`, Supabase browser client | reimplement: read the token, decode the base64url payload, check `exp` (ms) with a 30 s skew |
| `lib/te/errors.ts` | pure, but server-side (`TeHttpError`, `mapTeError`) | not needed. Only the error-body shape matters (Part 1.2) |
| `lib/te/server.ts`, `lib/te/providers/*.ts`, `lib/te/admin.ts` | `next/server`, `@supabase/supabase-js` (service role), `node:crypto`, `process.env` | server only |
| `lib/travel/*` | the older v1 travel module. `access.ts` (supabase), `actor.ts` / `errors.ts` (next/server). `calc.ts`, `gps.ts`, `polyline.ts`, `types.ts` are pure but **not used by the T&E v2 screens** (only `lib/travel/actor.ts` is used, server side, to resolve the ESS caller) | none needed. `/api/travel/*` routes serve the old ESS "claims" tab (`components/ess/TravelClaims.tsx`) and are outside this module |

## 7.3 Direct Supabase queries

**None from the client.** The T&E browser code never touches Supabase. Migration 151 locks the anon/browser key out of every `te_*` table and function. Every read and write goes through `/api/te/*`, which uses the service-role client server side.

The routes make only these table reads themselves; the rest are RPCs:

- `employees.company_id` by id (company resolution)
- `te_settings.company_id` (seeding check)
- `te_claims.status` by id (stage resolution in `claims/[id]/decide`)
- `te_expense_files.id where storage_path = ? and expense_id in (?)` (file access check in `GET /api/te/upload`)
- `<table>.company_id` by id (`teStaffFor`)

Storage: bucket `onboarding-docs`, path `te/bills/<employee id>/<KIND>_<epoch ms>_<safe file name>`, read through signed URLs only.

---

# Part 8 — Implementation notes for React Native (Expo)

## 8.1 Browser APIs the web module uses, and their RN equivalents

| Web API (file) | Exact use | RN / Expo replacement |
|---|---|---|
| `navigator.geolocation.watchPosition` (`leg/TeLegLive.tsx`) | `{ enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }`. Every delivered fix is processed. Only `PERMISSION_DENIED` is handled. | `expo-location` `watchPositionAsync({ accuracy: Accuracy.BestForNavigation \| High, timeInterval: ~5000, distanceInterval: ~10 })` in the foreground. For background, `startLocationUpdatesAsync(TASK, {...})` with `expo-task-manager` (8.2). |
| `navigator.geolocation.getCurrentPosition` | start, stop and end fixes (`TeLegLive`, `TeStartNow`): `{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }`. Place picker "Use my location": `{ enableHighAccuracy: true, timeout: 12000 }`. Google map "Use my location": `{ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }` | `Location.getCurrentPositionAsync({ accuracy: High })`, plus your own timeout wrapper with the same ms values. Keep the exact error sentences (Part 4). |
| `localStorage` | ESS session `ezer_ess_session` (token). Ping queue `te.leg.<legId>.pings` (JSON `GpsPing[]`) | Token: `expo-secure-store`. Ping queue: MMKV or AsyncStorage behind the `PingStore` interface of `lib/te/leg-tracking.ts` (`getItem/setItem/removeItem`; make them sync with MMKV, or adapt to async). For background recording, prefer SQLite (`expo-sqlite`) so the background task and the UI share one queue safely. |
| `window` `online` / `pagehide` events | flush the ping queue | `@react-native-community/netinfo` (on reconnect) and `AppState` `background` -> flush |
| `setInterval(15000)` | clock + periodic flush while running | same in the foreground; in the background the location task is the timer |
| `<dialog>.showModal()` (`TeSheet`) | modal drawer, Escape closes | RN `Modal` or a navigation modal stack. The Android back button = onClose. |
| `<input type=file accept="image/*,.pdf">` (expense form), `accept="image/*,application/pdf"` (journey report, vehicle RC). No `capture` attribute, no client compression, no HEIC conversion (`heic2any` is in package.json but used only by `components/profile/PhotoUploader.tsx`, not T&E) | `expo-image-picker` (camera + library) and `expo-document-picker` (PDF). Upload `FormData` `file = { uri, name, type }`, `kind`. The server limit is 10 MB and the server sniffs the bytes (JPEG/PNG/WebP/HEIC/HEIF/PDF only), so HEIC from iOS is accepted as is. Recommended: downscale photos to about 2000 px JPEG q≈0.7 with `expo-image-manipulator` to stay well under 10 MB. Not done on the web, so optional. |
| `fetch` multipart with no Content-Type (`te.upload`) | the browser writes the boundary | RN `fetch` with a `FormData` body and no manual Content-Type, same rule |
| `window.open(url)` (`TeFileLink`) | opens the 1-hour signed URL of a bill | `expo-web-browser` `openBrowserAsync(url)`, or an in-app PDF/image viewer. Fetch the URL fresh each time (`GET /api/te/upload?path=&claim_id=`): it expires in 3600 s. |
| `<a target=_blank>` map links (`TeMapLinks`, `lib/te/map-links.ts`) | Google Maps / Apple Maps directions URLs | `Linking.openURL(url)`. The URL builders in `map-links.ts` are pure and can be reused. |
| Google Maps JS (`plan/TeGoogleMap.tsx`) | script `https://maps.googleapis.com/maps/api/js?key=${NEXT_PUBLIC_GOOGLE_MAPS_KEY}` (no `libraries` param), injected once as `<script id="ezer-gmaps">`. A draggable pin map (zoom 15, height 260) and a route map (markers A, B, C… + polylines) | `react-native-maps` with `PROVIDER_GOOGLE` (Android needs a Maps SDK key in `app.json` `android.config.googleMaps.apiKey`; iOS can use Apple Maps or a Google key). Draggable `Marker` + `onPress`/`onDragEnd` -> lat/lng. `Polyline` for journeys, `fitToCoordinates` for bounds. The keyless schematic (`TeTripMap`, `lib/te/trip-map.ts`) is the fallback when no key is set; it can be drawn with `react-native-svg` from the pure geometry in `trip-map.ts`. |
| `toLocaleString('en-IN')` (`rs`) | Indian digit grouping | needs Intl on Hermes (default in recent Expo). Otherwise hand-write the lakh grouping. |
| `window.location` (`app/ess/travel/page.tsx`, `TeHome.claimFromLink`) | login redirect, exit to ESS, deep link `?tab=claims&ref=<uuid>` | navigation + deep links (`expo-linking`): map `…/ess/travel?tab=claims&ref=<id>` and push payloads to Claim detail |

## 8.2 Background location: the main reason for a native app

The web recorder stops whenever the screen locks or the app is backgrounded, and says so on screen. The server then flags the gaps (G4) and the employee has to explain them. The RN app should keep recording through screen lock and app switching:

- **Permissions:** foreground first (`requestForegroundPermissionsAsync`), then background (`requestBackgroundPermissionsAsync`). On Android 10+ that is "Allow all the time"; on iOS, "Always".
  - Ask only when the employee starts a `track`-mode journey. A check-in journey needs only foreground fixes at start and end.
  - If background is refused, fall back to the web behaviour: foreground only, the "Keep this screen open" note, and the gap warning.
- **iOS:** `UIBackgroundModes: ["location"]`, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`. Use `showsBackgroundLocationIndicator: true` and `pausesUpdatesAutomatically: false`. Set `activityType` to `AutomotiveNavigation` or `OtherNavigation`.
- **Android:**
  - Permissions: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (API 34).
  - A foreground-service notification is mandatory: `foregroundService: { notificationTitle: 'Journey <n> is being recorded', notificationBody: '<from> → <to>' }`.
  - Ask the user to exempt the app from battery optimisation on aggressive OEMs.
- **Task design.** One `TaskManager.defineTask('te-leg-track', …)` registered at module scope:
  - Each delivery: apply `acceptFix` (accuracy ≤ `cfg.track.minAccuracy`, default 50 m), convert with `toPing`-equivalent fields `{lat, lng, accuracy_m, speed_kmh: speed*3.6 rounded, recorded_at: ISO(timestamp), is_mock: mocked}`, then append to the persisted queue (dedupe by `recorded_at`).
  - Flush with `shouldFlush` (≥ 20 queued, or `cfg.track.pingSec` s since the last send, default 30). Send batches of ≤ 200 (server max 5000) to `POST /api/te/legs/:id/action {action:'pings'}`. Remove only what was acknowledged.
  - Use `timeInterval` ≈ 5 s and `distanceInterval` ≈ 10–20 m. Use `deferredUpdatesInterval` ≈ `pingSec` to save battery.
  - The server does its own gap detection (no fix for more than `gapMin` = 5 min; 30 min on train or bus), jump detection (above 130 km/h) and start/end radius checks. Sampling must therefore be dense enough that a moving vehicle never goes 5 minutes without a fix.
  - Keep the active leg id and the auth token where the task can read them (SecureStore / MMKV). Stop the task on End, on leg-not-running errors ("This journey is not recording."), and on sign-out.
- **Offline.** Fixes persist in the queue and are sent on reconnect (NetInfo) or at the next delivery. Add exponential backoff; the web has none. Before End, always flush first, then send the end fix: pings after `ended_at` are dropped by the server, and the queue can still be flushed after End until the report is filed.
- **Stops and continue** need a fresh fix (`stop`) and nothing for `continue`. Stops are refused for modes whose `cfg.modes[].stops` is false, so hide the button for those.
- **Mock locations:** send `is_mock` (Android `coords.mocked` / `location.mocked`) on start and on pings. Optionally send `device: {platform, osVersion, model, appVersion}` on start. Both are stored; the web sends neither.
- **One running journey per employee:** the server enforces this ("End the journey that is running first."). Resume recording on app launch when `snap.journeys` has one of mine ACTIVE/PAUSED, i.e. restart the task if the OS killed it. Show the live bar until it ends.

## 8.3 Maps and keys

| Key | Where | Used for |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | web build (public) | Maps JavaScript API in the planner / place picker / trip map. Absent -> the keyless schematic map is shown. |
| `GOOGLE_MAPS_API_KEY` | server only | Directions (road km, minutes, polyline; `lib/te/providers/routes.ts`, 8 s timeout, `region=in`, driving), Geocoding and reverse geocoding (`providers/geocode.ts`) for `POST /api/te/places`. The app never calls these directly. |
| `TE_RC_PROVIDER` | server only | Vahan RC lookup (`mock` in non-production; none today means employees attach an RC photo) |
| `TE_OCR_PROVIDER` | server only | bill OCR. Not implemented today: `ocr` is always null, so employees type amounts. |

RN map needs: a draggable pin picker; a route view with lettered markers and journey polylines; optionally the recorded GPS track for the approver's journey evidence (Part 6, `TeLegEvidence`). Road distances always come from the server. Do not compute payable km on the device.

## 8.4 Networking and state

- Base URL: the web uses relative `/api/te/...`. RN needs `https://<deployment>/api/te/...` (`NEXT_PUBLIC_APP_URL`, e.g. `https://ezer-hrms-chi.vercel.app`). Every route is `force-dynamic` + nodejs runtime. Responses are uncached; send `cache: 'no-store'` semantics (no HTTP cache).
- Reproduce the web's state model: one `Snapshot` (`GET /api/te/me`) plus `queue` (`GET /api/te/queue`), refetched after every mutation. Trip and claim detail are fetched per screen and **must be refetched after child actions** (the web has stale-detail bugs; Part 4).
- Debounced previews:
  - trip preview: TePlanner (see Part 3) and TeStartNow, 350 ms;
  - journey report preview: 350 ms;
  - expense preview: see Part 5.
  Drop late answers to older requests (the `current` flag pattern).
- Errors: show `TeApiError.message`. Use `field` to mark a form field, `flags` to list blockers, `issues` for trip-plan problems. On 401, route to the ESS login.
- Dates: use `snap.today` (company IST date) for "today" logic. `when()` formats in fixed IST (+5:30) whatever the device time zone.
- Permissions summary for app.json:
  - location (when-in-use and always, with usage strings);
  - camera and photo library (bills, RC);
  - notifications (optional: claim sent back, approval waiting; deep links `claims/<id>`);
  - Android foreground service (location).
- Accessibility parity: the web uses `aria-current` on nav, `aria-pressed` on chips and segments, and `aria-live` on toasts. Map these to `accessibilityState` / `accessibilityLiveRegion`.
