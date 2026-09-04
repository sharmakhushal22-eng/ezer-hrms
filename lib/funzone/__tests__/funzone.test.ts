// Live play has no server in the loop: two browsers run the same functions on
// the same move list and must reach the same board. Everything here is about
// that agreement holding when the other side is late, reloaded, repeating
// itself, or sending nonsense.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  boardFrom, outcome, canApply, apply, resultOf, other, EMPTY_BOARD,
  GAMES, LIVE_GAMES, gameByCode, type Move, type Cell,
  memDeck, memReplay, memCanApply, memApply, memResult, MEM_FACES, MEM_CARDS,
  quizFor, quizReplay, quizCanApply, quizResult, shuffled, QUIZ, type MemTurn,
} from '../games.ts'
import {
  isPacket, reconcile, markFor, channelFor, isMine, reconcileList, sideFor,
  type Packet,
} from '../live.ts'
import {
  canInvite, canAccept, canDecline, canCancel, isExpired, effectiveStatus,
  minutesLeft, inboxOrder, pendingForMe, INVITE_TTL_MINUTES, type Invite,
} from '../invite.ts'

const mv = (n: number, by: 'X' | 'O', cell: number): Move => ({ n, by, cell })
const seq = (...cells: number[]): Move[] =>
  cells.map((c, i) => mv(i, i % 2 === 0 ? 'X' : 'O', c))

// ── the rules ────────────────────────────────────────────────────────────

test('a board is a pure function of its moves', () => {
  assert.deepEqual(boardFrom([]), EMPTY_BOARD)
  const b = boardFrom(seq(0, 4, 1))
  assert.equal(b[0], 'X'); assert.equal(b[4], 'O'); assert.equal(b[1], 'X')
})

test('every winning line is detected, for both marks', () => {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
  for (const l of lines) {
    const b = [...EMPTY_BOARD]; l.forEach(i => { b[i] = 'X' })
    const o = outcome(b)
    assert.equal(o.kind, 'won')
    assert.equal(o.kind === 'won' && o.by, 'X')
  }
})

test('a full board with no line is a draw, not a win', () => {
  //  X O X
  //  X O O
  //  O X X
  const b: Cell[] = ['X','O','X','X','O','O','O','X','X']
  assert.equal(outcome(b).kind, 'draw')
})

test('X opens, and the turn alternates from the move count alone', () => {
  assert.deepEqual(outcome(boardFrom([])), { kind: 'playing', turn: 'X' })
  assert.deepEqual(outcome(boardFrom(seq(0))), { kind: 'playing', turn: 'O' })
  assert.deepEqual(outcome(boardFrom(seq(0, 4))), { kind: 'playing', turn: 'X' })
  assert.equal(other('X'), 'O'); assert.equal(other('O'), 'X')
})

// ── what a hostile or out-of-date peer can send ──────────────────────────

test('a cell off the board is refused FOR BEING OFF THE BOARD', () => {
  // The reason matters, not just the refusal. Without the bounds check these
  // are still rejected — but only because board[99] is undefined and so reads
  // as "taken". That coincidence made the first version of this test pass
  // with the guard deleted, which is no test at all.
  for (const cell of [-1, 9, 99, 1.5, NaN]) {
    const v = canApply([], mv(0, 'X', cell))
    assert.equal(v.legal, false, `cell ${cell}`)
    assert.match(v.because, /not on the board/i,
      `cell ${cell} was refused for the wrong reason: ${v.because}`)
  }
})

test('a board is always nine cells, whatever the move list contains', () => {
  // boardFrom writes b[m.cell] directly. If a move with cell 99 ever reached
  // it, the array would grow and every index-based render would be wrong.
  // canApply is what stops that, so this pins the invariant it protects.
  assert.equal(boardFrom([]).length, 9)
  assert.equal(boardFrom(seq(0, 4, 8)).length, 9)
})

test('a taken square is refused', () => {
  const moves = seq(4)
  assert.equal(canApply(moves, mv(1, 'O', 4)).legal, false)
  assert.match(canApply(moves, mv(1, 'O', 4)).because, /taken/i)
})

test('a move out of turn is refused', () => {
  assert.equal(canApply(seq(0), mv(1, 'X', 1)).legal, false, 'X cannot move twice')
  assert.match(canApply(seq(0), mv(1, 'X', 1)).because, /O's turn/)
})

test('THE RECONNECT CASE: a repeated move is refused, not applied twice', () => {
  // A reconnecting peer re-sends its last move. Applying it again would hand
  // the turn back to the wrong side and the two boards would diverge.
  const moves = seq(0, 4)
  const repeat = mv(1, 'O', 4)
  assert.equal(canApply(moves, repeat).legal, false)
  assert.deepEqual(apply(moves, repeat), moves, 'the list must be unchanged')
})

test('a move that skips ahead is refused', () => {
  assert.equal(canApply(seq(0), mv(5, 'O', 1)).legal, false)
})

test('nothing can be played after the game is over', () => {
  const won = seq(0, 3, 1, 4, 2)                 // X takes the top row
  assert.equal(outcome(boardFrom(won)).kind, 'won')
  assert.equal(canApply(won, mv(5, 'O', 5)).legal, false)
  assert.match(canApply(won, mv(5, 'O', 5)).because, /already over/i)
})

test('apply never throws, whatever arrives', () => {
  const junk = [
    mv(0, 'X', -1), mv(99, 'O', 0),
    { n: 0, by: 'Z', cell: 0 } as unknown as Move,
  ]
  for (const j of junk) assert.doesNotThrow(() => apply([], j))
})

// ── the result the score is written from ─────────────────────────────────

test('an unfinished game has no result — it is not a draw', () => {
  assert.equal(resultOf([]), null)
  assert.equal(resultOf(seq(0, 4)), null)
})

test('a win and a draw are both derivable from the moves alone', () => {
  const won = resultOf(seq(0, 3, 1, 4, 2))!
  assert.equal(won.winner, 'X'); assert.equal(won.draw, false)
  assert.equal(won.moveCount, 5)
  const drawn = resultOf(seq(0, 1, 2, 4, 3, 5, 7, 6, 8))!
  assert.equal(drawn.draw, true); assert.equal(drawn.winner, null)
})

// ── the wire ─────────────────────────────────────────────────────────────

test('a malformed packet is rejected rather than crashing the game', () => {
  const bad: unknown[] = [
    null, undefined, 42, 'move', {}, { t: 'move' }, { from: 'a' },
    { t: 'nope', from: 'a' },
    { t: 'move', from: 'a', move: { n: 'x', by: 'X', cell: 0 } },
    { t: 'sync', from: 'a', moves: 'not an array' },
    { t: 'sync', from: 'a', moves: [{ bad: true }] },
    { t: 'move', from: '', move: { n: 0, by: 'X', cell: 0 } },
  ]
  for (const b of bad) assert.equal(isPacket(b), false, JSON.stringify(b))
})

test('well-formed packets are accepted', () => {
  const good: Packet[] = [
    { t: 'sync', from: 'a', moves: [] },
    { t: 'sync', from: 'a', moves: seq(0, 4) },
    { t: 'move', from: 'a', move: mv(0, 'X', 0) },
    { t: 'leave', from: 'a' },
    { t: 'rematch', from: 'a' },
  ]
  for (const g of good) assert.equal(isPacket(g), true, JSON.stringify(g))
})

test('RECONCILE: the longer list wins, so a reload recovers the board', () => {
  const real = seq(0, 4, 1)
  assert.deepEqual(reconcile([], real), real, 'a returning client adopts the real game')
  assert.deepEqual(reconcile(real, []), real, 'and does not lose it to an empty peer')
})

test('equal-length lists keep the local one, avoiding a pointless render', () => {
  const a = seq(0, 4), b = seq(0, 4)
  assert.equal(reconcile(a, b), a)
})

test('sides are fixed by the session, so a reload cannot swap them', () => {
  assert.equal(markFor('host', 'host'), 'X')
  assert.equal(markFor('guest', 'host'), 'O')
})

test('the channel name is namespaced to the feature', () => {
  assert.match(channelFor('abc'), /^funzone:game:abc$/)
})

test('our own broadcast is identifiable, so a move is not applied twice', () => {
  assert.equal(isMine({ t: 'leave', from: 'me' }, 'me'), true)
  assert.equal(isMine({ t: 'leave', from: 'them' }, 'me'), false)
})

// ── invites ──────────────────────────────────────────────────────────────

const NOW = '2026-09-04T10:00:00Z'
const inv = (o: Partial<Invite> = {}): Invite => ({
  id: 'i1', gameCode: 'ttt', fromId: 'a', toId: 'b', status: 'PENDING',
  createdAt: NOW, ...o,
})
const LIVE = ['ttt', 'quiz', 'mem']
const at = (mins: number) =>
  new Date(Date.parse(NOW) + mins * 60000).toISOString()

test('you cannot invite yourself', () => {
  const v = canInvite('a', 'a', 'ttt', { liveGames: LIVE, existing: [], now: NOW })
  assert.equal(v.ok, false)
})

test('a solo game cannot be played against somebody', () => {
  const v = canInvite('a', 'b', 'wheel', { liveGames: LIVE, existing: [], now: NOW })
  assert.equal(v.ok, false)
  assert.match(v.because, /no two-player mode/i)
  // and the catalogue explains why, rather than just disabling a button
  assert.match(gameByCode('wheel')!.soloReason!, /solo spin/i)
})

test('somebody who has left cannot be invited', () => {
  const v = canInvite('a', 'b', 'ttt',
    { liveGames: LIVE, existing: [], now: NOW, toIsActive: false })
  assert.equal(v.ok, false)
})

test('a second invite to the same person for the same game is refused', () => {
  // An impatient sender clicking twice would otherwise put two invites in
  // somebody's inbox and start two sessions if both were accepted.
  const v = canInvite('a', 'b', 'ttt',
    { liveGames: LIVE, existing: [inv()], now: at(3) })
  assert.equal(v.ok, false)
  assert.match(v.because, /already have an invite/i)
  assert.match(v.because, /12 minutes left/)
})

test('...but a different game, or a different person, is fine', () => {
  assert.equal(canInvite('a', 'b', 'quiz',
    { liveGames: LIVE, existing: [inv()], now: at(3) }).ok, true)
  assert.equal(canInvite('a', 'c', 'ttt',
    { liveGames: LIVE, existing: [inv()], now: at(3) }).ok, true)
})

test('and once the old one has expired, you may invite again', () => {
  assert.equal(canInvite('a', 'b', 'ttt',
    { liveGames: LIVE, existing: [inv()], now: at(INVITE_TTL_MINUTES) }).ok, true)
})

test(`an invite expires after ${INVITE_TTL_MINUTES} minutes`, () => {
  assert.equal(isExpired(inv(), at(14)), false)
  assert.equal(isExpired(inv(), at(INVITE_TTL_MINUTES)), true)
  assert.equal(effectiveStatus(inv(), at(20)), 'EXPIRED')
  assert.equal(effectiveStatus(inv(), at(1)), 'PENDING')
})

test('an expired invite cannot be accepted, and says why', () => {
  const v = canAccept(inv(), 'b', at(30))
  assert.equal(v.ok, false)
  assert.match(v.because, /expired/i)
  assert.match(v.because, /offer to play now/i)
})

test('only the recipient accepts or declines; only the sender withdraws', () => {
  assert.equal(canAccept(inv(), 'b', NOW).ok, true)
  assert.equal(canAccept(inv(), 'a', NOW).ok, false, 'the sender cannot accept')
  assert.equal(canDecline(inv(), 'b', NOW).ok, true)
  assert.equal(canDecline(inv(), 'a', NOW).ok, false)
  assert.equal(canCancel(inv(), 'a', NOW).ok, true)
  assert.equal(canCancel(inv(), 'b', NOW).ok, false, 'the recipient cannot withdraw')
})

test('an answered invite cannot be answered again', () => {
  for (const status of ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const) {
    assert.equal(canAccept(inv({ status }), 'b', NOW).ok, false, status)
  }
})

test('the inbox puts what is waiting on YOU first', () => {
  const list = [
    inv({ id: 'old', status: 'DECLINED', createdAt: at(-30) }),
    inv({ id: 'mine-out', fromId: 'me', toId: 'x' }),
    inv({ id: 'needs-me', toId: 'me' }),
  ]
  assert.deepEqual(inboxOrder(list, 'me', at(1)).map(i => i.id),
                   ['needs-me', 'mine-out', 'old'])
  assert.deepEqual(pendingForMe(list, 'me', at(1)).map(i => i.id), ['needs-me'])
})

test('an expired invite is not counted as waiting on you', () => {
  assert.equal(pendingForMe([inv({ toId: 'me' })], 'me', at(30)).length, 0)
})

// ── the catalogue ────────────────────────────────────────────────────────

test('every live game takes exactly two players, and the solo one explains itself', () => {
  for (const g of LIVE_GAMES) assert.equal(g.players, 2, g.code)
  for (const g of GAMES.filter(x => !x.live)) {
    assert.match(g.soloReason ?? '', /\S/, `${g.code} must say why it is solo`)
  }
})

// ═════════════════════════════════════════════════════════════════════════
// MEMORY MATCH AND TRIVIA
//
// Both deal from a seed because there is no server to deal for them. If the
// shuffle is not identical on two machines the players see different cards
// and the game is nonsense, so determinism is the first thing tested.
// ═════════════════════════════════════════════════════════════════════════

test('the same seed deals the same deck, every time', () => {
  assert.deepEqual(memDeck(12345), memDeck(12345))
  assert.deepEqual(quizFor(999).map(q => q.q), quizFor(999).map(q => q.q))
})

test('different seeds deal different decks', () => {
  // Not a guarantee for any single pair, so this checks across a spread —
  // a shuffle that ignored its seed would fail every one of them.
  const decks = new Set([1, 2, 3, 4, 5, 6].map(s => memDeck(s).join('')))
  assert.ok(decks.size >= 5, `only ${decks.size} distinct decks from 6 seeds`)
})

test('a deck is always the full set of pairs, whatever the seed', () => {
  for (const seed of [0, 1, 7, 12345, 2147483646]) {
    const d = memDeck(seed)
    assert.equal(d.length, MEM_CARDS)
    for (const face of MEM_FACES) {
      assert.equal(d.filter(c => c === face).length, 2, `${face} at seed ${seed}`)
    }
  }
})

test('the faces are distinct — a blank deck matches everything', () => {
  // The single-player game shipped with eight empty strings, so '' === ''
  // made the first two flips a pair and the game was won in eight turns.
  assert.equal(new Set(MEM_FACES).size, MEM_FACES.length)
  for (const f of MEM_FACES) assert.match(f, /\S/)
})

test('shuffling does not mutate the caller’s array', () => {
  // A shuffle that mutated its input would reshuffle the deck on every
  // re-render, and the two screens would drift apart mid-game.
  const src = [...MEM_FACES]
  shuffled(src, 42)
  assert.deepEqual(src, MEM_FACES)
})

// ── memory match rules ───────────────────────────────────────────────────

const DECK = memDeck(2026)
/** Find the partner of card `i` in this deck. */
const partner = (i: number) => DECK.findIndex((c, j) => j !== i && c === DECK[i])
const miss = (): [number, number] => {
  for (let a = 0; a < DECK.length; a++)
    for (let b = a + 1; b < DECK.length; b++)
      if (DECK[a] !== DECK[b]) return [a, b]
  throw new Error('no mismatched pair')
}

test('a hit keeps the turn; a miss passes it', () => {
  const hit: MemTurn = { n: 0, by: 'HOST', a: 0, b: partner(0) }
  assert.equal(memReplay(DECK, [hit]).turn, 'HOST', 'a hit keeps the turn')
  assert.equal(memReplay(DECK, [hit]).scores.HOST, 1)

  const [a, b] = miss()
  const missed: MemTurn = { n: 0, by: 'HOST', a, b }
  assert.equal(memReplay(DECK, [missed]).turn, 'GUEST', 'a miss passes it')
  assert.equal(memReplay(DECK, [missed]).scores.HOST, 0)
})

test('a card off the deck, or the same card twice, is refused', () => {
  for (const t of [
    { n: 0, by: 'HOST' as const, a: -1, b: 2 },
    { n: 0, by: 'HOST' as const, a: 0, b: 99 },
    { n: 0, by: 'HOST' as const, a: 3, b: 3 },
  ]) assert.equal(memCanApply(DECK, [], t).legal, false, JSON.stringify(t))
})

test('an already-matched card cannot be turned again', () => {
  const hit: MemTurn = { n: 0, by: 'HOST', a: 0, b: partner(0) }
  const again: MemTurn = { n: 1, by: 'HOST', a: 0, b: 1 }
  const v = memCanApply(DECK, [hit], again)
  assert.equal(v.legal, false)
  assert.match(v.because, /already been matched/i)
})

test('playing out of turn is refused', () => {
  const [a, b] = miss()
  const missed: MemTurn = { n: 0, by: 'HOST', a, b }   // turn passes to GUEST
  const v = memCanApply(DECK, [missed], { n: 1, by: 'HOST', a: 0, b: partner(0) })
  assert.equal(v.legal, false)
  assert.match(v.because, /GUEST's turn/)
})

test('a repeated turn is refused, so a reconnect cannot double-score', () => {
  const hit: MemTurn = { n: 0, by: 'HOST', a: 0, b: partner(0) }
  assert.deepEqual(memApply(DECK, [hit], hit), [hit])
})

test('the game is over when every pair is found, and the winner is by pairs', () => {
  // HOST takes all eight: every turn is a hit, so the turn never passes.
  const turns: MemTurn[] = []
  const used = new Set<number>()
  for (let i = 0; i < DECK.length; i++) {
    if (used.has(i)) continue
    const p = partner(i)
    used.add(i); used.add(p)
    turns.push({ n: turns.length, by: 'HOST', a: i, b: p })
  }
  const s = memReplay(DECK, turns)
  assert.equal(s.done, true)
  assert.equal(s.scores.HOST, 8)
  const r = memResult(DECK, turns)!
  assert.equal(r.winner, 'HOST'); assert.equal(r.draw, false)
  assert.equal(memCanApply(DECK, turns, { n: turns.length, by: 'HOST', a: 0, b: 1 }).legal,
               false, 'nothing can be played after the last pair')
})

test('an unfinished game has no result', () => {
  assert.equal(memResult(DECK, []), null)
})

// ── trivia rules ─────────────────────────────────────────────────────────

const QS = quizFor(7)
const ans = (q: number, by: 'HOST' | 'GUEST', choice: number) => ({ q, by, choice })
const right = (q: number, by: 'HOST' | 'GUEST') => ans(q, by, QS[q].correct)
const wrong = (q: number, by: 'HOST' | 'GUEST') =>
  ans(q, by, (QS[q].correct + 1) % QS[q].opts.length)

test('a question advances only when BOTH have answered', () => {
  assert.equal(quizReplay(QS, []).at, 0)
  assert.equal(quizReplay(QS, [right(0, 'HOST')]).at, 0, 'one answer is not enough')
  assert.equal(quizReplay(QS, [right(0, 'HOST'), wrong(0, 'GUEST')]).at, 1)
})

test('scoring counts only correct answers', () => {
  const s = quizReplay(QS, [right(0, 'HOST'), wrong(0, 'GUEST')])
  assert.equal(s.scores.HOST, 1); assert.equal(s.scores.GUEST, 0)
})

test('answering the same question twice is refused', () => {
  const v = quizCanApply(QS, [right(0, 'HOST')], wrong(0, 'HOST'))
  assert.equal(v.legal, false)
  assert.match(v.because, /already answered/i)
})

test('racing ahead to a later question is refused', () => {
  // Both players are on the same question. A client that jumped forward
  // would be scoring against a question its opponent has not seen.
  const v = quizCanApply(QS, [], right(2, 'HOST'))
  assert.equal(v.legal, false)
  assert.match(v.because, /question 1/)
})

test('an option that does not exist is refused', () => {
  for (const choice of [99, -2, 1.5]) {
    assert.equal(quizCanApply(QS, [], ans(0, 'HOST', choice)).legal, false, `${choice}`)
  }
  // -1 is legal: it means the answer timed out.
  assert.equal(quizCanApply(QS, [], ans(0, 'HOST', -1)).legal, true)
})

test('a timed-out answer scores nothing but still advances the question', () => {
  const s = quizReplay(QS, [ans(0, 'HOST', -1), right(0, 'GUEST')])
  assert.equal(s.scores.HOST, 0)
  assert.equal(s.at, 1)
})

test('the quiz ends after the last question, and ties are draws', () => {
  const all = QS.flatMap((_, i) => [right(i, 'HOST'), right(i, 'GUEST')])
  const r = quizResult(QS, all)!
  assert.equal(r.draw, true); assert.equal(r.winner, null)
  assert.equal(r.scores.HOST, QS.length)
  assert.equal(quizCanApply(QS, all, right(0, 'HOST')).legal, false)
})

test('the higher score wins', () => {
  const mixed = QS.flatMap((_, i) =>
    [right(i, 'HOST'), i === 0 ? right(i, 'GUEST') : wrong(i, 'GUEST')])
  const r = quizResult(QS, mixed)!
  assert.equal(r.winner, 'HOST'); assert.equal(r.draw, false)
})

// ── the wire, for the two new games ──────────────────────────────────────

test('memory and trivia packets are validated like every other', () => {
  assert.equal(isPacket({ t: 'mem', from: 'a',
    turn: { n: 0, by: 'HOST', a: 0, b: 1 } }), true)
  assert.equal(isPacket({ t: 'answer', from: 'a',
    answer: { q: 0, by: 'GUEST', choice: 1 } }), true)
  assert.equal(isPacket({ t: 'ready', from: 'a', q: 0 }), true)
  for (const bad of [
    { t: 'mem', from: 'a', turn: { n: 0, by: 'X', a: 0, b: 1 } },      // wrong side
    { t: 'mem', from: 'a', turn: { n: 0, by: 'HOST', a: 'x', b: 1 } },
    { t: 'answer', from: 'a', answer: { q: 0, by: 'HOST' } },
    { t: 'ready', from: 'a' },
    { t: 'memSync', from: 'a', turns: [{ bad: 1 }] },
  ]) assert.equal(isPacket(bad), false, JSON.stringify(bad))
})

test('THE PEEK GUARD: the ready packet the component sends carries no choice', () => {
  // Broadcast reaches the other browser immediately. If the choice travelled
  // with "I have answered", a modified client could read it off the wire
  // before committing its own.
  //
  // This has to be checked in the SOURCE. A value-level assertion cannot see
  // it: adding `choice?: number` to the type is erased at runtime, and an
  // object literal written inside this test proves nothing about what
  // LiveTrivia actually broadcasts.
  const src = readFileSync(
    new URL('../../../components/funzone/LiveTrivia.tsx', import.meta.url), 'utf8')
  const sends = [...src.matchAll(/send\(\{\s*t:\s*'ready'[^}]*\}/g)].map(m => m[0])
  assert.ok(sends.length > 0, 'LiveTrivia must announce readiness')
  for (const call of sends) {
    assert.doesNotMatch(call, /choice|answer|pending/,
      `a ready packet must carry only the question number: ${call}`)
  }
  // And the choice must go out separately, after both are ready.
  assert.match(src, /send\(\{\s*t:\s*'answer'/,
    'the choice has to be sent by its own packet')
})

test('sides are fixed by the session for these games too', () => {
  assert.equal(sideFor('h', 'h'), 'HOST')
  assert.equal(sideFor('g', 'h'), 'GUEST')
})

test('reconcileList follows the same longer-wins rule as reconcile', () => {
  assert.deepEqual(reconcileList([1], [1, 2]), [1, 2])
  assert.deepEqual(reconcileList([1, 2], [1]), [1, 2])
})

// ── one copy, not two ────────────────────────────────────────────────────

test('the solo games use the SAME questions and faces as the live ones', () => {
  // Both were duplicated in components/ess/FunZone.tsx, and within one
  // sitting they drifted: the live quiz offered "Reward Teams" and
  // "Provident Transfer" where the solo quiz offered "Report Automation" and
  // "Provident Trust". Same questions, different wrong answers — the kind of
  // difference nobody notices until two colleagues compare screens mid-game.
  const src = readFileSync(
    new URL('../../../components/ess/FunZone.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(src, /^const QUIZ\b/m,
    'FunZone must import QUIZ, not declare its own')
  assert.doesNotMatch(src, /^const MEM_EMOJIS\b/m,
    'FunZone must import the card faces, not declare its own')
  assert.match(src, /import \{[^}]*QUIZ[^}]*\} from '@\/lib\/funzone\/games'/,
    'the shared copy has to be the one it uses')
})

test('the quiz is answerable — every question has a correct option', () => {
  for (const q of QUIZ) {
    assert.ok(q.opts.length >= 2, `"${q.q}" needs at least two options`)
    assert.ok(q.correct >= 0 && q.correct < q.opts.length,
      `"${q.q}" has correct=${q.correct} but only ${q.opts.length} options`)
    assert.equal(new Set(q.opts).size, q.opts.length,
      `"${q.q}" repeats an option`)
    for (const o of q.opts) assert.match(o, /\S/, `"${q.q}" has a blank option`)
  }
})
