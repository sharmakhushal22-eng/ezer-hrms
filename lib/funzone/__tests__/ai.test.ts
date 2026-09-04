// The computer opponent.
//
// Randomness is injected everywhere, so these are ordinary deterministic
// tests rather than "run it a lot and hope". The headline claim — that hard
// cannot be beaten — is checked by playing every game that exists against it,
// not by playing a few and being satisfied.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  botMove, bestMoves, tacticalMove, randomMove, botAnswer, botDelay,
  memBotTurn, remember, EMPTY_MIND, MEM_RECALL,
  DIFFICULTY_LABEL, DIFFICULTY_MEANING, type Difficulty,
} from '../ai.ts'
import {
  boardFrom, outcome, other, memDeck, QUIZ,
  type Move, type Mark, type Board, type MemTurn,
} from '../games.ts'

/** A generator that returns a fixed sequence, then repeats the last value.
 *  Injected so "the bot looked" and "the bot picked the second option" are
 *  decisions the test makes, not accidents it observes. */
const feed = (...vals: number[]) => {
  let i = 0
  return () => vals[Math.min(i++, vals.length - 1)]
}
const always = (v: number) => () => v
const movesOf = (b: Board): Move[] =>
  b.map((c, i) => ({ c, i })).filter(x => x.c !== '')
    .map((x, n) => ({ n, by: x.c as Mark, cell: x.i }))

// ── tic-tac-toe ──────────────────────────────────────────────────────────

test('the bot takes a win when it has one', () => {
  //  X X .        X to play at 2 and win
  //  O O .
  //  . . .
  const b: Board = ['X', 'X', '', 'O', 'O', '', '', '', '']
  assert.deepEqual(bestMoves(b, 'X'), [2])
  assert.equal(botMove(movesOf(b), 'X', 'hard', always(0)), 2)
})

test('the bot blocks a loss when it cannot win', () => {
  //  O O .        X must block at 2
  //  X . .
  //  . . .
  const b: Board = ['O', 'O', '', 'X', '', '', '', '', '']
  assert.deepEqual(bestMoves(b, 'X'), [2])
  assert.equal(tacticalMove(b, 'X'), 2, 'the one-ply check finds it too')
})

test('a win is preferred to a block when both are available', () => {
  //  X X .   O O .    X can win at 2 or block at 5 — winning comes first
  const b: Board = ['X', 'X', '', 'O', 'O', '', '', '', '']
  assert.equal(tacticalMove(b, 'X'), 2)
})

test('tacticalMove says -1 when there is nothing tactical to do', () => {
  assert.equal(tacticalMove(Array(9).fill('') as Board, 'X'), -1)
})

test('winning SOONER is preferred to winning later', () => {
  // Without the depth term the bot is indifferent between the two, wanders,
  // and reads as not having noticed it had won.
  const b: Board = ['X', 'X', '', '', 'O', '', '', 'O', '']
  assert.ok(bestMoves(b, 'X').includes(2))
})

test('HARD CANNOT BE BEATEN — checked against every possible game', () => {
  // Tic-tac-toe is solved: perfect play always draws. So this plays the bot
  // against an opponent that tries EVERY legal reply, exhaustively, and
  // asserts the bot never loses. Anything less than exhaustive would be
  // "hard usually wins", which is not the claim being made.
  let losses = 0, games = 0

  const play = (moves: Move[], botMark: Mark) => {
    const b = boardFrom(moves)
    const st = outcome(b)
    if (st.kind !== 'playing') {
      games++
      if (st.kind === 'won' && st.by !== botMark) losses++
      return
    }
    if (st.turn === botMark) {
      const cell = botMove(moves, botMark, 'hard', always(0))
      play([...moves, { n: moves.length, by: botMark, cell }], botMark)
      return
    }
    for (let cell = 0; cell < 9; cell++) {
      if (b[cell] !== '') continue
      play([...moves, { n: moves.length, by: st.turn, cell }], botMark)
    }
  }

  play([], 'X')            // bot opens
  play([], 'O')            // bot replies
  assert.equal(losses, 0, `the hard bot lost ${losses} of ${games} games`)
  assert.ok(games > 100, `only ${games} games explored — the search did not run`)
})

test('THE LEVELS ACTUALLY DIFFER — easy plays moves hard never would', () => {
  // The first version of this bot made the weak levels "skip the search and
  // play a sensible move". A search over every reachable position found ZERO
  // where that differs from perfect play — tic-tac-toe is small enough that
  // sensible IS optimal — so all three levels were identical and the
  // difficulty was decoration. This is the test that would have caught it.
  const b: Board = ['X', '', '', '', '', '', '', '', '']
  const moves = movesOf(b)
  const best = bestMoves(b, 'O')

  const easyPicks = [0.99, 0.9, 0.8].map(r => botMove(moves, 'O', 'easy', always(r)))
  assert.ok(easyPicks.some(p => !best.includes(p)),
    `easy only ever played optimally: ${easyPicks} vs best ${best}`)

  for (const r of [0, 0.3, 0.6, 0.99]) {
    assert.ok(best.includes(botMove(moves, 'O', 'hard', always(r))),
      `hard played off-book at roll ${r}`)
  }
})

test('medium takes an obvious win, but does not see a fork coming', () => {
  //  O X X      O to play, and 8 completes 0-4-8.
  //  X O .      The winning square is deliberately NOT the first empty one:
  //  . . .      with the tactical check removed the fallback picks cells[0],
  //             which on an earlier board happened to be the winning square,
  //             so a sabotage that disabled the check passed anyway.
  const winnable: Board = ['O', 'X', 'X', 'X', 'O', '', '', '', '']
  assert.equal(botMove(movesOf(winnable), 'O', 'medium', always(0)), 8,
    'medium must take a win in one')
  // Nothing tactical on an open board, so it plays somewhere rather than
  // calculating — which is what makes it beatable.
  const open: Board = ['X', '', '', '', '', '', '', '', '']
  const picks = new Set([0.1, 0.4, 0.7, 0.95]
    .map(r => botMove(movesOf(open), 'O', 'medium', always(r))))
  assert.ok(picks.size > 1, `medium was deterministic: ${[...picks]}`)
})

test('the bot does not always open in the same corner', () => {
  // A bot with a fixed opening is beaten once and then forever.
  const picks = new Set([0, 0.3, 0.6, 0.9].map(r => botMove([], 'X', 'hard', always(r))))
  assert.ok(picks.size > 1, `always opened at ${[...picks]}`)
})

test('the bot returns -1 rather than a move when the game is over', () => {
  const won = movesOf(['X', 'X', 'X', 'O', 'O', '', '', '', ''])
  assert.equal(botMove(won, 'O', 'hard', always(0)), -1)
  const full = movesOf(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'])
  assert.equal(botMove(full, 'X', 'hard', always(0)), -1)
})

test('every move the bot returns is legal and empty', () => {
  const b: Board = ['X', 'O', '', 'X', '', '', '', 'O', '']
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const cell = botMove(movesOf(b), 'X', level, always(r))
      assert.ok(cell >= 0 && cell < 9, `${level} @${r} returned ${cell}`)
      assert.equal(b[cell], '', `${level} @${r} played on a taken square`)
    }
  }
})

// ── memory match ─────────────────────────────────────────────────────────

const DECK = memDeck(4242)
const partnerOf = (i: number) => DECK.findIndex((c, j) => j !== i && c === DECK[i])

test('the bot takes a pair it remembers', () => {
  const a = 0, b = partnerOf(0)
  const mind = remember(EMPTY_MIND, DECK, { n: 0, by: 'GUEST', a, b: 5 }, 'hard')
  const mind2 = remember(mind, DECK, { n: 1, by: 'GUEST', a: b, b: 7 }, 'hard')
  const pick = memBotTurn(DECK, [], mind2, always(0))
  assert.ok(pick, 'the bot must pick something')
  assert.deepEqual([...pick!].sort((x, y) => x - y), [a, b].sort((x, y) => x - y))
})

test('memory is BOUNDED, so a bot cannot clear the board unopposed', () => {
  // With perfect recall the person watching never gets another turn.
  let mind = EMPTY_MIND
  for (let i = 0; i < 16; i += 2) {
    mind = remember(mind, DECK, { n: i / 2, by: 'GUEST', a: i, b: i + 1 }, 'easy')
  }
  assert.ok(mind.seen.length <= MEM_RECALL.easy,
    `easy remembered ${mind.seen.length}, cap is ${MEM_RECALL.easy}`)
  assert.ok(MEM_RECALL.easy < MEM_RECALL.medium)
  assert.ok(MEM_RECALL.medium < MEM_RECALL.hard)
})

test('the bot never turns a matched card, or the same card twice', () => {
  const matched = [0, partnerOf(0)]
  for (const r of [0, 0.3, 0.7, 0.99]) {
    const pick = memBotTurn(DECK, matched, EMPTY_MIND, always(r))
    assert.ok(pick, 'expected a pick')
    const [a, b] = pick!
    assert.notEqual(a, b, `picked ${a} twice`)
    assert.ok(!matched.includes(a) && !matched.includes(b),
      `picked a matched card: ${a},${b}`)
  }
})

test('with two cards left the bot takes them, and with fewer it stops', () => {
  const all = DECK.map((_, i) => i)
  const twoLeft = all.filter(i => i !== 0 && i !== partnerOf(0))
  const pick = memBotTurn(DECK, twoLeft, EMPTY_MIND, always(0))
  assert.deepEqual([...pick!].sort((x, y) => x - y),
                   [0, partnerOf(0)].sort((x, y) => x - y))
  assert.equal(memBotTurn(DECK, all, EMPTY_MIND, always(0)), null)
})

test('remembering the same card twice does not duplicate it', () => {
  let mind = remember(EMPTY_MIND, DECK, { n: 0, by: 'HOST', a: 3, b: 4 }, 'hard')
  mind = remember(mind, DECK, { n: 1, by: 'HOST', a: 3, b: 9 }, 'hard')
  const threes = mind.seen.filter(s => s.card === 3)
  assert.equal(threes.length, 1, 'card 3 is remembered twice')
})

// ── trivia ───────────────────────────────────────────────────────────────

test('the bot answers correctly when it knows, and wrongly when it does not', () => {
  const q = QUIZ[0]
  assert.equal(botAnswer(q, 'hard', always(0)), q.correct, 'a low roll means it knows')
  const missed = botAnswer(q, 'easy', feed(0.99, 0))
  assert.notEqual(missed, q.correct, 'a high roll means it does not')
  assert.ok(missed >= 0 && missed < q.opts.length, 'and it still picks a real option')
})

test('even the hard bot misses sometimes — a quiz it always wins is a scoreboard', () => {
  const q = QUIZ[0]
  assert.notEqual(botAnswer(q, 'hard', feed(0.99, 0)), q.correct)
})

test('the bot answers every question with a valid option, at every level', () => {
  for (const q of QUIZ) {
    for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
      for (const r of [0, 0.5, 0.99]) {
        const a = botAnswer(q, level, always(r))
        assert.ok(a >= 0 && a < q.opts.length, `${level} @${r} answered ${a}`)
      }
    }
  }
})

test('the bot pauses before answering, and harder means faster', () => {
  // An instant answer reads as a script rather than an opponent.
  assert.ok(botDelay('easy', always(0)) > botDelay('hard', always(0)))
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    assert.ok(botDelay(level, always(0)) >= 500, level)
    assert.ok(botDelay(level, always(1)) <= 3000, level)
  }
})

// ── the choice on screen ─────────────────────────────────────────────────

test('every difficulty is labelled and explained', () => {
  for (const level of ['easy', 'medium', 'hard'] as Difficulty[]) {
    assert.match(DIFFICULTY_LABEL[level], /\S/)
    assert.ok(DIFFICULTY_MEANING[level].length > 30,
      `${level} needs to say what it actually does`)
  }
  // Hard has to be honest that it cannot be beaten, or it reads as broken.
  assert.match(DIFFICULTY_MEANING.hard, /draw/i)
})
