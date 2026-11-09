# 08 — Inbox, Social (Wall of Fame + celebrations), Fun Zone, RNR

Spec for rebuilding the employee-facing **Inbox**, **Social**, **Fun Zone** and **RNR** sidebar sections of the ESS portal (`components/ess/EmployeePortal.tsx`) as a React Native (Expo) app, with exact functional parity.

Everything below was read from source on branch `feat/mobile-app` (Oct 2026). File paths are relative to the repo root `/Users/girish/Documents/ezer-hrms`. Copy strings are quoted exactly as they are in the source, curly quotes included. Where the code has a quirk or a bug, the spec says so and does not quietly fix it.

---

## 0. Cross-cutting

### 0.1 How the portal mounts these sections

`components/ess/EmployeePortal.tsx` (`SECTIONS`, `renderView()`):

| Rail key | Label (`short`) | Rail icon (`ESS_ICON`) | status | `desc` (TabHeader subtitle) | Render |
|---|---|---|---|---|---|
| `inbox` | Inbox (`Inbox`) | `IconMail` (an envelope, not the bell) | ready | "Messages from colleagues and teams, and every notification in full" | `<InboxShell employeeId={emp.id} firstName={emp.first_name \|\| emp.full_name.split(' ')[0]} onUnread={setUnread} />` |
| `social` | Social (`Social`) | `IconHeart` | ready | "Birthdays, work anniversaries, new joiners and the Wall of Fame" | `<Social employeeId={emp.id} />` |
| `rnr` | RNR (`RNR`) | `IconAward` | **soon** | "Reward and recognise great work with points you can redeem" | `<FeatureGrid features=…/>` (see §7) |
| `funzone` | Fun Zone (`Fun`) | `IconGame` | ready | "Take a break: play a quick game with your team" | `<FunZone employeeId={emp.id} />` |

- Rail grouping (`NAV_GROUPS`): `inbox` sits in the first, unlabelled group with `home`. `social`, `rnr` and `funzone` are in the group labelled **"Community"**, in that order.
- A `soon` section shows a quiet **"Soon"** tag in the rail (`.ess-soon`) and in the phone "More" sheet. Its TabHeader shows a **"Coming soon"** chip (`.ess-head-chip`).
- Phone bottom bar (`MOBILE_PRIMARY`): `home, payroll, attendance, leave` plus **More**. Inbox, Social, RNR and Fun Zone are reached only through **More** (a bottom sheet with the same groups as the rail, two-column tiles).
- Each of these sections has a single item, so the portal draws no sub-tab pill row (`SubTabs` returns null below two items). Social and the Inbox draw their own tabs.
- Page chrome differs per section:
  - **Inbox**: a full-bleed tab. The portal draws `TabHeader` (icon tile, `<h1>Inbox</h1>`, the `desc` line) with padding `16px` on a phone or `22px` on desktop, then the shell. The shell sizes itself to the viewport.
  - **Fun Zone**: no portal TabHeader. Fun Zone draws its own hero.
  - **Social / RNR**: the standard padded page (`16px 14px` phone, `24px 28px 40px` desktop): TabHeader, then the content.
- Feature-search keywords (`FeatureSearch`): inbox → `'messages notifications mail'`, social → `'social wall fame appreciate'`, funzone → `'games fun zone'`.
- Deep links: `lib/today/schema.ts` routes `wall` and `appreciate` now point to `tab:social`. There is no `wall` view key any more.

### 0.2 The bell vs. the Inbox count

In the portal header, `NotificationBell` shows `unread` as a red pill (`C.critical` on `C.onAccent`, 17px, "9+" above 9).

`refreshUnread()` runs on portal mount and after the bell panel changes. It calls both endpoints and **adds** them:

```
GET /api/ess/notifications?employee_id=<id>   → j.unread
GET /api/ess/inbox?employee_id=<id>           → ji.unread, counted only if ji.installed
total = Number(j.unread) + (ji.installed ? Number(ji.unread) : 0)
```

- If the notifications call is not ok, the badge is left as it was.
- A failing inbox call is ignored.
- Headers: `essAuthHeaders()` (the ESS token). If there is no ESS token, the Supabase session `access_token` is used as the Bearer.

While the Inbox tab is open, `InboxShell` calls `onUnread(n)` → `setUnread(n)` with the **Messages count only**. The bell then **shows only the inbox number** until `refreshUnread` runs again. Wall and Broadcast counts never reach the bell. (This replace-not-add behaviour is a quirk of the source; keep it, or fix it on purpose.)

### 0.3 Auth on every API call

- `lib/auth-headers.ts`:
  - `authHeaders()` is **async**. It returns `{ 'Content-Type':'application/json', Authorization:'Bearer <ESS token>' }` when the ESS token in `localStorage['ezer_ess_session']` is present and unexpired.
  - Otherwise it uses a Supabase session token. It refreshes the token when it is within 30 s of expiry.
  - With no session at all it returns only Content-Type.
  - `uploadAuthHeaders()` is the same without Content-Type, for FormData.
- In RN, replace this with: the stored ESS token, plus a check on `exp` with 30 s of skew. The Supabase-session fallback exists only for admins previewing a portal on the web.
- Every ESS route goes through `essRoute(req)` (`lib/ess/session.ts`):
  - The caller is resolved from the token.
  - `employee_id` (query or body) is honoured only when it equals the caller's own id, or when the caller has admin access. That case is "view as": `viewAs: true`, and writes are refused.
  - Errors:
    - `{ error: 'You can only open your own portal.' }` 403.
    - `{ error: 'employee_id is required for the dashboard login.' }` 400.
    - 401 from `requireDashboardUser`.
    - `essContext` failure → 500 `{ error: 'ess_menu: … Has migration 071 been run?' }`.
- **RN: always send `employee_id=<own id>`** in the query (GET) or body (POST), as the web does.

### 0.4 Design tokens

Colours come from `@/lib/ui` (`C.*`, mapped to `var(--ez-*)`):

- `C.canvas`, `C.surface`, `C.sunken`
- `C.line`, `C.lineStrong`
- `C.ink`, `C.inkSoft`, `C.muted`, `C.faint`
- `C.brand`, `C.brandDeep`, `C.brandTint`, `C.brandEdge`, `C.onAccent`
- `C.positive`, `C.warning`, `C.critical`, `C.info`, each with `…Tint` and `…Edge`

The inbox stylesheet also defines `--ez-gold: #C2751B` (light) / `#E0A24A` (dark). It is used for stars, "You staff this", and Wall-of-Fame unread cards.

Folder colours are **measured pairs** in `lib/inbox/streams.ts` (§1.3). Use the light value in the light theme and the dark value in the dark theme. Never re-pick them by eye.

### 0.5 Pure modules RN can import directly (no supabase / next / DOM)

| Module | What it gives you | Import |
|---|---|---|
| `lib/inbox/streams.ts` | `STREAMS`, `STREAM`, `streamInk`, `streamLabel`, `streamFor(code)` | `import { STREAMS, STREAM, streamFor, streamInk, streamLabel, type StreamCode } from '@/lib/inbox/streams'` |
| `lib/inbox/errors.ts` | `notInstalled(err)` | `import { notInstalled } from '@/lib/inbox/errors'` |
| `components/ess/inbox/adapter.ts` | `toFolders`, `toConversation`, `toMessage`, `toNote`, `toDirectory` (server row → view model). Imports only `streams.ts` and types | `import { toFolders, toConversation, toMessage, toNote, toDirectory } from '@/components/ess/inbox/adapter'` |
| `components/ess/inbox/selectors.ts` | `selectConversations`, `matches`, `byNewestFirst`, `messagesUnread`, `unreadByFolder`, `catchUpBuckets`, `newDividerIndex` | `import { selectConversations, catchUpBuckets, newDividerIndex } from '@/components/ess/inbox/selectors'` |
| `components/ess/inbox/time.ts` | `relTime`, `dayLabel`, `exactTime`, `withinGroupWindow`, `initials`. Uses `toLocaleDateString('en-IN', …)`: make sure Hermes has Intl (Expo SDK ≥ 50 does) | `import { relTime, dayLabel, exactTime, withinGroupWindow, initials } from '@/components/ess/inbox/time'` |
| `components/ess/inbox/types.ts` | All view-model types | `import type { ConversationVM, MessageVM, NoteVM, FolderVM, DirectoryVM, WallItemVM, BroadcastVM } from '@/components/ess/inbox/types'` |
| `lib/broadcast/channel.ts` | `PRIORITY_LABEL`, `PRIORITY_MEANING`, `canRespond`, `canPublish`, `canReadResponse`, `ordered`, `unreadCount`, `checkDraft`, `audienceLine`, `REPLIES_DISABLED` | `import { ordered, unreadCount, canRespond, PRIORITY_LABEL, type Broadcast, type Priority } from '@/lib/broadcast/channel'` |
| `lib/wall/inbox.ts` | `STREAM_OF`, `STREAMS` (wall), `headlineFor`, `glyphFor`, `countFor`, `countsReconcile` | `import { STREAM_OF, headlineFor, countsReconcile, type Stream, type WallEvent, type Counts } from '@/lib/wall/inbox'` |
| `components/ess/social/types.ts` | Social payload types | `import type { SocialPayload, SocialPost, SocialComment, Reaction, SocialTab, SocialKind } from '@/components/ess/social/types'` |
| `components/ess/social/mock.ts` | `REACTIONS`, `GIF_PACK`, `WISH_SUGGESTIONS` (and `MOCK`, a design payload). Pure; uses `Date.now()` only for the mock | `import { REACTIONS, GIF_PACK, WISH_SUGGESTIONS } from '@/components/ess/social/mock'` |
| `lib/notifications/catalogue.ts` | `def(code)` → `{label, audience, priority, email, link}`, `isHigh(code)` | `import { def, isHigh } from '@/lib/notifications/catalogue'` |

Pure functions inside files that are **not** importable, because those files are `.tsx` with DOM/CSS:

- `components/ess/social/PostCard.tsx`: `toggle()`, `ago()`, `when()`, `kindStyle()`, `hue()`. Copy them.

**Not importable:**

- `lib/inbox/actions.ts`, `lib/wall/rpc.ts`, `lib/auth-headers.ts`: they import the `supabase` client. Reimplement them in about 20 lines each.
- `lib/inbox/server.ts`, `lib/notifications/derive.ts`, `lib/notifications/dispatch.ts`, `lib/ess/session.ts`: server-only, service role.
- All `*.css`.

---

## 1. INBOX (`components/ess/inbox/InboxShell.tsx`)

### 1.1 Shell

**Purpose.** Three inbox groups, each with its own unread badge. The counts are **never summed**. Only the Messages count goes up to the portal bell.

**Layout, top to bottom** (`<main class="ib">`, wrapped in `<ToastHost>`):

1. **Group segmented control** (`role=tablist`, "Inbox groups"). A sliding pill sits under the active tab. Three tabs, each `icon + label + count bubble`; the bubble is hidden when 0:

   | id | label | icon | blurb (shown under the control, `aria-live`) |
   |---|---|---|---|
   | `messages` | Messages | chat bubble | "Conversations with colleagues and desks" |
   | `wall` | Wall of Fame | star | "Notes, comments and replies about your recognition" |
   | `broadcast` | Broadcasts | megaphone | "Company-wide notices. Read only. Nobody replies in public" |

   - The count bubble on the active tab is `C.brand` on `C.onAccent`.
   - It replays a "tick" bump animation whenever the value changes.
2. **"Updated {ago}"** with a pulsing dot. Tooltip: "Polled every 20 seconds". Hidden ≤760 px.
   - `ago` is recomputed every 5 s from the last successful Messages poll:
     - under 15 s → `just now`
     - under 60 s → `{s}s ago`
     - otherwise → `{round(s/60)}m ago`
3. **Absent / error panels.** These show only when the Messages group is active.
   - **Absent** (`status==='absent'`). Glyph: megaphone-off. Heading: **"Not switched on yet"**. Text: `{reason || 'The inbox tables are not in the database yet.'} Your notifications still reach you on the bell in the meantime.`
     - The server's reason is `'The inbox tables are not in the database yet (migration 080).'`
   - **Error** (`status==='error'`). Glyph: bell-off. Heading: **"Could not open your inbox"**. Text: `{reason ?? 'The server did not respond.'} It will retry on the next poll.`
4. **Three panels.**
   - Messages is mounted immediately.
   - Wall and Broadcasts mount **on first visit** and then stay mounted. Switching tabs toggles `hidden` and does not unmount, so a half-typed reply survives.
   - Consequence: the Wall and Broadcast badges read **0 until their tab has been opened once**.

**Keyboard** (web only; optional in RN):

| Key | Action |
|---|---|
| `/` | Focus search |
| `c` | Compose |
| `↑` / `↓` | Move to the next or previous conversation (opens it) |
| `s` | Star (flag-gated) |
| `u` | Mark unread (flag-gated) |
| `Esc` | Blur the field, or close the thread |

The folder rail footer prints this legend: `/ search · c compose · ↑↓ move · s star · u unread · Esc back`.

**Toasts** (`ui.tsx` `ToastHost`): one toast at a time, bottom, `role=status`, auto-hides after **3200 ms**. An optional action button is supported but unused.

**Polling.** Messages has no realtime. Every **20 000 ms** it reloads the list, plus the open thread if there is one. Wall and Broadcasts load once on mount and **never poll**.

### 1.2 Feature flags (`components/ess/inbox/flags.ts`)

All of these are **OFF** in this repo: no `NEXT_PUBLIC_INBOX_*` value exists in `.env.example`, and the endpoints behind them do not exist. When a flag is off, the UI hides the control entirely.

| Flag | Env | Controls | Backend status |
|---|---|---|---|
| `conversationActions` | `NEXT_PUBLIC_INBOX_ACTIONS=1` | Star, Mute, Close/Reopen and Mark-unread buttons in the thread header; hover quick actions on rows; the `s` and `u` keys | Calls `PATCH /api/ess/inbox/conversation`, **which does not exist** (404) |
| `deleteOwnMessage` | `NEXT_PUBLIC_INBOX_DELETE=1` | Trash icon on own bubbles | Calls `DELETE /api/ess/inbox/messages?id=`. **No DELETE handler exists** (405) |
| `attachments` | `NEXT_PUBLIC_INBOX_ATTACHMENTS=1` | Paperclip, drag-drop, attachment chips | **No upload route or bucket.** Files are collected but never sent: `onSend` ignores `_files` |
| `markAllRead` | `NEXT_PUBLIC_INBOX_READ_ALL=1` | "Mark all read" in the list head | `POST /api/ess/inbox {action:'read_all', ids}`. The route has **no `read_all` branch** and answers 400 `Unknown action.` |
| `messageSearch` | `NEXT_PUBLIC_INBOX_SEARCH=1` | Only changes the search placeholder or label text | No `/api/ess/inbox/search` |

**RN: do not ship these controls.**

The backend **does** already support these POST actions: `read`, `mute`, `star` and `leave` (§1.9). No UI uses them today. If parity later needs star or mute, use them rather than the flagged `PATCH` endpoint.

### 1.3 Folders (`lib/inbox/streams.ts` `STREAMS`, in this order)

| code | label | hint | ink light | ink dark |
|---|---|---|---|---|
| DIRECT | Direct messages | People writing to you | #1F5BC1 | #588BE4 |
| HR | HR | Policy, records, letters | #6C2FB1 | #A576DB |
| PAYROLL | Payroll | Salary, payslips, tax, declarations | #1D7C4D | #51D694 |
| FINANCE | Finance | Claims, advances, reimbursements | #187991 | #47C2E1 |
| TIME | Leave & Attendance | Requests, approvals, regularisation | #2373A9 | #4DA2DB |
| PERFORMANCE | Performance | KRAs, reviews, ratings | #AF3181 | #D364AA |
| RECRUITMENT | Recruitment | Requisitions, candidates, offers | #A75C1B | #E18F47 |
| EXIT | Exit | Resignation, clearance, full & final | #B1402F | #D46E5E |
| IT | IT & Access | Accounts, roles, the portal itself | #497A29 | #89C95E |
| FUNZONE | Fun Zone | Game invites and scores colleagues shared | #115E59 | #3FC7BE |

**`streamFor(code)`** routes a notification `category` code to a folder. The longest prefix wins, and anything unmatched falls back to `HR`:

| Folder | Prefixes |
|---|---|
| TIME | LEAVE, ATTENDANCE, REGULARIS, HOLIDAY, SHIFT |
| PAYROLL | PAYSLIP, SALARY, PAYROLL, TDS, DECLARATION, PROOF, FLEXI, VPF, NPS, REGIME |
| FINANCE | TRAVEL, CLAIM, REIMB, ADVANCE, LOAN, INVOICE |
| PERFORMANCE | PMS, KRA, APPRAISAL, REVIEW, RATING, GOAL |
| RECRUITMENT | MRF, CANDIDATE, OFFER, INTERVIEW, ONBOARD, MAGIC_LINK |
| EXIT | RESIGNATION, EXIT, FNF, CLEARANCE, NOTICE_PERIOD |
| IT | ROLE, ESS, ACCESS, PASSWORD, LOGIN |
| FUNZONE | FUNZONE, GAME |

`BIRTHDAY`, `ANNIVERSARY` and `KUDOS*` go to `HR` explicitly, and null goes to `HR`.

**Folder glyphs for SYSTEM threads** (`icons.tsx` `FolderGlyph`):

| Folder | Glyph |
|---|---|
| TIME | Calendar with a tick |
| HR | Document |
| PAYROLL | Banknote |
| FUNZONE | Gamepad |
| PERFORMANCE | Line chart |
| Anything else | Bell |

### 1.4 Data layer (`components/ess/inbox/useInboxData.ts`)

All calls:

```
fetch(url, { ...init, headers: await authHeaders(), cache:'no-store' })
```

On a non-2xx response the client throws `new Error(json.error ?? json.message ?? 'HTTP <status>')`.

#### `GET /api/ess/inbox?employee_id=<id>` (the list)

Response when the tables are missing (200):

```json
{ "installed": false, "reason": "The inbox tables are not in the database yet (migration 080).",
  "folders": [], "conversations": [], "unread": 0, "desks": [] }
```

The client sets `status:'absent'` with `reason`.

Response when installed:

```jsonc
{
  "installed": true,
  "folders": [
    { "code": "ALL",     "label": "All",     "total": 0, "unread": 0 },
    { "code": "UNREAD",  "label": "Unread",  "total": 0, "unread": 0 },
    { "code": "STARRED", "label": "Starred", "total": 0, "unread": 0 },
    { "code": "DIRECT", "label": "Direct messages", "hint": "People writing to you", "total": 0, "unread": 0 }
    // … one per STREAMS entry; a DIRECT-kind row also counts toward DIRECT
  ],
  "conversations": [{
    "id": "uuid",
    "kind": "DIRECT" | "DESK" | "SYSTEM",
    "stream": "<folder code>",   // SYSTEM: stream_code; DESK: the desk's desk_code (or 'HR'); DIRECT: 'DIRECT'
    "title": "string",           // DIRECT: other members' full names joined ", " || 'Conversation'; DESK: desk label || 'Desk'; SYSTEM: stream label || stream_code
    "subject": "string|null",
    "members": [{ "id", "name", "code", "designation", "photo" }],  // other participants, excluding me
    "last_message_at": "ISO|null",
    "preview": "string|null",    // last_message_preview: whitespace collapsed, ≤180 chars (DB trigger)
    "message_count": 0,
    "unread": 0,                 // per thread, from inbox_unread_by_conversation (SYSTEM and muted threads included)
    "muted": false, "starred": false, "is_closed": false,
    "as_agent": false            // true = visible because I staff the desk, not because I am a participant
  }],
  "unread": 0,                   // inbox_unread_count(me): excludes SYSTEM threads, muted threads, deleted and own messages
  "desks": [{ "id", "desk_code", "label", "description", "accent" }],   // desks I STAFF (myDesks)
  "policy": { "reach_mode": "GROUP|COMPANY|CHAIN_HR|NO_COLD_UP", "allow_desk_threads": true,
              "allow_group_threads": true, "max_direct_members": 25, "always_reachable_desks": ["HR","PAYROLL"] }
}
```

- With no conversations: `{installed:true, folders:foldersFrom([]), conversations:[], unread:0, desks, policy}`.
- Other error: 500 `{error}`.
- **Server side effects on every GET:**
  - `syncNotifications(me)` mirrors up to 400 of the caller's `ess_notifications` into one SYSTEM thread per stream. The dedupe key is `notification_code|link`. It never deletes.
  - Only after the sync does it count.
- Conversations are capped at 300, ordered by `last_message_at desc nulls last`. The client re-sorts by `updatedAt`.

**Client mapping** (`adapter.ts`):

- `toFolders(serverFolders)`: always the **10 STREAMS** in streams order. Only `unread` is taken from the server's array. The server's `ALL`, `UNREAD` and `STARRED` entries are ignored.
- `toConversation(r)`:

  ```
  folder   = STREAM.get(r.stream) ?? HR
  kind     = upper(r.kind || 'DIRECT')
  subtitle = DIRECT: "<members[0].code> · <members[0].designation>" (empty parts dropped), else r.subject
  preview  = r.preview
  unread   = r.unread
  updatedAt = r.last_message_at || epoch
  starred, muted
  closed   = r.is_closed
  staffed  = r.as_agent
  ```

- `state.unread` = the server's `unread`. This is authoritative. It is reported to the bell and is **not** the sum of the folder badges: folder badges include SYSTEM threads, the total does not.

**Errors and polling behaviour:**

- If a poll fails after the screen is ready, the last good list is kept.
- A failure before the first success → `status:'error'`, `reason = message || 'Could not open the inbox.'`.

#### `GET /api/ess/inbox/messages?id=<conversationId>&employee_id=<id>` (open a thread)

```jsonc
{
  "installed": true,
  "conversation": { /* the raw inbox_conversations row: id, kind, subject, company_id, desk_id, stream_code, created_by,
                       last_message_at, last_message_preview, last_sender_id, message_count, is_closed, closed_at, closed_by, created_at */ },
  "as_agent": false,
  "messages": [{                  // oldest first, max 500
    "id": "uuid",
    "kind": "TEXT" | "SYSTEM" | "NOTIFICATION",
    "body": "string|null",        // null when deleted
    "deleted": false,
    "link": "string|null",        // a NOTIFICATION's link, e.g. "/ess?tab=approvals&ref=<id>"
    "notification_code": "string|null",
    "created_at": "ISO", "edited_at": "ISO|null",
    "mine": false,                // decided by the server
    "sender": null
      | { "name", "code", "designation", "photo" }              // a person
      | { "name": "<desk label>", "desk": true, "by": "full name|null", "accent": "#hex|null" }   // an answer from a desk
  }],
  "unread": 0                     // the caller's new inbox_unread_count after the read-mark
}
```

**Errors:**

| Condition | Status | Body |
|---|---|---|
| Missing `id` | 400 | `Which conversation?` |
| Conversation not found | 404 | `That conversation is gone.` |
| Not a participant and not a staffer | 403 | `Not your conversation.` |
| Messages table missing | 200 | `{installed:false, messages:[]}` |

**Side effects on the server:**

- Sets `inbox_participants.last_read_at = now()` for (conversation, me). Opening a thread is reading it.
- For a SYSTEM thread, also sets `ess_notifications.is_read = true` for this employee's unread notifications whose `category` is in the thread's `notification_code`s. This also clears the bell.

**Access rule** (`openable`): you can open a thread if you are a participant with `left_at` null, **or** you actively staff the desk the thread belongs to (`asAgent`).

**Client:**

- `messages = kind==='SYSTEM' ? [] : raw.map(toMessage)`.
- `notes = kind==='SYSTEM' ? raw.map(toNote) : []`. The kind comes from the list row, falling back to DIRECT.
- If `typeof json.unread === 'number'`, the value is forwarded to `onUnread`, which updates the bell.
- `toMessage`:
  - `authorName` = `"<desk name> · <by>"` for a desk reply when both are present, else `sender.name`.
  - `body = str(body)`, so a deleted message has `''` and `deleted: true`.
  - `sentAt = created_at`.
- `toNote`:
  - `title` = the first line of `body`, or `'Update'`.
  - `body` = the remaining lines.
  - `cta = link ? {label:'Open', href:link} : undefined`.
  - `done: false`, always.

**Open sequence** (`open(id)`):

1. Remember `unreadAtOpen`, the row's current unread.
2. Set a placeholder thread `{messages:[], notes:[], loaded:false}`.
3. Set that row's `unread` to 0 locally.
4. `await loadThread(id)`.
5. Re-apply `unreadAtOpen`.

The list is **not** reloaded.

#### `POST /api/ess/inbox/messages` (send a reply)

Body: `{ "id": "<conversationId>", "body": "<text>", "employee_id": "<id>" }`. The server also accepts an optional `reply_to` (a message id); no UI sends it.

Validation, in order:

| Condition | Status | Body |
|---|---|---|
| No `id` | 400 | `Which conversation?` |
| `body.trim()` is empty | 400 | `Write something first.` |
| Longer than 8000 characters | 400 | `That message is too long.` |
| Not openable | 403 | `Not your conversation.` |
| `is_closed` | 409 | `This conversation is closed.` |
| `kind==='SYSTEM'` | 409 | `This is a notification feed. There is nobody to reply to.` |
| Insert error | 500 | the DB message |

- **Sending as a desk:** when the sender reached the thread as a desk agent, or staffs the thread's desk, `sender_desk_id` is set to the desk. After a desk reply the agent is **upserted** as a MEMBER participant. Otherwise the sender's `last_read_at` is bumped.
- Response: `{ "id": "<messageId>", "created_at": "ISO" }`.
- A DB trigger updates the conversation's `last_message_at`, `last_message_preview` (≤180 characters, whitespace collapsed), `last_sender_id` and `message_count`.

**Client (optimistic):**

1. Append `{id:'tmp-<ms>', mine:true, body, sentAt:now, pending:true}`. It renders "· sending…".
2. POST.
3. `await Promise.all([loadThread(id), loadList()])`.

On error the temp bubble is removed and the error rethrown. `MessagesInbox` toasts `e.message || 'Message not sent'`, and the Composer keeps the text, because the rethrow skips the clear.

#### `GET /api/ess/inbox/directory?q=<text>&employee_id=<id>` (the compose picker)

```jsonc
{
  "installed": true,
  "reach_mode": "GROUP",
  "matched_self": false,          // q matched my own name, code or designation
  "people": [{ "id", "name", "code", "designation", "photo" }],   // max 25 (no q) or 40 (with q); ordered by full_name; excludes me
  "desks": [{ "desk_code", "label", "description", "accent", "staffed": true }],  // ALL active desks, sort_order. staffed = "any desk has any active agent" (one global flag)
  "unstaffed_desks": false        // true when there are desks but no active agent on any of them (can be 0 when there are no desks)
}
```

- On a missing table: `{installed:false, people:[]}`.
- If my employee record is missing: `{people:[]}`.
- Query error: 500.

**Search:**

- `q` is matched with `ilike` on `full_name`, `emp_code` and `designation` through `orIlike()`, which quotes the value so commas and full stops are safe.
- `COMPANY` reach limits to my `company_id` in SQL.
- `CHAIN_HR` filters in JS to: my L1 and L2 managers, people whose L1 or L2 manager is me, and peers (same `l1_manager_id`).
- `GROUP` and `NO_COLD_UP` are not filtered here. `NO_COLD_UP` is enforced only on send, by `inbox_can_message`.

**Client** `toDirectory`:

```
people: { id, name, code, designation }
desks:  { code: desk_code, name: label || '<stream label> desk', hint: description || stream.hint,
          unstaffed: unstaffed_desks===true || staffed===false }
matchedSelf
```

#### `POST /api/ess/inbox` (start a conversation)

- **Person:** `{ "action":"start", "to":["<employeeId>"], "employee_id":"<id>" }`. The server also takes an optional `subject`. The UI only ever sends one recipient.
- **Desk:** `{ "action":"desk", "desk_code":"HR", "employee_id":"<id>" }`.

Before the action branches, a probe runs. If the tables are missing, the response is the `notReady` JSON (`installed:false`, …).

`start` validation, in order:

| Condition | Status | Body |
|---|---|---|
| `to` is empty | 400 | `Pick somebody to write to.` |
| `to.length + 1 > max_direct_members` | 400 | `A conversation can hold {max_direct_members} people.` |
| More than one recipient and `!allow_group_threads` | 403 | `Group conversations are switched off.` |
| `inbox_can_message(me, t)` is false for any recipient | 403 | `Your access does not include that person.` |

- **Reuse:** for a single recipient, an existing DIRECT thread whose active members are exactly {me, them} is returned as `{ "id":"<cid>", "reused":true }`.
- Otherwise the server inserts a DIRECT conversation (`subject` or null, `created_by: me`) and participants: me as `OWNER` with `last_read_at` now, each recipient as `MEMBER` with `added_by: me`. Response: `{ "id":"<cid>" }`.
- Insert failure: 500, `ce.message || 'Could not start it.'`.

`desk` validation, in order:

| Condition | Status | Body |
|---|---|---|
| `!allow_desk_threads` | 403 | `Desk conversations are switched off.` |
| No active desk with that code | 404 | `No such desk.` |

- Then it inserts a DESK conversation (`subject: body.subject || desk.label`). The only participant is me, as OWNER. Agents reach the thread through the desk.
- Response: `{ "id":"<cid>" }`.
- A desk thread is **never** reused server-side; the client checks for one first (below).

**Client:** after `start`, `loadList()` runs in the background (not awaited), and the new id is opened immediately.

### 1.5 Messages group layout (`MessagesInbox.tsx`)

**Desktop:** three panes: folder rail, conversation list, then the thread or the catch-up panel.

**≤760 px:**

- The rail becomes a horizontal strip: a round compose button plus folder chips (pills, hints hidden).
- The list is full width.
- The thread is a **full-screen fixed layer** (`position:fixed; inset:0; z-index:30`) that slides in from the right (`translateX(100%)` → `0`, 320 ms). It has a Back button.
- `data-pane="thread"` while a thread is open.
- On mobile the composer does **not** autofocus (`autoFocus={!mobile}`).

**View state:**

| State | Values | Default |
|---|---|---|
| `folder` | `'ALL' \| FolderCode` | `'ALL'` |
| `filter` | `'all' \| 'unread' \| 'starred'` | `'all'` |
| `query` | free text | `''` |
| `railMin` | collapsed rail (desktop) | false |
| `composeOpen` / `composeQuery` | compose sheet | closed |

**List derivation:** `selectConversations(all, {folder, filter, query})`, applied in this order:

1. Folder (`ALL` or `c.folder===folder`).
2. Filter: unread → `unread>0`; starred → `starred`.
3. Query: `title`, `preview` or `subtitle` contains the lower-cased needle.
4. Sort: `updatedAt` descending.

#### 1.5.1 Folder rail (`FolderRail.tsx`)

- Collapse toggle (chevron). Tooltip/label: "Collapse folders" or "Expand folders".
- **"+ New message"** button (title "New message") opens Compose with an empty query.
- Heading **"Who is this from?"**.
- **All** row:
  - Label "All", hint "Everything, newest first".
  - Unread = `state.unread`, the server total, which excludes SYSTEM.
  - Its dot is a gradient from the DIRECT ink to the PERFORMANCE ink.
- Then one row per folder: a coloured dot, the label, the hint (as a `<small>`, and as the tooltip), and the unread count (blank when 0; bump animation on change).
- Active row: `aria-current=true`.

#### 1.5.2 Conversation list (`ConversationList.tsx`)

**Head:**

- `<h2>` = `All` or the folder label.
- Summary: `N conversation(s)`, blank when 0.
- (Flag) "Mark all read", disabled when nothing is unread.
- Search input with a `/` hint:
  - Placeholder **"Search people or desks…"** ("Search people, desks or messages…" with the search flag).
  - Screen-reader label: "Search conversations".
  - Client-side filter only.
- Filter chips: **All · Unread · Starred** (`aria-pressed`).

**Rows** (`role=option`):

- **Avatar:**
  - DIRECT → initials of the title, `initials()`: up to 2 letters, upper-cased.
  - DESK → house-shaped "desk" glyph.
  - SYSTEM → folder glyph.
  - Tinted with the folder ink.
- **Title** (bold) and time `relTime(updatedAt)`: `now` (<2 min), `Xm`, `Xh`, `Yesterday`, else `dd Mon`, e.g. "10 Sept" in en-IN.
- **Kind chip:** `Updates` (SYSTEM), `Desk` (DESK) or `Direct`. Plus a gold **"You staff this"** chip when `staffed`.
- One-line preview.
- Flags: a gold star if starred; bell-off if muted.
- Unread pill: folder ink background, white text (`#0D1117` in dark).
- An unread row has a bolder title and preview in `C.inkSoft`.
- Rows glide (FLIP, 380 ms) when the order changes after a poll, and stagger in at 28 ms each.
- (Flag) Hover quick actions on desktop: star, read/unread, mute.

**States:**

- Loading (first load only): six skeleton rows.
- **Empty** (glyph: chat). Heading **"No matches"** if there is a query, else **"Nothing here yet"**. Message:
  - query → `No conversation with “{q}” yet.`
  - unread filter → `You are all caught up here.`
  - starred filter → `Star a conversation to keep it within reach.`
  - All folder → `Start a conversation, or write to a desk.`
  - otherwise → `Nothing here yet.`

  With a query, a ghost button **`Search all colleagues for “{q}”`** opens Compose pre-filled with q.
- If there are matches and a query, a hint row sits above the results: **`Not here? Search all colleagues for “{q}”`**. It opens Compose pre-filled.

**Tapping a row** calls `open(id)`.

#### 1.5.3 Catch-up panel (`CatchUp.tsx`)

This is the right pane when no thread is open.

- Greeting by **local hour**, computed on mount: before 12 → "Good morning", before 17 → "Good afternoon", else "Good evening". It renders "Hello" first, then swaps. Line: `{greet}, {firstName}.`
- Lead line:
  - When there is something: `<b>N</b> update(s) need(s) an action` + ` and ` + `<b>M</b> conversation(s) is/are waiting` + `.`
  - Otherwise: "Nothing is waiting on you. Pick a conversation on the left, or start one."
- Buckets (`catchUpBuckets`):
  - **"Needs your action"**: SYSTEM threads with unread > 0, newest first. Each row shows the folder glyph, title, preview and an "Open" chip.
  - **"Unread"**: non-SYSTEM threads with unread > 0. Each row shows initials or the desk glyph, title, preview and the count.
- Footer: ghost button **"+ New message"** and the text "Updates from HR, Payroll and Leave arrive here as actions, not chats."

#### 1.5.4 Thread pane (`ThreadPane.tsx`)

**Header** (tinted with the folder ink):

- Back button ("Back to list"; visible on mobile).
- Avatar as in the rows.
- `<h2>` = title.
- Subline:
  - Folder label chip.
  - Kind label: `Direct message`, `Department desk`, or `Updates: notifications with an action` (hidden on mobile).
  - `Muted` chip (`C.sunken` / `C.muted`) and `Closed` chip (`C.warningTint` / `C.warning`) when they apply.
- (Flag) Action buttons: Star/Unstar, Mute/Unmute, Mark unread (hidden on mobile), Close/Reopen (not for SYSTEM).

**Feed:**

- While loading with nothing yet: spinner and **"Opening the conversation…"**.
- Loaded but empty, and not SYSTEM: **"No messages yet. Say hello."**
- **Messages** (DIRECT/DESK):
  - **Day dividers** from `dayLabel()`: `Today`, `Yesterday`, else `dd Month` (en-IN long month).
  - **Red "New" divider** before index `messages.length - unreadAtOpen`. Shown only when `0 < unreadAtOpen ≤ messages.length`, using `C.critical` lines.
  - **Bubbles:** mine are right-aligned with a blue gradient (`#2563EB` → `#1D4ED8`) and white text. Theirs are left-aligned on `C.surface` with a `C.line` border.
  - The bubble tooltip is `exactTime()`, e.g. "10 Sept, 03:41 pm".
  - **Grouping:** consecutive messages from the same side within **5 minutes**, on the same day and not deleted, form a group (`cont`). Only the last bubble of a group (`tail`) shows the meta line: `{authorName} · ` (theirs only, when present), then `relTime`, then for mine either `· sending…` or `· ✓sent` (in `C.positive`).
  - **Tombstone:** a deleted message renders as an italic dashed bubble reading **"Message deleted"** plus its time.
  - There are no read receipts beyond "sent". The server has no per-recipient read state on messages; only `last_read_at` per participant, which is not exposed.
- **Notes** (SYSTEM):
  - Each note is a card tinted with the folder ink: folder glyph, `<h5>` title (first line), body (remaining lines), then a CTA row.
  - CTA row: **"Open"** button linking to the notification `link` (web paths such as `/ess?tab=approvals&ref=<id>`, `/ess?tab=performance`, `/dashboard/investment-proofs`, `/ess?tab=social`; RN must map these to screens), then the time.
  - Day dividers as above.
  - No "New" divider.
- **Jump pill:**
  - Opening a thread scrolls to 60 px above the "New" divider, or to the bottom.
  - A new item arriving by poll while scrolled up (more than 120 px from the bottom) shows the **"New message"** pill (brand fill). Otherwise, or for your own send, the feed auto-scrolls.
  - Scrolled up with nothing new: a "Latest" pill.
  - Tapping either smooth-scrolls to the bottom.

**Composer** (`Composer.tsx`):

- Replaced by a disabled strip when:
  - SYSTEM: "This is a one-way stream. Act on the update above. Questions? **[Write to a desk]**". The button runs `writeToDesk(c.folder)`: it opens the existing DESK thread in that folder, or else opens Compose with an empty query.
  - Closed: "**Closed.** Nobody can reply until it is reopened." (plus a flag-gated Reopen).
- Textarea, placeholder **"Write a reply…"**, one row, grows to 160 px. The text is cleared when the conversation changes. It autofocuses on desktop.
- **Enter sends; Shift+Enter inserts a newline.** RN: a Send button. Multiline input, with return inserting a newline.
- Send is disabled while busy or when the trimmed text is empty. After success the field clears and the button shows a ✓ for 900 ms.
- Hint row: "Enter to send" / "Shift+Enter for a new line".
- No attachments (flag off).

### 1.6 Compose sheet (`ComposeSheet.tsx`)

A modal dialog titled **"New message"** with a close (×) button. Tapping the backdrop closes it.

- On open: `q = initialQuery`, the input is focused and its text selected after 80 ms.
- Search input, placeholder **"Search a colleague by name or code…"**. It is a combobox; ↑↓ and Enter pick an option.
- **Debounce:** 180 ms when `q` is non-empty, 0 ms for empty. Each change calls `GET /api/ess/inbox/directory?q=`. A stale response is ignored.
- **Desks** are filtered on the client: the server returns all of them. A desk matches when `${name} ${hint} ${code}` contains the needle.
- Body, in order:
  1. **"Departments"**: one option per desk, with a dot in the folder ink of `folders[d.code]` (no ink when the code is not a stream, e.g. `ADMIN`), the bold name, the `<small>` hint and a chevron.
  2. **Warning** (`C.warningTint` box) when any listed desk is unstaffed: `**{names joined ", "}** has nobody assigned yet, so a message may sit unanswered. HR can assign people in Admin Setup → Inbox.`
  3. **"People"**: options with initials, the bold name, `<small>{code} · {designation}`, a chevron, and the DIRECT ink.
  4. **Empty** (loaded, not busy, not failed, nothing listed):
     - Heading **"That is you"** if `matchedSelf`, else **"No one found"**.
     - Text, matchedSelf → `“{q}” matches your own record, and you cannot message yourself. Search for a colleague instead.`
     - Text, with q → `Nothing matches “{q}”. Try a name, an employee code, or a desk.`
     - Text, no q → `Try a name, employee code or a desk.`
     - When not matchedSelf, append ` Only colleagues your reach policy allows are listed.`
  5. **Failed:** heading **"Could not load the directory"**, text `{error message || 'The directory did not load.'} Check your connection and try again. Nothing has been sent.`
  6. **First load:** spinner and **"Loading the directory…"**.
- Footer: "Only colleagues and desks your company’s reach policy allows are listed. Nothing here will be refused on send."

**Picking:**

- **A person:** close the sheet, then `POST {action:'start', to:[id]}`, then open the returned id. On error, toast `e.message || 'Could not start the conversation'`.
- **A desk:** close the sheet. If a conversation exists with `kind==='DESK' && folder===code`, open it; otherwise `POST {action:'desk', desk_code}` and open it. On error, toast `e.message || 'Could not reach the desk'`.
  - **Quirk:** the folder of a DESK thread is its desk code mapped through STREAMS, falling back to HR. The seeded `ADMIN` desk (Admin & Facilities) therefore lands in the HR folder. Picking `ADMIN` never finds its existing thread (folder `HR` ≠ `ADMIN`) and creates a new one each time. Picking `HR` can open an existing `ADMIN` desk thread instead of the HR one.

**Teams and groups:** no group-thread UI exists. The server supports multi-recipient `start` (`to: [...]`, up to `max_direct_members-1` recipients, when `allow_group_threads`). A DIRECT thread with several members is titled with all names joined `, `.

**Seeded desks** (080): `HR` "HR" (accent `#7C3AED`), `PAYROLL` "Payroll" (`#047857`), `FINANCE` "Finance" (`#0E7490`), `IT` "IT Support" (`#B45309`), `ADMIN` "Admin & Facilities" (`#BE185D`).

Their descriptions:

- HR: "Policy, records, letters, anything people-related"
- Payroll: "Salary, payslips, tax, reimbursements"
- Finance: "Claims, advances, vendor and expense queries"
- IT Support: "Access, hardware, software, the ESS portal itself"
- Admin & Facilities: "Office, travel desk, assets"

### 1.7 Reach policy (`inbox_can_message(p_from, p_to)`, SQL in 080)

- Returns false for self or for an unknown employee.
- **Mode:** the most permissive `inbox_reach_overrides` entry for any active ESS role of the sender, ranked GROUP > NO_COLD_UP > COMPANY > CHAIN_HR. Otherwise `inbox_policy.reach_mode`, otherwise `GROUP`.

| Mode | Rule |
|---|---|
| `GROUP` | Always true |
| `COMPANY` | Same `company_id` |
| `CHAIN_HR` | The target is my L1 or L2 manager, or I am their L1 or L2 manager, or we share an L1 manager |
| `NO_COLD_UP` | True for my direct manager or my direct reports. True if the target is not in my L1 chain (12 levels) or is at depth < 2. Otherwise true only if the target has already messaged me in a thread I am in |

### 1.8 Unread semantics

- `inbox_unread_count(me)`, the **bell and All** number, counts messages:
  - in threads I am an active participant of (`left_at` null),
  - **not muted**, **not SYSTEM**, not deleted, not sent by me,
  - created after my `last_read_at`, or all of them when that is null.
- `inbox_unread_by_conversation(me)`, the per-row number, uses the same rule **but includes SYSTEM and muted** threads.
- A thread is "read" only by opening it (GET messages) or by sending in it. There is no per-message read.
- Desk threads seen as an agent (not a participant) have no participant row, so they show 0 unread.

### 1.9 Server POST actions that exist but are unused by the UI

`POST /api/ess/inbox` with `{ id, action, employee_id }`. Each first passes `openable`, else 404 or 403 `Not your conversation.`; no `id` → 400 `Which conversation?`.

| action | extra field | effect | response |
|---|---|---|---|
| `read` | none | `last_read_at = now()` | `{ ok:true, unread:<inbox_unread_count> }` |
| `mute` | `value: boolean` | `is_muted = !!value` | `{ ok:true }` |
| `star` | `value: boolean` | `is_starred = !!value` | `{ ok:true }` |
| `leave` | none | `left_at = now()` | `{ ok:true }` |
| anything else | n/a | n/a | 400 `Unknown action.` |

### 1.10 Supabase from the browser (Messages)

**None.** The inbox tables are read only through the API with the service role. `lib/inbox/server.ts` states the rule: the anon key ships to every browser, so a private conversation must never be queried client-side.

---

## 2. INBOX → Wall of Fame tab (`components/wall/WallInbox.tsx` + `components/ess/inbox/WallInboxView.tsx`)

**Purpose.** Only things a colleague actually said: appreciation notes, comments and replies about your recognition. No approvals, badge unlocks or reaction counts.

**Calls.** All go through `wallRpc(action, args, employeeId)`:

```
POST /api/ess/wall
body: { action, ...args, employee_id }
```

- Success → `{data}`.
- Errors:
  - 503 `{error:'The Wall of Fame is not fully installed yet (migration 094). Ask your administrator to run it.', installed:false}` when the RPC is missing.
  - 403 for DB code `42501`, and for any write while `viewAs`.
  - 400 `{error: <db message>}` otherwise.
  - `Unknown action '<x>'.` for an action not on the allowlist.
- A network failure → `{error:{message:'Could not reach the server.'}}`.

The full set of RPC shapes is in §6.4, the Wall of Fame section.

**Load sequence** (on mount, and each time the stream chip changes):

1. `get_inbox_counts` with `{}` → `Counts { total_unread, appreciation, comments, replies }`.
   - If the error is "missing" (`installed===false`, `code==='PGRST205'`, or the message matches `/PGRST205|does not exist|could not find/i`) → the not-switched-on state.
   - Any other error → the same state, with the error text.
2. Report `onUnread(counts.total_unread ?? 0)`. This becomes the Wall tab badge.
3. `get_wall_inbox` with `{ p_filter: stream, p_limit: 30 }` → rows:

   ```ts
   interface InboxRow { id; event_type; is_read; created_at; actor_name; actor_designation; preview; body;
                        category_label; category_glyph; recognition_id; comment_id; message_id; can_thank }
   ```

**Row → card mapping** (`toItem`):

```
type             = STREAM_OF[event_type] ?? 'appreciation'
actorName        = actor_name ?? 'A colleague'
actorDesignation = actor_designation ?? ''
headline         = headlineFor(event_type, actorName)
badge            = category_label ? "<glyph > <label>" : undefined
text             = body ?? preview ?? ''
sentAt           = created_at
unread           = !is_read
canThankBack     = !!can_thank
thankId          = message_id ?? id
```

| event_type | stream | headline |
|---|---|---|
| appreciation | appreciation | `{actor} sent you a note` |
| recognised | appreciation | `{actor} recognised you` |
| thanked_back | appreciation | `{actor} said thank you` |
| share_request | appreciation | `{actor} asked to share their note on the feed` |
| commented | comments | `{actor} commented on your recognition` |
| mentioned | comments | `{actor} mentioned you` |
| replied | replies | `{actor} replied to your comment` |
| (any other) | n/a | `{actor} did something` |

**Layout:**

- `<h2>Wall of Fame</h2>`, with the line "Approvals and nominations stay in your approvals queue. Only appreciation lives here."
- Chips: **All · Appreciation · Comments · Replies**. Filtering happens on the server (`p_filter`). Do not filter again on the client.
- Notice when `!countsReconcile(counts)`, meaning the three streams do not add up to `total_unread`: "The unread totals do not add up. Some events are not in any stream. Worth telling HR."
- An error notice, in red (`C.criticalTint` / `C.critical`), shows `err`.
- Loading: spinner and "Opening the wall…".
- Empty: **"Nothing here yet"** / "This is only what colleagues have said to you. Approvals stay in their own queue."
- **Card** (staggered 40 ms; unread = gold border, gold wash and a gold dot top-right):
  - Initials avatar, **actorName**, `<small>` designation, `relTime`.
  - Category chip:
    - appreciation: gold, star icon, text `badge ?? 'Appreciation'`
    - comments: `C.infoTint` / `C.info`, chat icon, `badge ?? 'Comment'`
    - replies: `C.positiveTint` / `C.positive`, reply icon, `badge ?? 'Reply'`
  - The headline sentence.
  - The text. Appreciation text is wrapped in quotation marks (`<q>`).
  - Footer:
    - **"Thank back"** (heart icon, gold outline) when `canThankBack`. "Thanked" is a disabled filled gold state with a particle burst, but `thanked` is never set by the data layer, so in practice it is always "Thank back".
    - **"Mark read"** chip when unread.

**Actions:**

- **Mark read:** optimistically set `is_read=true`, then `mark_inbox_read` with `{ p_ids:[row.id] }`, then reload (on success and on error alike). There is no "open" tap; only the chip.
- **Thank back:** `thank_for_appreciation` with `{ p_message: thankId }`. The UI never sends `p_body`. On error, `setErr(message)`. On success, reload.

**Not switched on** (`ready===false`): glyph ★, **"Not switched on yet"**, then `err ??` "The Wall of Fame is not switched on for this company yet. Once it is, notes, comments and replies from colleagues will appear here, separately from your approvals."

No polling.

---

## 3. INBOX → Broadcasts tab (`components/ess/BroadcastInbox.tsx` + `components/ess/inbox/BroadcastView.tsx`)

**Purpose.** A company-wide, read-only channel. There are no public replies. An employee may send a **private response**, which only the publisher sees.

### 3.1 Direct Supabase queries (browser, anon key), verbatim

```ts
// 1. The notices
supabase.from('ess_announcements')
  .select('id,title,body,priority,published_by,published_at,is_pinned,is_active,is_broadcast,source_department_id')
  .eq('is_broadcast', true).eq('is_active', true)
  .order('published_at', { ascending: false }).limit(100)

// 2. Publisher names (only when any published_by exists)
supabase.from('employees').select('id,full_name').in('id', publisherIds)

// 3. My read marks
supabase.from('ess_broadcast_reads').select('announcement_id').eq('employee_id', employeeId)

// 4. Mark read (optimistic; the result is not checked)
supabase.from('ess_broadcast_reads')
  .upsert({ announcement_id: id, employee_id: employeeId }, { onConflict: 'announcement_id,employee_id' })

// 5. Private response (recipient_id and company_id are set by trigger trg_broadcast_response_recipient)
supabase.from('ess_broadcast_responses').insert({ announcement_id: id, author_id: employeeId, body })
```

Notes:

- **There is no `company_id` filter on query 1.** Every company's broadcasts are visible to every employee. Keep this for parity or fix it on purpose.
- Migration 088 creates no RLS policies for these tables.
- If query 1 errors with `PGRST205` (missing table) or `42703` (missing column), the state is `absent`.
- Any **other** error is treated as ready with zero items, which shows "No notices yet". The `'error'` state is never produced.
- Triggers on insert into `ess_broadcast_responses`:
  - It sets `recipient_id = announcement.published_by` and `company_id`. If the announcement has no publisher: `RAISE 'Announcement % has no publisher, so there is nobody to respond to'`.
  - It inserts an `ess_notifications` row for the publisher: `category 'BROADCAST'`, title `'<author> replied to your broadcast'`, body = the first 240 characters.

### 3.2 Rules (`lib/broadcast/channel.ts`, pure)

- **Order** (`ordered`): only `isActive` items. Pinned first, then priority `URGENT(0) < IMPORTANT(1) < NORMAL(2)`, then `publishedAt` descending.
- **Unread** (`unreadCount`): ordered items whose id is not in my read set. This becomes the Broadcasts badge.
- **`canRespond(me, b)`:**
  - `!b.isActive` → `'This notice has been withdrawn.'`
  - `me === b.publishedBy` → `'You published this one.'`
  - otherwise allowed.
- `PRIORITY_LABEL`: NORMAL `Notice`, IMPORTANT `Important`, URGENT `Urgent`.
- Mapping to the view model: `publisher = publisherName ?? 'Your company'`.

### 3.3 Layout

- Loading: spinner and "Opening broadcasts…".
- **Absent:** megaphone-off glyph, **"Not switched on yet"**, then "The broadcast channel is waiting on `088_broadcast_channel.sql`, which adds the channel to the announcements table. It is handed to Nayan rather than run from here. This project does not apply schema changes itself."
- **Ready:**
  - `<h2>Broadcasts</h2>`, with "Company-wide notices. Read only. Nobody replies in public."
  - The notice line, if any.
  - Empty: **"No notices yet"** / "Company-wide announcements will appear here."
- **Card** (staggered 40 ms):
  - Pinned → a 4 px blue bar on the left.
  - Unread → `C.brandEdge` border and a 4 % brand wash.
  - Meta line, joined by `·`:
    - `Pinned` (`C.brand`, bold), when pinned.
    - The priority label when not NORMAL: `Important` in `C.warning`, `Urgent` in `C.critical`.
    - The publisher.
    - `relTime(publishedAt)`.
  - `<h4>` title, `<p>` body.
  - Footer: a lock chip **"No public replies"**, then either a **"Reply privately"** button (toggles to "Cancel") when `canRespond`, or the reason text (`C.faint`, right-aligned).
  - **Reply box:** 3-row textarea, autofocus, placeholder "Only the publisher will see this…". Hint `Enter to send · goes to {publisher} alone`, then a **Send** button ("Sending…" while busy; disabled when empty or busy). Enter sends; Shift+Enter inserts a newline.
  - After send, the card shows "Sent. Only they can see it." in `C.positive`.
- **Read marking:** `onMouseEnter` or `onFocus` on an unread card calls mark-read. **RN:** mark read when the card becomes visible, or on tap.
- **Response result** (the top notice): `error ? 'That did not send: <message>' : 'Sent. Only they can see it.'`.
  - Quirk: the card shows its own "Sent. Only they can see it." even when the insert failed. The top notice still shows the error.

No polling, no realtime.

---

## 4. Notifications (bell panel; `/api/ess/notifications`)

The bell panel is not a sidebar tab, but the Inbox SYSTEM threads mirror these rows and clear them. The panel is `Notifications` inside `EmployeePortal.tsx`.

#### `GET /api/ess/notifications?employee_id=<id>`

- **Sync first** (best effort): `deriveFor(me)` computes which notifications should exist. Missing ones are inserted, deduped on `link`. A summary row whose title changed is updated in place and set unread again.
- Then:

  ```
  select id, category, title, body, link, is_read, created_at
  from ess_notifications
  where employee_id = me
  order by created_at desc
  limit 100
  ```

Response:

```jsonc
{
  "personal": [Row],   // role_scoped === false (audience SELF or PEER)
  "role":     [Row],   // role_scoped === true (RM, HOD, HR, … audiences)
  "unread":   0,       // unread rows among the 100 returned
  "synced":   0
}
// Row = { id, category, title, body, link, is_read, created_at,
//         label: def(category)?.label ?? category, high: isHigh(category), role_scoped: boolean }
```

Error: 500 `{error}`.

#### `POST /api/ess/notifications`

| Body | Effect | Response |
|---|---|---|
| `{ "action":"read", "id":"<uuid>" }` | Marks one of the caller's notifications read | `{ok:true}` |
| `{ "action":"read_all" }` | Marks all of the caller's unread notifications read | `{ok:true}` |
| anything else | n/a | 400 `{ error: "action must be 'read' or 'read_all'" }` |

DB errors return 500 `{error}`.

#### Panel UI

- Header: **"Notifications"**, with a **"Mark all read"** outline button.
- Loading: "Loading…".
- Empty: "You're all caught up. 🎉"
- Groups: **"For you to action"** (role rows), then **"About you"** (personal rows).
- **Row:**
  - Unread rows have a brand-coloured `●` before the title and full opacity. Read rows are at opacity 0.6.
  - `high` rows have a 3 px `C.critical` left stripe.
  - Title (13 px, 600), body (12 px, `C.muted`), then `{label} · {fmtDT(created_at)}` (10 px, `C.faint`).
  - `fmtDT` = `toLocaleString('en-IN', {dateStyle:'medium', timeStyle:'short'})`.
- Tapping an unread row → POST `read`, then reload, then `onChange()` refreshes the bell.
- Tapping a row does **not** navigate to `link`.

---

## 5. FUN ZONE

> Source of truth (read-only survey, branch `feat/mobile-app`, 19 Oct 2026):
> `components/ess/FunZone.tsx` (511 lines), `components/funzone/*` (PlayTogether, LiveTicTacToe,
> LiveMemoryMatch, LiveTrivia, VsComputer, MindGames, ui, fzStyles), `design/funzone.css` (851 lines,
> compiled into `components/funzone/fzStyles.ts`), `lib/funzone/{games,ai,mindgames,invite,live,client}.ts`,
> `lib/funzone/__tests__/*`, `app/api/ess/funzone/route.ts`, `lib/ess/session.ts` (`essRoute`, `notify`),
> `lib/auth-headers.ts`, `lib/ess-session-client.ts`, `lib/pg-search.ts`, `lib/inbox/{streams,server}.ts`,
> `supabase/migrations/090_funzone_multiplayer.sql`, `096_funzone_actor_wrappers.sql`, `094_*` (`wof_act_as`).
> Only those two migrations mention Fun Zone (`grep -l funzone supabase/migrations`).

### 5.1 Purpose, entry point and overall contract

- **What it is:** an employee-facing break-time games area inside the ESS portal. 14 games:
  4 "Classics" (Tic-Tac-Toe, Memory Match, EZER Trivia, Spin the Wheel) and 10 solo "Mind games".
  Three classics (ttt, mem, quiz) have three play modes: against the computer (bot), solo / same-screen,
  and live with a colleague on two devices (invite + Supabase Realtime broadcast).
- **Mounted from:** `components/ess/EmployeePortal.tsx`
  - nav section `{ k:'funzone', label:'Fun Zone', short:'Fun', icon:'', status:'ready', desc:'Take a break: play a quick game with your team', items:[{ k:'funzone', label:'Fun Zone' }] }` (line ~3275); rail group `{ label: 'Community', keys: ['social', 'rnr', 'funzone'] }`; rail icon `IconGame`; portal search keywords for it: `'games fun zone'`.
  - loaded lazily: `const FunZone = dynamic(() => import('@/components/ess/FunZone'), { ssr: false, loading: SectionLoading })`.
  - rendered as `case 'funzone': return <FunZone employeeId={emp.id} />`.
  - rendered **without** the portal `TabHeader`/`SubTabs` (bare `<div>{renderView()}</div>`), because Fun Zone draws its own hero. The `.fz` root supplies its own page padding `18px 22px`.
- **Deep link:** every server-sent Fun Zone notification links to `'/ess?tab=funzone'` (legacy query form; `lib/ess/routes.ts` maps `?tab=<view>` to `{ kind:'view', view:'funzone' }`; `/ess/funzone` path form also resolves since `'funzone'` is in `VIEW_KEYS`). The deep link only opens the hub; it does NOT open Play Together or a specific invite.
- **Access:** open to every employee, no role check (component comment "brief §9"). `employeeId` prop is optional: when absent, the "With a colleague" mode is hidden everywhere and copy changes (see 5.3/5.4).
- **Persistence contract:** the solo, bot and mind games touch **no network, no database and no localStorage**. A refresh/leaving a game resets everything; there is no leaderboard, best score or history anywhere in the UI. Only live multiplayer touches the server (invites, session start, result, optional share). `game_score_shares`/`share` action exist server-side but **no UI calls `share`** (see 5.10).
- **Navigation model:** hub-and-spoke, all state-driven inside one component (no routes, no URL change):
  `Hub` → (tap tile) → for ttt/mem/quiz: `ModeScreen` → mode screen; wheel and every mind game open straight into the game. Every game screen has a "Back" button. From a mode's game, Back returns to the ModeScreen (`backToModes`); from ModeScreen / wheel / mind game, Back returns to the Hub (`back` → `game=null, mode=null`).
- **Scroll reset:** on every `game`/`mode` change, if the `.fz` root's top is above the viewport (`getBoundingClientRect().top < 0`) it calls `scrollIntoView({ block:'start' })`. RN: scroll the ScrollView to top on screen change.
- Test harness only (not product): `app/funzone-preview/page.tsx` renders `<FunZone employeeId="00000000-0000-0000-0000-000000000001" />` inside `max-width:900` padding 24 for `scripts/smoke-funzone.py`. Not needed in RN.

### 5.2 Source map and what RN can import directly

| Module | Pure? | Imports | RN reuse |
|---|---|---|---|
| `lib/funzone/games.ts` | **Pure TS**, no imports | — | Import as-is: `import { GAMES, LIVE_GAMES, gameByCode, QUIZ, MEM_FACES, MEM_CARDS, WIN_LINES, EMPTY_BOARD, FIRST, boardFrom, outcome, other, canApply, apply, resultOf, rng, shuffled, memDeck, memReplay, memCanApply, memApply, memResult, MEM_FIRST, quizFor, quizReplay, quizCanApply, quizApply, quizResult, type Move, type Mark, type Board, type MemTurn, type Answer, type Question } from '@/lib/funzone/games'` |
| `lib/funzone/ai.ts` | **Pure TS** | `from './games.ts'` (note the explicit `.ts` extension — needs `allowImportingTsExtensions` or Metro/Babel resolving `.ts`; otherwise change to `'./games'` in a copy) | `import { botMove, bestMoves, tacticalMove, randomMove, memBotTurn, remember, EMPTY_MIND, MEM_RECALL, botAnswer, botDelay, DIFFICULTY_LABEL, DIFFICULTY_MEANING, type Difficulty, type MemMind } from '@/lib/funzone/ai'` |
| `lib/funzone/mindgames.ts` | **Pure TS**, no imports, randomness injected | — | Import as-is (all 10 mind-game rules + catalogue) |
| `lib/funzone/invite.ts` | **Pure TS**, no imports; `now` always passed in | — | Import as-is |
| `lib/funzone/live.ts` | **Pure TS** (type-only import from `./games`) | — | Import as-is (channel naming, packet validation, reconcile, sides/marks, status text) |
| `lib/funzone/client.ts` | **Not pure** | `@/lib/auth-headers` → `@/lib/supabase` + `@/lib/ess-session-client` (reads `localStorage['ezer_ess_session']`, uses `atob`); uses relative `fetch('/api/ess/funzone…')` | Re-implement: absolute base URL + RN token storage (see 5.10.1) |
| `components/funzone/*.tsx`, `components/ess/FunZone.tsx` | DOM/React-web; CSS classes from `FZ_CSS` injected `<style>`; `useTimers`/`useCountdown` in `ui.tsx` are plain React hooks (setTimeout/setInterval only) and are portable | `@/lib/supabase` (Live*), `@/lib/ui` (C/F/W/S/R tokens) | Rewrite views; copy hook logic |
| `app/api/ess/funzone/route.ts` | Server only (`next/server`, service-role client) | — | Call over HTTP |

`ui.tsx` also imports `DIFFICULTY_LABEL`, `DIFFICULTY_MEANING` from `@/lib/funzone/ai`. No module in Fun Zone uses `canvas`, `requestAnimationFrame`, `window.localStorage` (except via authHeaders), `document` (except `scrollIntoView`, `window.addEventListener('keydown')` in 2048 — see 5.7) or browser storage for game state.

### 5.3 The games catalogue (exact)

Hub tile type: `interface Tile { k: string; icon: string; name: string; desc: string; badge: string; cat: Cat; live?: boolean; bot?: boolean }`.
`Cat = 'arcade'|'quiz'|'social'|'puzzle'|'memory'|'reflex'|'words'|'brain'|'logic'`.

**Classics** (`GAMES` in `components/ess/FunZone.tsx` — distinct from `GAMES` in `lib/funzone/games.ts`):

| k | icon | name | desc (tile line) | badge | cat | live | bot |
|---|---|---|---|---|---|---|---|
| `ttt` | ⭕ | Tic-Tac-Toe | Against the computer, or a colleague | Arcade | arcade | ✓ | ✓ |
| `mem` | 🧩 | Memory Match | Find the pairs, alone or head to head | Arcade | memory | ✓ | ✓ |
| `quiz` | 💡 | EZER Trivia | Company policy, solo or against somebody | Quiz | quiz | ✓ | ✓ |
| `wheel` | 🎡 | Spin the Wheel | Daily spin: win a fun shoutout or a treat | Social | social | – | – |

(Note: `mem` badge says "Arcade" but its `cat` is `memory`, so it is coloured teal and appears under the "Memory" filter chip.)

**Mind games** (`MIND_GAMES` in `lib/funzone/mindgames.ts`; tile `badge = CATEGORY_LABEL[cat]`; no live/bot):

| code | icon | name | cat (badge) | desc (tile) | how (sub-title inside game) |
|---|---|---|---|---|---|
| `tiles` | 🔢 | 2048 | puzzle (Puzzle) | Slide and merge tiles to reach 2048 | Use the arrow keys, swipe, or the pad. Equal tiles merge when they touch. |
| `simon` | 🎹 | Echo | memory (Memory) | Watch the pads light up, then repeat the pattern | Each round adds one more step. One wrong pad ends the run. |
| `reflex` | ⚡ | Quick Draw | reflex (Reflex) | Tap the moment the panel turns green | Wait for green, then tap. Tapping early counts as a false start. |
| `scramble` | 🔤 | Payroll Scramble | words (Words) | Unscramble HR and payroll words against the clock | Type the word the letters make. The hint tells you what it means. |
| `slide` | 🧱 | Slide Puzzle | puzzle (Puzzle) | Put the eight tiles back in order | Tap a tile next to the gap to slide it in. Fewest moves wins. |
| `sprint` | ➗ | Math Sprint | brain (Brain) | Solve as many sums as you can in 45 seconds | Type the answer. It is checked as you type. Sums get harder as you go. |
| `clash` | 🎨 | Colour Clash | brain (Brain) | Name the ink colour, not the word | The word says one colour and is printed in another. Pick the ink. |
| `codebreak` | 🔐 | Code Breaker | logic (Logic) | Crack a four-colour code in ten tries | A filled dot is right colour, right place. A ring is right colour, wrong place. |
| `lights` | 🔆 | Lights Out | logic (Logic) | Switch every light off. Each tap flips its neighbours | A tap flips that light and the four next to it. Get the board dark. |
| `mines` | 💣 | Minesweeper | logic (Logic) | Clear the field without touching a mine | Numbers count the mines around a square. Flag mode marks what you suspect. |

`ALL_TILES = [...GAMES(4 classics), ...MIND_TILES(10)]` → 14 tiles, in exactly the order above.

`lib/funzone/games.ts` has its own server-facing catalogue (used by the route and Play Together):
```ts
export const GAMES: GameDef[] = [
  { code: 'ttt',  name: 'Tic-Tac-Toe',    live: true,  players: 2 },
  { code: 'quiz', name: 'EZER Trivia',    live: true,  players: 2 },
  { code: 'mem',  name: 'Memory Match',   live: true,  players: 2 },
  { code: 'wheel', name: 'Spin the Wheel', live: false, players: 1,
    soloReason: 'The wheel is a daily solo spin. There is nothing for a second player to do.' },
]
export const LIVE_GAMES = GAMES.filter(g => g.live)   // ttt, quiz, mem — this ORDER drives the Play Together <select>
```
`soloReason` is defined but not rendered anywhere in the current UI.

### 5.4 Hub screen (`Hub`)

Layout, top to bottom (all inside `.fz` root → `.fz-view`):

1. **Hero card** (`.fz-hero`, dark "stage" surface `--fz-stage #1E1B4B` → `--fz-stage-2 #2B2566`, text `--fz-on-stage #F5F3FF`; radius 24, 1.5px border).
   - Row (`.fz-hero-row`), left column:
     - `<h1 aria-label="Fun Zone">` — the title "Fun Zone" rendered one letter per `<span>` (space gets class `sp`), each with `--i` = index for a staggered letter entrance animation. Display font "Bricolage Grotesque" (Google Font, weights 600/800).
     - Blurb `.fz-blurb`: **"Take a break. Play on your own, against the computer, or with a colleague on two screens. Nothing here is scored towards anything."**
   - Right column:
     - Primary arcade key `.fz-key.lg` with an inline 20×20 dice SVG (rounded square stroke 2, three 1.4r dots at (7,7),(10,10),(13,13)) and label **"Surprise me"**.
     - Meta `.fz-hero-meta`: **"{ALL_TILES.length} games, {GAMES.filter(g => g.live).length} of them live"** → renders "14 games, 3 of them live".
   - **Filter chips** (`.fz-chips`, `role="group" aria-label="Show games"`), each a toggle button (`aria-pressed`) with label + count badge `<span className="n">{count}</span>`:

     | k | label | count (matches) |
     |---|---|---|
     | `all` | All | 14 |
     | `live` | With a colleague | 3 (tiles with `live`) |
     | `puzzle` | Puzzle | 2 (tiles, slide) |
     | `memory` | Memory | 2 (mem, simon) |
     | `logic` | Logic | 3 (codebreak, lights, mines) |
     | `brain` | Brain | 2 (sprint, clash) |
     | `words` | Words | 1 (scramble) |
     | `reflex` | Reflex | 1 (reflex) |

     Rule: `matches(t,f) = f==='all' ? true : f==='live' ? !!t.live : t.cat===f`. There is **no** chip for `arcade`, `quiz` or `social` (so ttt, quiz, wheel are only reachable via All / With a colleague). Default filter `'all'`; filter state is local (lost on leaving the hub).
2. **When filter = all**: two shelves.
   - Shelf "Classics" — `<h3>Classics</h3>` + `<p>`: **"On your own, against the computer, or head to head with a colleague"** + (if no `employeeId`) **" once you are signed in"** + **"."**. Grid `.fz-grid.big` of the 4 classic tiles (stagger index i = 0..3).
   - Shelf "Mind games" — `<h3>Mind games</h3>` + `<p>`**"Quick solo puzzles for a five-minute break."** Grid `.fz-grid` of the 10 mind tiles (stagger index i+4).
3. **When filter ≠ all**: one shelf, no heading, grid `.fz-grid` (re-keyed by filter to replay the deal-in animation) of the filtered tiles.
4. Footer `.fz-foot`: **"Scores reset when you leave a game. Nothing here is saved or ranked."**

**Game tile** (`GameTile`, a button, class `fz-tile cat-<cat>`, `--i` stagger):
- "screen" square `.scr` with the emoji `.glyph` (category colour background).
- `.name` (tile name), `.desc` (desc line), tags row: `.fz-tag` = badge text; plus `.fz-tag.plain` **"🤖 Bot"** if `bot`; **"🤝 Live"** if `live`.
- Tap → `onOpen(k)` → sets `game=k, mode=null`.

**Surprise me**: `pool = shown.length ? shown : ALL_TILES` (shown = currently filtered tiles), picks `pool[Math.floor(Math.random()*pool.length)].k` uniformly and opens it (same as tapping the tile — classics go to ModeScreen, wheel/mind games open directly). Respects the active filter.

### 5.5 Mode screen (`ModeScreen`) — ttt, mem, quiz only

`Stage` with the game's `cat`, `icon`, `title = name`, `sub = "How do you want to play?"`, Back → hub.
Body `.fz-modes`: one big button `.fz-mode` per mode (stagger `--i`), each: icon `.ic` (`MODE_ICON`: bot 🤖, solo 🎮, live 🤝), `.label`, `.hint`. Order is bot, solo, live:

| game | mode | label | hint |
|---|---|---|---|
| ttt | bot | Against the computer | Three difficulties. Hard is unbeatable: a draw is the best there is. |
| ttt | solo | Two players, one screen | Pass the device back and forth. |
| ttt | live | With a colleague | Invite somebody and play on two screens. |
| mem | bot | Against the computer | It remembers what it has seen, more of it on harder settings. |
| mem | solo | On your own | Find all eight pairs. Nothing is timed. |
| mem | live | With a colleague | Take turns on two screens. |
| quiz | bot | Against the computer | It answers too, and it does not always know. |
| quiz | solo | On your own | Four questions, no opponent. |
| quiz | live | With a colleague | Head to head on the same questions. |

- `live` is filtered out when `employeeId` is falsy, and then a note `.signin-note` renders below: **"Playing with a colleague needs you to be signed in to ESS."**
- Routing after pick (`FunZone`): `live && employeeId` → "Play together" stage (5.9); `bot` → `TicTacToeVsBot` / `MemoryVsBot` / `TriviaVsBot`; `solo` → `TicTacToe` / `MemoryMatch` / `Trivia`. All of these get `onBack = backToModes` (returns to this ModeScreen, not the hub).

### 5.6 Shared game chrome (`components/funzone/ui.tsx`)

- **`Stage({ cat, icon, title, sub?, aside?, onBack?, children, bodyClass?, confetti? })`** — `<section class="fz-stage fz-view cat-<cat>">`:
  header `.fz-stage-top` = optional `BackBtn` (chevron-left SVG + text **"Back"**), identity `.fz-stage-id` (emoji glyph + `<h2>{title}</h2>` + optional `<p>{sub}</p>`), optional right `aside` (stats); body `.fz-stage-body` (+ `bodyClass`, e.g. `left`). `confetti`: a number; when non-zero a `Confetti` burst is mounted keyed by the number, so changing the number replays it; `0` = none.
- **`Confetti`** — 36 pieces, deterministic (no Math.random): piece i: x = `(i*37)%100`%, colour `['#8B5CF6','#F59E0B','#14B8A6','#EC4899','#3B82F6','#22C55E','#F97316'][i%7]`, duration `1.3 + ((i*7)%10)/10` s, delay `((i*13)%10)/25` s, horizontal drift `((i*29)%120)-60` px, rotation `((i*53)%720)-360` deg. Pure CSS animation (`fz-fall` style) — recreate with Reanimated/Animated.
- **`Stat({ label, value, hot?, bump? })`** — a value with a label (`<b>value</b><span>label</span>`); `hot` = accent colour; `bump` = replays a small pop each time `value` changes after first render.
- **`Status({ text, tone?: 'win'|'lose'|'draw', busy? })`** — one status line, `role=status aria-live=polite`, re-keyed by text (pop animation when toned); `busy` shows a pulsing dot before the text. Empty text still renders the (empty) row.
- **`DifficultyBar({ level, onPick })`** — 3-way sliding segmented control (Easy / Medium / Hard; `DIFFICULTY_LABEL`), thumb position `--pos` = index; below it `.fz-seg-note` = `DIFFICULTY_MEANING[level]`:
  - easy: **"Often just plays somewhere. You should win."**
  - medium: **"Takes an obvious win and blocks yours, but does not see a fork coming."**
  - hard: **"Solved play. The best you can get is a draw. That is the game, not the bot."**
  (Same meaning text is shown for all three bot games, even Memory and Trivia.)
- **`VsBar({ left:{who,pts}, right:{who,pts}, turn?: 'left'|'right'|null, mid='vs' })`** — head-to-head scoreboard; the side whose turn it is gets class `on` (highlight).
- **`useTimers()`** — `{ after(ms, fn), clear() }`, all cleared on unmount. **`useCountdown(seconds, running, onEnd)`** — returns whole seconds left; resets to `seconds` whenever not running; while running, a 200 ms `setInterval` computes `max(0, seconds - floor((Date.now()-started)/1000))` and calls `onEnd` once at 0. Both portable to RN as-is.

### 5.7 Solo / same-screen Classics (`components/ess/FunZone.tsx`)

#### 5.7.1 Tic-Tac-Toe (solo = two players, one screen)
- Stage: cat `arcade`, icon ⭕, title "Tic-Tac-Toe", sub **"Two players, take turns tapping a square"**.
- Scoreboard `.fz-vs`: left `{tally.X}` "Player X", mid **"wins"**, right `{tally.O}` "Player O"; side highlighted (`on`) = current turn while not over.
- State: `board: string[9]` ('' | 'X' | 'O'), `turn` starts 'X', `tally {X:0,O:0}` (per sitting, lost on Back).
- Win detection on the 8 `WIN_LINES` `[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]` (derived from board each render); draw = no win and all filled.
- Tap square i: ignored if filled or over; place `turn`; if it completes a line, `tally[turn]++`; toggle turn (turn flips even after a win).
- Status: win → **"🎉 Player {X|O} wins!"** (tone win); draw → **"It's a draw!"** (tone draw); else **"Player {turn}'s turn"**.
- Squares: disabled when filled or game over; winning-line squares get class `win`; empty squares show a ghost of the current mark on hover (`data-ghost={turn}`) — no hover in RN, drop.
- a11y labels: `Square {i+1}, {v}` / `Square {i+1}, empty`.
- Button `.fz-key` **"New Game"** → clears board, turn='X' (tally kept). **Note:** after a win, `turn` was already flipped, so reset sets it back to X — X always opens a new game.
- Confetti: on win, `confetti = tally.X + tally.O` (so each new win replays).

#### 5.7.2 Memory Match (solo)
- Stage: cat `memory`, icon 🧩, title "Memory Match", sub **"Find all 8 pairs · {pairs} found"** or **"You found them all!"** when done; aside stats: `Stat label="pairs" value="{pairs}/8" hot bump` and `Stat label="turns" value={turns}`.
- Deck: `MEM_FACES = ['🍕','🎧','🚀','🌵','🎲','⚓','🧩','🎸']` ×2 = 16 cards, Fisher–Yates with `Math.random()` (unseeded, `shuffleDeck()` local to FunZone.tsx). Dealt in an effect on mount and on reset (deck empty on first render).
- Progress bar `.fz-progress` width `pairs/8*100%`.
- Flip rules: ignore tap if `lock`, already flipped, or matched. 1st card → face up. 2nd card → `turns++`; if faces equal → both matched, flipped cleared (no lock); else lock the board, after **800 ms** flip both back and unlock.
- Done when `pairs === 8` → `Status` **"Cleared in {turns} turns"** (tone win); confetti keyed by `deal` counter.
- Card a11y label: `Card {i+1}, {emoji}` or `Card {i+1}, face down`; classes `mcard`, `up` (face up), `done` (matched).
- Grid re-keyed by `deal` (replays deal-in animation). **"New Game"** → reshuffle, clear everything, turns 0, `deal++`.
- Nothing is timed.

#### 5.7.3 EZER Trivia (solo)
- Question bank (`QUIZ` from `lib/funzone/games.ts`, same for every mode; solo uses it **in fixed order**, unshuffled):
  1. "EZER's mission stands for Empower, Zero Risk, Efficient, and…?" — opts `['Retain Top Talent','Reduce Turnover','Report Automation']`, correct 0
  2. "Which financial year runs April to March in India?" — `['Calendar Year','Financial Year','Fiscal Quarter']`, correct 1
  3. "What does PT stand for in Indian payroll?" — `['Personal Tax','Professional Tax','Provident Trust']`, correct 1
  4. "LWF stands for Labour ___ Fund?" — `['Welfare','Wages','Work']`, correct 0
- Stage: cat `quiz`, icon 💡, title "EZER Trivia", sub **"Four questions on how things work here"**, aside `Stat label="correct" value={score} hot bump`.
- Progress bar = `min(idx,4)/4`. Hint line `.fz-hint`: **"Score: {score} / 4"**.
- Question block (re-keyed per question): `<small>Question {idx+1} of 4</small>` then **"Q{idx+1}. {q}"**; options as buttons with letter badges A/B/C/(D/E) (`data-key`), stagger `--i`.
- Answer: only first tap counts (`picked !== null` → ignore). Correct → `score++`. Reveal immediately: correct option class `right`, picked wrong option class `wrong`. After **900 ms** advance to next question.
- Done screen `.fz-result`: big **"{score}/4"**, **"Quiz done! You scored {score}/4"**, sub **"Every one right."** if perfect else **"Play again. The questions stay the same."**; button **"Play Again"** (restart: idx 0, score 0, `round++`). Confetti only on a perfect score (keyed by round).
- No timer per question.

#### 5.7.4 Spin the Wheel (no modes)
- Stage: cat `social`, icon 🎡, title "Spin the Wheel", sub **"Tap spin for today's surprise"**.
- Prizes (6 equal segments, `SEG = 60°`): `['Free Coffee ☕','Shoutout 📣','Extra Break ⏰','High-Five 🙌','WFH Day 🏠','Snack Treat 🍪']`; segment colours `['#7C3AED','#DB2777','#0F766E','#C2410C','#1D4ED8','#B45309']` as a conic gradient, segment i covering `i*60°..(i+1)*60°` clockwise from 12 o'clock. Each label shows only the first word (`p.split(' ')[0]`: Free, Shoutout, Extra, High-Five, WFH, Snack) rotated to `i*60 + 30 - 90` deg along the segment centre line.
- Decorative rim: 18 bulbs at `k*20°`, alternating (`k%2`); rim gets class `fast` while spinning; pointer pin at top gets class `tick` while spinning.
- Hub (centre) shows 🎁 until a result, then the prize's last token (its emoji, `result.split(' ').pop()`).
- **Spin!** (`.fz-key.lg`, shows **"Spinning…"** and disabled while spinning): `next = deg + (5 + Math.random()*3)*360 + Math.random()*360` (rotation accumulates, never resets → always spins forward); wheel CSS `transform: rotate(next deg)` with a ~4 s ease-out transition; after **4100 ms** `resting = (360 - (next % 360)) % 360`, prize = `PRIZES[Math.floor(resting / 60)]`, `spins++`. Prize is read from the resting angle, not pre-picked.
- Result card (`role=status aria-live=polite`) `.prize-card`: `<small>You got:</small>` + prize text. Confetti keyed by spin count when a result exists.
- "Daily" is copy only — **no once-per-day limit is enforced** and nothing is stored; the user can spin unlimited times.

### 5.8 Against the computer (`components/funzone/VsComputer.tsx` + `lib/funzone/ai.ts`)

No network AI: the "AI" is local deterministic-given-rand logic. `rand = () => Math.random()`. Default difficulty **medium**. Changing difficulty restarts the game.

#### 5.8.1 Tic-Tac-Toe vs computer (`TicTacToeVsBot`)
- Stage: arcade, ⭕, "Tic-Tac-Toe", sub **"You are X and you open."**; `DifficultyBar`; `VsBar left {who:'You'} right {who:'Computer'} mid="wins"`, turn highlight left when my turn, right when bot's turn, none when over.
- Human is always X and always opens; bot is O. Moves kept as `Move[]` (`{n, by, cell}`), board derived via `boardFrom`, state via `outcome`.
- Bot turn: in an effect whenever it is O's turn, after `botDelay(level, rand)` ms (easy 1600, medium 1100, hard 700, each `+ rand()*900`, rounded) calls `botMove(moves,'O',level,rand)`, re-validated with `canApply`.
- `botMove` rules (`ai.ts`): if game not playing / no empty cells → -1. **hard**: full minimax (`score`: win `10-depth`, loss `depth-10`, draw 0) via `bestMoves`, random tie-break among equal best. **easy/medium**: with probability `TACTICAL` (easy 0.4, medium 1.0) try `tacticalMove` (one-ply: complete own line, else block opponent's line, scanning `WIN_LINES` in order); otherwise / if none, `randomMove` (uniform empty cell).
- Tally `{me, bot}` incremented once per won board (draws not counted).
- Status: win **"You win."** / **"The computer wins."**; draw **"A draw. That's the game, not the bot."**; my turn **"Your turn."**; bot's turn **"Thinking…"** with busy pulse. Tones win/lose/draw.
- Squares disabled when filled or not my turn; ghost `X`. **"New Game"** clears moves (tally kept). Confetti on my win keyed by `tally.me`.

#### 5.8.2 Memory Match vs computer (`MemoryVsBot`)
- Seeded deck: `seed = Math.floor(Math.random()*2**31)`, deck = `memDeck(seed)` (mulberry32 + Fisher–Yates from games.ts). Human = HOST (opens), bot = GUEST. Turns are `MemTurn {n, by, a, b}`; state via `memReplay` (**a hit keeps the turn**; a miss passes it).
- Stage: memory, 🧩, "Memory Match", sub **"You {HOST} · Computer {GUEST} · 8 pairs"**; DifficultyBar; `VsBar ... mid="pairs"`.
- Human flip: ignored if not my turn / busy / matched / already face up. After 2nd card, turn validated by `memCanApply` (invalid → just un-flip); then both shown and `commit(t)`: `peek=t` for **850 ms**, then faces down, `mind = remember(mind, deck, t, level)`, turn appended.
- Bot turn (effect when GUEST to move): after `botDelay(level)` → `memBotTurn(deck, matched, mind, rand)`: (1) if it remembers two unmatched cards with the same face → take them; (2) else flip a random card it has not seen (or any open card if all seen), and if it remembers that card's twin take it; (3) else a random second card. Then show both + `commit`.
- Bot memory `remember`: watches **both** players' turns, keeps last `MEM_RECALL[level]` cards (easy 2, medium 6, hard 16).
- Status: result → **"A draw."** / **"You win."** / **"The computer wins."**; else my turn **"Your turn: turn over two."**, else **"The computer is looking…"** (busy). Winner by pairs (`memResult`; equal pairs = draw).
- **"New Game"** → new random seed, everything cleared, mind emptied. Confetti on my win keyed by seed.

#### 5.8.3 EZER Trivia vs computer (`TriviaVsBot`)
- Questions = `quizFor(seed)` (the 4 QUIZ questions shuffled by the seed; option order unchanged). Seed random per game.
- Stage: quiz, 💡, "EZER Trivia", sub **"You {me} · Computer {bot}"**; DifficultyBar; `VsBar mid = done ? "final" : "Q{at+1}/4"`.
- On my tap (first only): mark `mine`, score if correct; option class `mine` until reveal. Bot's choice pre-computed (`botAnswer`: knows correct with prob `KNOWS` easy 0.35 / medium 0.6 / hard 0.85, else uniform random wrong option). After `botDelay(level)` reveal: `theirs` set, bot scores if correct, correct option `right`, my wrong pick `wrong`, the bot's option shows a small tag **"computer"**. After another **1400 ms** next question.
- While waiting: `Status` busy **"The computer is thinking…"** (empty text otherwise).
- Done: big **"{me}–{bot}"** (en dash) and **"A draw, {me} each."** / **"You win, {me}–{bot}."** / **"The computer wins, {bot}–{me}."**; button **"Play Again"** (new seed). Confetti if I won.
- No question timer. The bot does not answer until the human does.

### 5.9 The ten Mind games (`components/funzone/MindGames.tsx` + `lib/funzone/mindgames.ts`)

All open directly from the hub (no ModeScreen), Back → hub. `MindGame({code,onBack})` looks up `SCREENS[code]`; an unknown code calls `onBack()` (returns to hub) and renders nothing. Every screen uses `Frame` = `Stage` with the catalogue's `cat`, `icon`, `name` as title and **`how` as the sub-title** (5.3 table). All randomness is `rand = () => Math.random()` injected into the pure functions. "best" values are per sitting only (React state; lost on Back). No network.

#### 5.9.1 2048 (`tiles`, cat puzzle)
- 4×4 grid (`TILES_SIZE = 4`), goal `TILES_GOAL = 2048`. Start: `newTiles(rand)` = empty grid + two `spawnTile`s.
- `spawnTile`: random empty cell; value 2 with prob 0.9, else 4.
- `slideTiles(grid, dir)`: per line in direction of travel, compress non-zeros, merge equal adjacent pairs **once per tile per move** (`[2,2,2,2]→[4,4]`), `gained` = sum of merged values; returns `{grid, gained, moved, merged:number[] (indices of merged cells)}`.
- Move: ignored if `tilesStuck(grid)` (no direction moves) or (won and not "keep going"); ignored if nothing moved; otherwise apply, spawn one tile, `score += gained`, `best = max(best, score)`; highlight new tile (pop-in `fz-mark`) and merged tiles (`fz-merge` 1.12 pulse).
- Input: **keyboard** `ArrowUp/Down/Left/Right` and `w/a/s/d` on `window keydown` (ignored when focus is in INPUT/TEXTAREA/SELECT, `preventDefault`); **swipe** via pointerdown/pointerup on the board: threshold 24 px on the larger axis, direction = dominant axis sign; **D-pad** buttons ▲ ◀ ▼ ▶ (aria Up/Left/Down/Right, `fz-key soft sm`). Board has `touch-action:none`.
- Aside: `Stat score` (hot, bump), `Stat best`.
- Status: won → **"You made 2048!"** (win); stuck → **"No moves left. Top tile {max}"** (lose); else **"Top tile {max}"**.
- Buttons: when won (and not yet continuing) **"Keep going"** (soft) → continue past 2048; **"New game"** → fresh grid, score 0, keep-going off, `round++` (best kept).
- Confetti when won (keyed by round). Tile colours (bg / text): 2 `#EDE9FE/#4C1D95`, 4 `#DDD6FE/#4C1D95`, 8 `#FDBA74/#7C2D12`, 16 `#FB923C/#fff`, 32 `#F97316/#fff`, 64 `#EA580C/#fff`, 128 `#FCD34D/#78350F` (24px), 256 `#FBBF24/#78350F` (24px), 512 `#F59E0B/#fff` (24px), 1024 `#8B5CF6/#fff` (20px), 2048 `#EC4899/#fff` (20px, pink glow), >2048 `#14B8A6/#fff` (18px); empty cell `rgba(255,255,255,.07)` on the dark stage; default number 28px.

#### 5.9.2 Echo (`simon`, cat memory)
- 4 pads (`ECHO_PADS = 4`), names (aria) `['Violet','Teal','Amber','Pink']`, colours `#8B5CF6, #14B8A6, #F59E0B, #EC4899`, laid 2×2 with the outer corner fully rounded; dim (opacity .45) until lit; centre disc shows `{seq.length}` over **"STEPS"**.
- Phases `idle | show | input | over`. **Start** → `seq = echoExtend([], rand)` (one random pad) and play it.
- Playback: `step = echoStepMs(len) = max(260, 620 - len*25)` ms. Pad k lights at `500 + k*step`, unlights at `500 + k*step + 0.6*step`; input phase begins at `500 + len*step`.
- Tap (input only): pad flashes 180 ms. `echoCheck(seq, at, pad)`: `'miss'` → phase over, board shakes, `best = max(best, len-1)`; `'next'` → `at++`; `'round'` → `best = max(best, len)`, phase show, after **650 ms** extend by one random pad and replay the whole sequence.
- Status: idle **"Press start and watch closely."**; show **"Watch…"** (busy pulse); input **"Your turn: step {at+1} of {len}"**; over **"Missed. You reached {len-1}."** (lose).
- Aside: `Stat round = seq.length` (hot, bump), `Stat best`. Button label **"Start"** when idle, else **"Play again"**; disabled during show and input. Play again restarts at length 1. No time limit on input.

#### 5.9.3 Quick Draw (`reflex`, cat reflex)
- `REFLEX_ROUNDS = 5`. A big panel button (240 px tall) fires on **pointerdown** (not click), also Space/Enter on keyboard.
- Phases and panel faces (`[big, small]`) and colours:
  - `ready` (stage dark): **"Tap to start"** / **"5 rounds. Wait for green."**
  - `wait` (red `#B91C1C`): **"Wait…"** / **"Not yet"**
  - `go` (green `#15803D`, bump): **"TAP!"** / **"Now"**
  - `early` (brown `#92400E`): **"Too soon"** / **"That was a false start. Tap to try again"**
  - `result` (category solid): **"{last} ms"** / **"{verdict(last)} · tap for round {times.length+1}"**
  - `done` (category solid): **"{avg} ms"** / **"Average of 5 · {verdict(avg)} · tap to go again"**
- Press logic: ready/early/result → arm (phase wait; after `reflexWait(rand)` = random integer 1400–4200 ms, record `performance.now()` and phase go); done → clear times then arm; wait → cancel timer, phase early (false start is not recorded and does not consume a round); go → `ms = round(now - goAt)`, append, best = min, phase `done` if 5 times else `result`.
- `reflexVerdict(ms)`: <200 **"Lightning"**, <260 **"Sharp"**, <330 **"Quick"**, <450 **"Steady"**, else **"Warming up"**. `average` = rounded mean (0 for empty).
- Aside: `Stat round = "{min(times.length + (done?0:1), 5)}/5"`, `Stat "best ms" = best ?? '-'` (hot). Splits row: each time as **"{ms} ms"** chip; the fastest highlighted. Hint: **"Keyboard: focus the panel and press Space."** (web-only; drop or adapt in RN).
- Confetti when done and avg < 300 ms.
- RN: use `performance.now()` (available in Hermes) or `Date.now()`; fire on `onPressIn`.

#### 5.9.4 Payroll Scramble (`scramble`, cat words)
- 20 words (`SCRAMBLE_WORDS`, UPPERCASE letters only) with hints, verbatim:
  PAYROLL "The run that pays everybody"; PAYSLIP "Your monthly salary breakdown"; GRATUITY "Paid after five years of service"; BONUS "Something extra on top of pay"; APPRAISAL "The yearly performance review"; ATTENDANCE "Who was in, and when"; OVERTIME "Hours beyond the normal shift"; HOLIDAY "A day the office is shut"; PENSION "Income after retirement"; ALLOWANCE "HRA is one of these"; ONBOARDING "A new joiner’s first days" (typographic apostrophe U+2019); DEDUCTION "Taken out of gross pay"; REFERRAL "Recommending a friend for a role"; PROBATION "The trial period before confirmation"; TIMESHEET "Where hours are logged"; WELFARE "The W in LWF"; INCREMENT "A raise in salary"; RESIGNATION "Formally deciding to leave"; HANDBOOK "Where the policies are written down"; WELLNESS "Health and wellbeing programmes".
- Ready screen: letter tiles spelling P A Y R O L L, hint **"You get 60 seconds. Type each word. It moves on by itself when it is right."**, big **"Start"**.
- Start: `deck = scrambleDeck(rand)` (Fisher–Yates of all 20), score 0, 60 s countdown (`SCRAMBLE_SECONDS = 60`, `useCountdown`). Word i = `deck[i % 20]` (wraps and repeats in the same order after 20). Letters = `scramble(word, rand)`: shuffled, retried up to 12 times to differ from the word, else rotate by one.
- Play screen: time bar (`left/60`, turns critical red when ≤10 s, 1 s linear width transition); letter tiles (staggered deal-in), letters already typed greyed out left-to-right (`used`, per-letter multiset match); hint **"Hint: {hint} · {n} letters"**; text input (centred, uppercase display, `autoComplete=off`, `autoCapitalize=characters`, `spellCheck=false`, `maxLength = len+2`, auto-focused on every new word); **"Skip word"** (soft sm) → shows **"Last one was {WORD}."** and deals next word (no penalty).
- Checking: on every change, `normaliseWord(v)` (uppercase, strip non A–Z) === word → input turns green (`ok`), `score++`, typing locked, after **450 ms** next word.
- Time up → done: big `{score}`, **"{word|words} in 60 seconds"** (singular when 1), sub **"The last word was {WORD}."** (the word on screen when time ran out), **"Play again"**.
- Aside: `Stat solved` (hot, bump), `Stat seconds` = `left` while playing else 60. Confetti if score ≥ 8.

#### 5.9.5 Slide Puzzle (`slide`, cat puzzle)
- 3×3, tiles 1–8 + gap 0; solved = `[1,2,3,4,5,6,7,8,0]`. Shuffle = 80 random legal moves backwards from solved, never immediately undoing the previous move; if still solved, one move (`slideMove(t, 7)`). Always solvable.
- Tap a tile: only tiles orthogonally adjacent to the gap are enabled; it swaps with the gap, `moves++`; on solve, `best = min(best, moves)`.
- Tiles rendered in value order and absolutely positioned (`--x = at%3, --y = floor(at/3)`, 0.18 s glide). A tile in its home square uses the solid category fill (`home`), others the tint. aria `Tile {v}` + `, in place`.
- Status: **"Solved in {moves} moves"** (win) / **"Tiles next to the gap can move"**. Aside: `Stat moves` (hot, bump), `Stat best` (`'-'` until first solve). Button **"Shuffle"** (new puzzle, moves 0, best kept). Confetti on solve.

#### 5.9.6 Math Sprint (`sprint`, cat brain)
- `SPRINT_SECONDS = 45`. Ready: big **"12 + 7 = ?"**, hint **"Sums start easy and get harder the more you solve. No minus answers."**, big **"Start"**.
- `makeSum(solved, rand)`: tier 0 (solved < 5): ops `+`/`−`, operands 1–20; tier 1 (5–11): ops `+`/`−`/`×`, `×` operands 2–9 × 2–9, `+`/`−` operands 1–60; tier 2 (≥ 12): `×` 2–12 × 2–15, `+`/`−` 1–150. Subtraction swaps operands so the answer is ≥ 0. Text uses `−` (U+2212) and `×`: `"{a} + {b}"`, `"{a} − {b}"`, `"{a} × {b}"`.
- Play: time bar (critical when ≤ 10 s), **"{left} seconds left"**, sum **"{text} = ?"** (pop on each new sum), numeric input (`inputMode=numeric`; non-digits stripped, max 4 digits), on-screen numpad 3×4: `7 8 9 / 4 5 6 / 1 2 3 / _ 0 ⌫` (0 in centre column; ⌫ aria "Delete" removes last digit). Auto-checked on every change: equals answer → `solved++`, next sum, input cleared. Wrong answers have no penalty.
- Time up → done: big `{solved}`, **"solved in 45 seconds"**, sub **"Your best this session."** if `solved ≥ best && solved > 0`, else **"Best this session: {best}"**; **"Play again"**. Best updated on entering done.
- Aside: `Stat solved` (hot, bump), `Stat best`. Confetti if solved ≥ 15.

#### 5.9.7 Colour Clash (`clash`, cat brain) — Stroop
- Colours (`CLASH_COLOURS`): red "Red", blue "Blue", green "Green", yellow "Yellow", purple "Purple". Ink colours light: red `#DC2626`, blue `#2563EB`, green `#16A34A`, yellow `#CA8A04`, purple `#9333EA`; dark theme: `#F87171`, `#60A5FA`, `#4ADE80`, `#FACC15`, `#C084FC`.
- `CLASH_ROUNDS = 12`. `clashCard(rand)`: word uniform; with prob 0.25 ink = word, else ink uniformly one of the other four.
- Ready: word **"RED"** printed in blue, hint **"That one is Blue. 12 cards. Be quick and be right."** ("Blue" bold), big **"Start"**.
- Play: hint **"Card {n+1} of 12: tap the colour of the ink"**; the word = colour name UPPERCASE in the ink colour (shakes if the previous pick was wrong); 5 swatch buttons (colour square + name). Pick: records ms since the card was shown; correct (= ink index) → `right++`, `streak++`; wrong → streak 0. After 12 picks → done. No time limit.
- Done: big **"{right}/12"**, **"right, averaging {(average(ms)/1000).toFixed(2)} s a card"**, sub **"Not fooled once."** (12/12) else **"The word tries to win. The ink is the answer."**; **"Play again"**.
- Aside: `Stat right = "{right}/12"` (hot, bump), `Stat streak` (bump). Confetti on a perfect run.

#### 5.9.8 Code Breaker (`codebreak`, cat logic) — Mastermind
- `CODE_COLOURS = 6`, `CODE_LENGTH = 4`, `CODE_TRIES = 10`; code = 4 independent random colours (repeats allowed). Peg names `['Red','Blue','Green','Yellow','Purple','Orange']`, colours `#EF4444, #3B82F6, #22C55E, #FACC15, #A855F7, #F97316`.
- `scoreGuess(code, guess)` → `{exact, near}`, each peg counted once (e.g. code `[0,0,1,1]` vs guess `[0,1,1,1]` = 3 exact, 0 near).
- Board: 10 rows always shown (`GuessRow`): row number, 4 peg slots (dashed empty circle until filled), 4 key dots in a 2×2: first `exact` filled (●), next `near` rings (○), rest empty. The current row (`now`, highlighted) shows the pegs being entered.
- Controls (while not over): palette of 6 round colour buttons (disabled once 4 chosen) → append; **"Undo"** (soft sm, disabled when empty) removes last; **"Check guess"** (disabled unless 4 pegs) → scores and appends the row.
- Status: won **"Cracked in {n} try"**/**"tries"**; lost (10 rows, none exact 4) **"Out of tries"**; else **"Guess {rows+1} of 10"**. When over, a row labelled **"Code"** reveals the secret, and **"New code"** replaces the controls.
- Footer hint: **"● right colour, right place · ○ right colour, wrong place. Colours can repeat."** Aside: `Stat "tries left" = 10 - rows` (hot, bump). Confetti on win.

#### 5.9.9 Lights Out (`lights`, cat logic)
- 5×5 booleans. Puzzle = dark board pressed at 9 distinct random cells (so always solvable); if that happens to be all dark, press cell 12 (centre).
- Tap cell i (unless solved): toggles i and its 4 orthogonal neighbours (edges clipped); `moves++`.
- Status: **"Lights out in {moves} moves"** (win) / **"{lit} light still on"** / **"{lit} lights still on"**. Aside: `Stat lit` (hot, bump), `Stat moves`.
- Buttons: **"Restart this one"** (soft; disabled when moves = 0) → back to the puzzle's starting board, moves 0; **"New puzzle"**. Lit cell `#FDE047` with glow on a dark grid. aria `Light {i+1}, on|off`, `aria-pressed`. Confetti on solve.

#### 5.9.10 Minesweeper (`mines`, cat logic)
- 9×9 (`MINES_SIZE`), 10 mines (`MINES_COUNT`). Mines are laid on the **first dig**, never on that cell or its 8 neighbours (`layMines(first, rand)`), so the first dig always opens ground.
- Tap action toggle (segmented, `role=group aria-label="Tap action"`): **"⛏ Dig"** / **"🚩 Flag"** (default Dig). Web also flags on right-click (`contextmenu`) — RN: map to long-press.
- Dig: ignored on a flagged/open cell or when over; mine → game lost (`boom` = that cell; all mines revealed as 💣, the hit cell red `#DC2626`, other mines `#FECACA`; grid shakes); else `openSquare` flood-fills zeros (never opens flagged cells). Flag: toggles on any unopened cell (allowed before the first dig).
- Win when every non-mine cell is open. Cells show the neighbour count (1 `#1D4ED8`, 2 `#15803D`, 3 `#B91C1C`, 4 `#6D28D9`, 5 `#9A3412`, 6 `#0E7490`, 7/8 `#1E1B4B`), 🚩 on flags; unopened cells dark on the stage; opened `#EFEBFA`. All unopened cells disabled once over.
- Timer: starts at first dig, re-rendered every 500 ms, whole seconds, frozen at the end.
- Status: before first dig **"Tap anywhere to start. The first square is always safe"**; playing **"Right-click or use flag mode to mark a mine"** (RN should reword "Right-click" → long-press only if product agrees; parity copy is the string above); win **"Field cleared in {secs} s"**; loss **"Boom. That one was a mine."**
- Aside: `Stat "mines left" = 10 - flagged` (can go negative; hot), `Stat seconds`. **"New field"** resets everything. aria per cell: `Row {r}, column {c}: {n} nearby | clear | flagged | hidden`. Confetti on win.

### 5.10 "With a colleague" — Play Together screen (`components/funzone/PlayTogether.tsx`)

Reached from ModeScreen → "With a colleague" (only when `employeeId` is set). Wrapped by FunZone in:
`Stage cat={game's cat} icon="🤝" title="Play together" sub="Invite a colleague and play on two screens, live." onBack={backToModes} bodyClass="left"` → `<div className="fz-live"><PlayTogether meId={employeeId} /></div>`.
**The game chosen on the hub is NOT passed in** — PlayTogether has its own Game select defaulting to `LIVE_GAMES[0]` = Tic-Tac-Toe regardless of which tile was opened. PlayTogether and the Live* games use inline styles with `@/lib/ui` tokens (`C`, `F`, `W`, `S`, `R`), not the Fun Zone CSS.

#### 5.10.1 Data and polling
- On mount and **every 15 s** (`setInterval(…, 15_000)`): `tick` re-render (countdowns) **and** `load()`.
- `load()`: `setFunzoneOwner(meId)` then `listInvites()` = `GET /api/ess/funzone?employee_id=<meId>`.
  - error → `loadErr = { auth: status === 401, msg }`, `ready = null` → renders the error card (below) instead of the screen.
  - ok → `ready = data.installed !== false`; `invites = data.invites ?? []`; if `data.me`: `serverMe = data.me`, `serverName` = `fromName` of the first invite where `fromId === me`, else `toName` of the first where `toId === me`, else null.
- `who_me = serverMe ?? meId` — the identity used for every rule/role decision (session identity wins over portal owner).
- `now = new Date().toISOString()` computed per render.

#### 5.10.2 States
- **Load error card** (bg `C.warningTint`, border `1px solid C.warning`, radius `R.lg`, padding `16px 18px`):
  title (F.body, bold, C.ink) **"Please sign in again"** if 401 else **"Could not load Fun Zone"**; body (F.small, C.muted, line-height 1.7) **"Your session has expired. Sign out and back in, then reopen Fun Zone."** if 401 else the server's error message.
- **Not installed card** (`installed === false`, same styling): **"Playing together is not switched on yet"** / **"The games all work on their own. Inviting somebody needs `090_funzone_multiplayer.sql`, which is handed to Nayan rather than run from here."** (file name in a `code` chip, bg `C.sunken`, radius 6).
- **Loading:** no explicit spinner — before the first response `ready === null` and `loadErr === null`, so the normal screen renders with an empty invite list ("Nothing yet…").
- **Identity mismatch banner** (when `serverMe && serverMe !== meId`; border `1px solid C.critical`, bg `C.criticalTint`, radius `R.sm`, padding `11px 13px`, F.small, C.ink):
  **"This is not your Fun Zone."** (bold) + **" You are signed in as {serverName ?? 'a different employee'}, but you are looking at somebody else’s portal. The invites below are yours, not theirs, so anything you send or accept here happens as you. Open your own portal, or sign in again in this tab."**

#### 5.10.3 Section "Ask somebody to play" (card: bg C.surface, border C.line, radius R.lg, padding 16px 18px)
- h3 **"Ask somebody to play"** (F.body bold C.ink); sub (F.micro C.muted) **"They get it in their inbox. Invites last 15 minutes. It is an offer to play now, not an appointment."** (15 = `INVITE_TTL_MINUTES`).
- Responsive grid of three fields (`repeat(auto-fit, minmax(min(180px,100%), 1fr))`, gap S.sm). Labels (`lbl`: F.micro, bold, C.inkSoft, uppercase, letterSpacing .05em):
  1. **"Game"** — select of `LIVE_GAMES`: Tic-Tac-Toe (`ttt`), EZER Trivia (`quiz`), Memory Match (`mem`) in that order; default `ttt`.
  2. **"Who"** — when nobody chosen: text input, placeholder **"Name or employee code"**, aria **"Search for a colleague by name or employee code"**. When chosen: a read-only field showing **"{name} ({code})"** (code omitted if null) with a text button **"change"** (clears who/chosen/query/results).
  3. **"Say something (optional)"** — text input, placeholder **"Best of three?"**.
- Search (debounced **250 ms** on `query`; term = trimmed; < 2 chars → results cleared, no request): `POST {action:'search', q: term}` → `people` (error → empty list). Result panel only while no one is chosen and term ≥ 2 chars (border C.line, radius R.md):
  - while in flight: **"Searching…"**
  - no matches: **"Nobody matches “{term}”. Try a different spelling, or their employee code."** (curly quotes)
  - each result row button: **{name}** bold + `" · {code}"` muted if code. Tap → `who = id`, `chosen = person`, results cleared.
- Client-side verdict (courtesy check, same function the server uses): `canInvite(who_me, who, game, { liveGames: ['ttt','quiz','mem'], existing: invites, now })`. If `who` set and not ok → warning line (F.micro, C.warning) with `verdict.because`.
- Error line (F.micro, C.critical) shows `err` (from any failed send/accept/answer).
- **Send button** — label **"Send the invite"** / **"Sending…"** while busy; disabled unless `who && verdict.ok && !busy`; enabled style bg `C.brand` text `C.onAccent`, disabled bg `C.sunken` text `C.faint`; F.small bold, padding 9px 18px, radius R.sm.
  - Action: `POST {action:'send', to: who, game, message: note.trim() || null}`. Error → `err = message`. Success → clear who, chosen, query, results, note; `load()`.

#### 5.10.4 Section "Invites"
- h3 **"Invites"**; sub **"Waiting on you first."**
- Empty: **"Nothing yet. Send one above, and it appears in their inbox straight away."**
- List sorted by `inboxOrder(invites, who_me, now)`: rank 0 = PENDING (effective) addressed to me, 1 = other PENDING, 2 = everything else; ties newest `createdAt` first.
- Row (radius R.sm, padding 10px 13px; highlighted border `C.brand` + bg `C.brandTint` when pending AND addressed to me, else border C.line bg C.surface):
  - Line 1 (F.small semi C.ink): if I sent it **"You invited {toName ?? 'a colleague'} to {gameName ?? gameCode}"**, else `inviteLine(inv, gameName)` = **"{fromName ?? 'A colleague'} wants to play {gameName} with you"**.
  - Line 2 (F.micro C.muted): pending → **"{STATUS_LABEL} · {minutesLeft} min left"** (i.e. "waiting for an answer · 12 min left"); otherwise `STATUS_LABEL[effectiveStatus]`: PENDING "waiting for an answer", ACCEPTED "accepted", DECLINED "declined", CANCELLED "withdrawn", EXPIRED "expired". Then, if message, **` · “{message}”`**.
  - Buttons (pending + addressed to me): **"Play"** (`btnGo`: bg C.brand, text C.onAccent, F.tiny bold, padding 7px 14px) disabled if busy or `!canAccept(...)`; **"No thanks"** (`btnQuiet`: bg C.surface, border C.line, text C.muted, F.tiny semi, padding 7px 12px) disabled if busy or `!canDecline`.
  - Buttons (pending + sent by me): **"Withdraw"** (btnQuiet), disabled if busy or `!canCancel`.
  - No buttons for accepted/declined/withdrawn/expired rows.
- `effectiveStatus`: a stored PENDING older than 15 min shows as EXPIRED (nothing sweeps the table; the server only writes EXPIRED when someone tries to accept late).
- **Play (accept):** `POST {action:'accept', id}` → on error: `err = message`, `load()`. On success `data.session = { session_id, game_code, seed, host }`; if `session_id` → `live = { sessionId: session_id, hostId: inv.fromId, opponent: inv.fromName ?? 'your opponent', gameCode: session.game_code ?? inv.gameCode, seed: session.seed ?? 1 }`; then `load()`. The screen is replaced by the live game.
- **No thanks / Withdraw:** `POST {action:'answer', id, status:'DECLINED'|'CANCELLED'}`; error → `err`; always `load()`.
- **Live game routing:** `gameCode 'mem'` → `LiveMemoryMatch`, `'quiz'` → `LiveTrivia`, otherwise `LiveTicTacToe`. Props `{ sessionId, seed, meId: who_me, hostId, opponentName, onExit: () => { setLive(null); load() } }` (TicTacToe gets no seed).
- **IMPORTANT parity gap (current behaviour):** only the **recipient** ever enters a live game. The sender (host) gets an inbox notification "{name} accepted your game invite / They are waiting in the Fun Zone." but their Invites list shows the row as "accepted" with **no Join/Play button**, and nothing in PlayTogether reads `sessionId` from the GET list. So in the current web build the guest sits on "Waiting for them to join…" unless the host somehow joins. `InviteRow.sessionId` is returned by GET (see 5.12) precisely so a "Join" for `ACCEPTED && fromId === me && sessionId` could be built — the RN rebuild must decide with product whether to replicate the gap or add Join (host would then mount the live game with `hostId = me`, `opponent = toName`, `seed` — **seed is not in the GET payload**, so a host-join would also need the seed from `game_sessions`, which no route currently exposes).

### 5.11 Live play — protocol and the three live games

#### 5.11.1 Transport (`lib/funzone/live.ts`)
- Supabase Realtime **broadcast + presence**, browser anon client from `@/lib/supabase` (no auth on the channel; anyone knowing the session UUID could join). No `postgres_changes`, no polling during play. Moves are not stored.
- Channel: `channelFor(sessionId) = 'funzone:game:' + sessionId`; created with `supabase.channel(name, { config: { broadcast: { self: false }, presence: { key: meId } } })` (own broadcasts are not echoed; `isMine` / `p.from === meId` is also checked).
- Broadcast event name: `EVENT = 'g'`. Send: `ch.send({ type: 'broadcast', event: 'g', payload: packet })`.
- Packets (`Packet` union; all carry `from: string` = sender employee id):
  ```ts
  { t: 'sync'; from; moves: Move[] }            // TTT: my full move list (on join / to catch a peer up)
  { t: 'move'; from; move: Move }               // TTT: one move {n, by:'X'|'O', cell 0-8}
  { t: 'mem'; from; turn: MemTurn }             // Memory: a whole turn {n, by:'HOST'|'GUEST', a, b}
  { t: 'memSync'; from; turns: MemTurn[] }
  { t: 'ready'; from; q: number }               // Trivia phase 1: "I have locked in question q" (NO choice)
  { t: 'answer'; from; answer: Answer }         // Trivia phase 2: {q, by, choice}
  { t: 'quizSync'; from; answers: Answer[] }
  { t: 'leave'; from }                          // deliberate exit
  { t: 'rematch'; from }                        // play again (resets the receiver's state)
  ```
- `isPacket(v)` validates shape (non-empty string `from`; integer fields; arrays of valid items; `by` in X/O or HOST/GUEST); anything else is silently dropped.
- `reconcile(mine, theirs)` / `reconcileList` — longer list wins; equal keeps local.
- Sides: `markFor(me, host)` → host = **X** (opens), guest = **O**; `sideFor(me, host)` → `'HOST'|'GUEST'`. Host = the invite sender (fixed in `game_sessions.host_employee`).
- `LiveStatus = 'connecting'|'waiting'|'playing'|'opponent_left'|'ended'|'failed'`; `STATUS_TEXT`: connecting **"Connecting…"**, waiting **"Waiting for them to join…"**, playing "", opponent_left **"They left the game."**, ended "", failed **"The live connection could not be opened. The game cannot be played across two screens right now."**

#### 5.11.2 Connection lifecycle (identical in all three live components)
1. Create channel (above). Register `broadcast` handler for event `'g'`, `presence` `leave` and `sync` handlers.
2. `subscribe(cb)`: `SUBSCRIBED` → `ch.track({ id: meId })`, send my sync packet (`sync`/`memSync`/`quizSync` with my current list — empty on first mount), status `waiting`. `CHANNEL_ERROR` or `TIMED_OUT` → status `failed`.
3. Presence `sync` → `n = Object.keys(ch.presenceState()).length`; status stays `opponent_left` if already so, else `n >= 2 ? 'playing' : 'waiting'`.
4. Presence `leave` → if any moves/turns/answers exist, status `opponent_left` (a leave before the first move is ignored).
5. Receiving a sync: adopt the longer list; if mine is longer than theirs, reply with my sync (prevents ping-pong).
6. Receiving `leave` → `opponent_left`. Receiving `rematch` → clear state, status `playing`.
7. Unmount (Leave button / Back / navigation): best-effort send `{t:'leave', from}` then `supabase.removeChannel(ch)`.
- No reconnect/rejoin protocol beyond the sync-on-subscribe; no turn timeouts; no session expiry once started (only the invite expires). A dropped socket without presence leave just stalls.
- Header row (all three; `Head` in LiveMemoryMatch reused by LiveTrivia; TTT has its own): left **"You are {X|O}"** + muted **"vs {opponentName}"** (TTT) or **"You {myScore}"** + muted **"{opponentName} {theirScore}"** (Memory/Trivia); right status pill (radius 999, F.micro semi, padding 3px 10px): **"Live"** (bg C.positiveTint, text C.positive) when playing; otherwise bg C.sunken text C.muted with **"Connecting"**, **"Waiting"**, **"No connection"**, or **"Ended"** (for opponent_left/ended).
- Status banner when `STATUS_TEXT[status]` non-empty: F.small, radius R.sm, padding 9px 12px; failed → bg C.criticalTint text C.critical; else bg C.warningTint text C.warning.
- Footer: **"Play again"** (bg C.brand, text C.onAccent, F.tiny bold) shown when the game has a result and status ≠ opponent_left → reset local state, re-arm the result save, send `rematch`. **"Leave"** (bg C.surface, border C.line, text C.inkSoft, F.tiny semi) → `onExit` (back to PlayTogether list + reload). Note: a rematch does NOT create a new `game_sessions` row; the second game's `finish` call returns `{already:'FINISHED'}` (see 5.13) so only the first result is stored.

#### 5.11.3 Live Tic-Tac-Toe (`LiveTicTacToe`)
- State `moves: Move[]`; board/outcome derived (`boardFrom`, `outcome`). `me = markFor(meId, hostId)`; `myTurn = playing && turn === me`.
- My tap on cell (enabled only when empty, my turn, and status `playing`): `m = {n: moves.length, by: me, cell}`; if `canApply` legal → append locally and broadcast `move`.
- Incoming `move`: `canApply(cur, move)` — illegal → not applied, its `because` text shown under the board (F.micro C.muted), e.g. "Move 3 arrived when 4 was expected.", "It is X's turn.", "That square is taken.", "Cell 9 is not on the board.", "The game is already over.", "{by} is not a player."; legal → applied, rejection cleared.
- Board: 3×3 grid (max width 300, gap 8), squares aspect 1, font 34 bold, radius R.md; X text `C.brand`, O text `C.critical`; winning-line squares border+tint `C.positive`/`C.positiveTint`. aria `Square {i+1}, {mark|empty}`.
- Status line (F.body semi): won → **"You won."** / **"{opponentName} won."**; draw **"A draw."**; playing → **"Your turn."** / **"{opponentName}'s turn."**; else empty.
- On game end (once per game; `saved` ref): `POST {action:'finish', session: sessionId, moves}` — errors swallowed. **Both** clients send it; the server replays the moves (first call finishes the session, second returns `already`).

#### 5.11.4 Live Memory Match (`LiveMemoryMatch`)
- `deck = memDeck(seed)` (seed from `accept` response; both sides deal identically). `me = sideFor`; HOST opens; a hit keeps the turn.
- My flips: allowed when my turn, not locked, status `playing`, card not matched/face-up. First card face up locally only. Second card → `t = {n: turns.length, by: me, a, b}`; if `memCanApply` legal → lock, show both, broadcast `mem` with the whole turn, then `showThen` peek **900 ms** (`PEEK_MS`), then append (re-validated), clear face-up, unlock. Illegal → just un-flip.
- Incoming `mem`: validated against current turns; if legal, the opponent's two cards are shown (peek 900 ms) then appended. (Single-card flips are never broadcast.)
- Board: 4×4 grid (max width 360, gap 8), cards aspect 1, font 26, radius R.md; face-down bg C.sunken; face-up bg C.surface; matched border C.positive, bg C.positiveTint, opacity .65. aria `Card {i+1}, {face}|face down`.
- Status line: result → **"A draw, {HOST} each."** / **"You won, {mine} pairs to {theirs}."** / **"{opponentName} won."**; playing → **"Your turn: turn over two."** / **"{opponentName}'s turn."**.
- On result (once): `POST {action:'finish', session, moves: [], claim: { winner: 'HOST'|'GUEST'|null, draw: boolean, host: <HOST pairs>, guest: <GUEST pairs> }}`; errors swallowed. Both clients send; server settles by agreement (5.13).

#### 5.11.5 Live Trivia (`LiveTrivia`)
- Questions `quizFor(seed)` (4 QUIZ questions in seeded order). Not turn-based: both answer the current question `state.at` (`quizReplay` advances only when both have answered).
- Two-phase answer: tap option → `pending = choice`, broadcast `{t:'ready', q: at}` (no choice). If the opponent's ready for this question had already arrived → `release(at)` immediately. Incoming `ready` → `theyReady = q`; if I have a pending choice → `release(q)`. `release`: build `{q: at, by: me, choice}`, clear pending, append (if `quizCanApply` legal), broadcast `answer`. Incoming `answer` → append if legal, `theyReady = null`.
- Screen: **"Question {at+1} of 4"** (F.micro C.faint), question text (F.lead semi, C.ink), option buttons (F.small, padding 11px 14px, radius R.sm; my locked choice border C.brand bg C.brandTint; others dimmed to .55 once answered); disabled when answered or not playing.
- Progress line (F.micro C.muted): answered & opponent not ready **"Locked in. Waiting for {opponentName}…"**; not answered & opponent ready **"{opponentName} has answered. Your turn."**; both **"Both in, revealing…"**.
- After each completed question (until result): divider, **"Last one: {correct option}"** (bold) then for each answer to that question **" · you got it|missed it"** / **" · {opponentName} got it|missed it"**.
- Result: big (22 bold) **"A draw, {HOST} each."** / **"You won."** / **"{opponentName} won."**, below **"{myScore} right out of 4."**
- On result: `finish` with `claim {winner, draw, host, guest}` (scores = correct answers). No per-question timer in the UI (the rules support `choice: -1` = "ran out of time" but nothing sends it).

### 5.12 API — `app/api/ess/funzone/route.ts`

`export const dynamic = 'force-dynamic'`. One path, `/api/ess/funzone`, GET + POST. Server uses the service-role client (`rmsServiceClient as sb`); the browser never touches the Fun Zone tables directly. All errors are JSON `{ "error": string }` via `bad(m, status=400)`.

#### 5.12.1 Client wrapper and auth (`lib/funzone/client.ts`, `lib/auth-headers.ts`)
```ts
export type InviteRow = Invite & { sessionId: string | null }
export interface FzResult<T = unknown> { data: T | null; error: { message: string; status?: number } | null }
let portalOwner: string | null = null
export const setFunzoneOwner = (id: string | null) => { portalOwner = id }
// call(): fetch(`/api/ess/funzone${portalOwner ? `?employee_id=${encodeURIComponent(portalOwner)}` : ''}`,
//               { ...init, headers: await authHeaders() })
//   !res.ok -> { data:null, error:{ message: String(payload?.error ?? `Request failed (${res.status}).`), status } }
//   network throw -> { data:null, error:{ message:'Could not reach the server.' } }   (no status)
export const listInvites = () => call<{ installed: boolean; invites: InviteRow[]; me?: string; reason?: string }>({ method: 'GET' })
export const funzone = <T>(action: string, args = {}) => call<T>({ method: 'POST', body: JSON.stringify({ action, ...args }) })
```
- `?employee_id=<portal owner>` is appended to **every** call (GET and POST) once `setFunzoneOwner` has run (PlayTogether calls it on each load). Required for the legacy dashboard login (else 400 "employee_id is required for the dashboard login."); for an ESS token whose employee equals it, it is a no-op.
- `authHeaders()` → `{ 'Content-Type': 'application/json', Authorization: 'Bearer <token>' }`. Token precedence: (1) ESS token from `localStorage['ezer_ess_session']` JSON `{ token, employee_id, … }`, used only if its base64url payload `exp` (ms) is > now + 30 s; (2) Supabase auth session `access_token` (refreshed if within 30 s of `expires_at`, seconds). No header if neither. RN: read the ESS token from SecureStore/AsyncStorage equivalent and apply the same 30 s skew rule; use an absolute base URL (`https://ezer-hrms-chi.vercel.app/api/ess/funzone`).
- Server identity (`essRoute` → `essCaller`): no/invalid bearer → **401** `"Sign in first. This endpoint needs a dashboard session."`; expired → **401** `"Your session has expired. Sign in again."`; ESS user asking for another employee without admin access → **403** `"You can only open your own portal."`; legacy login without `employee_id` → **400** `"employee_id is required for the dashboard login."`; `ess_menu` failure → **500** `"ess_menu: … Has migration 071 been run?"`. The acting player `me = ctx.caller.employeeId` (portal owner) — never from the body.
- **View-as write wall:** for actions `send`, `accept`, `answer`, `finish`, `share` when `ctx.caller.viewAs` is true → **403**:
  - shared dashboard login (`actorEmployeeId === null`): **"This session is the shared dashboard login, which is not attached to an employee record. Sign in with your own ESS account to play."**
  - admin viewing someone else's portal: **"You are looking at somebody else's portal, so this would be recorded as them. Open your own portal to send or accept a game invite."**
  (`search` and GET are allowed while viewing as.)
- Body helper `str(k)`: a non-empty trimmed string, else `null`.

#### 5.12.2 `GET /api/ess/funzone[?employee_id=…]` — my invites
- Query (service role): `game_invites` `.select('id,game_code,from_employee,to_employee,status,created_at,message,session_id')` `.or('from_employee.eq.<me>,to_employee.eq.<me>')` `.order('created_at', { ascending:false })` `.limit(40)`; then `employees.select('id, full_name').in('id', <all from/to ids>)` for names.
- Response headers: `Cache-Control: no-store, no-cache, must-revalidate`.
- Not installed (PostgREST `PGRST205`, table missing): **200** `{ "installed": false, "invites": [], "reason": "The Fun Zone multiplayer tables are not in the database yet (migration 090)." }`
- Other DB error: treated as an empty list (`{ installed: true, invites: [], me }`).
- OK **200**:
  ```json
  { "installed": true, "me": "<employee uuid>",
    "invites": [ { "id": "uuid", "gameCode": "ttt|quiz|mem", "fromId": "uuid", "toId": "uuid",
                   "fromName": "string|null", "toName": "string|null",
                   "status": "PENDING|ACCEPTED|DECLINED|CANCELLED|EXPIRED",
                   "createdAt": "ISO timestamptz", "message": "string|null", "sessionId": "uuid|null" } ] }
  ```
  (max 40, newest first; stored status — the client derives EXPIRED for stale PENDING.)

#### 5.12.3 `POST` body `{ action, ... }` — every variant

| action | body | validation / errors (status 400 unless noted) | success 200 |
|---|---|---|---|
| `search` | `{ action:'search', q }` | `q` missing or < 2 chars → `{ ok:true, people:[] }` (not an error). DB error → `bad(error.message)` | `{ ok:true, people:[{ id, name, code: string\|null, designation: string\|null }] }` |
| `send` | `{ action:'send', to, game, message? }` | missing `to`/`game` → **"Who, and which game?"**; recipient not found → **"No such colleague."**; tables missing → **503** **"Fun Zone multiplayer is not installed yet (migration 090)."**; `canInvite` refusal → its `because` (below); unique-index race (`23505`) → **"You already have a pending invite to this colleague for this game. Wait for their reply, or cancel it under Invites first."**; other insert error → raw message | `{ ok:true, id: "<invite uuid>" }` |
| `accept` | `{ action:'accept', id }` | missing id → **"Which invite?"**; not in my 40 invites → **403** **"That invite is not yours."**; addressed to someone else → **403** **"This invite was sent to {toName ?? 'somebody else'}, and you are signed in as {myName ?? 'another employee'}. If that is not who you expected, you are looking at a colleague's portal. Open your own to accept invites addressed to you."**; `canAccept` refusal → its `because`; RPC missing (`PGRST202`) → **503** **"Fun Zone multiplayer is not fully installed yet (migration 096). Ask your administrator to run it."**; other RPC error → its message (e.g. SQL RAISE texts in 5.13) | `{ ok:true, session: { session_id, game_code, seed, host } }` |
| `answer` | `{ action:'answer', id, status:'DECLINED'\|'CANCELLED' }` (case-insensitive) | missing id → **"Which invite?"**; other status → **"Decline or cancel?"**; not mine → **403** **"That invite is not yours."**; `canDecline`/`canCancel` refusal → `because`; update error → raw | `{ ok:true }` |
| `finish` | `{ action:'finish', session, moves?: Move[], claim?: {winner,draw,host,guest}\|null }` | missing session → **"Which game?"**; RPC error → its message | `{ ok:true, data: <finish_game jsonb> }` |
| `share` | `{ action:'share', session, with?: uuid[], note? }` | missing session → **"Which game?"**; RPC error → its message | `{ ok:true, data: { session_id, shared_with: <count> } }` |
| other | — | **"Unknown action '{action}'."** | — |

Details per action:
- **search** — first reads my `company_id` (`employees.select('company_id').eq('id', me).maybeSingle()`), then `employees.select('id, full_name, emp_code, designation').neq('id', me).is('date_of_leaving', null).or(orIlike(['full_name','emp_code'], q)).order('full_name').limit(10)` plus `.eq('company_id', company)` when known. `orIlike` → `full_name.ilike."%q%",emp_code.ilike."%q%"` with `\` and `"` escaped (`%`/`_` stay wildcards). Only people with no leaving date are searchable; max 10.
- **send** — reads recipient `employees(id, full_name, date_of_leaving)` and my `employees(company_id, full_name)`. "Still here" = no `date_of_leaving` or `date_of_leaving >= today (UTC date)`. Re-reads my invites and runs `canInvite(me, to, game, { liveGames: ['ttt','quiz','mem'], existing: rows, now, toIsActive })`. Inserts `game_invites { company_id: <my company>, game_code, from_employee: me, to_employee: to, message: str('message') }` (`.select('id, created_at').single()`). Then **notifies the recipient** (see 5.14). `message` is stored but never length-limited server-side.
- **accept** — `canAccept(inv, me, now)` then `sb.rpc('accept_game_invite_as', { p_actor: me, p_invite: id })`.
- **answer** — ownership via `canDecline` (recipient only) or `canCancel` (sender only); `game_invites.update({ status, answered_at: now }).eq('id', id)`; then notifies the other party (5.14).
- **finish** — `sb.rpc('finish_game_as', { p_actor: me, p_session: session, p_moves: body.moves ?? [], p_claim: body.claim ?? null })`.
- **share** — `sb.rpc('share_game_score_as', { p_actor: me, p_session: session, p_with: Array.isArray(body.with) ? body.with : [], p_note: str('note') })`. **No UI calls `share`** in the current web app (route + RPC exist; the "share your score" feature is server-only so far).

`lib/funzone/invite.ts` refusal texts (`because`), used by both client and server:
- `canInvite`: **"You cannot invite yourself."** · **"That game has no two-player mode."** · **"That person has left the company."** · **"You already have an invite waiting with them ({minutesLeft} minutes left on it)."**
- `canAccept`: **"This invite was not sent to you."** · **"This invite has expired. Invites last 15 minutes, because a game is an offer to play now."** · **"This invite was already {accepted|declined|withdrawn}."** (`STATUS_LABEL` of the effective status; EXPIRED is caught by the previous rule)
- `canCancel`: **"Only the person who sent it can withdraw it."** · **"It is no longer waiting for an answer."**
- `canDecline`: **"This invite was not sent to you."** · **"It is no longer waiting for an answer."**
- Timing: `isExpired` = `(now - createdAt)/60000 >= 15`; `minutesLeft = max(0, ceil(15 - elapsedMinutes))`.

### 5.13 Database (migrations 090 + 096; depends on 094 `wof_act_as`)

**`game_invites`**: `id uuid pk default gen_random_uuid()`, `company_id uuid not null`, `game_code text not null`, `from_employee uuid not null → employees(id) on delete cascade`, `to_employee uuid not null → employees(id) on delete cascade`, `message text`, `status text not null default 'PENDING' check in ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')`, `session_id uuid`, `created_at timestamptz not null default now()`, `answered_at timestamptz`; check `from_employee <> to_employee`. Unique partial index `uq_game_invites_open (from_employee, to_employee, game_code) where status = 'PENDING'`; index `idx_game_invites_inbox (to_employee, status, created_at desc)`.

**`game_sessions`**: `id uuid pk`, `company_id uuid not null`, `game_code text not null`, `host_employee uuid not null` (the inviter; plays X / HOST and opens), `guest_employee uuid not null`, `invite_id uuid → game_invites(id) on delete set null`, `status text not null default 'OPEN' check in ('OPEN','FINISHED','ABANDONED')`, `seed int not null default floor(random()*2147483647)`, `pending_claim jsonb`, `claimed_by uuid → employees`, `host_score int`, `guest_score int`, `winner text check in ('HOST','GUEST')`, `is_draw boolean not null default false`, `move_count int not null default 0`, `started_at timestamptz default now()`, `finished_at timestamptz`; checks not-self and "FINISHED ⇒ (draw and winner null) or (not draw and winner not null)". Indexes on `(host_employee, started_at desc)`, `(guest_employee, started_at desc)`.

**`game_score_shares`**: `id`, `company_id`, `session_id → game_sessions on delete cascade`, `shared_by → employees`, `shared_with uuid[] not null default '{}'`, `note text`, `created_at`, `unique (session_id, shared_by)`.

RLS on these tables is **not written** (left to "Nayan"); the browser does not query them anyway — only the service-role route does.

**RPCs** (all `security definer`, `search_path = public`; the plain versions identify the caller with `funzone_current_employee()` = `current_setting('app.current_employee_id')`). 096 adds `*_as` wrappers that call `wof_act_as(p_actor)` then the inner function; **all six are revoked from public/anon/authenticated and granted to `service_role` only** — RN must go through the route, never call them directly.

- `wof_act_as(p_actor uuid) returns void` — raises **"An actor is required. The caller must resolve the employee before calling a wall function."** if null; **"Employee {id} is not an active employee"** if not found or `date_of_leaving < current_date`; sets `app.current_employee_id` (transaction-local).
- `accept_game_invite_as(p_actor uuid, p_invite uuid) returns jsonb` → `accept_game_invite(p_invite)`:
  - raises **"That invite no longer exists"**; **"This invite was not sent to you"**; **"This invite was already {lower(status)}"** (e.g. "already accepted", "already cancelled"); if age ≥ 15 min: sets status EXPIRED + answered_at and raises **"This invite expired — they were offering to play at the time"**.
  - inserts `game_sessions (company_id, game_code, host_employee = from, guest_employee = me, invite_id)`; sets invite `ACCEPTED`, `answered_at`, `session_id`; inserts `ess_notifications` for the host (5.14).
  - returns `{ "session_id": uuid, "game_code": text, "seed": int, "host": uuid(from_employee) }`.
- `finish_game_as(p_actor uuid, p_session uuid, p_moves jsonb default '[]', p_claim jsonb default null) returns jsonb` → `finish_game(...)`:
  - raises **"That game no longer exists"**; **"You were not playing in that game"**.
  - session not OPEN → returns `{ "id": uuid, "already": "FINISHED"|"ABANDONED" }`.
  - **Claim path** (Memory/Trivia, `p_claim` not null): no pending claim → store `pending_claim`, `claimed_by = me`, return `{ id, status: 'AWAITING_CONFIRMATION' }`; same player again → `{ id, status:'AWAITING_CONFIRMATION', why:'waiting for the other player' }`; other player with a different claim (jsonb `<>`) → status ABANDONED, `{ id, status:'ABANDONED', why:'the two players reported different results' }`; matching claim → FINISHED with `is_draw = claim.draw`, `winner = draw ? null : claim.winner`, `host_score = claim.host`, `guest_score = claim.guest`, returns `{ id, status:'FINISHED', winner: claim.winner }`. (Claim JSON must be byte-identical in key/value semantics on both clients: `{ winner, draw, host, guest }`.)
  - **Replay path** (TTT): replays `p_moves` (`cell` 0–8, `by` X/O, square empty) — any bad move → ABANDONED `{ id, status:'ABANDONED', why:'the move list did not replay' }`; no winner and < 9 moves → ABANDONED with `move_count`, `why:'the game was not played out'`; else FINISHED with `move_count`, `is_draw`, `winner` = X→HOST, O→GUEST; returns `{ id, status:'FINISHED', winner: 'X'|'O'|null, moves: n }`. (Turn order is not checked by SQL; the client rules enforce it.)
- `share_game_score_as(p_actor uuid, p_session uuid, p_with uuid[] default '{}', p_note text default null) returns jsonb` → `share_game_score(...)`: raises **"That game no longer exists"**; **"You can only share a game you played in"**; **"That game did not finish, so there is no score to share"**; upserts `game_score_shares` on `(session_id, shared_by)`; notifies each `p_with` id (5.14); returns `{ "session_id": uuid, "shared_with": <array length or 0> }`.

No leaderboard/history query exists anywhere (no route reads `game_sessions` for display).

### 5.14 How Fun Zone reaches the Inbox (notifications)

All rows go to `ess_notifications` with `category = 'FUNZONE'`:

| Trigger | Inserted by | Recipient | title | body | link | notification_code |
|---|---|---|---|---|---|---|
| Invite sent (`send`) | route `notify()` | invitee | `inviteLine` → **"{senderName ?? 'A colleague'} wants to play {Tic-Tac-Toe\|EZER Trivia\|Memory Match} with you"** | **"It is good for fifteen minutes. Open Fun Zone → Play together to join."** | `/ess?tab=funzone` | — (not set) |
| Invite withdrawn (`answer` CANCELLED) | route | invitee | **"A game invite was withdrawn"** | **"{fromName ?? 'A colleague'} cancelled the invite."** | `/ess?tab=funzone` | — |
| Invite declined (`answer` DECLINED) | route | inviter | **"Your game invite was declined"** | **"{toName ?? 'They'} cannot play just now."** | `/ess?tab=funzone` | — |
| Invite accepted | SQL `accept_game_invite` | inviter (host) | **"{accepter full_name} accepted your game invite"** | **"They are waiting in the Fun Zone."** | NULL | `FUNZONE_INVITE_ACCEPTED` (+ `actor_employee_id`) |
| Score shared | SQL `share_game_score` | each `p_with` | **"{sharer full_name} shared a game result"** | `p_note` or **"From the Fun Zone."** | NULL | `FUNZONE_SCORE_SHARED` (+ actor) |

`notify(employeeId, title, body, link, category)` inserts `{ employee_id, category, title, body, link, is_read: false }`.
Inbox mirroring (`lib/inbox/server.ts`): each `ess_notifications` row is copied into the employee's SYSTEM conversation as an `inbox_messages` row `{ kind:'NOTIFICATION', body: title + '\n' + body, notification_code: <category>, link }`; folder = `streamFor(category)` → codes starting `FUNZONE` or `GAME` map to the **FUNZONE** folder (label **"Fun Zone"**, hint **"Game invites and scores colleagues shared"**, ink light `#115E59` / dark `#3FC7BE`, gamepad icon in `components/ess/inbox/icons.tsx`). Note the mirror de-duplicates on `category|link`, so repeated FUNZONE notifications with the same link may be collapsed by the mirror — current server behaviour, not something the client controls. There is no realtime push for invites: the recipient learns of an invite via the inbox or the 15 s Play Together poll.

### 5.15 AI / computer opponent — what it is NOT

`lib/funzone/ai.ts` is a **local, deterministic-given-rand bot**: no HTTP endpoint, no LLM, no model, no prompt, no API key, no fallback path. Everything is pure functions (5.8). Nothing in Fun Zone calls Gemini or any `/api/*/ai` route. Constants: `TACTICAL {easy:0.4, medium:1, hard:1}`, `MEM_RECALL {easy:2, medium:6, hard:16}`, `KNOWS {easy:0.35, medium:0.6, hard:0.85}`, `botDelay base {hard:700, medium:1100, easy:1600} + rand*900`.

### 5.16 Visual system (for faithful re-skin)

- Fun Zone uses its own stylesheet (`design/funzone.css` → `FZ_CSS` string injected by `<FzStyles/>` as `<style data-fz="funzone">`), whose neutrals map to portal tokens with fallbacks: `--fz-ink = --ez-ink` (C.ink), `--fz-ink-soft` (C.inkSoft), `--fz-muted` (C.muted), `--fz-surface` (C.surface), `--fz-canvas` (C.canvas), `--fz-sunken` (C.sunken), `--fz-line` (C.line), `--fz-brand` (C.brand), `--fz-brand-deep` (C.brandDeep), `--fz-on-accent` (C.onAccent), `--fz-positive(+tint)`, `--fz-critical(+tint)`, `--fz-warning(+tint)` (C.positive/positiveTint etc.). Fun-Zone-only constants: stage `#1E1B4B`→`#2B2566` (dark mode `#0B0A18`/`#1B1840`), on-stage text `#F5F3FF`, secondary `#C4BCF5`; edge `rgba(30,27,75,.14)` (dark `rgba(255,255,255,.10)`), keycap shadow `rgba(30,27,75,.16)` (dark `rgba(0,0,0,.55)`). Display font "Bricolage Grotesque" 800 for titles/numbers; body DM Sans; tabular numerals.
- Category accents (`--a` vivid / `--a-solid` fill under white text / `--a-ink` text on tint / `--a-tint` bg; dark-mode ink/tint in parentheses):
  arcade `#8B5CF6 / #6D28D9 / #5B21B6 / #EDE9FE` (`#C4B5FD`, `rgba(139,92,246,.16)`);
  quiz `#3B82F6 / #1D4ED8 / #1E40AF / #DBEAFE` (`#93C5FD`, `rgba(59,130,246,.16)`);
  social `#EC4899 / #BE185D / #9D174D / #FCE7F3` (`#F9A8D4`, `rgba(236,72,153,.16)`);
  puzzle `#F59E0B / #B45309 / #92400E / #FEF3C7` (`#FCD34D`, `rgba(245,158,11,.15)`);
  memory `#14B8A6 / #0F766E / #115E59 / #CCFBF1` (`#5EEAD4`, `rgba(20,184,166,.15)`);
  reflex `#F97316 / #C2410C / #9A3412 / #FFEDD5` (`#FDBA74`, `rgba(249,115,22,.15)`);
  words `#22C55E / #15803D / #166534 / #DCFCE7` (`#86EFAC`, `rgba(34,197,94,.15)`);
  brain `#F43F5E / #BE123C / #9F1239 / #FFE4E6` (`#FDA4AF`, `rgba(244,63,94,.15)`);
  logic `#06B6D4 / #0E7490 / #155E75 / #CFFAFE` (`#67E8F9`, `rgba(6,182,212,.15)`).
- Hero title letter colours (by position in "Fun Zone"): F `#C4B5FD`, u `#FCD34D`, n `#5EEAD4`, (space), Z `#F9A8D4`, o `#93C5FD`, n `#86EFAC`, e `#FDBA74`; 44–76 px; each letter animates in with a 45 ms stagger. Hero "Surprise me" key uses amber `#FBBF24` with ink `#1E1B4B`. Hero has a dot-matrix overlay and a violet radial glow (decorative).
- Buttons ("arcade keys", `.fz-key`): solid `--a-solid` fill, white text, 4 px solid offset shadow that the key presses down into on press (`soft` variant = tint bg + ink text; `sm` 12.5 px; `lg` 16 px). Radii: key 12 (sm 10, lg 14), chips/pills 999, tiles 20, stage/hero 24, mode cards 18.
- Tiles: "cartridge" (8 px padding, 20 radius, 5 px keycap shadow), screen area 108 px (classics 132 px; ≤560 px wide: 84 px), emoji 50 px (classics 60; mobile 40), name 18 px display, desc 12.5 px muted (desc hidden ≤560 px), tags 11 px pills. Grids: mind games `auto-fill minmax(190px,1fr)` gap 16; classics 4 columns; ≤560 px both 2 columns gap 12.
- Stage header uses the category tint with a dotted pattern, 52 px icon box, 24 px title (mobile 20), 13 px sub; body is centred grid with 16 px gap (`left` variant stretches — used for Play Together).
- Status line tones: win `--fz-positive`, lose `--fz-critical`, draw `--fz-muted`, 16 px bold.
- Mobile sizes (≤560 px): ttt cell 84 (92 default), memory card 66 (78), 2048 tile 64 (76), echo pad 108 (128), wheel 260 (300), slide tile 84 (96), lights cell 50 (58), mines cell `(100vw - 90px)/9` (36).
- Animations (CSS keyframes, recreate natively): `fz-view` screen enter (opacity + translateY 10 px, .38 s); `fz-deal` tile deal-in (translateY 26 px + slight rotate, 40 ms stagger); `fz-letter`; `fz-pop` status/result; `fz-bump` stat value pop (scale 1.35); `fz-pulse` busy dot; `fz-mark` mark/tile appear; `fz-winbeat` winning squares ×2; card 3-D flip (`rotateY(180deg)`, .42 s) and `fz-matched`; `fz-shake` (wrong answer / Echo miss / mine hit / clash wrong); `fz-fall` confetti; wheel 4 s `cubic-bezier(.17,.67,.12,.99)` rotation, rim bulbs blink (1.2 s, .3 s while spinning), pin wobble; 2048 `fz-merge`; timebar 1 s linear. `prefers-reduced-motion` disables all animations and hides confetti — honour `AccessibilityInfo.isReduceMotionEnabled` in RN.

### 5.17 Business rules worth restating (all live in pure TS — import, do not rewrite)

- Invite TTL **15 min** (`INVITE_TTL_MINUTES`), enforced client-side (`invite.ts`), in the route (`canAccept`) and in SQL (`interval '15 minutes'`). Expired = derived, not swept.
- One open invite per (sender, recipient, game) — client rule, server rule and DB unique index.
- Search returns only colleagues with no `date_of_leaving`, in the caller's company (when known), excluding the caller, max 10. `send` itself re-checks only that the recipient exists and has not left (`date_of_leaving` null or ≥ today) — it does **not** re-check company. You cannot invite yourself; only ttt/quiz/mem are live.
- Only the recipient accepts/declines; only the sender withdraws.
- Host (sender) = X / HOST and always opens; fixed by the session.
- TTT results are re-derived server-side from the move list; Memory/Trivia results need **both** clients to post identical claims.
- No persistence of solo/bot/mind-game scores; "best" values are per sitting; nothing is ranked. The footer copy promises this.
- The quiz bank (4 questions) and memory faces (8) are shared constants in `games.ts` used by solo, bot and live modes.

### 5.18 Implementation notes for React Native (Fun Zone)

1. **Reuse the pure modules unchanged**: `lib/funzone/games.ts`, `ai.ts`, `mindgames.ts`, `invite.ts`, `live.ts` have no DOM/Next/Supabase imports. Only gotcha: `ai.ts` imports `'./games.ts'` with an explicit extension — configure Metro/TS (`allowImportingTsExtensions`, or a Babel resolver) or vendor a copy with `'./games'`. Keep the hooks `useTimers`/`useCountdown` from `components/funzone/ui.tsx` (plain React; copy them out of the `'use client'` file which also imports the CSS string).
2. **No canvas anywhere.** Every game is a grid of buttons/divs → `View`/`Pressable` grids. The wheel is a CSS `conic-gradient` — draw six wedges with `react-native-svg` (`Path` arcs, segment i from `i*60°` clockwise from 12 o'clock, colours in 5.7.4) and rotate the whole SVG with Reanimated (`withTiming(deg, { duration: 4000, easing: Easing.bezier(.17,.67,.12,.99) })`); keep the accumulate-rotation rule and read the prize at 4100 ms with the same `(360 - next % 360) % 360` formula so the outcome matches the visual.
3. **Card flips / tile glides / confetti / shakes**: Reanimated (`rotateY` with `backfaceVisibility:'hidden'` for Memory; absolute-positioned slide-puzzle tiles animated by `translateX/Y`; 36 deterministic confetti pieces using the index formulas in 5.6). Respect reduce-motion.
4. **Keyboard input**: 2048's arrow/WASD and Quick Draw's Space/Enter are web-only; on mobile the D-pad and swipe (use `react-native-gesture-handler` Pan/Fling, 24 px threshold, dominant axis) and tap are the inputs. Payroll Scramble and Math Sprint need a `TextInput` (Scramble: `autoCapitalize="characters"`, `autoCorrect={false}`, `maxLength=len+2`, auto-focus per word; Sprint: `keyboardType="number-pad"`, digits only, max 4) — consider hiding the system keyboard for Sprint since an on-screen numpad exists (`showSoftInputOnFocus={false}`), but keep the field for parity. Minesweeper right-click → long-press to flag (plus the Dig/Flag toggle).
5. **Timers**: `setTimeout`/`setInterval` work in RN; clear on unmount and on app background (AppState) — Scramble (60 s) and Sprint (45 s) use wall-clock (`Date.now()`) so they keep counting while backgrounded, matching web. Quick Draw should use `performance.now()` (Hermes supports it) and `onPressIn` to match web's `pointerdown`. Memory flip-back 800 ms (solo), 850 ms (bot), 900 ms (live peek); Trivia advance 900 ms (solo), bot reveal `botDelay` + 1400 ms; Echo timings in 5.9.2.
6. **Realtime**: use `@supabase/supabase-js` in RN (needs `react-native-url-polyfill`); same anon key, same channel `funzone:game:<sessionId>`, config `{ broadcast: { self:false }, presence: { key: meId } }`, event `'g'`, presence `track({ id: meId })`, same packet shapes, `isPacket` validation and longer-list reconcile so a web and a mobile player can play each other. Send `{t:'leave'}` and `removeChannel` on unmount **and** when the app goes to background (otherwise presence leave arrives late). Handle `CHANNEL_ERROR`/`TIMED_OUT` → "No connection" state.
7. **Polling**: Play Together polls GET every 15 s while mounted; pause on background, refetch on foreground. Search debounce 250 ms, ≥ 2 chars.
8. **Auth**: send `Authorization: Bearer <ESS token>` and append `?employee_id=<own id>` to every Fun Zone call exactly like `lib/funzone/client.ts`; map 401 to the "Please sign in again" card; network failure message "Could not reach the server.".
9. **Deep link**: inbox items link to `/ess?tab=funzone` — map to the Fun Zone hub screen in the app router.
10. **Known gaps to raise before building** (do not silently "fix" without product sign-off): (a) the host has no way to join an accepted game (5.10.4) and the seed is not exposed to them; (b) the hub's selected game is not pre-selected in Play Together (always Tic-Tac-Toe); (c) `share` exists server-side with no UI; (d) "Daily spin" is not limited; (e) rematches never create a new session, so only the first game of a sitting is recorded; (f) the Minesweeper copy says "Right-click".


## 6. SOCIAL (`components/ess/social/Social.tsx`)

### 6.1 Purpose, modes and states

**Purpose.** One section with four sub-tabs: **Wall of Fame**, **Birthdays**, **Work anniversaries** and **New joiners**.

**Scope.** This is the only surface that crosses company lines: the scope is the caller's **group** (every company sharing `companies.group_id`). That is why every person carries a company chip.

**Two modes.**

- Given `initial` (the design harness at `/social-preview`), the component uses `mock.ts` data and makes no network calls.
- Given `employeeId` (live), it fetches `/api/ess/social`. In live mode the Wall tab renders `<WallOfFame employeeId/>` (§6.4) rather than feed cards. **RN implements live mode only.**

**States before the feed.**

- **Pending.** Shown when the route answers 503 or the body has `installed:false`. A card with a trophy icon:
  - Heading: **"Social is not switched on yet"**
  - Hint: "The screens are built and waiting. The tables they read come from migration 118, which is written and handed over but not applied to this database yet. Nothing here is broken."
- **Load error (no data yet).** A card with a shield-off icon:
  - Heading: **"Could not load Social"**
  - Hint: the error text, which is `j.error || 'Could not load Social'`.
- **Loading.** A blank 220 px card at 50 % opacity.
- **Later errors.** Any write error once data is loaded shows a red notice, *"That did not save"*, with the error text below. It sits under the tabs and stays until a later successful load clears `err`.

### 6.2 API: `/api/ess/social` (`app/api/ess/social/route.ts`)

The client sends `GET /api/ess/social?employee_id=<id>` with `headers: await authHeaders()`.

**Server steps:**

1. **Resolve the group.** Read the caller's company and its `group_id`.
   - If the company has no group, the scope is the caller's own company: `companyIds = [ctx.companyId]`, `name = null`.
   - If the caller has no company: 400 `Your employee record has no company, so there is no feed to show.`
2. **Materialise.** When a group exists, call `rpc('ess_social_materialise', { p_group_id, p_birthday_days: 14, p_anniversary_days: 7 })`.
   - This is idempotent through a unique key on `(kind, subject_employee_id, occasion_on)`.
   - **Birthdays:** active employees in the group with `date_of_birth`. `occasion_on` is this year's day-of-year date, and only dates between `current_date` and `current_date + 14` are created. No year or age is stored.
   - **Anniversaries:** from `company_doj`, the same way, within 7 days. Only when completed years ≥ 1. `years` is stored.
   - **Joiners:** from `ess_new_joiners` where `is_hidden = false`, the employee is active, and `current_date ≤ code_issued_at::date + ess_new_joiner_settings.announce_days` (default 30). `occasion_on = coalesce(joined_on, code_issued_at::date)`.
   - If the error message matches `/PGRST202|PGRST205|does not exist/i`, the route answers **503** `{ error:'Social is not switched on yet: migration 118 has not been applied.', installed:false }`.
3. **Read the stores.**
   - `social_posts` (`id, kind, subject_employee_id, occasion_on, years, created_at, removed_reason, removed_at`) where `company_id` is in the group's companies, ordered by `occasion_on` **ascending**, limit 300.
   - `social_reactions`, `social_comments` (ordered by `created_at` ascending), `social_comment_reactions` and `social_intros`.
   - `v_company_feed` (`id, message, published_at, category_label, category_glyph, giver_id, receivers, company_id`) for the group's companies, ordered by `published_at` descending, limit 30.
   - People: `employees` with `id, full_name, designation, departments(dept_name), companies(company_name)`. **`date_of_birth` is never selected.**
4. **Reactions.** Tallied as `{emoji, count, mine}` per target, in first-seen order.

**Response shape:**

```jsonc
{
  "group": { "name": "<group_name> | 'your company'", "companies": <number of companies> },
  "me": Person,
  "today":              [Post],   // social posts where on === today (UTC date of the server) and kind !== 'joiner'
  "upcoming_birthdays": [Post],   // kind 'birthday' and on > today
  "week_anniversaries": [Post],   // kind 'anniversary' and on > today
  "joiners":            [Post],   // every kind 'joiner' post, regardless of date
  "wall": [WallPost],
  "notices": [{ "id", "kind", "excerpt": "Your birthday post" | "Your anniversary post" | "Your new joiner post",
                "removed": { "remark", "at" } }]   // removed posts whose subject is me
}
```

**`Person`:**

```jsonc
{ "id", "name",                 // full_name, or 'A colleague'
  "initials",                   // first letters of the first two words, upper-case, or '?'
  "designation", "department", "company" }
// an unknown id becomes { id, name:'A colleague', initials:'?', designation:null, department:null, company:null }
```

**`Post`** (`source:'social'`):

```jsonc
{ "id", "source":"social", "kind":"birthday|anniversary|joiner", "subject": Person,
  "at": created_at, "on": occasion_on (YYYY-MM-DD), "years": number|undefined,
  "joined_on": "joiner only", "intro": "string|null (joiner only)",
  "hobbies": [] , "skills": [],          // joiner only
  "reactions": [{ "emoji", "count", "mine" }],
  "comments": [{ "id", "author": Person,
                 "body": "''" if removed,
                 "media": { "kind":"gif", "ref":"<media_ref>", "label":"<media_ref>" } | null,
                 "at", "reactions": [...], "mine": boolean,
                 "removed": { "remark", "at" } | null }],
  "acted": true when any comment is mine,
  "removed": { "remark", "at" } | null,
  "mine": false }
```

**`WallPost`:**

```jsonc
{ "id", "source":"wall", "kind":"shoutout",
  "subject": Person,            // receivers[0], else the giver
  "author": Person,             // the giver
  "at": published_at, "body": message,
  "category": { "label", "glyph" } | null,
  "reactions": [], "comments": [], "acted": false, "removed": null,
  "mine": giver_id === me }
```

Notes on what the GET returns:

- Posts whose subject is me are left out of every list.
- `removed_by` is never returned.
- The `wall` reactions and comments are always empty here. Live mode does not render `wall` anyway.
- **Quirks to preserve:**
  - "today" is the server's **UTC** date, but the materialiser uses Postgres `current_date`.
  - Because the post read is limit 300 **ascending**, very old posts can push recent ones out.
  - `upcoming_birthdays` and `week_anniversaries` have no upper bound in the GET. The materialiser windows bound them in practice.

#### `POST /api/ess/social`

Every action is refused while viewing another portal, with **403**:

- When `actorEmployeeId === null`: `Your ESS session is not active, so a post has nobody to attribute it to. Sign in again with your own ESS account to post.`
- Otherwise: `A post carries your own name, so it cannot be made while you are viewing another portal. Open your own to post.`

The client sends `headers: {'Content-Type':'application/json', ...authHeaders()}`. On any non-2xx it throws `error || 'That did not save'`.

**`react`** — body `{ "action":"react", "post_id", "emoji" }`. The client also sends `source:'wall'` for wall posts; the server ignores it and always uses `social_reactions`.

| Condition | Result |
|---|---|
| `post_id` or `emoji` missing | 400 `post_id and emoji are required` |
| I already have that emoji on the post | The row is deleted; returns `{ok:true, mine:false}` |
| Otherwise | A row is inserted; returns `{ok:true, mine:true}` |
| Insert fails | 500 with the DB message |

**`react_comment`** — body `{ "action":"react_comment", "comment_id", "emoji" }`. Same toggle, on `social_comment_reactions`. A missing field gives 400 `comment_id and emoji are required`. *No UI calls this* (§6.3).

**`comment` / `wish`** — body `{ "action":"comment"|"wish", "post_id", "body", "media_ref": string|null }`.

- The body is trimmed and cut to 1000 characters. `media_ref` is cut to 60.

| Condition | Result |
|---|---|
| No `post_id` | 400 `post_id is required` |
| Neither text nor media | 400 `Write something, or pick a GIF.` |
| Post not found | 404 `No such post` |
| Post removed | 409 `That post has been removed.` |
| Comment insert fails | 500 |

- On success a row is inserted into `social_comments` `{post_id, employee_id: me, body, media_ref}`.
- When the subject is not me:
  - **`wish`** — if I have not already sent the subject an `ess_kudos` today (UTC day):
    - Insert `ess_kudos {from_employee_id: me, to_employee_id: subject, message: text||null, badge: 'BIRTHDAY'|'ANNIVERSARY'|'JOINING', points: 0}`.
    - Notify the subject with `WISH_RECEIVED` (link `/ess`). The title is:
      - `🎂 {sender} wished you a happy birthday`
      - `🌟 {sender} congratulated you on your work anniversary`
      - `👋 {sender} welcomed you`
    - The notification body is the text.
  - **`comment`** — notify the subject with `SOCIAL_COMMENT` (link `/ess?tab=social`), title `{sender} commented on your post`.
- Response: `{ ok:true, id, at, duplicate:boolean }`. `duplicate` is true when a wish today already existed. The comment is still stored.

**`intro`** — body `{ "action":"intro", "intro", "hobbies":[], "skills":[] }`.

- This upserts my `social_intros`.
- `intro` is cut to 600 characters, or set to null when empty.
- Hobbies: at most 10, each at most 40 characters. Skills: at most 12, each at most 40.
- Returns `{ok:true}`. **No UI calls this today**: the joiner's intro has no editor in this module.

**`remove`** (HR only) — body `{ "action":"remove", "target":"post"|"comment", "id", "reason" }`.

| Condition | Result |
|---|---|
| Caller lacks admin access (`hasAdminAccess`) | 403 `Only HR can remove a post.` |
| No `id` | 400 `id is required` |
| `reason` under 5 characters (after trim, cut to 300) | 400 `Give a remark. The author is shown it in place of their words.` |
| Item not found | 404 `No such item` |

- On success it sets `removed_by`, `removed_reason` and `removed_at`.
- It notifies the author with `SOCIAL_COMMENT_REMOVED` or `SOCIAL_POST_REMOVED`:
  - Title: `A comment of yours was removed` / `A post of yours was removed`
  - Body: `Removed for violating company policy. “{reason}”`
- No UI calls this in ESS.

**Any other action:** 400 `Unknown action '<x>'.`

**Tables (migration 118):**

- `social_posts`
  - `kind` is one of birthday / anniversary / joiner.
  - `occasion_on` date; `years` is set for anniversaries only.
  - `removed_*` columns.
- `social_reactions`: unique `(post_id, employee_id, emoji)`.
- `social_comments`
  - `body` is at most 1000 characters, default `''`.
  - `media_ref`, `parent_comment_id` (unused), `edited_at` (unused), `removed_*`.
  - Check: body non-empty **or** `media_ref` set.
- `social_comment_reactions`: unique `(comment_id, employee_id, emoji)`.
- `social_intros`
  - `intro` is at most 600 characters.
  - `hobbies text[]`, `skills text[]`.

All of these have the allow-all RLS policy. **The browser never queries them directly**; only through the API.

### 6.3 Layout and behaviour

Wrapper `.soc`. The accent comes from the open tab, through `kindStyle`:

| Kind | Light (ink / ink-2 / tint) | Dark (ink / ink-2 / tint) |
|---|---|---|
| shoutout (Wall) | `#1D4ED8` / `#60A5FA` / `#DBEAFE` | `#60A5FA` / `#93C5FD` / `#152A4A` |
| birthday | `#BE123C` / `#FB7185` / `#FFE4E6` | `#FDA4AF` / `#FB7185` / `#3A0D1A` |
| anniversary | `#B45309` / `#F59E0B` / `#FEF3C7` | `#FCD34D` / `#F59E0B` / `#3A2A08` |
| joiner | `#0E7490` / `#22D3EE` / `#CFFAFE` | `#67E8F9` / `#22D3EE` / `#062B33` |

The CSS variables are `--soc-*`; cards use the `--ez-shadow-raised` elevation.

**Page, top to bottom:**

1. **Scope chip:** `{group.name} · {group.companies} company|companies`.
2. **Tabs** (`nav`, "Social sections"). Each tab is an icon, a label and a count. **The counts are never summed.**

   | Tab | Icon | Count |
   |---|---|---|
   | Wall of Fame | Trophy | `wall.length` (from the API; at most 30) |
   | Birthdays | Cake | today's birthdays + `upcoming_birthdays.length` |
   | Work anniversaries | Medal | today's anniversaries + `week_anniversaries.length` |
   | New joiners | Door | `joiners.length` |

   - The default tab is `wall`.
3. **Notices.** One collapsible `<details>` per `notices[]` entry.
   - Summary: shield icon, **"A post of yours was removed"**, then the excerpt.
   - Expanded: `RemovedBlock` with `mine`.
4. **Error notice**, if any (see §6.1).
5. **Tab content:**
   - **Wall of Fame** → `<WallOfFame employeeId/>` (§6.4).
   - **Birthdays:**
     - Card **"Today"** (cake). It gets the `is-today` style when there are entries. Hint: "Say something. It takes ten seconds and it is remembered."
       - Each entry is a `PostBlock`.
       - Empty: **"No birthdays today"** / "The next ones are listed below."
     - Card **"Coming up"**. Hint: "The next few, so nobody is a surprise."
       - Each entry is an `UpcomingRow`.
       - Empty: **"None coming up"** / "They will appear here as they come round."
   - **Work anniversaries:**
     - Card **"Today"** (medal). Hint: "A year of work is worth a sentence from someone who saw it."
       - Empty: **"No anniversaries today"** / "This week’s are listed below."
     - Card **"This week"**. Hint: "Anniversaries falling in the next seven days."
       - Each entry is an `UpcomingRow`.
       - Empty: **"None this week"** / "They will appear here as they come round."
   - **New joiners** — one card titled **"New joiners"** (door icon). Hint: `Everyone who joined recently, across {group.name}. Say hello.` Each joiner is a `PostBlock`, then:
     - **If there is an intro:** the intro paragraph. Then **"Outside work"** with hobby chips, if any. Then **"Brings with them"** with skill chips (kind-tinted), if any.
     - **If there is no intro:** an empty block, **"No introduction yet"** / `{firstName} has not written one. It is theirs to write, not HR's. Welcome them anyway.`
     - Empty list: **"Nobody new right now"** / "New joiners appear here for their first few weeks."
6. **Footer** (11.5 px, `C.faint`, centred): `Showing {active tab label lower-cased} for {group.name}. Birthdays show the day and month only, never the year.`

#### PostCard (`PostCard.tsx`): one implementation for every kind

- **Header.**
  - **Avatar.** Shows the initials. Colour comes from the name: `h = Σ(h*31 + charCode) % 360`; background is `hsl(h 58% 93%)`, ink is `hsl(h 62% 28%)`, with theme-aware mixing. A small kind icon (`mark`) sits on the avatar, in the kind ink.
  - **Headline.** For a shoutout with an author: `**{author}** recognised **{subject}**`. Otherwise `**{subject.name}**`.
  - **Role line.** `designation · department`, or `-` when both are missing, then a company chip.
  - **Time ago** (`ago`): `just now` (under 2 min), `{m}m ago`, `{h}h ago`, `{d}d ago` (under 7 days), else `d Mon` (en-IN). The tooltip is `toLocaleString('en-IN')`.
- **Removed post.** `RemovedBlock` replaces the body:
  - Shield icon.
  - **"Removed by the authorities"**
  - If mine: "This was removed for violating company policy. You can post again, within the policy." Otherwise: "This was removed for violating company policy."
  - Then `“{remark}”`.
  - It **never names who removed it**.
- **Body**, top to bottom:
  - The category chip (`{glyph} {label}`), shoutouts only.
  - The body paragraph.
  - Media: a large emoji tile. `confetti 🎊, cake 🎂, balloons 🎈, clap 👏, popper 🎉, highfive 🙌`, falling back to 🎉.
- **Bar.**
  - **Reaction chips** (`emoji count`). `data-mine` highlights mine. The aria label is `"{emoji} {count}, including you"`.
  - An **add-reaction** button opens a picker of **`REACTIONS = ['👏','❤️','🎉','🙌','😄','🔥']`**. Picking one toggles it and closes the picker.
  - The **comments toggle** (bubble icon) reads `{n || ''} comment|comments`.
  - The **action button**, right-aligned, appears when the post is not removed:
    - Label by kind: birthday **"Wish"**, anniversary **"Greet"**, joiner **"Welcome"** (wave icon), shoutout "Say something" (send icon).
    - When `acted`, it shows a disabled **"Sent"** chip instead.
- **Thread.** Open by default when there are comments.
  - **CommentRow:** avatar, then the name, company chip and time ago, then the body text. **A comment's `media` is not rendered**: a GIF-only wish shows an empty bubble.
  - A removed comment shows `RemovedBlock` with `mine`.
  - Each comment has a compact reaction bar. **Comment reactions are local only**: they toggle in memory and are never sent, even though `react_comment` exists on the server.
  - **CommentComposer:** my avatar, a textarea (placeholder **"Write a comment…"**, one row; Enter sends, Shift+Enter is a newline) and a **"Post"** button, disabled when the trimmed text is empty.
- **Reactions are optimistic** (`react` in `Social.tsx`, the same logic as `toggle()`):
  - If the emoji is absent, add it as `{count:1, mine:true}`.
  - If present, `count ± 1` and flip `mine`. Remove the chip when the count reaches 0.
  - Then POST `react`. On error, roll back and show the error notice.
- **Comment send (`say`):**
  - Optimistically append `{id:'local-<ms>', author: me, body, at: now, reactions: [], mine: true, media: mediaRef ? {kind:'gif', ref, label: ref} : null}`.
  - If it is a wish, also set `acted = true`.
  - POST `comment` or `wish` with `{post_id, body, media_ref}`. A plain comment sends `media_ref: null`.
  - On success, reload the whole payload. On error, roll back and show the notice.

#### UpcomingRow

A compact row:

- A date block: the day number in bold, then the short month (en-IN).
- Avatar with the kind mark.
- Name (13.5 px, 600).
- Subline, depending on kind:
  - Anniversary: `{years} year|years {when(on)}`
  - Birthday: `Birthday {when(on)}`
  - Then a company chip.
  - `when()` gives `today`, `tomorrow`, `on {Weekday}, {d Mon}` (under 7 days ahead), or `on {d Mon}`. **The year is never shown.**
- A button: **"Wish"** or **"Greet"**, which toggles the WishSheet. When acted it shows a disabled **"Sent"**.

#### WishSheet (`WishSheet.tsx`): the inline composer under the post or row

- **Label:** `To {name}`.
- **Textarea.**
  - Autofocused, `maxLength 500`, with a `{len}/500` counter.
  - Placeholder by kind:

    | Kind | Placeholder | Send button |
    |---|---|---|
    | birthday | "Write something for their birthday…" | **Send birthday wishes** |
    | anniversary | "Say something about working with them…" | **Send your congratulations** |
    | joiner | "Welcome them to the company…" | **Send your welcome** |
    | shoutout | "Say what they did, and why it mattered…" | **Post it** |

- **"Or start from one of these"** shows only while the text is empty. Tapping a suggestion sets the text:
  - birthday: "Happy birthday! Hope you get the day you want." · "Many happy returns 🎂" · "Have a brilliant one, enjoy every bit of it."
  - anniversary: "Congratulations on the milestone!" · "Thanks for everything you have built here." · "Here is to the next one 🎉"
  - joiner: "Welcome to the team!" · "Great to have you with us. Shout if you need anything." · "Welcome aboard 👋"
- **"Add an emoji"**: the six `REACTIONS`. Each appends `' ' + emoji` to the text, then trims the start.
- **GIF.**
  - A **"Add a GIF"** button (`GIF: {label}` once one is chosen) toggles a grid of 6 tiles from `GIF_PACK`:

    | ref | label | hue |
    |---|---|---|
    | confetti | Confetti | 268 |
    | cake | Cake | 338 |
    | balloons | Balloons | 16 |
    | clap | Applause | 42 |
    | popper | Party popper | 158 |
    | highfive | High five | 205 |

  - Each tile is an emoji drawn on an `hsl(hue 70% 92%)` background, with a caption.
  - Tapping a tile selects it; tapping the selected tile deselects it.
  - **"Remove"** clears the selection.
  - The pack is CSS/emoji only. No files are uploaded, and there is **no third-party GIF search**.
- **Buttons.**
  - **Cancel** closes the sheet.
  - **Send** is disabled when the text is empty and no GIF is chosen. It closes the sheet and calls `say(post, text.trim(), media?.ref ?? null, true)`, which is a `wish`.
- **Uploads:** none anywhere in Social.

### 6.4 Wall of Fame (`components/ess/WallOfFame.tsx`), first tab of Social

**Purpose.** Recognition across the company. A shoutout is public, on the wall. A private note goes only to the person. The screen states plainly that recognition "never touches pay".

#### Layout, in order

1. **Hero**, a brand-tint panel with a dotted star field. Left side:
   - Kicker: ✦ "Recognition, company-wide"
   - Heading (34 px, bold): **"Wall of Fame"**
   - Paragraph: "What your colleagues have noticed. Noticed someone doing something well? Say so: a shoutout goes on the wall for everyone, a note goes only to them."
   - Two launcher tiles. They toggle; only one composer is open at a time:

     | Tile | Icon | Subtitle when closed |
     |---|---|---|
     | **Give a shoutout** | megaphone | "Public praise, on the wall" |
     | **Send a private note** | mail | "Only they will see it" |

     - When a tile is open its subtitle reads "Open below · tap again to close", it has a brand border and tint, and the chevron rotates.
   - Footnote (shield icon): "Recognition here is thanks, never pay. It changes nothing about anyone’s salary."
   - Right side: **Spotlight**, showing the latest award winner who has not left.
2. **Composer panel**, shown when a launcher is open:
   - Shoutout: title "Give a shoutout", subtitle "Public, on the wall. Recognition here is thanks, never pay."
   - Note: title "Send a private note", subtitle "Straight to them, in their inbox."
   - A ghost **Close** button.
   - The body is `ShoutoutComposer` or `AppreciationComposer`, both with `actorId = employeeId`.
   - After a shoutout is sent: close the panel, reload, and toast **"Shoutout posted to the wall"**.
   - After a note is sent: close the panel and toast **"Note sent. It is in their inbox"**. No reload.
3. **Jump bar** (narrow screens only): Feed · Most recognised · Legends · My badges · Manage. These anchor to `#wof-feed`, `#wof-leaders`, `#wof-legends`, `#wof-badges` and `#wof-manage`.
4. **Split view.**
   - **Main column — "Recently recognised"** (megaphone icon).
     - Subtitle: `The last {n} across your company`, or "Across your company" when empty.
     - **Filter chips**, labelled "Show": All / Shoutouts / Awards, each with a count. They appear only when the feed contains **both** awards and shoutouts.
     - A row is an award when `kind==='award'` or it has `award_name`.
     - Rows are grouped by `published_at` into **Today, Yesterday, This week (<7 days), This month (<31 days), Earlier** (and `null` → Earlier). Each row is a `FeedCard`.
     - Empty: **"Be the first on the wall"** / "Nothing yet. Birthdays and service anniversaries fill this on their own from the first day, so it will not stay empty for long."
   - **Rail:**
     - **"Most recognised"** — subtitle "A count of thanks. It affects nothing else." Shows `Leaderboard`, with `enabled = wall_config.leaderboard_enabled !== false`.
     - **"Hall of legends"** — subtitle "Everyone who has won an award here". Shows `HallOfLegends` with every winner after the first.
     - **"My badges"** — subtitle "Awards, company values and service milestones". Shows `BadgeCabinet`.
5. **"Manage the wall"** (shield icon) — subtitle "Awards, values, badges, screens and who may change them". Renders `<AdminConsole employeeId/>`. It is shown to everyone; areas you cannot use are locked and give the reason.
6. **Toast** for success messages.

#### Other states

- **Loading:** skeletons. A 230 px hero, a spotlight block, then "Recently recognised" and "Most recognised" skeleton panels.
- **Not switched on** (the probe errors with `PGRST205` / "does not exist"):
  - Heading "Wall of Fame", then a warning notice titled **"The Wall of Fame is not switched on yet"**.
  - Body: "The screens are built and waiting. The tables they read come from migrations 082 and 084–087, which are written and handed over but not applied to this database yet. Nothing here is broken."
  - Second paragraph, muted: "Once they are applied, EZER switches the module on for your company and your HR team picks a Wall Owner. Everything after that happens without any more SQL."
- **Any other probe error:** a critical notice, **"Could not read the Wall of Fame."**, with the message.

#### Direct Supabase queries (browser, anon key), verbatim, in order

```ts
// 1. Probe
supabase.from('wall_config').select('module_enabled, leaderboard_enabled').limit(1)

// 2. Feed: through the API, not Supabase
wallRpc('get_company_feed', { p_scope: 'company', p_limit: 20 }, employeeId)   // → FeedRow[]; errors ignored

// 3. Awards, for the Spotlight and the Hall
supabase.from('recognitions')
  .select('id, message, cycle_label, published_at, receiver_employee_ids, recognition_awards(name)')
  .eq('kind', 'award').eq('is_archived', false)
  .not('published_at', 'is', null)
  .order('published_at', { ascending: false }).limit(12)

// 4. Winner details (only when ids exist)
supabase.from('employees').select('id, full_name, designation, date_of_leaving').in('id', ids)

// 5. Leaderboard
supabase.from('v_wall_leaderboard')
  .select('employee_id, full_name, designation, recognition_count, points')
  .order('recognition_count', { ascending: false }).limit(5)

// 6. My badges
supabase.from('employee_badges')
  .select('badge_code, earned_count, tier, progress_pct, last_earned_on, badge_master(label, glyph, shape)')
  .eq('employee_id', employeeId).limit(60)
```

Mappings:

- **Winner** (from the first receiver):

  ```
  { id, name: full_name, designation,
    awardName: recognition_awards.name ?? 'Award',
    cycleLabel, message, publishedAt,
    hasLeft: !!date_of_leaving }
  ```

  - Spotlight = the first winner with `!hasLeft`.
  - Legends = `all.slice(1)`. **Leavers stay in the Hall** but are never spotlighted.
- **LeaderRow:** `{ employeeId, name, designation, recognitionCount, points }`.
- **MyBadge:**

  ```
  { badge_code, label: badge_master.label ?? code, glyph, shape, tier,
    earned_count, progress_pct, earned_at: last_earned_on }
  ```

Errors from queries 3–6 are swallowed; the section simply stays empty.

> The details of every component under `components/wall/` — the composers, the feed card, comments and reactions, Spotlight, Leaderboard, Hall, Badge and BadgeCabinet, AdminConsole — and every wall RPC's argument and return shapes follow in §6.4.x below.

### 6.4 Wall of Fame — components, RPCs and rules

Scope: everything `components/ess/WallOfFame.tsx` renders from `components/wall/*`, the pure rules in `lib/wall/*`, the SQL behind every wall RPC (latest definition wins), and the TV board in one paragraph. The WallOfFame shell, its direct queries, the `wallRpc` wire and `WallInbox` are documented elsewhere and only referenced here.

Conventions in this section:
- "`wallRpc('x', {...})`" means `POST /api/ess/wall` with body `{ action: 'x', ...args, employee_id }`. The route copies only the allowlisted params, drops `undefined`, and sets `p_actor` from the session last. The client gets back `{ data, error: { message, status?, installed? } | null }`. Offline gives `error.message = 'Could not reach the server.'`. A non-JSON or bodiless failure gives `'The request failed (<status>).'`.
- When this section says "the server's message is shown", the client renders `error.message` exactly as received, which is the SQL `RAISE EXCEPTION` text (see 6.4.12).
- Colour names are `C.*` tokens from `@/lib/ui` (CSS vars). The "gold" tokens are listed under Spotlight (6.4.9).

#### 6.4.1 `lib/wall/*` — the pure modules RN can import

| File | Pure? | RN import |
|---|---|---|
| `lib/wall/shoutout.ts` | Yes, no imports | `import { problems, problemFor, canSend, remainingToday, messageLength, visibilityNote, VISIBILITIES, DEFAULT_RULES, EMPTY_DRAFT, type Draft, type WallRules, type Problem, type Field, type Context } from '@/lib/wall/shoutout'` |
| `lib/wall/appreciation.ts` | Yes, no imports | `import { directProblems, directProblemFor, canSendDirect, notesLeftToday, modeNote, REPLY_RULE, DEFAULT_DIRECT, EMPTY_DIRECT, type DirectDraft, type DirectRules, type SendMode } from '@/lib/wall/appreciation'` |
| `lib/wall/catalogue.ts` | Yes, no imports | `import { CATEGORIES, BADGES, TAGS, ALL_ITEMS, badgeByRef, tagByRef, byCategory, search, MAX_TAGS, EMPTY_SELECTION, checkSelection, describe, type CatalogueItem, type Selection } from '@/lib/wall/catalogue'` |
| `lib/wall/comments.ts` | Yes, no imports (uses `String.prototype.matchAll`, which Hermes supports) | `import { threadComments, renderBody, type CommentRow, type Reaction, type Threaded } from '@/lib/wall/comments'` |
| `lib/wall/inbox.ts` | Yes, no imports | `import { STREAM_OF, STREAMS, headlineFor, glyphFor, countFor, countsReconcile } from '@/lib/wall/inbox'` (it belongs to the inbox, documented elsewhere) |
| `lib/wall/theme.ts` | Yes, no imports | `import { LIGHT, DARK, GRADE, SHADOW, RADIUS, EASE, TYPE, BOARD, tokens, gradeStyle } from '@/lib/wall/theme'`. **No wall component imports it.** Components use `@/lib/ui` tokens. Its only live use is `BOARD` colours (the TV board). |
| `lib/wall/access.ts` | **Not for RN.** It imports the `SupabaseClient` type and calls `supabase.rpc('set_config' / 'wof_can' / 'wof_explain_access' / 'is_wall_admin')`. Its `deny()` returns a web `Response`. It is server-route plumbing. RN may import only the types: `import type { WallPermission, AdminLevel } from '@/lib/wall/access'` | |
| `lib/wall/rpc.ts` | **Not portable as-is.** It imports `authHeaders` from `@/lib/auth-headers` (browser session) and calls a relative `fetch('/api/ess/wall')`. RN needs its own copy with an absolute base URL and its own bearer token. The `{data,error}` contract stays the same. | |

##### `lib/wall/shoutout.ts` (mirrors `create_shoutout`)

- `DEFAULT_RULES: WallRules = { requireCategory: true, requireValue: false, allowGroup: true, maxReceivers: 10, minMessageLength: 15, dailyLimit: 5, cooldownHours: 24 }`.
- `EMPTY_DRAFT = { receiverIds: [], categoryCode: null, valueIds: [], message: '', visibility: 'company', badgeRef: null, tagRefs: [] }`.
- `Draft` also has an optional `categoryRequiresValue?: boolean`.
- `messageLength(m) = m.trim().length`. This counts characters after trimming. There is no maximum length and no word limit.
- `problems(draft, ctx, rules)` returns problems in fill-in order. The exact strings:
  1. receivers: none picked → `Pick at least one person.`
  2. receivers: includes `ctx.actorId` → `You cannot recognise yourself.`
  3. receivers: more than one picked and `!allowGroup` → `Group shoutouts are switched off for this company.`
  4. receivers: more than `maxReceivers` → `` `You can recognise up to ${maxReceivers} people at once.` ``
  5. receivers: duplicates → `Somebody is on the list twice.`
  6. receivers: any id in `ctx.recentlyRecognised`. For one: `` `You already recognised ${name} in the last ${cooldownHours} hours.` ``, where `name` comes from `nameOf`, falling back to `'that person'`. For several: `` `You already recognised ${n} of these people in the last ${cooldownHours} hours.` ``
  7. category: `requireCategory && !categoryCode` → `Pick what the shoutout is for.`
  8. value: `(requireValue || categoryRequiresValue) && valueIds.length===0` → `This shoutout needs a company value attached.`
  9. message: trimmed length below `minMessageLength`. At length 0: `` `Say why. At least ${min} characters.` ``. Otherwise: `` `Say a little more: at least ${min} characters.` ``
  10. quota: `sentToday >= dailyLimit` → `` `You have used all ${dailyLimit} shoutouts for today. They reset at midnight.` ``
- `canSend` is `problems().length===0`. `problemFor(field, list)` returns the first message for that field.
- `remainingToday(ctx, rules) = max(0, dailyLimit - sentToday)`.
- `visibilityNote(v)`:
  - `company` → `Everyone in the company will see this.`
  - `branch` → `People at the same location will see this.`
  - `department` → `Their department will see this.`
  - `team` → `Only their immediate team will see this.`
  - anything else → `Your HR team decides who sees this.`
- `VISIBILITIES = ['company','branch','department','team']`. These are the only `p_visibility` values the UI sends.
- Header rule: "Recognition never touches pay. There is no points-to-money conversion". `wall_config.payout_linkage` is pinned false by a CHECK.

##### `lib/wall/appreciation.ts` (mirrors `send_appreciation`; "THIS IS NOT A CHAT")

- `DEFAULT_DIRECT = { enabled: true, requireCategory: true, maxReceivers: 10, dailyLimit: 10, allowShareToFeed: true }`.
- `SendMode = 'private' | 'also_post'`.
- `EMPTY_DIRECT = { receiverIds: [], categoryCode: null, body: '', mode: 'private', visibility: 'company' }`.
- `directProblems(d, ctx, rules)`:
  - If `!enabled`, it returns only `[{mode:'Direct appreciation is switched off for this company.'}]`.
  - Otherwise the checks run in this order:
    - receivers, empty → `Pick at least one person.`
    - receivers, self → `You cannot send appreciation to yourself.`
    - receivers, duplicate → `Somebody is on the list twice.`
    - receivers, too many → `` `You can appreciate up to ${maxReceivers} people at once.` ``
    - category, `requireCategory && !categoryCode` → `Pick what you are appreciating them for.`
    - body, blank after trimming → `Say something, however short.` (there is **no minimum length** and no maximum)
    - mode, `also_post && !allowShareToFeed` → `Your company does not allow appreciation notes to be posted to the feed.`
    - quota, `sentToday >= dailyLimit` → `` `You have sent all ${dailyLimit} appreciation notes for today.` ``
- `canSendDirect`, `directProblemFor` and `notesLeftToday` (`max(0, dailyLimit - sentToday)`) are defined like their shoutout equivalents.
- `modeNote(mode, allowShare)`:
  - private → `Only they will see this. They can send one thank-you back, and that ends it.`
  - also_post with `allowShare` → `They get the note, and it also appears on the company feed for others to see.`
  - also_post without it → `Your company does not allow this.`
- `REPLY_RULE = 'They can reply once to say thanks. Notes are not a chat. There is no back-and-forth.'`

##### `lib/wall/comments.ts`

- Types:
  - `CommentRow {id, body, employee_id, parent_comment_id|null, mentions: string[]|null, created_at|null, is_hidden?}`
  - `Reaction {comment_id, emoji, employee_id}`
  - `Threaded = CommentRow & {replies: CommentRow[]}`
- `threadComments(rows)`:
  - Drops `is_hidden` rows.
  - Top-level comments are the rows with `parent_comment_id` null.
  - Every reply is attached to its **root** top-level comment. It walks at most 8 parent links, so a cycle cannot hang. A deeper reply is hoisted to its grandparent, not dropped. Orphans with no reachable top are dropped.
  - Tops and replies are each sorted by `created_at` ascending, using string compare.
  - The result has exactly two levels.
- `renderBody(body, names: Map<id,name>)`:
  - Splits the body into strings and `{at: name}` chips.
  - The pattern is the regex `@(<name1>|<name2>…)`, names sorted longest first and regex-escaped.
  - Mentions are therefore **`@` followed by the person's full display name**, which may contain spaces. There is no `@username` token and no id markup in the text.
  - If `names` is empty it returns `[body]`.

##### `lib/wall/catalogue.ts` — the recognition catalogue (badges + tags, 089)

This is the canonical list: 30 badges and 44 tags across 11 categories. Migration 089's seed is generated from it. Catalogue items have **no colours**. In the picker and in the preview they render with brand and neutral tokens (`C.brand` / `C.brandTint` when selected, a neutral Pill in the preview). The metal colours of the SVG `Badge` (6.4.10) belong to a separate system, `badge_master` / `employee_badges` tiers, and are not linked to these catalogue refs.

- `CATEGORIES` (the catalogue's 11 groupings, in display order): `Behavior, Collaboration, Communication, Culture, Customer, Growth, Innovation, Leadership, Performance, Project, Technology`.
- `CatalogueItem { ref, name, category, glyph, description }`.
- `MAX_TAGS = 5`. A recognition carries one badge at most.
- `checkSelection({badgeRef, tagRefs})` returns these faults:
  - `` `${ref} is not a badge in the catalogue.` ``
  - `` `${ref} is not a tag in the catalogue.` ``
  - `The same tag has been picked twice.`
  - `` `Pick at most ${MAX_TAGS} tags. Past that they stop telling anybody anything.` ``
- `describe(sel)` returns `"Badge · tag1, tag2"`, or only the badge, or only the tags, or `''`.
- `byCategory(items)` groups by `CATEGORIES` order and drops empty groups.
- `search(items, q)` does a case-insensitive substring match on name, description or category. A blank `q` returns everything.
- Five names appear deliberately as both a badge and a tag: Team Player, Problem Solver, Culture Champion, Decision Maker, Positive Energy.

BADGES (ref · name · category · glyph · description):

| ref | name | category | glyph | description |
|---|---|---|---|---|
| B001 | Best Performer | Performance | 🏆 | Outstanding overall performance |
| B002 | Star Performer | Performance | ⭐ | Consistently strong performance |
| B003 | High Achiever | Performance | 📈 | Exceeded goals or targets |
| B004 | Innovation Champion | Innovation | 💡 | Introduced a useful new idea or solution |
| B005 | Out-of-the-Box Thinker | Innovation | 💡 | Demonstrated creative thinking |
| B006 | Team Player | Collaboration | 🤝 | Excellent teamwork and collaboration |
| B007 | Leadership Excellence | Leadership | 🧭 | Demonstrated strong leadership |
| B008 | Goal Crusher | Performance | 🥇 | Consistently achieved or exceeded targets |
| B009 | Going the Extra Mile | Behavior | 🏃 | Went beyond normal responsibilities |
| B010 | Speed & Efficiency | Performance | ⚡ | Delivered work quickly and efficiently |
| B011 | Excellence Award | Performance | 🎖️ | Exceptional quality of work |
| B012 | Rising Star | Growth | 🌟 | Rapid growth and strong potential |
| B013 | Problem Solver | Innovation | 💡 | Successfully solved complex problems |
| B014 | Growth Champion | Growth | 🌱 | Significant improvement or development |
| B015 | Customer Champion | Customer | 💙 | Exceptional customer focus |
| B016 | Collaboration Champion | Collaboration | 🤝 | Excellent cross-functional collaboration |
| B017 | Quality Champion | Performance | ✨ | Consistently high-quality output |
| B018 | Reliability Award | Behavior | 🛡️ | Highly dependable and reliable |
| B019 | Ownership Champion | Behavior | 🔑 | Takes complete ownership of work |
| B020 | Learning Champion | Growth | 📚 | Proactively learns and applies new skills |
| B021 | Tech Champion | Technology | ⚙️ | Strong technical contribution |
| B022 | Data Champion | Technology | 📊 | Excellent data-driven contribution |
| B023 | Communication Star | Communication | 🗣️ | Exceptional communication |
| B024 | Decision Maker | Leadership | 🧭 | Strong judgment and decision-making |
| B025 | Culture Champion | Culture | 🎉 | Strongly demonstrates company values |
| B026 | Positive Energy | Culture | 🎉 | Creates a positive work environment |
| B027 | Execution Champion | Performance | 🎯 | Excellent execution and delivery |
| B028 | Key Contributor | Performance | 🎯 | Made a critical contribution |
| B029 | Project Hero | Project | 🚩 | Played a major role in project success |
| B030 | Celebration Champion | Culture | 🎉 | Contributes to team engagement |

TAGS:

| ref | name | category | glyph | description |
|---|---|---|---|---|
| T001 | High Performer | Performance | 🎯 | Consistently delivers strong results |
| T002 | Consistent | Performance | 🎯 | Maintains dependable performance |
| T003 | Target Achiever | Performance | 🎯 | Achieves assigned targets |
| T004 | Result Oriented | Performance | 🎯 | Focuses on measurable outcomes |
| T005 | Quality Focused | Performance | 🎯 | Pays strong attention to quality |
| T006 | Efficient | Performance | 🎯 | Uses time and resources effectively |
| T007 | Reliable | Behavior | 🪴 | Can be depended upon |
| T008 | Fast Learner | Growth | 🌱 | Learns new concepts quickly |
| T009 | Ownership | Behavior | 🪴 | Takes responsibility end-to-end |
| T010 | Accountability | Behavior | 🪴 | Owns commitments and outcomes |
| T011 | Proactive | Behavior | 🪴 | Takes initiative without waiting for instructions |
| T012 | Dependable | Behavior | 🪴 | Consistently dependable |
| T013 | Positive Attitude | Culture | 🎉 | Maintains a constructive attitude |
| T014 | Disciplined | Behavior | 🪴 | Demonstrates strong work discipline |
| T015 | Adaptable | Behavior | 🪴 | Adapts effectively to change |
| T016 | Resilient | Behavior | 🪴 | Handles challenges and setbacks effectively |
| T017 | Innovative | Innovation | 💡 | Brings new ideas and approaches |
| T018 | Creative Thinker | Innovation | 💡 | Uses creative approaches to problems |
| T019 | Out of the Box | Innovation | 💡 | Thinks beyond conventional solutions |
| T020 | Idea Generator | Innovation | 💡 | Frequently contributes useful ideas |
| T021 | Problem Solver | Innovation | 💡 | Solves issues effectively |
| T022 | Process Improver | Innovation | 💡 | Improves processes or workflows |
| T023 | Tech Savvy | Technology | ⚙️ | Strong technology orientation |
| T024 | Team Player | Collaboration | 🤝 | Works effectively with others |
| T025 | Collaborative | Collaboration | 🤝 | Works well across teams |
| T026 | Supportive | Collaboration | 🤝 | Actively supports colleagues |
| T027 | Cross Functional | Collaboration | 🤝 | Works effectively across functions |
| T028 | Knowledge Sharer | Collaboration | 🤝 | Shares knowledge with others |
| T029 | Mentor | Leadership | 🧑‍🏫 | Supports and develops colleagues |
| T030 | Great Communicator | Communication | 🗣️ | Communicates clearly and effectively |
| T031 | Leadership | Leadership | 🧭 | Demonstrates leadership qualities |
| T032 | Influencer | Leadership | 🧭 | Positively influences others |
| T033 | Decision Maker | Leadership | 🧭 | Makes sound decisions |
| T034 | Strategic Thinker | Leadership | 🧭 | Thinks strategically |
| T035 | People Leader | Leadership | 🧭 | Supports and guides people effectively |
| T036 | Change Maker | Leadership | 🧭 | Drives positive change |
| T037 | Role Model | Leadership | 🪞 | Sets a strong example for others |
| T038 | Culture Champion | Culture | 🎉 | Promotes company culture and values |
| T039 | Value Driven | Culture | 🎉 | Demonstrates organizational values |
| T040 | Positive Energy | Culture | 🎉 | Creates positive team energy |
| T041 | Helpful | Culture | 🎉 | Consistently helps colleagues |
| T042 | Inclusive | Culture | 🎉 | Promotes an inclusive environment |
| T043 | Employee First | Culture | 🎉 | Prioritizes employee/team experience |
| T044 | Team Spirit | Culture | 🎉 | Strengthens team morale |

The per-company **shoutout categories** (the "What is it for" tiles, table `shoutout_categories`) are a separate list and live in the database. See 6.4.13.

##### `lib/wall/theme.ts`

It exports `LIGHT`/`DARK` (brand `#2563EB`/`#3B82F6`…), `GRADE`, `SHADOW`, `RADIUS {md:12,lg:16,xl:22,pill:999}`, `EASE = 'cubic-bezier(.22,.72,.28,1)'`, `TYPE`, `BOARD {bg:'#060F1F',card:'#0E1C33',line:'#1A2E4F',dim:'#8FB0DC',gold:'#FCD34D'}`, and `tokens(theme)` and `gradeStyle(token, theme)`.

`GRADE` has seven colour pairs (fg/bg, plus fgDark/bgDark):

| Name | fg | bg |
|---|---|---|
| gold | `#B45309` | `#FEF3C7` |
| green | `#047857` | `#D1FAE5` |
| cyan | `#0E7490` | `#CFFAFE` |
| violet | `#6D28D9` | `#EDE9FE` |
| rose | `#BE123C` | `#FFE4E6` |
| slate | `#334155` | `#E2E8F0` |
| blue | `#1D4ED8` | `#DBEAFE` |

None of the ESS wall components import this file. RN should use the app's `C` tokens for parity.

##### `lib/wall/access.ts` (server-only; for the rules)

- `WallPermission` values:
  - `wof.view`, `wof.shoutout.create`, `wof.nominate`, `wof.react`, `wof.comment`, `wof.mention`
  - `wof.message.send`, `wof.inbox.view`, `wof.endorse`, `wof.shortlist`, `wof.publish`, `wof.unpublish`
  - `wof.moderate`, `wof.configure`, `wof.badge.manage`, `wof.board.manage`, `wof.report.view`, `wof.admin.grant`, `wof.module.activate`
- `AdminLevel` values, ascending: `board_operator` < `wall_moderator` < `wall_admin` < `wall_owner`.
- `wofExplain` falls back to `'You do not have access to this.'`.
- `deny(reason)` returns 403 `{ error:'forbidden', reason }`.

#### 6.4.2 `components/wall/ui.tsx` — the shared pieces (behaviour and copy)

This file is pure presentation. Its only side effect is the Toast timer.

- **Constants**
  - `EASE = 'cubic-bezier(.22,.72,.28,1)'`
  - `RAD = { control: R.sm (7), tile: R.md (10), panel: R.lg (14), hero: 22, pill: 999 }`
- **`WALL_CSS`** is the single `<style>` block, injected by WallOfFame. It sets:
  - focus ring: 2px `C.brand`
  - input focus: border `C.brand` plus a 3px `C.brandTint` glow
  - button press: `translateY(1px)`
  - primary hover: `brightness(1.06)`
  - secondary hover: border and text `C.brand`
  - ghost hover: bg `C.sunken`
  - danger hover: border `C.critical`
  - tile hover (not pressed or checked): border `C.brandEdge`, bg `C.brandTint`
  - row hover: `C.sunken`
  - keyframes:
    - `wofOpen` (.34s): opacity 0 / translateY(-6px) → none
    - `wofPulse` (1.4s infinite): opacity .55↔1, used by skeletons and the "Searching" label
    - `wofToast` (.38s): from opacity 0, translate(-50%,14px)
  - `.wof-jump` is shown only at ≤900px
  - `prefers-reduced-motion` switches all of these off.
- **Icon** draws 24-unit stroked paths (`currentColor`, default stroke 1.8). The names are: megaphone, mail, close, check, lock, globe, users, trophy, medal, search, plus, refresh, copy, trash, power, sparkle, tv, shield, heart, list, clock, alert, info, send, eye. The SVG path strings are in the file and can be reused with `react-native-svg`.
- **`initialsOf(name)`**: the first letters of the first two words, uppercased, or `'·'`.
- **`shortDate(iso)`**: `toLocaleDateString('en-IN', {day:'numeric', month:'short'})`, e.g. "14 Oct". It returns `''` for null.
- **Avatar**:
  - Shows initials only; there are no photos anywhere in the wall.
  - The colour is a stable hash: `h = (h*31 + charCode) >>> 0` over the name, then index `h % 6` into these [bg, fg] pairs:
    - `['#DBEAFE','#1D4ED8']`
    - `['#D1FAE5','#047857']`
    - `['#CFFAFE','#0E7490']`
    - `['#EDE9FE','#6D28D9']`
    - `['#FFE4E6','#BE123C']`
    - `['#E2E8F0','#334155']`
  - Font size is `round(size*0.38)`, bold. An optional `ring` adds a 2px ring.
- **AvatarStack**: up to 4 overlapping avatars (`-8` margin, 2px `C.surface` ring), then a `+N` disc (`C.sunken`/`C.muted`).
- **Pill** tones (bg/fg):
  - brand: `C.brandTint`/`C.brand`
  - neutral: `C.sunken`/`C.muted`
  - positive, warning, critical: their `…Tint`/base token
- **Button**:
  - Variants:
    - primary: `C.brand` bg, `C.onAccent` text
    - secondary: `C.surface` bg, `C.inkSoft` text, `C.line` border
    - ghost: transparent
    - danger: `C.surface` bg, `C.critical` text
  - Sizes (padding / font):
    - sm: `6px 11px`, `F.micro`
    - md: `9px 16px`, `F.small`
    - lg: `12px 22px`, `F.small`
  - Disabled or busy: a primary button turns `C.sunken`/`C.muted`. Busy sets opacity .75 and `aria-busy`.
- **Panel**:
  - The card is `C.surface` with a `C.line` border and radius 14.
  - The header has an optional 32px icon square (`C.brandTint`/`C.brand`), a title (`F.body` bold `C.ink`), a sub line (`F.micro` `C.muted`) and a right-aligned action.
- **Step**:
  - A numbered form step. The left column is a 26px circle plus a vertical connector line.
  - Circle states:
    - error: `C.criticalTint` with `C.critical` border and text
    - done: `C.brand` fill with a white check
    - otherwise: `C.sunken` with the number in `C.muted`
  - Then the title (`F.small` bold), the hint (`F.micro` `C.muted`), the children, and a `FieldError`.
- **FieldError**: a ⚠ alert icon plus text in `F.micro` semibold `C.critical`, `role="alert"`. It renders nothing when empty.
- **`inputStyle`**: padding `10px 12px`, radius 7, `C.line` border, `C.surface` bg, `C.ink` text, `F.small`.
- **Notice**:
  - Tones (bg / edge / icon colour):
    - info: `C.brandTint` / `C.brandEdge` / `C.brand`, icon `info`
    - positive: `C.positiveTint` / 30% `C.positive` / `C.positive`, icon `check`
    - warning: `C.warningTint`, icon `alert`
    - critical: `C.criticalTint`, icon `alert`
  - Optional title (bold `C.ink`) and body (`C.inkSoft`, `F.small`).
- **Empty**:
  - A 44px `C.sunken` circle with an icon in `C.faint`, then the title (bold) and body (`F.micro` `C.muted`), inside a 1px dashed `C.line` frame.
  - `compact` lays it out as a 30px row with no frame. `bare` removes the frame.
- **Segmented**: a `C.sunken` track. The selected segment is `C.surface` with a shadow and bold text. Labels are the raw option values, **CSS-capitalised** (`company` → "Company").
- **ChoiceTile**:
  - Optional 34px glyph square, title (bold; `C.brand` when on), and text (`F.micro` `C.muted`).
  - On: border 1.5px `C.brand`, bg `C.brandTint`, and an 18px brand check disc top-right.
  - Disabled: opacity .55.
- **CategoryGrid**: an auto-fill grid with min 200px columns, one `ChoiceTile(glyph, label, helper_text)` per category, keyed by `code`.
- **PersonChip**: a pill with a 24px avatar, the name (bold), meta (11px `C.faint`) and a close button labelled `Remove <name>`.
- **Skeleton**: `lines` pulsing bars. The first bar is 16px high; the rest are 11px at widths 92%, 75%, 58%…
- **Split**: two flex columns. `main` flexes at 999 and `rail` at 1, and the rail wraps under main when space runs out. `stickyRail` makes the rail sticky at top 16.
- **Toast**:
  - Defaults: **`ms = 3800`** (3.8 s auto-dismiss); the timer resets when `message` changes.
  - Placement: fixed, bottom-centre at bottom 24.
  - Styling: pill-shaped, bg `C.ink`, text `C.surface`.
  - Content: a 22px `C.positive` check disc, the message, and a close button labelled `Dismiss`.
  - Accessibility: `role="status"`, `aria-live="polite"`.
- **JumpBar**:
  - A sticky (top 8) horizontally scrolling pill bar of anchor links (icon plus label).
  - It is **visible only on narrow screens (≤900px)**. RN should treat it as an in-page "jump to section" control, e.g. `ScrollView.scrollTo` on a measured section.
- **FilterChips**:
  - Pills, each showing a label plus a count badge.
  - Selected: bg and border `C.ink`, text `C.surface`; the count badge is 22% surface.
  - Unselected: `C.surface` bg, `C.line` border, `C.inkSoft` text; the count badge is `C.sunken`/`C.muted`.
- **GroupLabel**: `F.micro` bold `C.muted` text followed by a hairline. It is used for the feed's Today/Yesterday… groups.
- **Divider**: a hairline with an optional centred label.

#### 6.4.3 `ShoutoutComposer.tsx` — "Give a shoutout"

**Mount and props.** WallOfFame mounts it as `<ShoutoutComposer actorId={employeeId} onSent={…}/>`. The other props are left at their defaults:
- `rules = DEFAULT_RULES`
- `sentToday = 0`
- `recentlyRecognised = []`

**The client never loads the real `wall_config`, the day's count or the cooldown list.** The quota dots always show 5 of 5. The server is the only enforcer of quota, cooldown and the company's own limits; its message comes back as `serverErr`.

**Reads on mount (direct Supabase, keyed on `actorId`):**
```ts
supabase.from('employees').select('company_id').eq('id', actorId).maybeSingle()
supabase.from('shoutout_categories')
  .select('id, code, label, helper_text, glyph, requires_value')
  .eq('is_active', true).order('sort_order').limit(24)
  .eq('company_id', companyId)          // if companyId is null → .limit(0) (empty)
supabase.from('recognition_values').select('id, label')
  .eq('is_active', true).order('sort_order').limit(24)
  .eq('company_id', companyId)          // null → .limit(0)
```
Query errors are swallowed and the lists stay empty.

**Layout.** A `Split(main=steps, rail, mainMin 440, railMin 280, stickyRail)`. The steps are numbered dynamically, so a step that is hidden does not consume a number.

1. **Step "Who are you recognising"**
   - Hint: `` `Up to ${maxReceivers} people at once` `` when `allowGroup`, else `One person at a time`.
   - Error: the receivers problem.
   - Done when at least one person is picked.
   - Body: `PersonPicker` (inputId `wof-shout-people`).
2. **Step "What is it for"**
   - Shown only if categories were loaded.
   - Body: a `CategoryGrid` of categories; picking a tile sets `categoryCode = code`. Picking the same tile again does **not** clear it.
   - Error: the category problem. Done when a category is picked.
3. **Step "Which company value"**
   - Shown only if `(rules.requireValue || category.requires_value) && values.length>0`.
   - Hint: `This category is tied to a company value`.
   - Body: value chips. These are multi-select toggles: pill, 1.5px border, `C.brand`/`C.brandTint` with a check when on, otherwise `C.line`/`C.surface`/`C.inkSoft`.
   - Error: the value problem.
4. **Step "Badge and tags"**
   - Hint: `` `Optional · one badge, up to ${MAX_TAGS} tags` `` (i.e. "Optional · one badge, up to 5 tags").
   - Body: `RecognitionPicker`.
   - Done when a badge or any tag is chosen.
5. **Step "What did they do"**
   - Hint: `Be specific. What happened, and why it mattered.`
   - Body: a textarea (5 rows, minHeight 120, resizable, aria-label `Your message`) with placeholder `e.g. Stayed back on Friday to rebuild the dispatch sheet, so the morning shift started on time.`
   - Below it, the **MessageMeter**: a 54×4 bar filling to `len/min` (`C.brand`, or `C.positive` once reached). The label reads `` `${len} of ${min} characters` ``, switching to `Long enough` in `C.positive` once `len >= min`.
   - Error: the message problem.
6. **Step "Who can see it"**
   - Always marked done.
   - Body: `Segmented` with options `company | branch | department | team`, shown as Company / Branch / Department / Team.
   - Below it: a globe icon (company) or users icon (others), then `visibilityNote(v)`.

**Rail:**
- **Preview** card:
  - Header strip (`C.sunken`): eye icon and `How it will look on the wall`.
  - Body:
    - Avatar "You", then **You** `recognised` **<names joined ", ">**. With no names it reads `nobody yet` in `C.faint`. An AvatarStack (24px) appears when there is more than one person.
    - Pills for the category (`glyph + label`, brand) and the badge (`glyph name`, neutral).
    - The message, with a 3px `C.brandEdge` left rule, or the placeholder `Your message will appear here.` in `C.faint`.
    - Tag names joined `' · '`.
    - The visibility icon and note.
- **Send box**:
  - QuotaDots: `` `${left} left today` `` or `None left today` (`C.critical`), with `dailyLimit` dots (`C.brand` for remaining, `C.line` for used).
  - The quota FieldError.
  - `serverErr` as a critical Notice.
  - Button: primary, lg, full width, send icon, label `Post shoutout`, or `Posting…` while busy. It is disabled only when `left===0`.
  - Footer note: `Recognition is thanks, never pay.`

**Validation timing.** The button stays enabled while the form is incomplete. The first press sets `tried=true`. After that, every step shows its `problemFor` inline and keeps updating live. If any problems remain, nothing is sent.

**Send flow.**
1. Call `create_shoutout`:
   ```ts
   wallRpc('create_shoutout', { p_receivers: draft.receiverIds, p_category: draft.categoryCode,
     p_message: draft.message.trim(), p_value_ids: draft.valueIds, p_visibility: draft.visibility }, actorId)
   ```
2. If that succeeds and a badge or tags were chosen, take `id = r.data.id` and call:
   ```ts
   wallRpc('set_recognition_marks', { p_recognition: id, p_badge_ref: draft.badgeRef ?? null, p_tag_refs: draft.tagRefs ?? [] }, actorId)
   ```
   If this marks call fails, `serverErr` becomes `` `Posted, but the badge did not attach: ${m.error.message}` ``. The form is still reset and `onSent` still fires (in the code the error is set and then the success path runs). WallOfFame's `onSent` closes the composer at once, so on the web **this message is effectively never seen**: the person only gets the toast `Shoutout posted to the wall`. RN may surface the marks failure, for example as a second toast. That would be an improvement, not parity.
3. If `create_shoutout` failed, `serverErr` shows the server's message verbatim and the draft is kept.
4. On success the draft and picks are reset, `tried=false`, and `onSent()` runs. WallOfFame then closes the composer, reloads, and toasts `Shoutout posted to the wall`.

#### 6.4.4 `AppreciationComposer.tsx` — "Send a private note"

**Mount and props.** WallOfFame mounts it as `<AppreciationComposer actorId onSent/>`. The other props default to `rules = DEFAULT_DIRECT` and `sentToday = 0`. The real `dm_daily_limit` and `allow_share` settings are never loaded client-side; the server enforces them.

**Reads on mount:**
```ts
supabase.from('employees').select('company_id').eq('id', actorId).maybeSingle()
supabase.from('shoutout_categories').select('id, code, label, glyph, helper_text')
  .eq('is_active', true).order('sort_order').limit(24).eq('company_id', companyId)   // null → limit(0)
```

**Switched off.** If `!rules.enabled`, the composer renders only `Empty(icon mail, title 'Private notes are switched off')` with the body `Direct appreciation is switched off for this company. You can still give a shoutout on the wall.` This is unreachable with the defaults.

**Layout** (single column, maxWidth 760):
1. An info Notice titled `A note, not a chat`, with body `REPLY_RULE`.
2. **Step "Who are you thanking"**
   - Hint: `` `Up to ${maxReceivers} people` ``.
   - Body: `PersonPicker` (inputId `wof-note-people`).
3. **Step "What for"**
   - Shown only if categories were loaded.
   - Body: a `CategoryGrid`.
4. **Step "Your note"**
   - Done when the body is non-blank.
   - The **Letter** card holds a textarea with:
     - rows 4, minHeight 116
     - placeholder `Thank you for…`, aria-label `Your note`
     - a ruled-paper background: a repeating gradient of `C.surface` with a `C.sunken` line every 28px
   - Footer strip (`C.sunken`):
     - left: `However short you like`
     - right: `` `${left} note${left===1?'':'s'} left today` ``, or `None left today` in `C.critical`
5. **Step "Where it goes"**
   - Always marked done. Error: the mode problem.
   - Two ChoiceTiles:
     - `✉️ Just to them` (`private`), with text `modeNote('private')`
     - `📣 Also post it to the feed` (`also_post`), with text `modeNote('also_post', allowShare)`; disabled when `!allowShareToFeed`
   - There is no visibility picker. `draft.visibility` stays `'company'`.

Below the steps, in order:
- The quota FieldError.
- `serverErr` (critical Notice).
- `sent` (positive Notice `Sent. They will see it in their inbox.`).
- A button row with:
  - the primary lg `Send note` button (`Sending…` while busy), disabled when `left===0`
  - a lock icon with `Only they will see it` (private) or `They get it, and it goes on the feed`

**Send:**
```ts
wallRpc('send_appreciation', { p_receivers: draft.receiverIds, p_category: draft.categoryCode,
  p_body: draft.body.trim(), p_also_post: draft.mode === 'also_post', p_visibility: draft.visibility }, actorId)
```
`p_related` is never sent. On success the composer resets, sets `sent`, and calls `onSent`. WallOfFame then closes the composer and toasts `Note sent. It is in their inbox`. Because the composer closes, its own `Sent. They will see it in their inbox.` notice is never actually visible on the Wall tab.

#### 6.4.5 `PersonPicker.tsx` — colleague search (used by both composers)

- **Picked list.** Picked people render above the search box as `PersonChip`s, with meta `designation ?? emp_code` and a remove button that calls `onRemove(id)`.
- **Search box**:
  - A search icon sits inside on the left.
  - Placeholder: `Search by name or employee code`, or `Add another colleague` once someone is picked.
  - aria-label: `Search for a colleague`.
  - While a query is in flight a pulsing `Searching` label shows on the right.
- **Query.** It runs when the trimmed text is **at least 2 characters**, debounced **220 ms**, and a stale response is discarded:
  ```ts
  supabase.from('employees').select('id, full_name, emp_code, designation')
    .is('date_of_leaving', null)
    .or(orIlike(['full_name','emp_code'], q))   // → full_name.ilike."%q%",emp_code.ilike."%q%"  (\ and " escaped; % _ stay wildcards)
    .limit(8)
  ```
  There is no company filter here (any current employee is returned); the server rejects anyone outside scope. `orIlike` comes from `lib/pg-search.ts`, which is pure and has no imports, so RN can use `import { orIlike } from '@/lib/pg-search'`.
- **Dropdown.** Up to 8 rows, each with a 30px avatar, the name (semibold), and `emp_code · designation`. A row already picked shows `Added` in `C.brand`, but can still be clicked; clicking it is a no-op because the parent de-dupes. The highlighted row uses `C.brandTint`.
- **Keyboard.** ↑/↓ moves the cursor (wrapping), Enter picks, Esc closes.
- **Choosing** a person calls `onAdd(p)`, clears the query and refocuses the box.
- **No match.** When the query is at least 2 characters, the search has finished and nothing came back: `` Nobody current matches “<q>”. Try a surname or the employee code. ``

#### 6.4.6 `RecognitionPicker.tsx` — badge and tags (inside the shoutout composer)

**Data.** It is entirely client-side, from `lib/wall/catalogue`: `BADGES`, `TAGS`, `byCategory`, `search`, `checkSelection`, `describe`. It makes no network calls.

**Summary bar** (top, `C.sunken`, aria-live):
- With a selection: the selected badge and tags as removable pills, each showing `glyph name ×` with aria `Remove <name>`.
- Otherwise: `Optional. Pick one badge, and up to 5 tags that say why.`

**Tabs.** `Badge` and `Tags`, each with a count bubble (`C.brand` fill when above 0). Next to them is a search input with placeholder `Search badges, e.g. "helps others"` or `Search tags` (aria `Search badges` / `Search tags`).

**List** (max height 300, scrolls):
- Grouped by category heading (`F.micro` bold `C.faint`), in `CATEGORIES` order.
- **Badges** are radio "cornered tiles": a 24px glyph square plus the name. Clicking the selected badge clears it. Picking another replaces it.
- **Tags** are checkbox pills: glyph, name, and a ✓ when on.
- Once 5 tags are picked, the unpicked ones are blocked (opacity .5, not-allowed).
- Every chip has a tooltip (`title`) of its description.
- No match: `` Nothing matches “<q>”. The search covers names, descriptions and categories. ``

**Footer:**
- On the Tags tab at the limit: `5 tags is the limit. Past that they stop telling anybody anything.` in `C.warning`.
- If `checkSelection` finds faults: they are joined with spaces, in `C.critical`.

The search text is shared across both tabs.

#### 6.4.7 `FeedCard.tsx` — one feed row (read-only)

**Props.** `{ row: FeedRow }`, where FeedRow is:
```
{ id, kind, message, published_at, category_label, category_glyph, award_name, badge_code,
  giver_id, giver_name, giver_designation, receiver_names: string[], visibility }
```
These are rows of `get_company_feed`; the shape is in 6.4.12.

**It is presentation only.** It has no reactions, no comments, no reply, no "thank back" and no menu. `reaction_count`/`comment_count` are deliberately not shown. `badge_code` and `giver_id` are carried but not rendered.

Layout:
- **Award strip.** Rendered only when `kind==='award' || award_name`: a `C.brandTint` strip with a `C.brandEdge` bottom border, a trophy icon and `award_name ?? 'Award'` (bold `C.brand`, one line, ellipsis). An award card's border is `C.brandEdge`; any other card's is `C.line`. **Awards are brand blue, not gold.**
- **Grid** (42px avatar column, then content):
  - The giver's Avatar (42), using `giver_name ?? 'Someone'`.
  - Line 1: **giver** `recognised` **receivers joined ", "** (or `a colleague`). Under it, `giver_designation` (`F.micro` `C.muted`). On the right, `shortDate(published_at)` (`F.micro` `C.faint`).
  - Pill row, only if there is a category or more than one receiver: a brand Pill `glyph + ' ' + category_label`, then an AvatarStack(22) when there are 2+ receivers.
  - The message, with a 3px `C.brandEdge` left rule, `pre-wrap`, `C.inkSoft`, line-height 1.7.
  - The visibility line, if `visibility`: a globe icon (company) or users icon (others), then `` `Visible to ${visibility.toLowerCase()}` ``, e.g. "Visible to company".

#### 6.4.8 `CommentThread.tsx` — comments, replies, mentions, reactions (**built but NOT mounted anywhere**)

The file header reads: "RESTYLED ONLY, AND STILL NOT MOUNTED ANYWHERE … Mounting it under FeedCard would be a new feature." The current employee experience therefore has **no comments, replies, mentions or reactions on the feed**. For strict parity RN should not show them either. The component is specified here so it can be built behind a flag if product decides to mount it.

- **Props.**
  - `recognitionId`: required.
  - `names: Map<employeeId, displayName>`: required, supplied by the caller. It is used both to show authors and to detect mentions.
  - `actorId?`.
  - `repliesEnabled = true`.
  - `onPosted?`.
- **Reads:**
  ```ts
  supabase.from('recognition_comments')
    .select('id, body, employee_id, parent_comment_id, mentions, created_at, is_hidden')
    .eq('recognition_id', recognitionId).order('created_at').limit(200)
  supabase.from('comment_reactions').select('comment_id, emoji').in('comment_id', ids).limit(1000)
  ```
  The reactions are tallied per comment into `{emoji: count}`.
- **Threading.** `threadComments(rows)` hides `is_hidden` rows and produces two levels. Replies are indented (marginLeft 16, paddingLeft 26, with a 2px `C.line` left rule).
- **A comment** (`One`):
  - Avatar: 32px, or 26px for replies.
  - Bubble (`C.sunken`): the author name (`names.get(employee_id) ?? 'Someone'`, bold), `shortDate(created_at)`, and the body.
  - In the body, mentions render as `@Name` chips (`C.brandTint` bg, `C.brand` text, radius 5, semibold) via `renderBody`.
  - Under the bubble, the reaction buttons. Then `Reply` (ghost sm), on top-level comments only and only when `repliesEnabled`. Replies cannot be replied to.
- **Reaction emoji set:** `['👏', '🙌', '❤️']`. There is no picker; these three are fixed.
  - Each is a pill showing the emoji plus a count when above 0. With a count the pill uses `C.brandEdge`/`C.brandTint`/`C.brand`.
  - aria-label: `` `React with ${e}${n ? `, ${n} so far` : ''}` ``.
  - Clicking is **optimistic +1, with no toggle and no un-react**. It then runs `supabase.from('comment_reactions').insert({ comment_id, emoji })`, a direct insert with no employee_id sent; the DB is expected to stamp it or refuse it. On error the thread reloads from the server.
- **Reply state.** It shows `Replying to <name of the parent author ?? 'a comment'>` with a ghost `Cancel` button.
- **Input.** A single-line pill-shaped input:
  - Placeholder: `Add a comment. Use @ to mention someone.`, or `Write a reply…` when replying.
  - aria-label: `Your comment` / `Your reply`.
  - Enter (without Shift) posts.
  - The button reads `Comment` / `Reply` / `Posting…`, uses the send icon, and is disabled while the input is blank.
- **Mentions.** There is no autocomplete or picker. The person types `@Full Name` by hand. On post, `p_mentions` is every id in `names` whose `'@' + name` appears in the body.
- **Post:**
  ```ts
  wallRpc('add_comment', { p_recognition: recognitionId, p_body: body /*trimmed*/,
    p_parent: replyTo /*top-level comment id or null*/, p_mentions: mentioned }, actorId)
  ```
  On error, the server's message appears in a FieldError. On success the input clears, the reply state clears, the thread reloads and `onPosted` runs.
- **Editing and deleting.** Comments cannot be edited or deleted from any UI, and neither can shoutouts or notes. Hiding is moderation only, through `is_hidden`.

#### 6.4.9 `Spotlight.tsx` — `Spotlight`, `Leaderboard`, `HallOfLegends`

**Gold tokens.** CSS variables on `.wof-gold` (light / dark):

| Token | Light | Dark |
|---|---|---|
| `--g-wash` | `#FEF3C7` | `#3A2A08` |
| `--g-ink` | `#B45309` | `#FCD34D` |
| `--g-text` | `#3A2A08` | `#FDF3D6` |
| `--g-edge` | `#F5C86B` | `#7A5A18` |
| `--g-soft` | `#6B4E12` | `#E4CE96` |

Dark applies under `prefers-color-scheme: dark` unless `[data-ez-theme="light"]`, and always under `[data-ez-theme="dark"]`. Gold is used **only** for the Spotlight frame, the #1 podium step or row, and the TV board's ribbon.

**Reduced motion.** `useCalm()` reads `prefers-reduced-motion`. It starts `true` (no animation) until the effect runs.

Types:
- `Winner {id, name, designation?, awardName?, cycleLabel?, message?, publishedAt?, hasLeft?}`
- `LeaderRow {employeeId, name, designation?, recognitionCount, points?}`. `points` is never rendered.

**Spotlight({winner})**
- With `winner === null`: a dashed card (minHeight 220, radius 20) holding `Empty(trophy, 'The spotlight is waiting')` with body `No award has been published yet. The first one will appear here.`
- Otherwise a **WinnerCard**:
  - Frame: radius 20, 2px `--g-edge` border, background `linear-gradient(165deg, wash 0%, wash 38%, C.surface 100%)`.
  - Entrance animation `wofSpotIn .6s` (opacity 0, translateY(10px) scale(.99) → none).
  - A laurel watermark SVG (170px, top-right, opacity .35, stroked in `--g-edge`): two arcs and five ellipse leaves per side.
  - Top row: a pill on `--g-ink` with `--g-wash` text: trophy icon + `awardName ?? 'Award'`. Then `cycleLabel` in `--g-soft`.
  - Person row: a 64px Avatar inside a 3px `--g-edge` ring, the name (26px bold `--g-text`), and the designation (`--g-soft`).
  - The message, as a blockquote with a 3px `--g-edge` left rule.
  - At the bottom: `` `Announced ${shortDate(publishedAt)}` ``.

**Leaderboard({rows, enabled})**
- `!enabled`: compact Empty(list) `Your company has the leaderboard switched off.`
- No rows: compact Empty(list) `Nobody is on the board yet. It fills as recognitions are published.`
- **Podium.** Used only when there are 2 or more rows; it takes `min(rows, 3)` people.
  - Seat order, left to right: `[2nd, 1st, 3rd]`, or `[2nd, 1st]` with two people.
  - Step heights by rank: 112 / 88 / 72 px. Steps are 116px wide and butt together; a top corner is rounded (10) only where it is exposed.
  - The #1 step uses `--g-wash` and `--g-edge` lines. The others use `C.sunken` with a black 0→16% vertical overlay and `C.line` lines.
  - Each step has a 4px "lit top" strip and contains:
    - the first name only (`name.split(/\s+/)[0]`)
    - the count
    - a large rank number "cut" into the face: 34px for #1 or 26px, opacity .9/.5, with a text-shadow
  - Above each step: an Avatar (54px with a gold ring for #1, 42px with a surface ring otherwise), a `♛` crown over #1 (19px `--g-ink`), and a blurred contact shadow.
  - Under the podium: one shared ground bar, 8px `C.line`.
  - Animations:
    - steps rise in (`wofRise .5s`, translateY(12px) → 0), staggered 90 ms per seat
    - the #1 step shimmers (`wofShimmer 4.5s` infinite, brightness 1 → 1.045)
  - Per-step aria-label: `` `${rank}. ${name}, ${n} recognition(s)` ``.
- **Remaining rows** (an `<ol>` starting at podiumCount+1):
  - Columns: rank (`C.faint`), Avatar 34, name and designation, then a 4px bar.
  - Bar width: `max(6, round(count/top*100))%`, in `C.brand` at opacity .7 on a `C.sunken` track.
  - On the right: the count (`F.lead` bold) over `recognition`/`recognitions`.
  - With only one row (no podium), that single row is rank 1 and gets the gold row styling: `--g-wash` bg, `--g-edge` border, `--g-ink` bar.
- Footer: `Counts recognitions received. It affects nothing else.`

**HallOfLegends({winners})**
- No winners: compact Empty(trophy) `Past award winners will be listed here once the first cycle closes.`
- Each row:
  - Avatar 32, at opacity .6 if `hasLeft`.
  - The name, plus a `no longer here` chip (`C.sunken`/`C.muted`, 11px) when the person has left.
  - Under the name: `awardName · cycleLabel`.
  - On the right: `publishedAt` as `toLocaleDateString('en-IN', {month:'short', year:'numeric'})`, e.g. "Oct 2026".
- Footer: `People who have left the company stay here. What somebody won is still theirs.`

#### 6.4.10 `Badge.tsx` and `BadgeCabinet.tsx` — badges, tiers and shapes

**Badge** is generated SVG; there are no image assets. It encodes three separate things:
- **shape** = the kind of badge:
  - `shield` = formal award
  - `hex` = company value
  - `medal` = quarterly title
  - `ring` = long service
- **tier/metal** = how many times it has been earned
- **glyph** = an emoji from `badge_master.glyph`

**Tiers** (`BADGE_TIERS`, a/b/c = highlight/body/shadow):

| Tier | a | b | c | rim | Label |
|---|---|---|---|---|---|
| blue | `#DBEAFE` | `#3B82F6` | `#1D4ED8` | `#93C5FD` | Blue |
| bronze | `#F6D5B3` | `#C97B3C` | `#7C4318` | `#E0A472` | Bronze |
| silver | `#F7FAFD` | `#A9B6C6` | `#5F6E80` | `#D5DEE8` | Silver |
| gold | `#FDEBB0` | `#EFB02A` | `#9A5E06` | `#F8D77A` | Gold |
| platinum | `#F0F8FF` | `#9BC0E6` | `#3F6B94` | `#CBE1F5` | Platinum |

The tier order is blue → bronze → silver → gold → platinum. Which tier applies is decided server-side and read from `employee_badges.tier`.

**Shape paths** (viewBox `-6 -6 132 144`):
- shield `M60 8 L104 27 V72 C104 99 84 117 60 125 C36 117 16 99 16 72 V27 Z`
- hex `M60 7 L104 32 V82 L60 107 L16 82 V32 Z`
- medal `M60 12 a48 48 0 1 1 -0.1 0 Z`
- ring `M60 10 a50 50 0 1 1 -0.1 0 Z`

**Layers, in draw order:**
1. Platinum (not locked): 16 rotating rays, 2.4×16 rects at 22.5° steps, opacity .7/.35 alternating, in the rim colour. They rotate 360° every 22 s (`ezBadgeRays`).
2. Locked: a progress ring, r=54 at (60,64):
   - track `#CBD5E1`, 4px, opacity .45
   - arc `#2563EB`, 4px round cap, dasharray `C·pct/100 C`, rotated -90°
3. Medal: two ribbon tails:
   - `M40 96 L28 130 L46 122 L58 130 L52 96 Z` in c
   - `M80 96 L92 130 L74 122 L62 130 L68 96 Z` in b
   - both at opacity .9
4. Inside a drop shadow (dy 4, std 4, colour c, opacity .38):
   - the shape filled with the metal gradient (a 0%, b 42%, c 72%, b 100%; vector 0,0 → .35,1) with a 1.5px rim stroke
   - a radial white highlight (cx 34%, cy 24%, r 62%, opacity .55 → 0)
   - an inner white outline at opacity .38, the shape scaled .86 about (60,62)
   - ring only: a 9px circle at r 38 in the plate gradient (c → b), opacity .55
   - a plate circle at r 27, (60,55), opacity .42
5. Glyph:
   - It is an HTML overlay, not SVG text, at top `0.22·size`, height `0.48·size`.
   - Font size is `0.26·size`. For `ring` it is instead `0.23·size`, weight 800, white, showing `years`.
   - It has a drop shadow, and opacity .7 when locked.

**Other states and behaviour:**
- **Count chip.** Shown when not locked and `count > 1`: a top-right pill `×N` (ink bg, surface text, 2px surface border, 12px weight 800).
- **Locked:**
  - the art is grayscale(1), brightness .94, opacity .5
  - a `{progress}%` pill near the bottom
  - the label is in ink-4
- **Size.** Width `size` (default 118); art height `round(size·1.1)`.
- **Label.** Optional, 12.5px weight 650. The sub line is 11px ink-4.
- **Tilt.** `interactive`: on the web the badge follows the pointer, ±8° rotateX/rotateY with perspective(600px) and translateY(-4px), easing back over .28s. It is disabled under reduced motion and below 60px.
- **Defaults.** `shape='shield'`, `tier='bronze'`, `glyph='★'`.
- **`badgeFromRow(row)`.** A helper, unused by the cabinet: `locked = (progress_pct ?? 100) < 100`.

**BadgeCabinet({badges, size=118})**
- `MyBadge {badge_code, label, glyph, tier, shape, earned_count, progress_pct, earned_at}`.
- Empty: compact Empty(medal, `Your cabinet is empty`) with body `Badges arrive from awards, company values and service milestones, the last of those on their own, from your joining date.`
- Otherwise:
  - Header: `**{earned}** earned`, plus `, {n} in progress` when some are unearned. "Earned" means `earned_at` is not null.
  - A `C.sunken` shelf grid (auto-fill, min `size+16`px) of Badge props:
    - `tier ?? 'blue'`, `shape ?? 'shield'`, `glyph ?? '★'`
    - `label`
    - sub = `earned_at` as `en-IN {month:'short', year:'numeric'}`
    - `count = earned_count ?? 1`
    - `locked = !earned_at` (note: the cabinet decides locked by `earned_at`, not by `progress_pct`)
    - `progress = progress_pct ?? 0`
    - `showLabel`, `interactive`
  - Badges are not clickable and open no detail view.

**Points.** The UI never shows points. `LeaderRow.points` exists but is not rendered, and the leaderboard counts recognitions. "Recognition never touches pay" is stated in three places:
- the composer footer: `Recognition is thanks, never pay.`
- the WallOfFame hero
- the leaderboard footer

`wall_config.payout_linkage` is CHECK-pinned to false (see 6.4.13).

#### 6.4.11 `AdminConsole.tsx` — "Manage the wall" (rendered for every employee)

**Mount.** `<AdminConsole employeeId={employeeId}/>`, inside WallOfFame's "Manage the wall" panel, shown to everyone. Denial is shown as a state, never hidden.

**Gate pass on mount** (direct Supabase with the anon client, not wallRpc):
1. Probe: `supabase.from('wall_config').select('module_enabled').limit(1)`.
   - The error matches PGRST205, "does not exist" or "could not find" (case-insensitive) → `ready=false` with no message.
   - Any other error → `err = error.message`, `ready=false`.
2. For each distinct permission (`wof.configure`, `wof.badge.manage`, `wof.board.manage`, `wof.admin.grant`, `wof.report.view`), run them **sequentially**:
   ```ts
   supabase.rpc('wof_can', { p_employee: employeeId, p_permission: p, p_company: null, p_branch: null })   // allowed iff data === true
   // if not allowed:
   supabase.rpc('wof_explain_access', { p_employee: employeeId, p_permission: p, p_company: null })        // reason = data ?? 'You do not have access to this.'
   ```
   Calling `wof_can` or `wof_explain_access` without `can[p] === true` must count as **locked**. That includes the case where the function errors.

**States:**
- `ready===null`: `Skeleton lines=4`.
- `ready===false`: a warning Notice titled `The Wall of Fame is not installed yet`. The body is `err`, or, when there is no error, this verbatim text: `Migrations 082 and 084–087 are written and handed over but not applied to this database. Once they run, EZER switches the module on for your company and your HR team names a Wall Owner. Nothing after that needs SQL.`
- Ready: the layout below.

**Layout.** Left is a nav column (`aria-label "Wall settings"`, a `C.sunken` box). Right is the selected area. The default area is `awards`. Each nav item has an icon and a label. The active item is `C.brandTint`/`C.brand`. A locked item is `C.faint` with a lock icon (title "Locked"). Under the nav: `` `You can open ${openCount} of 6` ``.

**The six areas** (key · label · permission · icon · blurb):

| key | label | permission | icon | blurb |
|---|---|---|---|---|
| awards | Awards | `wof.configure` | trophy | What can be won, who may nominate, and how often |
| values | Company values | `wof.configure` | heart | The values a shoutout can be tagged against |
| badges | Badges | `wof.badge.manage` | medal | Shapes, glyphs and the rules that unlock them |
| screens | Screens | `wof.board.manage` | tv | Televisions on the wall, and their pair codes |
| admins | Administrators | `wof.admin.grant` | users | Who may change any of this, and why they were granted it |
| audit | Audit | `wof.report.view` | clock | Every configuration change, who made it and when |

**What an ordinary employee sees.** All six areas are present and locked. Each locked area shows:
- the AreaHeader (icon, label, blurb) with a neutral `🔒 Locked` pill
- a `C.sunken` box with a 38px lock disc, the title `You can’t open this yet`, and the **database's sentence verbatim** from `wof_explain_access` (see 6.4.12 for every possible sentence)
- the footer `You can open 0 of 6`

**Read-only areas** (allowed and not `screens`):
- The AreaHeader carries a neutral `👁 Read-only` pill. Below it is a Table and then the footer `Read-only in this build. Changing configuration needs a server route that proves who is asking, because the database rejects an unidentified write.`
- Data loads after the company lookup `employees.select('company_id').eq('id', employeeId).maybeSingle()`, then `supabase.from(<table>).select(<cols>).limit(100).eq('company_id', companyId)`. If the company is null the query becomes `.limit(0)`. A query error leaves the table empty.

| area | table | select | columns shown (status column is a Pill: `active` = positive, otherwise neutral) | empty text |
|---|---|---|---|---|
| awards | `recognition_awards` | `name, frequency, is_active` | Award · Cadence · Status (`active`/`off`) | `No awards yet. Your Wall Owner adds the first one.` |
| values | `recognition_values` | `label, code, is_active` | Value · Code · Status | `No values yet. A values programme is optional.` |
| badges | `badge_master` | `label, shape, base_tier, is_active` | Badge · Shape · Tier · Status | `No badges yet. Service milestones generate their own.` |
| admins | `wall_admins` | `employee_id, admin_level, grant_reason, is_active` | Level · Why they were granted it · Status (`active`/`revoked`). employee_id is selected but not shown. | `Only the Wall Owner, so far.` |
| audit | `wall_audit_log` | `action, entity, created_at` | Action · Entity · When (`toLocaleString('en-IN')` or `-`) | `Nothing changed yet.` |
| (screens table def, unused because screens uses the manager) | `board_screens` | `screen_name, pair_code, rotate_seconds, is_active` | Screen · Pair code · Rotates (`Ns`) · Status | `No screens paired. Add one to put the wall on a television.` |

The table is horizontally scrollable (min width 440). A null cell shows `-`. The first column is semibold `C.ink`. Administrators cannot be granted or revoked from the UI, and **`grant_wall_admin` / `revoke_wall_admin` / `list_wall_admins` are not called by any component**. They are allowlisted in the route only (signatures in 6.4.12).

**Screens area** (`ScreensManager`; the only writable area, shown when `wof.board.manage` is allowed):
- **Load:**
  - `employees.select('company_id').eq('id', employeeId).maybeSingle()`
  - `locations.select('id, location_name').eq('company_id', co).eq('status','Active').order('location_name')`. The first location is preselected.
  - `board_screens.select('id, screen_name, pair_code, rotate_seconds, is_active, location_id').order('created_at', {ascending:false})`. **This query has no company filter**, so RLS decides what comes back.
- **Add form** (`C.sunken` box):
  - `Screen name`: text, placeholder `Manesar Plant · Gate 2`.
  - `Location`: a select of active locations, or a single `No locations` option.
  - `Rotate every (s)`: number, min 5, max 120, default `'8'`. The HTML bounds are not enforced in code.
  - Button: primary, plus icon, `Add screen` / `Adding…`.
- **Validation** (the messages flash for 3 s):
  - `Give the screen a name`
  - `Pick a location`
- **Add call:** `wallRpc('create_board_screen', { p_location: locId, p_name: name.trim(), p_rotate: Number(rotate) || 8 })`. Success shows `Screen added. Share its pair code with the TV`. An error shows the server's message.
- **Messages.** Positive and critical Notices; both auto-clear after 3000 ms.
- **Empty:** Empty(tv, `No screens paired yet`) with body `Add one to put the wall on a television.`
- **ScreenCard**:
  - A 40px tv tile (`C.brandTint`/`C.brand` when active, `C.sunken`/`C.faint` when off).
  - `screen_name`, then `` `${locationName} · ${rotate_seconds}s rotation` ``.
  - A status Pill: `active` (positive) or `off` (neutral).
  - The pair-code button: monospace, letter-spacing .14em, `C.brandDeep` on `C.brandTint`, dashed `C.brandEdge` border, title `Copy pair code`. Clicking copies the code to the clipboard and shows `Copied ✓` for 3 s.
  - Actions:
    - `New code` (refresh icon): `wallRpc('rotate_board_pair_code', { p_screen })`, then `New pair code issued. The old one no longer works`.
    - `Deactivate` / `Activate` (power icon): `wallRpc('set_board_screen_active', { p_screen, p_active: !is_active })`.
    - `Remove` (danger, trash icon). The first click turns it into `Confirm remove` (danger) plus `Keep` (ghost). Confirming calls `wallRpc('delete_board_screen', { p_screen })`.
  - Every action reloads the list. An error flashes the server's message.

The route maps these four actions to migration 101's wrappers: `create_board_screen_as(p_actor, p_location, p_name, p_rotate, p_scope)` (p_scope defaults to `'branch'`, p_rotate to 8), `set_board_screen_active_as`, `rotate_board_pair_code_as` and `delete_board_screen_as`.

#### 6.4.12 Wall RPCs — what is sent, what comes back, every refusal (latest SQL)

**How a call travels.** The route calls `<name>_as(p_actor, …)` with the service role. Every `_as` wrapper (094; boards 101; admins 106/110) begins with `perform wof_act_as(p_actor)`, which sets `app.current_employee_id` for the current transaction only. The inner function then reads the actor through `wof_current_employee()`.

`wof_act_as` can refuse:
- `An actor is required. The caller must resolve the employee before calling a wall function.` (p_actor null)
- `Employee <uuid> is not an active employee` (unknown id, or `date_of_leaving < today`)

The route maps errcode `42501` → HTTP 403 and everything else → 400. Postgres CHECK and NOT NULL violations come through as raw Postgres text with 400.

**Message differences.** Where a server message differs from the client mirror in `lib/wall/*`, the server text below is what the person sees after a failed submit.

##### get_company_feed — `wallRpc('get_company_feed', { p_scope: 'company', p_limit: 20 })` (sent by WallOfFame)

Signature: `get_company_feed(p_scope text='company', p_category text=null, p_kind text=null, p_limit int=20, p_before timestamptz=null) returns setof v_company_feed` (086; the wrapper is in 094).

- `p_scope`:
  - `company`
  - `branch`
  - `department`
  - `circle` (the viewer's manager and their reports)
  - `mine` (given or received)
- The page size is `least(p_limit, 50)`. Rows are ordered `published_at desc`. Paging is done with `p_before` = the last row's `published_at`.
- If `wof_can(actor,'wof.view')` is false it returns an **empty set**, not an error. It raises no exceptions of its own.
- Visibility per post (applied on top of the requested scope):
  - `company`: everyone.
  - `branch`: rows with the viewer's `location_id`.
  - `department`: any receiver in the viewer's department.
  - `team`: the giver is the viewer's L1 manager, or the viewer.
  - The viewer always sees their own posts.

Row shape (`v_company_feed`, 086; never redefined later):

| column | type | notes |
|---|---|---|
| id | uuid | recognition id |
| company_id, location_id | uuid | |
| kind | text | `award` \| `shoutout` \| `milestone` \| `pms_remark` |
| visibility | text | `company` \| `branch` \| `department` \| `team` |
| message, message_hi | text | |
| points_awarded | int | never rendered |
| thanked_back | boolean | |
| published_at | timestamptz | |
| cycle_label | text | |
| category_code, category_label, category_glyph, category_colour | text | from `shoutout_categories` (colour_token: blue/green/cyan/violet/rose/gold/slate) |
| award_name, badge_code | text | from `recognition_awards` |
| giver_id | uuid | |
| giver_name, giver_code, giver_designation, giver_branch | text | |
| receivers | jsonb | an array of `{id, name, code, designation, department, branch, photo_url}`; leavers are excluded |
| values | jsonb | an array of `{code, label, colour}` |
| reaction_count, comment_count | bigint | the comment count excludes hidden comments |

> **Parity caveat.** `FeedCard` reads `row.receiver_names`, but that column **does not exist** in `v_company_feed`. It returns `receivers` (jsonb) instead. The web feed therefore always prints "… recognised **a colleague**" and never draws the receiver AvatarStack. For strict parity RN would do the same. The obvious fix is `receiver_names = receivers.map(r => r.name)`, which is a product decision.

##### get_feed_stats — allowlisted (`p_company`), **not called by any component**

It returns jsonb:
```
{ shoutouts_this_month:int, people_recognised_this_month:int,
  top_categories:[{label,glyph,n}] (≤5, this month),
  my_shoutouts_left_today:int (shoutout_daily_limit default 5 − today's count, ≥0),
  never_recognised_90d:int }
```
It raises no exceptions of its own. RN *could* use `my_shoutouts_left_today` to feed `sentToday` to the composer, but the web does not do this.

##### create_shoutout — sent by ShoutoutComposer (and internally by send_appreciation / approve_share_to_feed)

Args sent: `{ p_receivers: uuid[], p_category: text (shoutout_categories.code) | null, p_message: text (trimmed), p_value_ids: uuid[], p_visibility: 'company'|'branch'|'department'|'team' }`.

Signature (086): `create_shoutout(p_receivers uuid[], p_category text, p_message text, p_value_ids uuid[]='{}', p_visibility text=null) returns jsonb`. A null visibility falls back to `wall_config.feed_default_scope`.

It returns:
```
{ id: uuid, category: text, points: int, receivers: int, shoutouts_left_today: int }
```

It raises, in this order (errcode in brackets):
1. `No acting employee in session.` [42501]. Actor null.
2. `Shoutouts are not available to you. <wof_explain_access sentence>` [42501]. `wof_can(actor,'wof.shoutout.create', company, branch)` false; for example the `shoutouts_enabled` switch is off.
3. `Pick what the shoutout is for.` [22023]. `require_category` and no active category with that code in the actor's company.
4. `This shoutout needs a company value attached.` [22023]. The category `requires_value`, or `wall_config.require_value`, and `p_value_ids` is empty.
5. `Pick at least one person.` [22023]
6. `You cannot recognise yourself.` [22023]
7. `Group shoutouts are switched off for this company.` [22023]. More than one receiver and `!allow_group_shoutout`.
8. `You can recognise up to <max_receivers> people at once.` [22023]. `max_receivers` defaults to 10 (range 1–25).
9. `One or more people named are not active employees of this company.` [22023]. A receiver in another company, or one who has left.
10. `Say a little more — at least <min_message_length> characters.` [22023]. Trimmed length below `min_message_length` (default 15, range 0–200). **Server wording uses an em dash; the client uses a colon.**
11. `You have used all <shoutout_daily_limit> shoutouts for today. They reset at midnight.` [22023]. Today's count of kind=shoutout by this giver is at or above the limit (default 5).
12. `You already recognised one of these people in the last <shoutout_cooldown_hours> hours.` [22023]. Any overlap with this giver's shoutouts inside the cooldown (default 24 h). **The server always says "one of these people".**

Side effects:
- It inserts a `recognitions` row (kind `shoutout`, `points_awarded = category.points ?? 10`).
- If values were given, `award_badge` runs for every active badge whose `value_code` matches. This creates or increments `employee_badges` and upgrades the tier by `tier_thresholds` (default `{"bronze":1,"silver":3,"gold":5,"platinum":10}`).
- The `trg_notify_recognition` trigger writes a `recognised` inbox event to each receiver, preview `<giver> recognised you`. For an award the preview is `You received an award`.

Table CHECKs: `receiver_employee_ids` length 1–25; `visibility` in the four values.

##### set_recognition_marks — sent by ShoutoutComposer after create_shoutout, when a badge or tags were chosen

Args: `{ p_recognition: uuid, p_badge_ref: 'B0xx'|null, p_tag_refs: string[] }`.

Signature (089, wrapper in 094): returns `{ id, badge_ref, tags: int }`. It overwrites `recognitions.badge_ref` and `tag_refs`.

It raises (P0001 → 400):
- `That recognition no longer exists`
- `Only the person who gave this recognition can set its badge`
- `This recognition has been archived`
- `trg_recognition_refs` trigger:
  - `<ref> is not an active badge`
  - `<ref> is not an active tag`
  - `the same tag has been given twice`
- CHECK `recognitions_tag_refs_len`: at most 5 tags (raw constraint text).

The badge and tags live in `recognition_catalogue (ref, kind 'BADGE'|'TAG', name, category, glyph, description, sort_order)`, which is generated from `lib/wall/catalogue.ts`. Setting marks does **not** award an `employee_badges` row.

##### send_appreciation — sent by AppreciationComposer

Args sent: `{ p_receivers: uuid[], p_category: code|null, p_body: text (trimmed), p_also_post: boolean, p_visibility: 'company' }`. `p_related` is never sent.

Signature (087): `send_appreciation(p_receivers uuid[], p_category text, p_body text, p_related uuid=null, p_also_post boolean=false, p_visibility text='company') returns jsonb`.

It returns:
```
{ id: uuid (wall_messages.id), posted_publicly: boolean, recognition_id: uuid|null, messages_left_today: int }
```

It raises:
1. `Direct appreciation is not available to you. <explain>` [42501]. `wof.message.send` refused.
2. `Direct appreciation is switched off for this company.` [22023]. `!direct_messages_enabled`.
3. `Pick what you are appreciating them for.` [22023]. `dm_requires_category` (default true) and no valid category.
4. `Pick at least one person.` [22023]
5. `You cannot send appreciation to yourself.` [22023]
6. `You can appreciate up to <max_receivers> people at once.` [22023]. This shares `wall_config.max_receivers` with shoutouts.
7. `One or more people named are not active employees of this company.` [22023]
8. `You have sent all <dm_daily_limit> appreciation notes for today.` [22023]. `dm_daily_limit` defaults to 10 (range 0–50).
9. **Table CHECK `wall_messages.body` length 15–2000.** A note shorter than 15 characters fails with Postgres' raw `new row for relation "wall_messages" violates check constraint "wall_messages_body_check"` (400). The client mirror says notes have "no minimum", and the composer copy reads "However short you like", but **the database requires at least 15 characters**. Over 2000 also fails.
10. With `p_also_post && dm_allow_share_to_feed`, the function also calls `create_shoutout(p_receivers, p_category, p_body, '{}', p_visibility)`. Every create_shoutout refusal above can then surface: min length, shoutout daily limit, 24 h cooldown, group switch, required value. It runs in the same transaction, so the whole note is rolled back. If `dm_allow_share_to_feed` is false, `p_also_post` is silently ignored.

Side effects:
- one `wall_messages` row (`share_state 'private'`, or `'shared'` when it was also posted)
- one `wall_message_recipients` row per receiver
- an `appreciation` inbox event per receiver, preview `<sender> sent you appreciation`

##### thank_for_appreciation · request_share_to_feed · approve_share_to_feed · thank_back

None of these four are called from the Wall of Fame tab. The first two are inbox actions (WallInbox, documented elsewhere). `approve_share_to_feed` and `thank_back` are allowlisted but have no UI.

- **`thank_for_appreciation(p_message uuid, p_body text=null) returns void`**
  - Raises:
    - `Message not found.`
    - `This message was not sent to you.` [42501]
    - `You have already replied. This channel allows one reply — carry the rest into a conversation.` [22023]
  - Sets `thanked_at`. `thank_body` is cut to 500 characters. It writes a `thanked_back` event to the sender, preview `<name> thanked you for your note`.
- **`request_share_to_feed(p_message uuid) returns void`**
  - Raises:
    - `This message was not sent to you.` [42501]
    - `This note has already been dealt with.` [22023], when `share_state <> 'private'`
  - Sets `share_requested` and writes a `share_request` event to the sender, preview `<name> would like your note shared on the wall`.
- **`approve_share_to_feed(p_message uuid, p_visibility text='company') returns uuid`** (the new recognition id)
  - Raises `Only the person who wrote it can share it.` [42501].
  - It then calls `create_shoutout` with the stored body and category, so every create_shoutout refusal applies.
- **`thank_back(p_recognition uuid) returns void`** (086)
  - Raises:
    - `Not found.`
    - `Only the person recognised can thank back.` [42501]
  - Sets `recognitions.thanked_back = true`. The flag is never displayed.

##### add_comment — used only by the unmounted CommentThread

Args: `{ p_recognition, p_body (trimmed), p_parent: uuid|null, p_mentions: uuid[] }`. Returns a uuid (the new comment id).

It raises:
- `Commenting is not available to you. <explain>` [42501]
- `That post is no longer available.`, when the recognition is missing or archived
- `Replies are switched off for this company.` [22023], when `p_parent` is set and `!comment_replies_enabled`
- `Replies only go one level deep here. Reply to the original comment instead.` [22023], when the depth exceeds `comment_max_depth` (default 1, range 0–3)
- Table CHECK: `recognition_comments.body` length 1–1000 (raw constraint text)

Other rules:
- If `!mentions_enabled`, the mentions are silently dropped.
- Notifications:
  - a top-level comment sends `commented` to every receiver (`<name> commented on your recognition`)
  - a reply sends `replied` to the parent author (`<name> replied to your comment`)
  - every mention sends `mentioned` (`<name> mentioned you in a comment`)
  - nobody is notified about their own action

**`comment_reactions` table:** `(id, comment_id, employee_id NOT NULL, emoji text default 'clap', created_at, unique(comment_id, employee_id, emoji))`, with RLS allow-all. CommentThread inserts `{comment_id, emoji}` **without `employee_id`**, so the insert would be refused by NOT NULL and the optimistic +1 would be rolled back by the reload. The unique key allows one reaction of each emoji per person.

**`recognition_reactions`** (`recognition_id, employee_id, emoji default 'clap'`, unique) is counted into `v_company_feed.reaction_count`, but **no UI reads or writes it**.

##### Inbox RPCs (reference; the UI is in WallInbox, documented elsewhere)

- **`get_wall_inbox(p_filter='all'|'unread'|'appreciation'|'comments'|'replies', p_limit=30 (max 50), p_before)`** (latest: 093)
  - Returns a table of: `id uuid, event_type text, is_read bool, created_at timestamptz, actor_id uuid, actor_name, actor_code, actor_designation, actor_branch, preview, body (coalesce of message body, comment body, recognition message), category_label, category_glyph, recognition_id uuid, comment_id uuid, message_id uuid, can_thank bool (appreciation and not yet thanked), can_request_share bool (appreciation and share_state='private')`.
  - It returns an empty set when `wof.inbox.view` is refused.
- **`get_inbox_counts()`** returns `{total_unread, appreciation, comments, replies}`. The appreciation stream counts appreciation, recognised, thanked_back and share_request.
- **`mark_inbox_read(p_ids uuid[]=null)`** returns the number of rows marked read. Null marks all as read. It also stamps `wall_message_recipients.read_at`.

##### Board screens (AdminConsole · Screens; 101 wrappers)

| action → fn | args sent | returns | raises |
|---|---|---|---|
| `create_board_screen` → `create_board_screen_as(p_actor, p_location, p_name, p_rotate=8, p_scope='branch')` | `{p_location, p_name, p_rotate}` | the `board_screens` row | `Unknown location <id>`; `A screen name is required`; the trigger guard (below) |
| `set_board_screen_active` → `…_as(p_actor, p_screen, p_active)` | `{p_screen, p_active}` | the row | `No screen <id>`; guard |
| `rotate_board_pair_code` → `…_as(p_actor, p_screen)` | `{p_screen}` | the row with a new `pair_code` | `No screen <id>`; guard |
| `delete_board_screen` → `…_as(p_actor, p_screen)` | `{p_screen}` | boolean (`found`) | guard |

Details:
- **Pair code.** 6 uppercase alphanumerics from `gen_random_bytes(6)` base64, retried until unique.
- **Rotation.** `rotate` is clamped to 5–120.
- **Guard trigger.** `trg_guard_screens` → `enforce_wall_admin('wof.board.manage')` (latest: 109) raises:
  - `Wall of Fame: no acting employee in session. Set app.current_employee_id.` [42501]
  - `Wall of Fame: <actor uuid> is not permitted to change board_screens. <explain>` [42501]
  - The 109 exemption covers heartbeat-only updates (`last_seen_at`/`last_seen_ip`).
- **Audit.** Every change is audited to `wall_audit_log` (`action = 'board_screens.insert|update|delete'`).
- **106's variants.** `pair_board_screen`, `rotate_screen_pair_code`, `set_screen_active` and `list_board_screens` (106/107/108) are allowlisted too, but **unused**.

`board_screens` columns:
- `id`, `company_id`, `location_id`, `screen_name`
- `pair_code` (unique), `pair_code_set_at`
- `rotate_seconds` (5–120, default 8)
- `language` (`en`|`hi`|`both`)
- `slide_types` (text[] default `{hero,grid,milestone}`)
- `scope` (`branch`|`company`|`group`)
- `max_slides` (3–40, default 12)
- `is_active`, `created_by`, `created_at`, `last_seen_at`, `last_seen_ip`

##### Wall administrators (allowlisted; **no UI calls them**)

- **`grant_wall_admin_as(p_actor, p_employee, p_level, p_reason, p_branch=null, p_valid_until=null)`** returns a uuid.
  - Raises:
    - `Only a Wall Owner can grant Wall Administrator rights.` [42501]
    - `You cannot grant Wall Administrator rights to yourself.` [42501]
    - `A reason is required for every Wall Administrator grant.` [22023], when the trimmed reason is under 5 characters
  - Table CHECKs: level in `wall_owner|wall_admin|wall_moderator|board_operator`; no self-grant; one active grant per (company, employee, location).
- **`revoke_wall_admin_as(p_actor, p_grant_id, p_reason)`** returns void.
  - Raises `Only a Wall Owner can revoke Wall Administrator rights.` [42501].
- **`list_wall_admins_as(p_actor, p_company=null)`** (latest: 110) returns a table of `grant_id, employee_id, emp_code, full_name, admin_level, granted_at, grant_reason, valid_until`.
  - Raises `You need Wall Administrator rights to see who else holds them.` [42501] unless the caller holds `wof.admin.grant` or `wof.configure`.

##### Gate functions called directly by AdminConsole

- **`wof_can(p_employee, p_permission, p_company, p_branch)`** returns boolean (084).
  - The checks run in order: the employee is active → `wall_config` exists and `module_enabled` → the permission code exists → the feature switch → the location override (`location_overrides[branch].wall_enabled`) → admin_only.
  - An admin_only permission needs `is_wall_admin(rank ≥ min_level)`, or `super_admin` via `can(…,'company.activate','global')`.
  - Otherwise the RBAC `can(p_employee, perm, 'self')` decides, defaulting to true.
  - Feature switches:
    - `wof.view` ↔ `wall_enabled`
    - `wof.shoutout.create` ↔ `shoutouts_enabled`
    - `wof.nominate` ↔ `nominations_enabled`
    - `wof.react` ↔ `reactions_enabled`
    - `wof.board.manage` ↔ `board_enabled` (**default false**)
- **`wof_explain_access(p_employee, p_permission, p_company)`** returns text (latest: 095). It first calls `wof_can`; if that is true it returns `Allowed.`. Otherwise it returns exactly one of these sentences, in this order of checks:
  - `No employee to check.`
  - `This employee is not attached to a company.`
  - `This employee has left the organisation.`
  - `Module has never been set up for this company.`
  - `Module is not activated. EZER Super Admin must activate it.`
  - `Unknown permission code.`
  - For board management with the switch off: `Wall boards are switched off for this company. Switch on "board" in the Wall of Fame settings — an administrator grant will not open this on its own.`
  - For other switches: `This feature is switched off for the company, so <perm> is unavailable to everybody. It is a settings switch, not a permission.`
  - `Restricted to EZER Super Admin.`
  - `Requires Wall Administrator level <min_level> or above. Ask a Wall Owner to grant it.`
  - `Refused by the access gate, for a reason this screen could not determine. Please report it.`
  - `Your role does not include this permission.`

**Admin permission minimum levels** (`wall_permissions`): `wof.publish`, `wof.unpublish` and `wof.moderate` need `wall_moderator`; `wof.configure`, `wof.badge.manage` and `wof.report.view` need `wall_admin`; `wof.board.manage` needs `board_operator`; `wof.admin.grant` needs `wall_owner`; `wof.module.activate` needs `super_admin`. An ordinary employee therefore sees `Requires Wall Administrator level wall_admin or above. Ask a Wall Owner to grant it.` on Awards, Company values, Badges and Audit, and `…level wall_owner…` on Administrators. On Screens they see the "Wall boards are switched off…" sentence while `board_enabled` is false (the default), and otherwise `…level board_operator…`.

**Everyday permissions.** Available to all employees through RBAC `everyday` (097 opened endorse/shortlist): `wof.view`, `wof.shoutout.create`, `wof.react`, `wof.comment`, `wof.mention`, `wof.nominate`, `wof.inbox.view`, `wof.message.send`, `wof.endorse`, `wof.shortlist`.

#### 6.4.13 Tables and columns read directly, and the configuration that drives the rules

- **`employees`**:
  - `id, company_id` (composer and console company lookup)
  - `id, full_name, emp_code, designation, date_of_leaving` (PersonPicker search, with `date_of_leaving is null`)
- **`shoutout_categories`** (086; per company; RLS allow-all; writes guarded by `wof.configure`):
  - Columns: `id, company_id, code, label, helper_text, glyph (default '👏'), colour_token (blue|green|cyan|violet|rose|gold|slate), points (0–100, default 10), requires_value, sort_order, is_active, created_at, created_by`, unique `(company_id, code)`.
  - The composers read `id, code, label, helper_text, glyph, requires_value`. `colour_token` and `points` are not shown.
  - **Live seed per company, after 115:**

| sort | code | label | glyph | helper_text | colour | points |
|---|---|---|---|---|---|---|
| 1 | helping_hand | Helping hand | 🤝 | Covered a shift, unblocked someone, stayed back to help. | green | 10 |
| 2 | above_beyond | Above and beyond | 🚀 | Went past what the job asked for. | violet | 15 |
| 3 | customer_save | Customer save | 🛟 | Turned an unhappy customer around. | cyan | 15 |
| 4 | safety_catch | Safety catch | 🦺 | Spotted a hazard or stopped an unsafe job. | rose | 20 |
| 5 | learning | Learning and sharing | 📚 | Taught someone, wrote it down, ran a session. | gold | 10 |
| 6 | team_spirit | Team spirit | 🎈 | Made the team better to work in. | slate | 10 |
| 7 | thank_you | Just a thank you | 🙏 | No big reason needed. | slate | 5 |
| — | performance | Performance | 📈 | Hit a number, cleared a backlog, delivered ahead of plan. | blue | 15 |

  The `performance` row is **deactivated by 115** (`is_active=false`). It is kept for posts that already carry it, so an old feed row can still display "📈 Performance". None of the seeds set `requires_value`. Companies can edit the list; RN must read it, not hard-code it.
- **`recognition_values`**:
  - Columns: `id, company_id, code, label, description, colour_token, icon, sort_order, is_active`.
  - The composer reads `id, label`; the console reads `label, code, is_active`.
- **`recognition_comments`**: `id, recognition_id, employee_id, body (1–1000), is_hidden, hidden_by, created_at, parent_comment_id, mentions uuid[] default '{}', edited_at`.
- **`comment_reactions`**: see 6.4.12.
- **`wall_config`** (one row per company). Columns that drive the rules:

| Group | Column (default) |
|---|---|
| Module and feature switches | `module_enabled` (false) |
| | `wall_enabled`, `shoutouts_enabled`, `nominations_enabled`, `badges_enabled`, `points_enabled`, `leaderboard_enabled`, `milestones_enabled` (all true) |
| | `board_enabled` (**false**) |
| | `comments_enabled`, `reactions_enabled` (true) |
| Feed content | `show_birthdays`, `show_service_years` (true) |
| Visibility | `default_visibility` / `feed_default_scope` ('company') |
| Shoutout limits | `shoutout_daily_limit` (5), `shoutout_cooldown_hours` (24) |
| Shoutout requirements | `require_category` (true), `require_value` (false), `allow_group_shoutout` (true), `max_receivers` (10, 1–25), `min_message_length` (15, 0–200) |
| Direct notes | `direct_messages_enabled` (true), `dm_daily_limit` (10, 0–50), `dm_requires_category` (true), `dm_allow_share_to_feed` (true) |
| Comments | `mentions_enabled` (true), `comment_replies_enabled` (true), `comment_max_depth` (1, 0–3) |
| Pay | `payout_linkage` (false, with **CHECK payout_linkage = false**) |
| Locations | `location_overrides` (jsonb) |

  Only `module_enabled` and `leaderboard_enabled` are read client-side, by WallOfFame. Every other rule is enforced server-side; the client uses the defaults from `lib/wall/*`.
- **`badge_master`**:
  - Columns: `code, label, glyph ('★'), shape (shield|hex|medal|ring), base_tier, tier_thresholds jsonb, award_id, value_code, unlock_rule jsonb, service_years, show_on_board, is_active`.
  - **`employee_badges`** columns: `employee_id, badge_code, earned_count, tier, progress_pct (0–100, default 100), first_earned_on, last_earned_on`.
  - These are read by WallOfFame (documented elsewhere) and rendered by BadgeCabinet.
- **AdminConsole tables:**
  - `recognition_awards`: `name, frequency (monthly|quarterly|half_yearly|annual|anytime), is_active`
  - `wall_admins`: `employee_id, admin_level, grant_reason, is_active` (generated from `revoked_at is null`)
  - `wall_audit_log`: `action, entity, created_at`
  - `locations`: `id, location_name`, filtered by `company_id` and `status='Active'`
  - `board_screens`: see 6.4.12

**Uploads.** The Wall of Fame has none. There are no photos, attachments or files in any composer, comment or admin area, and no Supabase Storage calls. Avatars are initials only. `receivers[].photo_url` exists in the feed payload but is unused.

**Realtime.** None. There are no Supabase channels or subscriptions. The feed refreshes only after you post a shoutout (WallOfFame `load()`).

**Editing and deleting.** No shoutout, note, comment or reaction can be edited or deleted from the employee UI. The `edited_at` columns exist but have no writer.

#### 6.4.14 `app/board/[pairCode]` — the TV board (not part of the employee app)

This is a public, unauthenticated, always-dark full-screen page for televisions. It uses the board palette (ground `#060F1F`, card `#0E1C33`, brand `#3B82F6`, gold `#F5C86B`), and gold is used only for the award ribbon.
- **Data.** Its only query is `supabase.rpc('get_board_payload', { p_pair_code })` (latest: 108). The payload is `{ error?, screen:{name, rotate_seconds, language}, company:{name}, slides:[{id, citation, award, badge_code, badge_tier, badge_count, cycle_label, full_name, emp_code, designation, dept_name, location_name, photo_url}] }`. Each call stamps `last_seen_at` as a heartbeat; that update is exempt from the guard and the audit by 109.
- **Refresh and rotation.** It refetches every 5 minutes. Slides rotate every `max(6, rotate_seconds ?? 12)` seconds.
- **Layout.** A header shows the company name (or `Wall of Fame`) with a "Wall of Fame" sub line, slide dots, a live dot with the screen name, and `i of n`. The stage shows the honoree and a 200px `medal` Badge (tier `badge_tier ?? 'gold'`). The footer has a white timer bar, `Up next <name>` and a ticker of names.
- **Empty and error states:**
  - `Connecting…`
  - `This screen is not paired`: `Ask your HR team to check the pair code and that the board is switched on.`
  - `Nothing to show yet`: `Awards appear here as soon as they are published.`
- **Screens.** They are managed from AdminConsole → Screens. The mobile app need not implement the board.

#### 6.4.15 Implementation notes for React Native (Wall of Fame)

- **Emoji.**
  - There is **no emoji picker anywhere**.
  - Glyphs are fixed data: the catalogue glyphs (6.4.1), `shoutout_categories.glyph` from the database, the two send-mode glyphs (`✉️`, `📣`), the podium crown `♛`, and the three CommentThread reactions `👏 🙌 ❤️` (only if comments are ever mounted).
  - Render them as plain `<Text>`. Several glyphs are multi-codepoint (`🧑‍🏫`, `🎖️`, `🛡️`, `⚙️`, `🗣️` with VS16/ZWJ), so do not slice or measure them by `.length`.
  - The `wall_messages` 15-character CHECK counts Postgres characters, not grapheme clusters.
- **Badge SVG.**
  - Port `Badge.tsx` to `react-native-svg`. Reuse the exact `SHAPE_PATH`, ribbon paths, `BADGE_TIERS` colours, gradient stops, radial highlight, the inner outline (`scale(.86)` about 60,62) and the plate circles, with viewBox `-6 -6 132 144` and height `size*1.1`.
  - `feDropShadow` is not supported by react-native-svg. Use a view-level shadow (iOS `shadowColor = metal.c`, `shadowOpacity .38`, `shadowRadius 4`, offset y 4; Android `elevation`), or a pre-blurred duplicate path at low opacity.
  - Keep the glyph as an absolutely positioned `<Text>` over the SVG, not SVG `<Text>`, exactly as the web does so emoji render consistently. Use top `0.22·size`, height `0.48·size`, font `0.26·size` (ring: `0.23·size`, weight 800, white, showing years).
  - Locked state: grayscale is not available in RN. Use opacity .5 and swap to a neutral metal (e.g. the silver tier, or a computed grey), plus the `%` pill and the progress ring (strokeDasharray as on web).
  - Unique gradient ids per instance: use `useId()` or a counter.
- **Animations** (use Reanimated or `Animated`; honour `AccessibilityInfo.isReduceMotionEnabled()` everywhere the web honours `prefers-reduced-motion`; note Spotlight's `useCalm` starts "calm" until resolved):

| Effect | Spec | Easing |
|---|---|---|
| Panel or dropdown open (`wofOpen`) | 340 ms, opacity 0→1, translateY -6→0 | `cubic-bezier(.22,.72,.28,1)` |
| Skeleton and "Searching" pulse (`wofPulse`) | 1.4 s loop, opacity .55↔1 | ease-in-out |
| Toast (`wofToast`) | 380 ms, opacity 0→1, translateY 14→0, auto-dismiss 3800 ms | |
| Spotlight entrance (`wofSpotIn`) | 600 ms, opacity 0, translateY 10, scale .99 → identity | |
| Podium rise (`wofRise`) | 500 ms per step, translateY 12→0 plus fade, staggered 90 ms by seat order (2nd, 1st, 3rd) | `cubic-bezier(.2,.8,.2,1)` |
| #1 shimmer (`wofShimmer`) | 4.5 s loop, brightness 1→1.045→1 | |
| Platinum rays (`ezBadgeRays`) | continuous 360° rotation every 22 s about (60,66) | linear |
| Press feedback | translateY 1 | |

  For the #1 shimmer, RN can approximate brightness with an overlay opacity of 0→0.045 white. The pointer-follow 3D tilt on badges has no touch equivalent and can be dropped, or replaced by a gentle press-scale; it is purely decorative.
- **Mentions input.** On the web, mentions are typed as plain `@Full Name` text with no autocomplete; ids are recovered by substring match against a supplied `names` map (`body.includes('@'+name)`). They are rendered with `renderBody()` from `@/lib/wall/comments`, which RN can import unchanged, as chips with a `C.brandTint` background and `C.brand` text. Comments are not mounted on the web wall, so mentions are out of scope for strict parity. If they are built, keep the text format identical: `@` plus the exact display name, longest-name-first matching, and the server's `mentions_enabled` switch.
- **Person search.** Debounce 220 ms, minimum 2 characters, limit 8, `date_of_leaving is null`, and build the `or()` filter with `orIlike` from `@/lib/pg-search`, which is pure. The web's ↑/↓/Enter/Esc keyboard handling maps to a tappable list on mobile.
- **Validation UX.**
  - Keep the "enabled button, show problems after the first press" behaviour.
  - Display server messages verbatim; they differ slightly from the client mirror (6.4.12).
  - The client does not know the real quota or cooldown. Either keep the web behaviour (the dots always show 5 of 5 and 10 notes left) or improve on it with `get_feed_stats.my_shoutouts_left_today`. The latter is a deviation.
- **Layout.** `Split` with `stickyRail` becomes a single column on a phone: steps first, then the preview and send box. Consider a sticky bottom send bar. `CategoryGrid` and `ModeChoice` tiles go one per row below about 400 px. JumpBar becomes section anchors in a `ScrollView`.
- **Gold theming.** Define the five gold tokens for light and dark (6.4.9) and switch on the app's colour scheme. Text on a gold surface must use `--g-text`/`--g-soft`, never `C.ink`; this is a contrast requirement.
- **Clipboard** (Screens pair code): `expo-clipboard` `setStringAsync`, then show `Copied` for 3 s.
- **Shoutout sequencing.** `set_recognition_marks` must run only after `create_shoutout` succeeds, using the returned `data.id`. A marks failure must not discard the post. The web sets `Posted, but the badge did not attach: …` but unmounts it immediately (see 6.4.3).
- **Not in the web wall** (and so excluded from parity): reactions on posts, comments on posts, thank-back on posts, sharing a note to the feed from the Wall tab, editing or deleting, uploads and photos, realtime.

### 6.5 `components/ess/Celebrations.tsx` + `/api/ess/celebrations` (legacy strip; the API is still live)

**Where it is used.** `Celebrations.tsx` is rendered only inside the legacy `Home` function of `EmployeePortal.tsx`, which **no view renders any more**: the `home` case renders `Today`. The Today tab uses its own `components/ess/today/Celebrations.tsx`, which is in the Home spec. The **API, though, is still called by Today** to send wishes, so its contract matters.

#### `GET /api/ess/celebrations?employee_id=<id>`

```jsonc
{
  "birthdays":     [Celebrant],  // active, same company as me, date_of_birth month+day == today (UTC); excludes me
  "anniversaries": [Celebrant],  // same, on company_doj; years = current UTC year − year of company_doj
  "new_joiners":   [NewJoiner],  // rpc ess_new_joiners_feed(p_employee_id: me); [] when there are none
  "mine": { "birthday": boolean, "anniversary": boolean }
}
// Celebrant = { id, emp_code, full_name, designation, dept_name, years?, already_wished }
//   already_wished = I sent this person an ess_kudos (any badge) since 00:00 UTC
// NewJoiner (SQL jsonb) = { id, name, initials, code, designation, department, photo, joined_on,
//   code_issued_at, days_since_joining, already_congratulated }
//   group-wide (company fallback); within announce_days of code_issued_at; ordered by joined_on desc
```

Note that birthdays and anniversaries are **same company only**, while joiners are group-wide.

#### `POST /api/ess/celebrations`

Body: `{ "to_employee_id", "kind": "BIRTHDAY"|"ANNIVERSARY"|"KUDOS"|"JOINING", "message"? }`.

- `kind` defaults to `BIRTHDAY` and is upper-cased.
- `message` is trimmed and cut to 500 characters.

| Condition | Status | Body |
|---|---|---|
| No `to_employee_id` | 400 | `to_employee_id is required` |
| Unknown kind | 400 | `kind must be one of BIRTHDAY, ANNIVERSARY, KUDOS, JOINING` |
| `to_employee_id` is me | 400 | `You cannot send yourself a wish` |
| Recipient not found, or has left | 404 | `No such active employee` |
| **Duplicate** — JOINING: any earlier JOINING kudos from me to them, ever. Other kinds: any kudos from me to them since 00:00 UTC | 200 | `{ ok:true, duplicate:true, message:'Already congratulated'|'Already wished today' }` |
| Kudos insert fails | 500 | the DB message |

On success:

- Insert `ess_kudos { from_employee_id: me, to_employee_id, message: message||null, badge: kind, points: 0 }`.
- Notify the recipient: `KUDOS_RECEIVED` for KUDOS, `WISH_RECEIVED` for the rest. Title by kind:

  | Kind | Title |
  |---|---|
  | BIRTHDAY | `🎂 {sender} wished you a happy birthday` |
  | ANNIVERSARY | `🌟 {sender} congratulated you on your work anniversary` |
  | JOINING | `🎉 {sender} congratulated you on joining` |
  | KUDOS | `👏 {sender} sent you kudos` |

- Response:

  ```jsonc
  { "ok": true, "notified": <number>, "to": "<full_name>", "deliverable": boolean,
    "warning": "<full_name> has no active ESS login yet, so this is saved but cannot be opened." | undefined }
  ```

**Cross-path duplicate rule.** `/api/ess/social` `wish` also writes `ess_kudos`, so the two paths share the one-per-day duplicate rule. Social `wish` on a joiner uses badge `JOINING` but checks only today.

#### Strip UI, for reference

- **Renders nothing** when there are no birthdays, anniversaries or joiners and neither of `mine` is set.
- Banner when it is my day: `🎂 Happy birthday!` or `🌟 Happy work anniversary!`, followed by ` From everyone at EZER.`
- Sections, in order:
  - **"🎂 Birthdays today"** — rows of initials, name, and `code · designation · dept`. Button: "Wish" → "Wished".
  - **"🌟 Work anniversaries today"** — the name is followed by ` · {n} yr(s)`. Button: "Congratulate" → "Wished".
  - **"🎉 New joiners"** — photo or initials. Button: "Congratulate" → "Congratulated".
- Buttons:
  - Brand fill; disabled after acting, shown as an outline in `C.muted`.
  - `…` while busy.
- Note line (3 s), in this order of precedence:
  1. `j.warning`
  2. On a duplicate: `Already congratulated {first}` / `Already wished {first} today`
  3. `Your congratulations are on their way to {first}` / `Wish sent to {first}`
  4. On error: `j.error || 'Could not send that wish'` (or `'Could not send that'` for a joiner)

---

## 7. RNR (status `soon`, no backend)

The sidebar entry is **RNR** (rail icon `IconAward`), with a **"Soon"** tag in the rail and in the More sheet.

**Page:**

- `TabHeader`: icon tile `IconAward`, `<h1>RNR</h1>`, the line "Reward and recognise great work with points you can redeem", and a **"Coming soon"** chip on the right.
- No sub-tabs.
- Then `FeatureGrid`:
  - A responsive grid, `repeat(auto-fit, minmax(220px, 1fr))` with a 12 px gap. **In RN: a two-column grid on a phone.**
  - Five tiles. Each tile: `C.surface`, 1 px `C.line` border, radius `R.lg` (14), padding 16, shadow `E.flat`.
  - A 38×38 icon square: radius 11, `C.brandTint` background, `C.brand` icon at 19 px with stroke 1.8.
  - Then the name (13.5 px, bold) and the note (12 px, `C.muted`).

| # | Icon (`ESS_ICON` key → component) | Name | Note |
|---|---|---|---|
| 1 | `social` → `IconHeart` | Nominate | Pick a category, write why |
| 2 | `hris` → `IconLetters` | Approval | Manager / HR reviews |
| 3 | `rnr` → `IconAward` | Points | Credited on approval |
| 4 | `payroll` → `IconPayroll` | Redeem | Vouchers, leave, merch |
| 5 | `performance` → `IconPerformance` | Leaderboard | Top recognized employees |

- Below the grid, a banner: `C.brandTint` background, 1 px `C.brandEdge` border, radius `R.md` (10), padding `12px 16px`, `marginTop` 20, 12.5 px, `C.brandDeep`. Text: **"This is on its way. Above is what it will let you do. It isn’t switched on yet."**
- If the icon key is unknown, the tile falls back to `IconAward`.
- The icons come from the `@/lib/ui` icon set (stroke icons). Use matching Lucide-style glyphs in RN: heart, letters/file-text, award, wallet/banknote, trending-up/bar-chart.

No API calls. Nothing is interactive.

---

## 8. Implementation notes for React Native

### 8.1 Realtime and polling

There are **no Supabase realtime subscriptions** in the Inbox, Social or Wall. Fun Zone's live play is covered in §5.

- **Messages:** poll `GET /api/ess/inbox` every 20 s, and also `GET /messages` for the open thread.
  - In RN, pause the interval when the app is backgrounded (`AppState`) and reload once on foreground. This matches the web, which keeps polling in a hidden tab.
  - Keep "Updated Xs ago" if you want it; it is hidden on phones in the web app.
- **Wall, Broadcasts and Social:** load once on mount or when the tab is opened. Reload after writes, as specified.
  - Add pull-to-refresh as an RN-native equivalent. It is not in the web app, but it is harmless.
- **Badges:** keep the Messages, Wall, Broadcasts and Social counts **separate**. Only the Messages count goes to any global badge, and in RN the bell total is notifications + inbox messages (§0.2).
- **Push notifications:** none exist. The web uses `ess_notifications` and polling only.

### 8.2 Layout translation

- Treat the desktop three-pane inbox as a stack:
  1. Group segmented control.
  2. A folder chip strip (horizontal `ScrollView`) with a compose FAB or button.
  3. The conversation `FlatList`.
  4. The thread on a pushed screen. This mirrors the web's ≤760 px layout.
- **The catch-up panel has no place on mobile web** (the thread layer covers it). It can be shown as a list header or omitted. On web mobile it sits under the list.
- **Thread:**
  - Use an inverted `FlatList`, or keep scroll-to-end.
  - Implement the "New" divider index, the 5-minute grouping, day dividers, and the jump pill: show it when more than 120 px from the bottom, and auto-scroll on your own send.
  - Use `KeyboardAvoidingView` for the composer.
- **Compose:** a modal screen with a search `TextInput`. Debounce 180 ms. Show Departments, then the warning, then People.
- **Keyboard shortcuts** are web-only. Drop them. Enter-to-send becomes a send button, with return inserting a newline.
- **Folder colours:** read `STREAMS[].ink.l` / `.d` according to `useColorScheme()`. Unread pills on a folder ink use white text in light mode and `#0D1117` in dark mode.
- **Fonts:** the inbox headings use a serif (`--ezt-serif`, Fraunces) for thread titles and the greeting. Elsewhere the font is DM Sans.

### 8.3 Links in SYSTEM notes and notifications

Notification `link`s are **web paths**:

- `/ess`
- `/ess?tab=<view>&ref=<id>`, where `<view>` is approvals, travel, proofs, performance, social, …
- `/dashboard/...`, the admin side

Build a resolver: `?tab=` maps to an RN screen, and `ref` is passed as a param. Fall back to opening `NEXT_PUBLIC_APP_URL + link` in the browser for `/dashboard/*`.

### 8.4 Emoji, GIFs and images

- **Reactions:** a fixed six-emoji palette (`REACTIONS`). No full emoji picker is needed; it is a small popover or row.
- **The wish composer's "Add an emoji"** also uses the same six. The OS emoji keyboard works in a `TextInput` anyway.
- **GIFs:** six keyed tiles rendered as emoji on an HSL background (`hsl(hue 70% 92%)`). Only `media_ref` (the key) is stored. No assets, no network, no third-party GIF search.
  - Wishes render the post's `media` as a big emoji.
  - Comments do **not** render media (web parity). Rendering it would be a deliberate improvement.
- **Avatars:**
  - The inbox and Social show initials only. Social uses the name-hash HSL colours.
  - `photo` / `photo_url` is returned by the inbox directory and members, and by the joiners feed, but is **not displayed** in the inbox or Social. The legacy strip does show a joiner's photo.
- **Uploads:** there is **no upload endpoint** in any of these modules (inbox attachments are flag-off with no backend; Social has no media upload). Wall uploads, if any, are listed in §6.4. Fun Zone has none unless §5 says otherwise.
- **`color-mix()`:** used heavily in CSS. Precompute these tints in RN, e.g. a 13 % ink overlay for kind chips, or a `${hex}22` alpha.

### 8.5 Animations worth keeping (all optional)

- FLIP reordering of the list rows (use `LayoutAnimation`).
- The count "tick" bump.
- Staggered row and card entry (28 ms in the list, 40 ms for cards).
- The thread slide-in (320 ms).
- The Thank-back particle burst (6 dots).
- The pulsing "live" dot.
- Use `react-native-reanimated` or `LayoutAnimation`. Respect reduced-motion with `AccessibilityInfo.isReduceMotionEnabled`.

### 8.6 Direct Supabase from the device

These modules read Supabase directly with the anon key: **BroadcastInbox** (`ess_announcements`, `employees`, `ess_broadcast_reads`, `ess_broadcast_responses`) and **WallOfFame** (`wall_config`, `recognitions`, `employees`, `v_wall_leaderboard`, `employee_badges`, plus the AdminConsole and composer reads in §6.4).

The RN app can do the same with `@supabase/supabase-js` and the public anon key, for exact parity. **Better:** proxy these reads through new API routes. Note that the broadcast read has no company filter (§3.1).

### 8.7 Dates and time zones

Several rules use the **server's UTC day**:

- Social `today`
- The "one wish per day" duplicate rule
- Celebrations' "today"

The client greeting uses the device's local hour. Do not recompute these on the device; trust the payload.

### 8.8 Things that do not exist (do not build them)

- Group-thread compose.
- Star, mute, close, mark-unread, delete-message, mark-all-read and attachments in the inbox. The UI is flag-gated off and the endpoints are missing. Note that `POST /api/ess/inbox` `star`/`mute`/`read`/`leave` do exist (§1.9).
- Message search.
- Per-message read receipts. Only "· sending…" / "· ✓sent" exist.
- The joiner intro editor (`intro` action exists, no UI).
- Comment reactions persisting (local only).
- HR remove in ESS.
- RNR.
