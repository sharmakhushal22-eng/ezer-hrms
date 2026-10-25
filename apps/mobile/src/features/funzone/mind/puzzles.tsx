// src/features/funzone/mind/puzzles.tsx — 2048 and Slide Puzzle (cat puzzle).
//
// Port of Tiles / SlidePuzzle in components/funzone/MindGames.tsx and the
// .t48 / .dpad / .slide rules of design/funzone.css. Rules are imported from
// lib/funzone/mindgames.ts unchanged.
//
// Phone input for 2048: a swipe on the board (24 px threshold on the larger
// axis, direction = dominant axis sign — the web's pointerdown/up rule) and the
// D-pad. The web's arrow-key / WASD listener has no phone equivalent.
import * as React from 'react'
import { Animated, PanResponder, Pressable, View } from 'react-native'
import {
  newTiles, slideTiles, spawnTile, tilesStuck, tilesWon, TILES_GOAL, type Dir,
  slideShuffle, slideMove, slideSolved, slideAdjacent,
} from '@web/funzone/mindgames'
import { Txt } from '@/ui/primitives'
import { alpha, DISPLAY, Key, Row, Stat, Status, useAccent, useFz, useFzScroll, useReduceMotion } from '../kit'
import { EASE, EASE_OUT, Frame, rand, useFit, type Props } from './frame'

// ═════════════════════════════════════════════════════════════════════════
// 2048
// ═════════════════════════════════════════════════════════════════════════

/** design/funzone.css `.t48 [data-v]` — tile fill / number colour / font size. */
const T48: Record<number, { bg: string; fg: string; fs?: number; glow?: string }> = {
  2:    { bg: '#EDE9FE', fg: '#4C1D95' },
  4:    { bg: '#DDD6FE', fg: '#4C1D95' },
  8:    { bg: '#FDBA74', fg: '#7C2D12' },
  16:   { bg: '#FB923C', fg: '#fff' },
  32:   { bg: '#F97316', fg: '#fff' },
  64:   { bg: '#EA580C', fg: '#fff' },
  128:  { bg: '#FCD34D', fg: '#78350F', fs: 24 },
  256:  { bg: '#FBBF24', fg: '#78350F', fs: 24 },
  512:  { bg: '#F59E0B', fg: '#fff', fs: 24 },
  1024: { bg: '#8B5CF6', fg: '#fff', fs: 20 },
  2048: { bg: '#EC4899', fg: '#fff', fs: 20, glow: '0 0 24px #EC4899' },
}
/** `[data-big]` — anything past 2048. */
const T48_BIG: { bg: string; fg: string; fs?: number; glow?: string } = { bg: '#14B8A6', fg: '#fff', fs: 18 }
/** Empty square on the dark stage, and the default number. */
const T48_EMPTY = 'rgba(255,255,255,0.07)'
const T48_FS = 28

function T48Cell({ v, size, anim }: { v: number; size: number; anim: 'new' | 'merged' | null }) {
  const calm = useReduceMotion()
  const a = React.useState(() => new Animated.Value(anim ? 0 : 1))[0]
  React.useEffect(() => {
    if (!anim) return
    if (calm) { a.setValue(1); return }
    // fz-mark (.25 s) for a fresh tile, fz-merge (.24 s, 1.12 at the middle) for a merge.
    Animated.timing(a, { toValue: 1, duration: anim === 'new' ? 250 : 240, easing: EASE, useNativeDriver: true }).start()
  }, [a, anim, calm])
  const look = v > TILES_GOAL ? T48_BIG : T48[v]
  const transform = anim === 'new'
    ? [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }, { rotate: a.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) }]
    : anim === 'merged'
      ? [{ scale: a.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.12, 1] }) }]
      : []
  return (
    <Animated.View accessibilityLabel={v ? String(v) : 'empty'}
      style={{
        width: size, height: size, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: v ? look?.bg ?? T48_EMPTY : T48_EMPTY, boxShadow: look?.glow,
        opacity: anim === 'new' ? a : 1, transform,
      }}>
      {!!v && <Txt size={look?.fs ?? T48_FS} w={800} color={look?.fg ?? '#fff'} style={{ fontFamily: DISPLAY, lineHeight: (look?.fs ?? T48_FS) * 1.15 }}>{v}</Txt>}
    </Animated.View>
  )
}

function DKey({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  return <Key title={glyph} label={label} soft size="sm" onPress={onPress} style={{ width: 44, height: 44, minHeight: 44, paddingVertical: 0, paddingHorizontal: 0 }} />
}

/** `.dpad` — ▲ over ◀ ▼ ▶ (soft sm keys). */
function DPad({ move }: { move: (d: Dir) => void }) {
  return (
    <View accessibilityLabel="Move" style={{ gap: 6, alignItems: 'center' }}>
      <View style={{ height: 48 }}><DKey glyph="▲" label="Up" onPress={() => move('up')} /></View>
      <View style={{ flexDirection: 'row', gap: 6, height: 48 }}>
        <DKey glyph="◀" label="Left" onPress={() => move('left')} />
        <DKey glyph="▼" label="Down" onPress={() => move('down')} />
        <DKey glyph="▶" label="Right" onPress={() => move('right')} />
      </View>
    </View>
  )
}

const SWIPE_MIN = 24
/** `.t48 { user-select: none }` — a drag on the web build must not select the numbers. */
const NO_SELECT = { userSelect: 'none' } as object

export function Tiles({ onBack }: Props) {
  const fz = useFz()
  const { mobile, room } = useFit()
  const { setScrollEnabled } = useFzScroll()
  const [grid, setGrid] = React.useState<number[]>(() => newTiles(rand))
  const [score, setScore] = React.useState(0)
  const [best, setBest] = React.useState(0)
  const [fresh, setFresh] = React.useState<number>(-1)
  const [merged, setMerged] = React.useState<number[]>([])
  const [stamp, setStamp] = React.useState(0)
  const [keepGoing, setKeepGoing] = React.useState(false)
  const [round, setRound] = React.useState(1)

  const won = tilesWon(grid) && !keepGoing
  const stuck = tilesStuck(grid)

  const move = React.useCallback((dir: Dir) => {
    if (tilesStuck(grid) || (tilesWon(grid) && !keepGoing)) return
    const r = slideTiles(grid, dir)
    if (!r.moved) return
    const s = spawnTile(r.grid, rand)
    const nx = score + r.gained
    setGrid(s.grid); setFresh(s.at); setMerged(r.merged); setStamp(n => n + 1)
    setScore(nx); setBest(b => Math.max(b, nx))
  }, [grid, score, keepGoing])

  // The responder is made once; the refs always hold the latest move() and scroll switch.
  const moveRef = React.useRef(move)
  const scrollRef = React.useRef(setScrollEnabled)
  React.useEffect(() => { moveRef.current = move; scrollRef.current = setScrollEnabled })
  // eslint-disable-next-line react-hooks/refs -- the refs are read inside gesture handlers, never during render
  const [pan] = React.useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => { scrollRef.current(false); return true },
    onPanResponderRelease: (_e, g) => {
      scrollRef.current(true)
      const dx = g.dx, dy = g.dy
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return
      moveRef.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
    },
    onPanResponderTerminate: () => { scrollRef.current(true) },
  }))
  React.useEffect(() => () => { scrollRef.current(true) }, [])

  const restart = () => {
    setGrid(newTiles(rand)); setScore(0); setFresh(-1); setMerged([]); setKeepGoing(false); setRound(r => r + 1)
  }

  // .t48: 4 × --t (76, mobile 64) with 10 / 8 gap and 10 padding — shrunk to fit a narrow phone.
  const gap = mobile ? 8 : 10
  const tile = mobile ? Math.min(64, Math.floor((room - 20 - gap * 3) / 4)) : 76
  const top = Math.max(...grid)
  return (
    <Frame code="tiles" onBack={onBack} confetti={won ? round : 0}
      aside={<><Stat label="score" value={score} hot bump /><Stat label="best" value={best} /></>}>
      <Status text={won ? `You made ${TILES_GOAL}!` : stuck ? `No moves left. Top tile ${top}` : `Top tile ${top}`}
        tone={won ? 'win' : stuck ? 'lose' : undefined} />
      <View {...pan.panHandlers} accessibilityLabel="2048 board"
        style={{ width: tile * 4 + gap * 3 + 20, flexDirection: 'row', flexWrap: 'wrap', gap, padding: 10, borderRadius: 18, backgroundColor: fz.stage, ...NO_SELECT }}>
        {grid.map((v, i) => {
          const hit = v > 0 && (i === fresh || merged.includes(i))
          return <T48Cell key={`${i}-${v}-${hit ? stamp : 0}`} v={v} size={tile}
            anim={v > 0 && i === fresh ? 'new' : merged.includes(i) ? 'merged' : null} />
        })}
      </View>
      <Row>
        <DPad move={move} />
        <View style={{ gap: 10, alignItems: 'stretch' }}>
          {won && <Key title="Keep going" soft onPress={() => setKeepGoing(true)} />}
          <Key title="New game" onPress={restart} />
        </View>
      </Row>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// SLIDE PUZZLE
// ═════════════════════════════════════════════════════════════════════════

/** `.slide-t` — absolutely placed, glides .18 s to its new square. */
function SlideTile({ v, at, s, home, disabled, onPress }: {
  v: number; at: number; s: number; home: boolean; disabled: boolean; onPress: () => void
}) {
  const ac = useAccent()
  const calm = useReduceMotion()
  const x = at % 3, y = Math.floor(at / 3)
  const pos = React.useState(() => new Animated.ValueXY({ x: x * s + 14, y: y * s + 14 }))[0]
  React.useEffect(() => {
    const to = { x: x * s + 14, y: y * s + 14 }
    if (calm) { pos.setValue(to); return }
    Animated.timing(pos, { toValue: to, duration: 180, easing: EASE_OUT, useNativeDriver: true }).start()
  }, [pos, x, y, s, calm])
  return (
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: pos.getTranslateTransform() }}>
      <Pressable onPress={onPress} disabled={disabled}
        accessibilityRole="button" accessibilityLabel={`Tile ${v}${home ? ', in place' : ''}`} accessibilityState={{ disabled }}
        style={{
          width: s - 8, height: s - 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
          backgroundColor: home ? ac.solid : ac.tint,
          boxShadow: home ? 'inset 0 -5px 0 rgba(0,0,0,0.22)' : `inset 0 -5px 0 ${alpha(ac.a, 0.45)}`,
        }}>
        <Txt size={36} w={800} color={home ? '#fff' : ac.ink} style={{ fontFamily: DISPLAY, lineHeight: 42 }}>{v}</Txt>
      </Pressable>
    </Animated.View>
  )
}

export function SlidePuzzle({ onBack }: Props) {
  const fz = useFz()
  const { mobile, room } = useFit()
  const [tiles, setTiles] = React.useState<number[]>(() => slideShuffle(rand))
  const [moves, setMoves] = React.useState(0)
  const [best, setBest] = React.useState<number | null>(null)
  const [round, setRound] = React.useState(1)
  const solved = slideSolved(tiles)

  const tap = (i: number) => {
    if (solved) return
    const next = slideMove(tiles, i)
    if (next === tiles) return
    setTiles(next)
    const m = moves + 1
    setMoves(m)
    if (slideSolved(next)) setBest(b => (b === null ? m : Math.min(b, m)))
  }
  const restart = () => { setTiles(slideShuffle(rand)); setMoves(0); setRound(r => r + 1) }
  const gap = tiles.indexOf(0)
  // --s: 96 (mobile 84); the board is 3 × s + 20.
  const s = mobile ? Math.min(84, Math.floor((room - 20) / 3)) : 96

  // Tiles are rendered in VALUE order so each keeps its view and glides.
  return (
    <Frame code="slide" onBack={onBack} confetti={solved ? round : 0}
      aside={<><Stat label="moves" value={moves} hot bump /><Stat label="best" value={best ?? '-'} /></>}>
      <Status text={solved ? `Solved in ${moves} moves` : 'Tiles next to the gap can move'} tone={solved ? 'win' : undefined} />
      <View accessibilityLabel="Slide puzzle" style={{ width: s * 3 + 20, height: s * 3 + 20, borderRadius: 18, backgroundColor: fz.stage }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(v => {
          const at = tiles.indexOf(v)
          return <SlideTile key={v} v={v} at={at} s={s} home={at === v - 1}
            disabled={solved || !slideAdjacent(at, gap)} onPress={() => tap(at)} />
        })}
      </View>
      <Key title="Shuffle" onPress={restart} />
    </Frame>
  )
}
