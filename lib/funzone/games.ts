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
