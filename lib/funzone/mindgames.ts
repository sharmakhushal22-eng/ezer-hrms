// lib/funzone/mindgames.ts — the ten solo mind games added in the 2026-09 redesign.
//
// SAME HOUSE RULES AS games.ts AND ai.ts
//
//   • Pure, total functions. Nothing here throws on bad input; it returns the
//     input unchanged, so a stray tap can never take a screen down.
//   • Randomness is INJECTED (`rand: () => number`), never Math.random(), so
//     every rule below can be pinned exactly in a test.
//   • Nothing here touches the network or the database. These are solo,
//     break-time games: a refresh resets them and no score is kept — exactly
//     the contract components/ess/FunZone.tsx already states for the originals.
//
// DELIBERATELY SEPARATE FROM games.ts
//
// games.ts is the file two live clients must agree on, and its GAMES /
// LIVE_GAMES lists are read by the API route to validate invites. None of
// these ten can be played with a colleague, so none of them belongs in that
// list — adding them there would put codes in front of canInvite() that the
// database has never heard of. They live here instead, and games.ts is
// byte-for-byte unchanged.

export type Rand = () => number

const pick = <T,>(xs: readonly T[], rand: Rand): T => xs[Math.floor(rand() * xs.length)]
const int = (lo: number, hi: number, rand: Rand) => lo + Math.floor(rand() * (hi - lo + 1))

// ═════════════════════════════════════════════════════════════════════════
// THE CATALOGUE
// ═════════════════════════════════════════════════════════════════════════

export type MindCode =
  | 'tiles' | 'simon' | 'reflex' | 'scramble' | 'slide'
  | 'sprint' | 'clash' | 'codebreak' | 'lights' | 'mines'

export type Category = 'puzzle' | 'memory' | 'reflex' | 'words' | 'brain' | 'logic'

export interface MindGameDef {
  code: MindCode
  name: string
  icon: string
  cat: Category
  /** One line on the hub tile. */
  desc: string
  /** One line under the title once the game is open — how to play. */
  how: string
}

export const CATEGORY_LABEL: Record<Category, string> = {
  puzzle: 'Puzzle', memory: 'Memory', reflex: 'Reflex',
  words: 'Words', brain: 'Brain', logic: 'Logic',
}

export const MIND_GAMES: MindGameDef[] = [
  { code: 'tiles',     icon: '🔢', name: '2048',          cat: 'puzzle',
    desc: 'Slide and merge tiles to reach 2048',
    how: 'Use the arrow keys, swipe, or the pad. Equal tiles merge when they touch.' },
  { code: 'simon',     icon: '🎹', name: 'Echo',          cat: 'memory',
    desc: 'Watch the pads light up, then repeat the pattern',
    how: 'Each round adds one more step. One wrong pad ends the run.' },
  { code: 'reflex',    icon: '⚡', name: 'Quick Draw',    cat: 'reflex',
    desc: 'Tap the moment the panel turns green',
    how: 'Wait for green, then tap. Tapping early counts as a false start.' },
  { code: 'scramble',  icon: '🔤', name: 'Payroll Scramble', cat: 'words',
    desc: 'Unscramble HR and payroll words against the clock',
    how: 'Type the word the letters make. The hint tells you what it means.' },
  { code: 'slide',     icon: '🧱', name: 'Slide Puzzle',  cat: 'puzzle',
    desc: 'Put the eight tiles back in order',
    how: 'Tap a tile next to the gap to slide it in. Fewest moves wins.' },
  { code: 'sprint',    icon: '➗', name: 'Math Sprint',   cat: 'brain',
    desc: 'Solve as many sums as you can in 45 seconds',
    how: 'Type the answer — it is checked as you type. Sums get harder as you go.' },
  { code: 'clash',     icon: '🎨', name: 'Colour Clash',  cat: 'brain',
    desc: 'Name the ink colour, not the word',
    how: 'The word says one colour and is printed in another. Pick the ink.' },
  { code: 'codebreak', icon: '🔐', name: 'Code Breaker',  cat: 'logic',
    desc: 'Crack a four-colour code in ten tries',
    how: 'A filled dot is right colour, right place. A ring is right colour, wrong place.' },
  { code: 'lights',    icon: '🔆', name: 'Lights Out',    cat: 'logic',
    desc: 'Switch every light off — each tap flips its neighbours',
    how: 'A tap flips that light and the four next to it. Get the board dark.' },
  { code: 'mines',     icon: '💣', name: 'Minesweeper',   cat: 'logic',
    desc: 'Clear the field without touching a mine',
    how: 'Numbers count the mines around a square. Flag mode marks what you suspect.' },
]

export function mindGameByCode(code: string): MindGameDef | null {
  return MIND_GAMES.find(g => g.code === code) ?? null
}

// ═════════════════════════════════════════════════════════════════════════
// 2048
// ═════════════════════════════════════════════════════════════════════════

export type Dir = 'up' | 'down' | 'left' | 'right'
export const TILES_SIZE = 4
export const TILES_GOAL = 2048

/** Row/column index lists for walking the grid in the direction of travel. */
function lines(dir: Dir): number[][] {
  const n = TILES_SIZE, out: number[][] = []
  for (let a = 0; a < n; a++) {
    const line: number[] = []
    for (let b = 0; b < n; b++) {
      if (dir === 'left')  line.push(a * n + b)
      if (dir === 'right') line.push(a * n + (n - 1 - b))
      if (dir === 'up')    line.push(b * n + a)
      if (dir === 'down')  line.push((n - 1 - b) * n + a)
    }
    out.push(line)
  }
  return out
}

export interface SlideResult { grid: number[]; gained: number; moved: boolean; merged: number[] }

/** Slide every line towards `dir`. A tile merges at most once per move — the
 *  standard rule, and the one people notice when it is wrong ([2,2,2,2] → [4,4]). */
export function slideTiles(grid: number[], dir: Dir): SlideResult {
  if (grid.length !== TILES_SIZE * TILES_SIZE) return { grid, gained: 0, moved: false, merged: [] }
  const next = [...grid]
  let gained = 0
  const merged: number[] = []
  for (const line of lines(dir)) {
    const vals = line.map(i => grid[i]).filter(v => v > 0)
    const out: number[] = []
    const mergedAt: boolean[] = []
    for (const v of vals) {
      const last = out.length - 1
      if (last >= 0 && out[last] === v && !mergedAt[last]) {
        out[last] = v * 2; mergedAt[last] = true; gained += v * 2
      } else { out.push(v); mergedAt.push(false) }
    }
    line.forEach((idx, k) => {
      next[idx] = out[k] ?? 0
      if (mergedAt[k]) merged.push(idx)
    })
  }
  const moved = next.some((v, i) => v !== grid[i])
  return { grid: next, gained, moved, merged }
}

/** Drop a 2 (90%) or a 4 (10%) on a random empty square. Returns the grid
 *  unchanged, with index -1, when there is nowhere to put it. */
export function spawnTile(grid: number[], rand: Rand): { grid: number[]; at: number } {
  const empty = grid.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0)
  if (!empty.length) return { grid, at: -1 }
  const at = pick(empty, rand)
  const next = [...grid]
  next[at] = rand() < 0.9 ? 2 : 4
  return { grid: next, at }
}

export function newTiles(rand: Rand): number[] {
  let g = Array(TILES_SIZE * TILES_SIZE).fill(0)
  g = spawnTile(g, rand).grid
  g = spawnTile(g, rand).grid
  return g
}

export function tilesStuck(grid: number[]): boolean {
  return (['up', 'down', 'left', 'right'] as Dir[]).every(d => !slideTiles(grid, d).moved)
}

export const tilesWon = (grid: number[]) => grid.some(v => v >= TILES_GOAL)

// ═════════════════════════════════════════════════════════════════════════
// ECHO (Simon)
// ═════════════════════════════════════════════════════════════════════════

export const ECHO_PADS = 4

export function echoExtend(seq: number[], rand: Rand): number[] {
  return [...seq, Math.floor(rand() * ECHO_PADS)]
}

/** Where the player is after tapping `pad` as step `at`.
 *  'next' — right, keep going; 'round' — right, and that finished the round;
 *  'miss' — wrong pad, the run is over. */
export function echoCheck(seq: number[], at: number, pad: number): 'next' | 'round' | 'miss' {
  if (at < 0 || at >= seq.length || seq[at] !== pad) return 'miss'
  return at === seq.length - 1 ? 'round' : 'next'
}

/** Playback speeds up as the pattern grows, so long runs stay brisk. */
export function echoStepMs(length: number): number {
  return Math.max(260, 620 - length * 25)
}

// ═════════════════════════════════════════════════════════════════════════
// QUICK DRAW (reaction time)
// ═════════════════════════════════════════════════════════════════════════

export const REFLEX_ROUNDS = 5

/** How long the panel stays red. Random, so it cannot be timed by rhythm. */
export function reflexWait(rand: Rand): number {
  return int(1400, 4200, rand)
}

export function reflexVerdict(ms: number): string {
  if (ms < 200) return 'Lightning'
  if (ms < 260) return 'Sharp'
  if (ms < 330) return 'Quick'
  if (ms < 450) return 'Steady'
  return 'Warming up'
}

export function average(xs: number[]): number {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0
}

// ═════════════════════════════════════════════════════════════════════════
// PAYROLL SCRAMBLE
// ═════════════════════════════════════════════════════════════════════════

export interface WordItem { word: string; hint: string }

/** House vocabulary. Upper case, letters only — the checker compares letters,
 *  so a space or a hyphen here would make a word unanswerable. */
export const SCRAMBLE_WORDS: WordItem[] = [
  { word: 'PAYROLL',    hint: 'The run that pays everybody' },
  { word: 'PAYSLIP',    hint: 'Your monthly salary breakdown' },
  { word: 'GRATUITY',   hint: 'Paid after five years of service' },
  { word: 'BONUS',      hint: 'Something extra on top of pay' },
  { word: 'APPRAISAL',  hint: 'The yearly performance review' },
  { word: 'ATTENDANCE', hint: 'Who was in, and when' },
  { word: 'OVERTIME',   hint: 'Hours beyond the normal shift' },
  { word: 'HOLIDAY',    hint: 'A day the office is shut' },
  { word: 'PENSION',    hint: 'Income after retirement' },
  { word: 'ALLOWANCE',  hint: 'HRA is one of these' },
  { word: 'ONBOARDING', hint: 'A new joiner’s first days' },
  { word: 'DEDUCTION',  hint: 'Taken out of gross pay' },
  { word: 'REFERRAL',   hint: 'Recommending a friend for a role' },
  { word: 'PROBATION',  hint: 'The trial period before confirmation' },
  { word: 'TIMESHEET',  hint: 'Where hours are logged' },
  { word: 'WELFARE',    hint: 'The W in LWF' },
  { word: 'INCREMENT',  hint: 'A raise in salary' },
  { word: 'RESIGNATION',hint: 'Formally deciding to leave' },
  { word: 'HANDBOOK',   hint: 'Where the policies are written down' },
  { word: 'WELLNESS',   hint: 'Health and wellbeing programmes' },
]

export const SCRAMBLE_SECONDS = 60

/** Letters of `word`, shuffled, and never left in their original order. */
export function scramble(word: string, rand: Rand): string {
  const letters = word.split('')
  if (new Set(letters).size < 2) return word
  for (let tries = 0; tries < 12; tries++) {
    const out = [...letters]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    const s = out.join('')
    if (s !== word) return s
  }
  // Twelve unlucky shuffles in a row: rotate by one, which always differs.
  return word.slice(1) + word[0]
}

export const normaliseWord = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')

/** A round of words in a random order, no repeats until the list runs out. */
export function scrambleDeck(rand: Rand): WordItem[] {
  const out = [...SCRAMBLE_WORDS]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ═════════════════════════════════════════════════════════════════════════
// SLIDE PUZZLE (3 × 3)
// ═════════════════════════════════════════════════════════════════════════

export const SLIDE_SIZE = 3
export const SLIDE_SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 0]

export function slideAdjacent(a: number, b: number): boolean {
  const n = SLIDE_SIZE
  const ar = Math.floor(a / n), ac = a % n, br = Math.floor(b / n), bc = b % n
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1
}

export function slideMove(tiles: number[], i: number): number[] {
  const gap = tiles.indexOf(0)
  if (i < 0 || i >= tiles.length || !slideAdjacent(i, gap)) return tiles
  const next = [...tiles]
  ;[next[i], next[gap]] = [next[gap], next[i]]
  return next
}

export const slideSolved = (t: number[]) => t.every((v, i) => v === SLIDE_SOLVED[i])

/** Shuffle by walking backwards from solved with legal moves only — half of
 *  all random permutations of an 8-puzzle cannot be solved, and a puzzle
 *  with no answer is the worst kind of bug to ship in a break-time game. */
export function slideShuffle(rand: Rand, steps = 80): number[] {
  let t = [...SLIDE_SOLVED]
  let prev = -1
  for (let s = 0; s < steps; s++) {
    const gap = t.indexOf(0)
    const options = t.map((_, i) => i).filter(i => slideAdjacent(i, gap) && i !== prev)
    const i = pick(options, rand)
    prev = gap
    t = slideMove(t, i)
  }
  // Solved means the gap is in the corner; one legal move un-solves it.
  return slideSolved(t) ? slideMove(t, 7) : t
}

// ═════════════════════════════════════════════════════════════════════════
// MATH SPRINT
// ═════════════════════════════════════════════════════════════════════════

export const SPRINT_SECONDS = 45

export interface Sum { text: string; answer: number }

/** Harder as the score climbs: bigger numbers, then multiplication. Subtraction
 *  never goes below zero, so the answer box never needs a minus sign. */
export function makeSum(solved: number, rand: Rand): Sum {
  const tier = solved < 5 ? 0 : solved < 12 ? 1 : 2
  const ops = tier === 0 ? ['+', '−'] : ['+', '−', '×']
  const op = pick(ops, rand)
  if (op === '×') {
    const a = int(2, tier === 1 ? 9 : 12, rand), b = int(2, tier === 1 ? 9 : 15, rand)
    return { text: `${a} × ${b}`, answer: a * b }
  }
  const hi = tier === 0 ? 20 : tier === 1 ? 60 : 150
  let a = int(1, hi, rand), b = int(1, hi, rand)
  if (op === '−' && b > a) [a, b] = [b, a]
  return op === '+'
    ? { text: `${a} + ${b}`, answer: a + b }
    : { text: `${a} − ${b}`, answer: a - b }
}

// ═════════════════════════════════════════════════════════════════════════
// COLOUR CLASH (Stroop)
// ═════════════════════════════════════════════════════════════════════════

export const CLASH_COLOURS = [
  { key: 'red',    name: 'Red' },
  { key: 'blue',   name: 'Blue' },
  { key: 'green',  name: 'Green' },
  { key: 'yellow', name: 'Yellow' },
  { key: 'purple', name: 'Purple' },
] as const

export const CLASH_ROUNDS = 12

export interface ClashCard { word: number; ink: number }

/** Three rounds in four are a mismatch — that is the whole game. The rest
 *  match, so nobody can win by always picking "not the word". */
export function clashCard(rand: Rand): ClashCard {
  const n = CLASH_COLOURS.length
  const word = Math.floor(rand() * n)
  if (rand() < 0.25) return { word, ink: word }
  const ink = (word + 1 + Math.floor(rand() * (n - 1))) % n
  return { word, ink }
}

// ═════════════════════════════════════════════════════════════════════════
// CODE BREAKER (Mastermind)
// ═════════════════════════════════════════════════════════════════════════

export const CODE_COLOURS = 6
export const CODE_LENGTH = 4
export const CODE_TRIES = 10

export function newCode(rand: Rand): number[] {
  return Array.from({ length: CODE_LENGTH }, () => Math.floor(rand() * CODE_COLOURS))
}

/** Right colour right place, and right colour wrong place — each peg counted
 *  once. Repeats are allowed in the code, which is exactly where a naive
 *  count goes wrong: code [0,0,1,1] against guess [0,1,1,1] is 3 exact, 0 near. */
export function scoreGuess(code: number[], guess: number[]): { exact: number; near: number } {
  if (code.length !== guess.length) return { exact: 0, near: 0 }
  let exact = 0
  const restCode: number[] = [], restGuess: number[] = []
  code.forEach((c, i) => {
    if (c === guess[i]) exact++
    else { restCode.push(c); restGuess.push(guess[i]) }
  })
  let near = 0
  for (const g of restGuess) {
    const k = restCode.indexOf(g)
    if (k >= 0) { near++; restCode.splice(k, 1) }
  }
  return { exact, near }
}

// ═════════════════════════════════════════════════════════════════════════
// LIGHTS OUT (5 × 5)
// ═════════════════════════════════════════════════════════════════════════

export const LIGHTS_SIZE = 5

export function lightsPress(board: boolean[], i: number): boolean[] {
  const n = LIGHTS_SIZE
  if (i < 0 || i >= n * n || board.length !== n * n) return board
  const r = Math.floor(i / n), c = i % n
  const next = [...board]
  for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const rr = r + dr, cc = c + dc
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) next[rr * n + cc] = !next[rr * n + cc]
  }
  return next
}

export const lightsOut = (b: boolean[]) => b.every(v => !v)

/** Built by pressing a dark board at random, so every puzzle has an answer —
 *  about a quarter of random 5×5 patterns do not. */
export function lightsPuzzle(rand: Rand, presses = 9): boolean[] {
  let b: boolean[] = Array(LIGHTS_SIZE * LIGHTS_SIZE).fill(false)
  const used = new Set<number>()
  while (used.size < presses) used.add(Math.floor(rand() * b.length))
  for (const i of used) b = lightsPress(b, i)
  if (lightsOut(b)) b = lightsPress(b, 12)
  return b
}

// ═════════════════════════════════════════════════════════════════════════
// MINESWEEPER (9 × 9, 10 mines)
// ═════════════════════════════════════════════════════════════════════════

export const MINES_SIZE = 9
export const MINES_COUNT = 10

export function around(i: number, n = MINES_SIZE): number[] {
  const r = Math.floor(i / n), c = i % n, out: number[] = []
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue
    const rr = r + dr, cc = c + dc
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc)
  }
  return out
}

/** Mines are laid AFTER the first tap and never on it or next to it, so the
 *  first move always opens some ground instead of ending the game. */
export function layMines(first: number, rand: Rand): boolean[] {
  const total = MINES_SIZE * MINES_SIZE
  const banned = new Set([first, ...around(first)])
  const mines: boolean[] = Array(total).fill(false)
  let placed = 0
  while (placed < MINES_COUNT) {
    const i = Math.floor(rand() * total)
    if (banned.has(i) || mines[i]) continue
    mines[i] = true; placed++
  }
  return mines
}

export function mineCounts(mines: boolean[]): number[] {
  return mines.map((_, i) => around(i).filter(j => mines[j]).length)
}

/** Open a square. A zero opens its neighbours, and so on outwards. Flagged
 *  squares are never opened by the flood. */
export function openSquare(mines: boolean[], open: boolean[], flags: boolean[], i: number): boolean[] {
  if (open[i] || flags[i]) return open
  const counts = mineCounts(mines)
  const next = [...open]
  const stack = [i]
  while (stack.length) {
    const k = stack.pop()!
    if (next[k] || flags[k]) continue
    next[k] = true
    if (!mines[k] && counts[k] === 0) for (const j of around(k)) if (!next[j]) stack.push(j)
  }
  return next
}

export function minesCleared(mines: boolean[], open: boolean[]): boolean {
  return mines.length > 0 && mines.every((m, i) => m || open[i])
}
