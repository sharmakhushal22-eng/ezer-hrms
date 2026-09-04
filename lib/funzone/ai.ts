// lib/funzone/ai.ts — the computer opponent.
//
// RANDOMNESS IS INJECTED, ALWAYS. Every function here takes its random source
// as an argument rather than calling Math.random(). A bot that reaches for the
// global generator cannot be tested — you can assert that it did not crash and
// nothing else — and this is exactly the code where "usually right" hides a
// bug for months.
//
// HARD IS UNBEATABLE, AND THAT IS THE POINT OF HAVING EASY
//
// Tic-tac-toe is solved: perfect play always draws. So the hard bot cannot be
// beaten, only held. That is the correct implementation of "hard" and a
// terrible default for a break-time game, which is why the difficulty is
// chosen on screen and starts at medium.
//
// AND EASY HAS TO ACTUALLY BE EASY, which took a second attempt.
//
// The first version made the weaker levels "sometimes skip the search and
// play a sensible move instead" — win, block, centre, corner. That reads
// well and is worthless: a search over every reachable position found ZERO
// where that heuristic differs from perfect play. Tic-tac-toe is small
// enough that "sensible" IS optimal, so all three levels played identically
// and the difficulty was decoration.
//
// So the weaker levels now play a genuinely worse move — a random legal one —
// and differ in how often they bother to be tactical at all. Easy loses.
// Medium takes the obvious win and block but does not see a fork coming.
// Hard is solved.

import { boardFrom, outcome, other, WIN_LINES,
         type Board, type Mark, type Move,
         type MemTurn, type Question } from './games.ts'

export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard',
}

/** What each level actually does, so the choice is informed rather than a guess. */
export const DIFFICULTY_MEANING: Record<Difficulty, string> = {
  easy:   'Often just plays somewhere. You should win.',
  medium: 'Takes an obvious win and blocks yours, but does not see a fork coming.',
  hard:   'Solved play. The best you can get is a draw — that is the game, not the bot.',
}

/** Chance the weaker levels bother to look for a win or a block at all. */
const TACTICAL: Record<Difficulty, number> = { easy: 0.4, medium: 1, hard: 1 }

export type Rand = () => number

// ── tic-tac-toe ──────────────────────────────────────────────────────────

function emptyCells(b: Board): number[] {
  return b.map((c, i) => (c === '' ? i : -1)).filter(i => i >= 0)
}

/**
 * Minimax with depth preference: win SOONER, lose LATER.
 *
 * Without the depth term the bot is indifferent between winning now and
 * winning in three moves, so it wanders — and against a human that reads as
 * the bot not having noticed it had won.
 */
function score(b: Board, me: Mark, turn: Mark, depth: number): number {
  const st = outcome(b)
  if (st.kind === 'won') return st.by === me ? 10 - depth : depth - 10
  if (st.kind === 'draw') return 0

  const cells = emptyCells(b)
  const scores = cells.map(i => {
    const next = [...b]; next[i] = turn
    return score(next, me, other(turn), depth + 1)
  })
  return turn === me ? Math.max(...scores) : Math.min(...scores)
}

/** Every move that ties for the best outcome. Returned as a list so the
 *  caller can break the tie randomly — a bot that always opens in the same
 *  corner is beaten once and then forever. */
export function bestMoves(b: Board, me: Mark): number[] {
  const cells = emptyCells(b)
  if (cells.length === 0) return []
  const scored = cells.map(i => {
    const next = [...b]; next[i] = me
    return { i, s: score(next, me, other(me), 1) }
  })
  const top = Math.max(...scored.map(x => x.s))
  return scored.filter(x => x.s === top).map(x => x.i)
}

/** A win or a block if one is there, otherwise -1. One ply, no lookahead —
 *  which is precisely why medium can still be beaten by a fork. */
export function tacticalMove(b: Board, me: Mark): number {
  const finisher = (mark: Mark) => {
    for (const [x, y, z] of WIN_LINES) {
      const line = [x, y, z]
      const marks = line.map(i => b[i])
      const mine = marks.filter(m => m === mark).length
      const gap = line.find(i => b[i] === '')
      if (mine === 2 && marks.filter(m => m === '').length === 1 && gap !== undefined) {
        return gap
      }
    }
    return -1
  }
  const win = finisher(me);          if (win >= 0) return win
  const block = finisher(other(me)); if (block >= 0) return block
  return -1
}

/** Any legal square. This is what makes easy losable — see the header. */
export function randomMove(b: Board, rand: Rand): number {
  const cells = emptyCells(b)
  return cells.length ? cells[Math.floor(rand() * cells.length)] : -1
}

/**
 * The bot's move.
 *
 * `rand` decides two things: whether this turn is played perfectly, and which
 * of several equally good moves is taken. Both are injected so a test can pin
 * the behaviour exactly.
 */
export function botMove(moves: Move[], me: Mark, level: Difficulty, rand: Rand): number {
  const b = boardFrom(moves)
  if (outcome(b).kind !== 'playing') return -1
  const cells = emptyCells(b)
  if (!cells.length) return -1

  if (level === 'hard') {
    const best = bestMoves(b, me)
    return best.length ? best[Math.floor(rand() * best.length)] : randomMove(b, rand)
  }
  if (rand() < TACTICAL[level]) {
    const t = tacticalMove(b, me)
    if (t >= 0) return t
  }
  return randomMove(b, rand)
}

// ── memory match ─────────────────────────────────────────────────────────

/**
 * What the bot has seen turned over, and how much of it it keeps.
 *
 * A bot with perfect recall clears the board without a mistake and the
 * person watching never gets another turn. So memory is BOUNDED: it holds the
 * last N cards it saw, which is also how a person plays — you remember the
 * last few, not all sixteen.
 */
export const MEM_RECALL: Record<Difficulty, number> = { easy: 2, medium: 6, hard: 16 }

export interface MemMind { seen: { card: number; face: string }[] }

export const EMPTY_MIND: MemMind = { seen: [] }

/** Fold a turn into the bot's memory — it watches both players' turns, the
 *  way a person at the table would. */
export function remember(mind: MemMind, deck: string[], t: MemTurn,
                         level: Difficulty): MemMind {
  const cap = MEM_RECALL[level]
  const seen = [...mind.seen.filter(s => s.card !== t.a && s.card !== t.b),
                { card: t.a, face: deck[t.a] }, { card: t.b, face: deck[t.b] }]
  return { seen: seen.slice(-cap) }
}

/**
 * Which two cards the bot turns over.
 *
 * If it remembers a pair among the unmatched cards it takes it. Otherwise it
 * turns one it has not seen, and then — knowing that card's face — takes the
 * partner if it happens to remember it. That second look is what makes it
 * feel like it is playing rather than guessing.
 */
export function memBotTurn(deck: string[], matched: number[], mind: MemMind,
                           rand: Rand): [number, number] | null {
  const open = deck.map((_, i) => i).filter(i => !matched.includes(i))
  if (open.length < 2) return null
  const known = mind.seen.filter(s => open.includes(s.card))

  for (const s of known) {
    const twin = known.find(o => o.card !== s.card && o.face === s.face)
    if (twin) return [s.card, twin.card]
  }

  const unseen = open.filter(i => !known.some(s => s.card === i))
  const first = unseen.length
    ? unseen[Math.floor(rand() * unseen.length)]
    : open[Math.floor(rand() * open.length)]

  const partner = known.find(s => s.card !== first && s.face === deck[first])
  if (partner) return [first, partner.card]

  const rest = open.filter(i => i !== first)
  return [first, rest[Math.floor(rand() * rest.length)]]
}

// ── trivia ───────────────────────────────────────────────────────────────

/** Chance the bot knows the answer. Not 100% even on hard: a quiz opponent
 *  that never misses is not a game, it is a scoreboard. */
const KNOWS: Record<Difficulty, number> = { easy: 0.35, medium: 0.6, hard: 0.85 }

export function botAnswer(q: Question, level: Difficulty, rand: Rand): number {
  if (rand() < KNOWS[level]) return q.correct
  const wrong = q.opts.map((_, i) => i).filter(i => i !== q.correct)
  return wrong.length ? wrong[Math.floor(rand() * wrong.length)] : q.correct
}

/** How long the bot "thinks", in ms. Instant answers feel like a script;
 *  this is enough to read the question and not so long it stalls the game. */
export function botDelay(level: Difficulty, rand: Rand): number {
  const base = level === 'hard' ? 700 : level === 'medium' ? 1100 : 1600
  return Math.round(base + rand() * 900)
}
