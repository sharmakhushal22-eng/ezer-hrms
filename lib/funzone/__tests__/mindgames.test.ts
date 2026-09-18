// The ten solo games. Same approach as funzone.test.ts: randomness is pinned,
// so every assertion describes exactly one board.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIND_GAMES, mindGameByCode,
  slideTiles, spawnTile, newTiles, tilesStuck, tilesWon,
  echoExtend, echoCheck,
  scramble, normaliseWord, SCRAMBLE_WORDS,
  slideMove, slideShuffle, slideSolved, SLIDE_SOLVED,
  makeSum, clashCard, CLASH_COLOURS,
  scoreGuess, newCode, CODE_LENGTH, CODE_COLOURS,
  lightsPress, lightsPuzzle, lightsOut,
  layMines, around, mineCounts, openSquare, minesCleared, MINES_COUNT,
} from '../mindgames.ts'
import { rng } from '../games.ts'

const seeded = (s: number) => rng(s)

test('the catalogue has ten games with unique codes', () => {
  assert.equal(MIND_GAMES.length, 10)
  assert.equal(new Set(MIND_GAMES.map(g => g.code)).size, 10)
  assert.equal(mindGameByCode('mines')?.name, 'Minesweeper')
  assert.equal(mindGameByCode('ttt'), null)
})

test('2048: a tile merges once per move', () => {
  const g = [2, 2, 2, 2,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0]
  const r = slideTiles(g, 'left')
  assert.deepEqual(r.grid.slice(0, 4), [4, 4, 0, 0])
  assert.equal(r.gained, 8)
  assert.equal(r.moved, true)
})

test('2048: directions', () => {
  const g = [2, 0, 0, 2,  0, 0, 0, 0,  0, 0, 0, 0,  2, 0, 0, 0]
  assert.deepEqual(slideTiles(g, 'right').grid.slice(0, 4), [0, 0, 0, 4])
  const up = slideTiles(g, 'up').grid
  assert.equal(up[0], 4); assert.equal(up[12], 0)
  const down = slideTiles(g, 'down').grid
  assert.equal(down[12], 4); assert.equal(down[15], 2)
})

test('2048: a move that changes nothing is not a move', () => {
  const g = [2, 4, 0, 0, ...Array(12).fill(0)]
  assert.equal(slideTiles(g, 'left').moved, false)
})

test('2048: spawn, stuck and won', () => {
  const g = newTiles(seeded(1))
  assert.equal(g.filter(v => v > 0).length, 2)
  const full = [2, 4, 2, 4,  4, 2, 4, 2,  2, 4, 2, 4,  4, 2, 4, 2]
  assert.equal(tilesStuck(full), true)
  assert.equal(spawnTile(full, seeded(1)).at, -1)
  assert.equal(tilesWon([2048, ...Array(15).fill(0)]), true)
})

test('echo: extend and check', () => {
  const s = echoExtend(echoExtend([], seeded(3)), seeded(4))
  assert.equal(s.length, 2)
  assert.equal(echoCheck(s, 0, s[0]), 'next')
  assert.equal(echoCheck(s, 1, s[1]), 'round')
  assert.equal(echoCheck(s, 0, (s[0] + 1) % 4), 'miss')
})

test('scramble never returns the word itself', () => {
  for (let k = 0; k < 200; k++) {
    for (const { word } of SCRAMBLE_WORDS) {
      const s = scramble(word, seeded(k))
      assert.notEqual(s, word)
      assert.equal([...s].sort().join(''), [...word].sort().join(''))
    }
  }
  assert.equal(normaliseWord(' pay-roll '), 'PAYROLL')
})

test('slide puzzle: shuffles are solvable and never solved', () => {
  const inversions = (t: number[]) => {
    const a = t.filter(v => v), n = a.length; let c = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (a[i] > a[j]) c++
    return c
  }
  for (let k = 0; k < 100; k++) {
    const t = slideShuffle(seeded(k))
    assert.equal(slideSolved(t), false)
    assert.equal(inversions(t) % 2, 0)   // 3×3: solvable iff even
  }
  assert.deepEqual(slideMove(SLIDE_SOLVED, 0), SLIDE_SOLVED) // not next to the gap
  assert.equal(slideMove(SLIDE_SOLVED, 7)[8], 8)
})

test('math sprint: answers are right and never negative', () => {
  const r = seeded(9)
  for (let k = 0; k < 500; k++) {
    const s = makeSum(k % 20, r)
    const [a, op, b] = s.text.split(' ')
    const x = Number(a), y = Number(b)
    const want = op === '+' ? x + y : op === '−' ? x - y : x * y
    assert.equal(s.answer, want)
    assert.ok(s.answer >= 0)
  }
})

test('colour clash: indices in range, mostly mismatched', () => {
  const r = seeded(5); let mismatch = 0
  for (let k = 0; k < 1000; k++) {
    const c = clashCard(r)
    assert.ok(c.word >= 0 && c.word < CLASH_COLOURS.length)
    assert.ok(c.ink >= 0 && c.ink < CLASH_COLOURS.length)
    if (c.word !== c.ink) mismatch++
  }
  assert.ok(mismatch > 650 && mismatch < 850)
})

test('code breaker: repeats are counted once', () => {
  assert.deepEqual(scoreGuess([0, 0, 1, 1], [0, 1, 1, 1]), { exact: 3, near: 0 })
  assert.deepEqual(scoreGuess([0, 1, 2, 3], [3, 2, 1, 0]), { exact: 0, near: 4 })
  assert.deepEqual(scoreGuess([0, 0, 0, 1], [1, 1, 0, 0]), { exact: 1, near: 2 })
  const c = newCode(seeded(2))
  assert.equal(c.length, CODE_LENGTH)
  assert.ok(c.every(v => v >= 0 && v < CODE_COLOURS))
})

test('lights out: pressing twice undoes, puzzles are lit', () => {
  const b = Array(25).fill(false)
  assert.deepEqual(lightsPress(lightsPress(b, 6), 6), b)
  assert.equal(lightsPress(b, 0).filter(Boolean).length, 3)   // corner
  assert.equal(lightsPress(b, 12).filter(Boolean).length, 5)  // centre
  for (let k = 0; k < 50; k++) assert.equal(lightsOut(lightsPuzzle(seeded(k))), false)
})

test('minesweeper: first tap is always safe ground', () => {
  for (let k = 0; k < 100; k++) {
    const first = k % 81
    const mines = layMines(first, seeded(k))
    assert.equal(mines.filter(Boolean).length, MINES_COUNT)
    assert.equal(mines[first], false)
    for (const j of around(first)) assert.equal(mines[j], false)
    assert.equal(mineCounts(mines)[first], 0)
    const open = openSquare(mines, Array(81).fill(false), Array(81).fill(false), first)
    assert.ok(open.filter(Boolean).length > 1)
    assert.ok(open.every((o, i) => !o || !mines[i]))
  }
})

test('minesweeper: cleared when every safe square is open', () => {
  const mines = Array(81).fill(false); mines[0] = true
  const open = mines.map(m => !m)
  assert.equal(minesCleared(mines, open), true)
  open[80] = false
  assert.equal(minesCleared(mines, open), false)
})
