# Fun Zone — how it works

**For:** Nayan Ahuja
**Date:** 4 September 2026
**Branch:** `TusharPanwar`
**Covers:** migration `090` and the code on it

---

## 1. What it is

Four break-time games in the ESS portal. Until now they touched no database
at all — a refresh reset everything and nothing was kept. `090` changes that
for one reason only: **you cannot invite a colleague, or share a score,
without somewhere to put the invite and the score.**

Every game now asks *how* you want to play before it starts:

| Game | On your own | Against the computer | With a colleague |
|---|:--:|:--:|:--:|
| Tic-Tac-Toe | two players, one screen | ✓ | ✓ |
| Memory Match | ✓ | ✓ | ✓ |
| EZER Trivia | ✓ | ✓ | ✓ |
| Spin the Wheel | ✓ | — | — |

The wheel skips the mode screen entirely. A solo spin has nothing for a
second player or a bot to do, and offering a choice that cannot be honoured
is worse than not offering one.

**Solo and computer modes work today, with no migration.** Only "with a
colleague" needs `090`.

---

## 2. Playing live — and why there is no game server

Live play runs over **Supabase Realtime broadcast**, client to client.

I checked rather than assumed: subscribing with the anon key returns
`SUBSCRIBED` and a broadcast echoes back in about 2.6 seconds. Nothing in this
app had used Realtime before — the inbox deliberately polls — and the app
deploys to Vercel, where there is nowhere to run a socket server of our own.
**There is nothing for you to enable.**

A move is not worth a database round trip, so only the START and the FINISH
are persisted. That has one consequence worth stating plainly:

> **During play there is no server in the loop, so the other browser is not
> trusted — it is merely the other player.** Every packet is validated against
> the same pure rules both clients run, and a malformed one is dropped rather
> than applied.

### Three things that make it survive a real office

- **A reload does not lose the game.** The returning client announces itself
  with an empty move list; the other answers with the real one. The longer
  list wins, because it can only have been reached by legal moves.
- **A closed tab is noticed.** Presence tells the other side, so the game says
  "they left" instead of waiting forever for a move.
- **A failed socket says so**, rather than sitting on "connecting" until
  somebody gives up.

---

## 3. Who won, and who says so

**Tic-Tac-Toe is replayed by the database.** `finish_game()` walks the move
list and derives the winner. Nine squares and eight lines is cheap, so no
client is believed.

**Memory Match and Trivia are settled by agreement.** Both depend on a seeded
shuffle, and reimplementing that shuffle in plpgsql to check a break-time game
would be a third copy of the same logic drifting from the other two. So each
client reports what it computed, the first claim is parked, and the second
must match it.

- One player alone cannot post a result — they can only leave the game
  unfinished, which gains them nothing.
- Two clients that disagree end it `ABANDONED` rather than picking a winner,
  because a disagreement means one of them is wrong and there is no way to
  tell which.

### The seed

Memory Match and Trivia need the same cards and the same questions in the same
order on two screens, with no server to deal them. `Math.random()` would deal
two different decks, so `game_sessions.seed` is generated on the server and
both clients shuffle from it deterministically.

---

## 4. Invites

An invite **expires after fifteen minutes**. A game invite is an offer to play
*now*; accepting an hour later starts a game against an empty chair and
strands whoever accepted. Fifteen minutes is long enough to come back from a
tea break.

A partial unique index enforces **one open invite** per sender, recipient and
game — so an impatient double-click cannot put two invites in somebody's inbox
and start two sessions when both are accepted.

Invites arrive in the ESS inbox under a **Fun Zone** folder, the tenth stream.
Its colour was computed against the same bars as the other nine — 7.58:1 on
the light surface, 8.33:1 on dark, and at least 21 ΔE from every neighbour —
rather than picked by eye, because `streams.ts` documents that constraint.

---

## 5. The computer opponent

Pure functions in `lib/funzone/ai.ts`, with randomness injected everywhere so
the behaviour can be pinned by a test rather than observed and hoped about.

- **Tic-Tac-Toe** — minimax, with a preference for winning *sooner*. Hard is
  unbeatable, and the screen says so: tic-tac-toe is solved, and a run of
  draws is the game rather than a fault.
- **Memory Match** — bounded recall. It remembers the last N cards it saw and
  N is the difficulty. Perfect recall would clear the board and you would
  never get another turn.
- **Trivia** — answers with a probability, and pauses first. Even hard misses
  sometimes; an opponent that never misses is a scoreboard, not a game.

> **One bug worth recording.** The first version made easy and medium "skip
> the search and play a sensible move" — win, block, centre, corner. A search
> over every reachable position found **zero** where that differs from perfect
> play. Tic-tac-toe is small enough that sensible *is* optimal, so all three
> levels were identical while the screen promised "Easy: you should win". The
> weaker levels now play a genuinely worse move.

---

## 6. No prizes

There is no link to recognition, the Wall of Fame leaderboard, performance or
pay, and the migration says so in as many words. A game that counts towards
something stops being a game and becomes another thing to be measured on.

---

## 7. Where the code lives

```
lib/funzone/
  games.ts    the rules — pure, shared by solo, bot and live modes
  ai.ts       the computer opponent, randomness injected
  invite.ts   the invite state machine and its fifteen-minute clock
  live.ts     the wire protocol and the reconnect rule

components/funzone/
  PlayTogether.tsx    invite, accept, decline, withdraw
  LiveTicTacToe.tsx   LiveMemoryMatch.tsx   LiveTrivia.tsx
  VsComputer.tsx      the three games against the bot

components/ess/FunZone.tsx   the hub and the mode screen
```

---

## 8. What is NOT built

- **Spectating.** No third party can watch a game.
- **Rejoining a game whose opponent has gone.** It ends with "they left".
- **A matchmaking queue.** You invite somebody by name.
- **A leaderboard.** Results are stored; nothing ranks them, deliberately.
- **The wheel against a colleague.** There is nothing to play.

---

## 9. What needs a decision from you

**RLS on the three new tables.** Not written, for the usual reason: I do not
know how "the current employee" resolves in this project's Supabase setup.

The stakes are low — it is tic-tac-toe — but *who has been playing games with
whom, and when* is exactly the sort of thing that reads badly in a workplace,
and scoping it properly costs nothing. Section 7 of `090` says what I would
write. The functions are `SECURITY DEFINER` and check the caller themselves,
so writes are already gated regardless of what the policies end up saying.
