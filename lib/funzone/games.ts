// lib/funzone/games.ts — which games can be played against somebody, and the
// rules of the ones that can.
//
// THE RULES ARE PURE FUNCTIONS ON PURPOSE
//
// In a live game there are two clients and neither is a server. Both run the
// same functions on the same move list and must reach the same board, or the
// two screens disagree and the players argue about who won. Pure, total, and
// tested is not an aesthetic choice here — it is the only thing making the
// two screens agree.
//
// It also means a move arriving over the wire can be CHECKED before it is
// applied. Broadcast is peer-to-peer: the other client is not trusted, it is
// merely the other player. An illegal move is dropped, not rendered.

export type GameCode = 'ttt' | 'quiz' | 'mem' | 'wheel'

export interface GameDef {
  code: GameCode
  name: string
  /** Can it be played against somebody else, live? */
  live: boolean
  players: number
  /** Why not, when it cannot. Shown instead of a disabled button with no
   *  explanation, which just reads as broken. */
  soloReason?: string
}

export const GAMES: GameDef[] = [
  { code: 'ttt',  name: 'Tic-Tac-Toe',    live: true,  players: 2 },
  { code: 'quiz', name: 'EZER Trivia',    live: true,  players: 2 },
  { code: 'mem',  name: 'Memory Match',   live: true,  players: 2 },
  { code: 'wheel', name: 'Spin the Wheel', live: false, players: 1,
    soloReason: 'The wheel is a daily solo spin — there is nothing for a second player to do.' },
]

export const LIVE_GAMES = GAMES.filter(g => g.live)
export function gameByCode(code: string): GameDef | null {
  return GAMES.find(g => g.code === code) ?? null
}

// ── tic-tac-toe ──────────────────────────────────────────────────────────

export type Mark = 'X' | 'O'
export type Cell = Mark | ''
export type Board = Cell[]

export const EMPTY_BOARD: Board = Array(9).fill('')

export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

export interface Move {
  /** 0-based, so a replay can be ordered and a duplicate detected. */
  n: number
  by: Mark
  cell: number
}

export type Outcome =
  | { kind: 'playing'; turn: Mark }
  | { kind: 'won'; by: Mark; line: number[] }
  | { kind: 'draw' }

/** X always opens. Stated once so both clients agree without negotiating. */
export const FIRST: Mark = 'X'

export function boardFrom(moves: Move[]): Board {
  const b = [...EMPTY_BOARD]
  for (const m of moves) b[m.cell] = m.by
  return b
}

export function outcome(board: Board): Outcome {
  for (const line of WIN_LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { kind: 'won', by: board[a] as Mark, line }
    }
  }
  if (board.every(c => c !== '')) return { kind: 'draw' }
  const played = board.filter(c => c !== '').length
  return { kind: 'playing', turn: played % 2 === 0 ? FIRST : other(FIRST) }
}

export function other(m: Mark): Mark { return m === 'X' ? 'O' : 'X' }

export interface Verdict { legal: boolean; because: string }

/**
 * May this move be applied to this move list?
 *
 * Everything a hostile or simply out-of-date peer could send is checked here:
 * a cell that is taken, a move out of turn, a move after the game is over, a
 * sequence number that has already been used or skips ahead, a cell outside
 * the board. The last one matters because `moves` arrive as JSON — an index
 * of 99 or -1 would otherwise write past the array and corrupt both screens.
 */
export function canApply(moves: Move[], m: Move): Verdict {
  if (!Number.isInteger(m.cell) || m.cell < 0 || m.cell > 8) {
    return { legal: false, because: `Cell ${m.cell} is not on the board.` }
  }
  if (m.by !== 'X' && m.by !== 'O') {
    return { legal: false, because: `${m.by} is not a player.` }
  }
  if (!Number.isInteger(m.n) || m.n !== moves.length) {
    // Not just "out of order": a repeat of the last move is what a reconnect
    // sends, and applying it twice would hand the turn back to the wrong side.
    return { legal: false, because: `Move ${m.n} arrived when ${moves.length} was expected.` }
  }
  const board = boardFrom(moves)
  const state = outcome(board)
  if (state.kind !== 'playing') {
    return { legal: false, because: 'The game is already over.' }
  }
  if (state.turn !== m.by) {
    return { legal: false, because: `It is ${state.turn}'s turn.` }
  }
  if (board[m.cell] !== '') {
    return { legal: false, because: 'That square is taken.' }
  }
  return { legal: true, because: '' }
}

/** Apply if legal; otherwise return the list unchanged. Never throws — a bad
 *  packet must not take the game down with it. */
export function apply(moves: Move[], m: Move): Move[] {
  return canApply(moves, m).legal ? [...moves, m] : moves
}

// ── the result, as the score record wants it ─────────────────────────────

export interface Result {
  /** 'X' | 'O' | null for a draw. */
  winner: Mark | null
  draw: boolean
  moveCount: number
}

/** Derive the result from the moves alone.
 *
 *  The score row is written from THIS, server-side, rather than from whatever
 *  the winning client claims. Two break-room players are not an adversary
 *  worth defending against, but a leaderboard nobody can trust is not worth
 *  showing either, and re-deriving it costs nothing. */
export function resultOf(moves: Move[]): Result | null {
  const state = outcome(boardFrom(moves))
  if (state.kind === 'playing') return null
  return {
    winner: state.kind === 'won' ? state.by : null,
    draw: state.kind === 'draw',
    moveCount: moves.length,
  }
}

// ═════════════════════════════════════════════════════════════════════════
// A DECK BOTH SCREENS AGREE ON
//
// Memory Match and Trivia both need the two clients to see the same cards in
// the same order, and there is no server to deal them. Math.random() would
// deal two different decks, so the order comes from a SEED the host puts in
// the session and both sides shuffle from.
//
// mulberry32 rather than anything cleverer: it is four lines, it is
// deterministic across engines, and nothing here is cryptographic. The seed
// decides a card order, not a password.
// ═════════════════════════════════════════════════════════════════════════

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, driven by the seeded generator. Returns a NEW array — a
 *  shuffle that mutates its input would reshuffle the caller's deck on a
 *  re-render and the two screens would drift apart. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const r = rng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── memory match ─────────────────────────────────────────────────────────

export const MEM_FACES = ['🍕', '🎧', '🚀', '🌵', '🎲', '⚓', '🧩', '🎸']
export const MEM_CARDS = MEM_FACES.length * 2

export function memDeck(seed: number): string[] {
  return shuffled([...MEM_FACES, ...MEM_FACES], seed)
}

/** One turn: the two cards a player turned over. Both are sent together,
 *  after the second flip, so the opponent never watches a half-finished turn
 *  and there is no "one card is face up" state to keep in sync. */
export interface MemTurn { n: number; by: 'HOST' | 'GUEST'; a: number; b: number }

export interface MemState {
  matched: number[]
  scores: { HOST: number; GUEST: number }
  turn: 'HOST' | 'GUEST'
  done: boolean
}

export const MEM_FIRST: 'HOST' = 'HOST'

/**
 * Replay the turns.
 *
 * A hit keeps the turn — the standard rule, and the reason the turn cannot be
 * derived from the turn COUNT the way tic-tac-toe's can. It has to be walked.
 */
export function memReplay(deck: string[], turns: MemTurn[]): MemState {
  const matched: number[] = []
  const scores = { HOST: 0, GUEST: 0 }
  let turn: 'HOST' | 'GUEST' = MEM_FIRST
  for (const t of turns) {
    const hit = deck[t.a] === deck[t.b]
    if (hit) { matched.push(t.a, t.b); scores[t.by]++ }
    else turn = t.by === 'HOST' ? 'GUEST' : 'HOST'
  }
  return { matched, scores, turn, done: matched.length >= MEM_CARDS }
}

export function memCanApply(deck: string[], turns: MemTurn[], t: MemTurn): Verdict {
  if (!Number.isInteger(t.n) || t.n !== turns.length) {
    return { legal: false, because: `Turn ${t.n} arrived when ${turns.length} was expected.` }
  }
  for (const c of [t.a, t.b]) {
    if (!Number.isInteger(c) || c < 0 || c >= deck.length) {
      return { legal: false, because: `Card ${c} is not in the deck.` }
    }
  }
  if (t.a === t.b) {
    return { legal: false, because: 'That is the same card twice.' }
  }
  const s = memReplay(deck, turns)
  if (s.done) return { legal: false, because: 'Every pair has been found.' }
  if (s.turn !== t.by) return { legal: false, because: `It is ${s.turn}'s turn.` }
  if (s.matched.includes(t.a) || s.matched.includes(t.b)) {
    return { legal: false, because: 'That card has already been matched.' }
  }
  return { legal: true, because: '' }
}

export function memApply(deck: string[], turns: MemTurn[], t: MemTurn): MemTurn[] {
  return memCanApply(deck, turns, t).legal ? [...turns, t] : turns
}

/** Winner by pairs. Equal pairs is a draw — with sixteen cards and eight
 *  pairs that is possible, so it is a real outcome rather than a rounding
 *  case. */
export function memResult(deck: string[], turns: MemTurn[]):
  { winner: 'HOST' | 'GUEST' | null; draw: boolean; scores: MemState['scores'] } | null {
  const s = memReplay(deck, turns)
  if (!s.done) return null
  const { HOST, GUEST } = s.scores
  return {
    winner: HOST === GUEST ? null : HOST > GUEST ? 'HOST' : 'GUEST',
    draw: HOST === GUEST,
    scores: s.scores,
  }
}

// ── trivia ───────────────────────────────────────────────────────────────

export interface Question { q: string; opts: string[]; correct: number }

/**
 * The four questions, for BOTH modes.
 *
 * components/ess/FunZone.tsx imports these rather than holding its own copy.
 * It did hold one, and within a single sitting the two had drifted: the live
 * quiz offered "Reward Teams" and "Provident Transfer" where the solo quiz
 * offered "Report Automation" and "Provident Trust". Same questions, different
 * wrong answers — which is the sort of difference nobody notices until two
 * colleagues compare screens mid-game.
 */
export const QUIZ: Question[] = [
  { q: "EZER's mission stands for Empower, Zero Risk, Efficient, and…?",
    opts: ['Retain Top Talent', 'Reduce Turnover', 'Report Automation'], correct: 0 },
  { q: 'Which financial year runs April to March in India?',
    opts: ['Calendar Year', 'Financial Year', 'Fiscal Quarter'], correct: 1 },
  { q: 'What does PT stand for in Indian payroll?',
    opts: ['Personal Tax', 'Professional Tax', 'Provident Trust'], correct: 1 },
  { q: 'LWF stands for Labour ___ Fund?',
    opts: ['Welfare', 'Wages', 'Work'], correct: 0 },
]

export function quizFor(seed: number): Question[] {
  return shuffled(QUIZ, seed)
}

/** One player's answer to one question. `choice` is -1 for "ran out of time". */
export interface Answer { q: number; by: 'HOST' | 'GUEST'; choice: number }

export interface QuizState {
  /** Which question both players are on. */
  at: number
  scores: { HOST: number; GUEST: number }
  done: boolean
}

export function quizReplay(qs: Question[], answers: Answer[]): QuizState {
  const scores = { HOST: 0, GUEST: 0 }
  for (const a of answers) {
    if (a.q >= 0 && a.q < qs.length && a.choice === qs[a.q].correct) scores[a.by]++
  }
  // A question is finished when BOTH have answered it.
  let at = 0
  while (at < qs.length &&
         answers.some(a => a.q === at && a.by === 'HOST') &&
         answers.some(a => a.q === at && a.by === 'GUEST')) at++
  return { at, scores, done: at >= qs.length }
}

export function quizCanApply(qs: Question[], answers: Answer[], a: Answer): Verdict {
  if (!Number.isInteger(a.q) || a.q < 0 || a.q >= qs.length) {
    return { legal: false, because: `There is no question ${a.q}.` }
  }
  if (!Number.isInteger(a.choice) || a.choice < -1 || a.choice >= qs[a.q].opts.length) {
    return { legal: false, because: `${a.choice} is not one of the options.` }
  }
  if (answers.some(x => x.q === a.q && x.by === a.by)) {
    return { legal: false, because: 'You have already answered this one.' }
  }
  const s = quizReplay(qs, answers)
  if (s.done) return { legal: false, because: 'The quiz is over.' }
  // Answering ahead is refused: both players are on the same question, and a
  // client that raced forward would be scoring against a question its
  // opponent has not seen.
  if (a.q !== s.at) {
    return { legal: false, because: `Everyone is on question ${s.at + 1}.` }
  }
  return { legal: true, because: '' }
}

export function quizApply(qs: Question[], answers: Answer[], a: Answer): Answer[] {
  return quizCanApply(qs, answers, a).legal ? [...answers, a] : answers
}

export function quizResult(qs: Question[], answers: Answer[]):
  { winner: 'HOST' | 'GUEST' | null; draw: boolean; scores: QuizState['scores'] } | null {
  const s = quizReplay(qs, answers)
  if (!s.done) return null
  const { HOST, GUEST } = s.scores
  return {
    winner: HOST === GUEST ? null : HOST > GUEST ? 'HOST' : 'GUEST',
    draw: HOST === GUEST,
    scores: s.scores,
  }
}
