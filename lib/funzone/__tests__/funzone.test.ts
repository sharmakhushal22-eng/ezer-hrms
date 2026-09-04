// Live play has no server in the loop: two browsers run the same functions on
// the same move list and must reach the same board. Everything here is about
// that agreement holding when the other side is late, reloaded, repeating
// itself, or sending nonsense.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boardFrom, outcome, canApply, apply, resultOf, other, EMPTY_BOARD,
  GAMES, LIVE_GAMES, gameByCode, type Move, type Cell,
} from '../games.ts'
import {
  isPacket, reconcile, markFor, channelFor, isMine, type Packet,
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
