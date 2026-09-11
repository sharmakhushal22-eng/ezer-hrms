# The ESS Inbox — how it works

**For:** Nayan Ahuja
**Date:** 4 September 2026
**Branch:** `TusharPanwar`
**Covers:** migrations `075`, `080`, `087`, `088` and the code on them

---

## 1. What it is

One place in the ESS portal for everything waiting on an employee. Three
groups sit side by side, because from the employee's side they are all
"something for me":

| Group | What arrives there | Migration |
|---|---|---|
| **Messages** | Colleagues, function desks, and the notification streams | `080` |
| **Wall of Fame** | Comments, appreciations and mentions about your recognition | `087` |
| **Broadcasts** | Company-wide notices. Read only | `088` |

---

## 2. Messages — the three kinds of conversation

**DIRECT** — one colleague to another, or a small group. Private to its
participants; nobody else can read or reply.

**DESK** — a thread with a *function* rather than a person: HR, Payroll,
Finance, IT, Admin & Facilities. Whoever staffs that desk today answers, and
the reply reads as coming from the desk.

> This is the part worth understanding. A desk is a first-class row, not a
> group chat, so that "message HR" does not mean "know which HR person to
> message" — and so it does not break the day somebody changes team. An agent
> who answers a desk thread is added to it, so it then appears in their own
> list rather than only under the desk.

**SYSTEM** — the notification streams the bell already produces, grouped by
the department that owns them. There are 30-odd stream codes (`CLAIM`,
`ATTENDANCE`, `APPRAISAL`, `BIRTHDAY`, …). One SYSTEM conversation per person
per stream, so "Payroll" is a single running thread rather than forty
one-line conversations.

**You cannot reply to a SYSTEM thread.** The route refuses it: a notification
feed is the system talking to you, and a reply into it would produce a message
with no reader — which is worse than no reply box at all.

### Access is one rule, in one place

`inbox_participants` **is** the access model. You can read a conversation if
and only if you have a row in it, and post if that row has no `left_at`.

There is no second path — no "and also if you are an admin". An HR person who
needs to see a thread is **added** to it, which is visible to everyone else in
the thread rather than silent. Desks are the single, deliberate exception, and
that exception is resolved live from `inbox_desk_agents`, so moving somebody
off the HR desk takes their access to HR threads with them the same second.

### Who may write to whom

`inbox_policy` holds one row with the reach mode:

| Mode | Means |
|---|---|
| `GROUP` | Anyone in the group (the current setting) |
| `COMPANY` | Only within your own company |
| `CHAIN_HR` | Your managers, your reports, your peers, plus HR desks |
| `NO_COLD_UP` | No unsolicited messages up the hierarchy |

`inbox_can_message(from, to)` is the authority and the directory endpoint uses
the same answer — the picker only offers people the policy will actually
accept, so it cannot suggest a conversation that will then be refused. A
directory that lists everyone and refuses on send teaches people to try and
fail.

If the policy row is missing, the code falls back to a permissive default
rather than failing closed. An inbox that stops working because a settings row
vanished is worse than one that is briefly too open.

---

## 3. Broadcasts (088, not yet applied)

A one-way company channel: policy changes, closures, statutory deadlines.

- **Nobody replies in public.** There is no thread table hanging off a
  broadcast, and that absence is the design. An announcement with a comment
  section under it stops being an announcement.
- **Responses are private to the publisher**, who is notified. The recipient
  is set by a trigger, not sent by the client — a caller that could choose the
  recipient could route somebody's private note to the wrong person.
- **Who may publish is a configured list** (`ess_broadcast_publishers`),
  maintained by an admin and enforced by a trigger as well as the UI. A role
  check would need a deployment every time the communications lead changed,
  and would exclude an MD who holds no HR role.

Every recipient may respond, not just seniors: the point of the private path
is that somebody who spots an error in a notice can say so without
contradicting it in front of the whole company.

---

## 4. The security posture, and a correction

**No browser code ever reads `inbox_*`.** Every path goes through
`/api/ess/inbox/*` on the server, using the service role, gated by
`lib/inbox/server.ts`. The reason is in that file's header: the anon key ships
in every page load, so a private conversation queried client-side would be a
private conversation anybody could query.

### The 42501 in my 4 September handover was wrong

I reported that `inbox_conversations` and `inbox_messages` return
`42501 permission denied for table` to `anon`, and listed three options for
fixing it — including granting `anon` SELECT.

**Do not grant it.** I have since checked: no client component reads those
tables, and none should. The missing grant is the *correct* posture, not a
defect. Granting `anon` SELECT would take a table that is currently
unreachable from the browser and make every private conversation in the
company readable by anyone who opened dev tools.

The inbox works today for reads. What was actually broken was in the
application, not the database — see below.

---

## 5. The bug that made it look broken

You could not send a message. Neither could anybody else, and it was not only
messages — **every write in the ESS product failed the same way**, while every
screen loaded perfectly.

`lib/ess/session.ts`, in `essCaller`:

```js
const asked = req.nextUrl.searchParams.get('employee_id')
              || (req.method !== 'GET' ? null : null)
```

Both branches of that ternary return `null`. It is a placeholder for reading
the body that was never finished — and it type-checks, reads plausibly, and is
invisible in review.

The client sends the employee id in the **query string** on reads and in the
**body** on writes. Only the query was ever read, so `asked` was always null on
a POST, which lands in `if (!asked) return 400 'employee_id is required'`. And
`ess_credentials` has **zero rows**, so nobody holds a real ESS session and
every user is on that path.

Fixed on the branch (`lib/ess/asked.ts`), with 14 tests and a source-level
guard that fails if the dead ternary returns. **No migration needed.**

---

## 6. Where the code lives

```
lib/inbox/
  server.ts     every access decision — openable(), canMessage(), policy()
  streams.ts    the ~30 notification stream codes and their grouping
  errors.ts     notInstalled(), so a pending migration renders as "not yet"

lib/ess/asked.ts        whose portal a request is about (section 5)
lib/broadcast/channel.ts the broadcast rules

app/api/ess/inbox/          route.ts · messages/ · directory/
app/api/admin/inbox/        the admin view

components/ess/InboxTabs.tsx       the three groups
components/ess/Inbox.tsx           Messages
components/ess/BroadcastInbox.tsx  Broadcasts
components/wall/WallInbox.tsx      Wall of Fame
components/broadcast/              Channel.tsx · Admin.tsx
```

---

## 7. What is NOT built

- **Attachments.** No file upload on a message.
- **Real-time.** The list polls; there is no socket or subscription.
- **Search across messages.** The directory is searchable; message bodies are not.
- **Broadcast scheduling, read receipts, or acknowledgement-required.** Each is
  a real feature with its own consequences and none was asked for.
- **Notification delivery.** Rows are written; email and WhatsApp are not wired.

---

## 8. What needs a decision from you

**RLS on 088's three tables.** `ess_broadcast_responses` is the one that
matters: a response is private to its author and the publisher it was sent to.
The EZER house default `USING (true)` would make every private response
readable by all 400 employees — the exact opposite of what the feature
promises the person typing it.

Section 5 of `088_broadcast_channel.sql` says what I would write. It needs a
reliable "who is the current employee" in this project's Supabase setup, and
you know how that resolves better than I do.

**`ess_credentials` is empty.** Nobody can log into ESS directly; everyone
arrives through the dashboard bridge. That is a data question rather than a
code one, but it is why the bug in section 5 affected every single user rather
than a subset.
