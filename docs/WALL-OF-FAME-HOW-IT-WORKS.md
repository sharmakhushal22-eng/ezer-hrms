# Wall of Fame — how it works

**For:** Nayan Ahuja
**Date:** 4 September 2026
**Branch:** `TusharPanwar`
**Covers:** migrations `082`, `084`–`087`, `089` and the code that sits on them

---

## 1. What it is

A recognition module. Employees praise each other in public, managers and HR
give awards, badges accumulate on a profile, and a TV in reception can show a
rolling board of it. Six migrations, **21 tables**, 38 functions and 3 views.

**The one rule that must never move:** recognition never touches pay.

```sql
payout_linkage boolean not null default false check (payout_linkage = false)
```

Pinned by a CHECK on `wall_config`, mirroring the same decision in PMS v2.
No screen, admin or API call can flip it. Points exist for ranking a
leaderboard and nothing else — there is no rate, no conversion, no total in
rupees anywhere in the module, and a test asserts that.

---

## 2. The five things a person can do

| | What it is | Where it goes | Who sees it |
|---|---|---|---|
| **Shoutout** | Peer to peer, needs a category | The company feed | Everyone (scope configurable) |
| **Appreciation** | A private note, needs a category | Direct to the person | Sender and recipient |
| **Award** | Nominated, approved, then published | The feed and the board | Everyone |
| **Badge** | Earned by repetition or service | The employee's profile | Everyone |
| **Comment** | A reply on a feed post | Under the post | Everyone who sees the post |

### Shoutout versus appreciation — the difference is deliberate

A **shoutout is public**: it lands in the feed, carries points, and is capped
by a daily limit and a per-person cooldown so the feed cannot be flooded.

An **appreciation is private**, and it is explicitly **not a chat**. The
recipient may send exactly **one thank-back**, and there is no path to a
rolling thread — no conversation id, no "continue this thread". That is a
design constraint, not a missing feature: free-form person-to-person messaging
inside an HRMS becomes a harassment vector and a records-retention problem, and
HR ends up owning both. If general chat is ever wanted, it is a different
product with a different risk profile.

An appreciation can be **promoted** to the feed, but only with the recipient's
consent — `request_share_to_feed()` then `approve_share_to_feed()`. Somebody
who was praised privately is not automatically willing to be praised publicly.

---

## 3. The catalogue — badges and tags (089, new)

Thirty badges and forty-four tags across eleven categories, from
`HRMS_Employee_Applause_Recognition_Master.docx`. This is what somebody picks
from when appreciating a colleague.

- A **badge** is an award — one per recognition, accumulating on the record.
- A **tag** is a description — several at once, attached to the recognition
  rather than the person, so the reason stays searchable later.

Five names appear in both lists (Team Player, Problem Solver, Culture
Champion, Decision Maker, Positive Energy). That is from the source document
and is deliberate: as a tag it describes this week's work, as a badge it is an
award for having done it consistently.

**`recognition_catalogue` is company-independent** — one row per item, not one
per company. The words mean the same thing everywhere, and per-company copies
would be three chances to drift.

`badge_master` (084) is a different thing and is untouched: it is per-company
and models **earned** badges, with tiers, unlock rules and service years.
The catalogue is **chosen**; `badge_master` is **earned**.

**The seed runs itself** when 089 is applied — no function to remember to
call. It upserts by `ref`, so re-running also picks up wording changes.

> The list lives in `lib/wall/catalogue.ts` and the SQL is generated from it by
> `scripts/gen-catalogue.py`. A test re-parses the migration and fails if they
> have drifted. Do not edit the seed block by hand.

---

## 4. Who can do what

Three layers, checked in this order:

1. **`can(permission)`** — the general access foundation from `082`
2. **`wall_admins`** — named grants with a level and an expiry
3. **`wof_can()`** — the wall's own check, which consults both

Four admin levels, narrowest first:

| Level | Can |
|---|---|
| `board_operator` | Pair and run a board screen |
| `wall_moderator` | Hide a post, action a report |
| `wall_admin` | Awards, badges, values, cycles, config |
| `wall_owner` | All of it, including granting other admins |

Every admin action is written to `wall_audit_log` with the actor, the before
state and the after state. That is not decoration — a recognition module is a
place where "who removed that post?" gets asked, and the answer needs to exist.

**Two functions with similar names, and only one is load-bearing.** `082`
creates `explain_access()`; `084` creates `wof_explain_access()`. The wall
uses **`wof_explain_access()`**. `explain_access()` exists because the original
bundle's brief named it and a future route may expect it.

---

## 5. The board

`app/board/[pairCode]` is the reception-screen view. A screen is paired by a
code rather than logged in, so a TV in a lobby is never holding a session that
could be walked up to and misused. `get_board_payload()` returns everything
one screen needs in a single call, because a board refreshing on a timer
should not make six round trips.

---

## 6. The inbox

`087` adds a wall inbox: comments on your recognition, appreciations sent to
you, mentions. It appears in ESS beside Messages and Broadcasts.

`wall_notify()` is the single entry point for anything that reaches a person,
so notification volume is throttled in one place instead of five.

---

## 7. Where the code lives

```
lib/wall/
  access.ts        the four levels and what each may do
  catalogue.ts     THE CANONICAL badge and tag list (089's seed is generated from it)
  shoutout.ts      composer rules, mirrored from create_shoutout()
  appreciation.ts  the direct channel, and why it is not a chat
  comments.ts      comment rules
  inbox.ts         unread grouping
  theme.ts         the wall's own palette on top of the app tokens

components/wall/
  ShoutoutComposer.tsx    RecognitionPicker.tsx    AppreciationComposer.tsx
  CommentThread.tsx       Badge.tsx                Spotlight.tsx
  WallInbox.tsx           AdminConsole.tsx

components/ess/WallOfFame.tsx      the employee surface
app/board/[pairCode]/page.tsx      the reception screen
```

**The database is the authority.** Every rule in `lib/wall` is enforced again
in SQL, and the wording is deliberately identical — a rule that only fires on
submit teaches nothing, and a caller who bypasses the UI still gets the same
refusal in the same words.

---

## 8. What is NOT built

Stated so it is not assumed:

- **Certificate PDF generation** — step 9 of the original brief
- **Real push and email notifications** — `wall_notify()` writes the row; the
  delivery channels are not wired
- **Feed pagination** — the feed returns a capped list, not an infinite scroll
- **The nightly milestone cron** — `generate_service_milestones()` exists and
  works, but nothing calls it on a schedule
- **Admin console writes** — the console reads and displays; the grant and
  revoke paths are not wired to it yet

---

## 9. What still needs a decision from you

**RLS on the new tables.** `089`'s `recognition_catalogue` has no policies, and
neither does `088`'s broadcast channel. The EZER house default —
`USING (true)` — is right for the catalogue (a badge name is not a secret) and
wrong for anything carrying employee content. I have not written either
without you agreeing to it. See section 5 of each file.
