// src/features/funzone/mind/logic.tsx — Code Breaker, Lights Out, Minesweeper (cat logic).
//
// Port of CodeBreaker / LightsOut / Minesweeper in components/funzone/MindGames.tsx
// and the .cb / .palette / .lo / .ms / .toggle rules of design/funzone.css.
//
// Minesweeper: the web flags on right-click; here a long-press flags (plus
// the Dig / Flag toggle). The playing status keeps the web's exact copy
// "Right-click or use flag mode to mark a mine" for parity.
import * as React from 'react'
import { Animated, Pressable, View } from 'react-native'
import {
  newCode, scoreGuess, CODE_COLOURS, CODE_LENGTH, CODE_TRIES,
  lightsPuzzle, lightsPress, lightsOut,
  layMines, mineCounts, openSquare, minesCleared, MINES_SIZE, MINES_COUNT,
} from '@web/funzone/mindgames'
import { Txt } from '@/ui/primitives'
import { DISPLAY, Hint, Key, Row, Stat, Status, useAccent, useFz, useReduceMotion, useShake } from '../kit'
import { EASE, Frame, rand, useEnter, useFit, wallClock, type Props } from './frame'

// ═════════════════════════════════════════════════════════════════════════
// CODE BREAKER
// ═════════════════════════════════════════════════════════════════════════

const PEG_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange']
/** design/funzone.css `[data-c="0…5"]`. */
const PEG_COLOURS = ['#EF4444', '#3B82F6', '#22C55E', '#FACC15', '#A855F7', '#F97316']

type CodeRow = { pegs: number[]; exact: number; near: number }

/** A filled `.peg` — pops in (fz-mark .25 s) when it is placed. */
function FilledPeg({ c }: { c: number }) {
  const v = useEnter(250, EASE)
  return (
    <Animated.View accessibilityLabel={PEG_NAMES[c]} style={{
      width: 30, height: 30, borderRadius: 15, backgroundColor: PEG_COLOURS[c], boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.25)',
      opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) }],
    }} />
  )
}

function Peg({ c }: { c?: number }) {
  const fz = useFz()
  if (c === undefined) return <View accessibilityLabel="empty" style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderStyle: 'dashed', borderColor: fz.C.line }} />
  return <FilledPeg key={c} c={c} />
}

function Pegs({ pegs }: { pegs: (number | undefined)[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {pegs.map((c, k) => <Peg key={k} c={c} />)}
    </View>
  )
}

/** `.keys` — 2 × 2: ● exact, ○ near, then empty. */
function KeyDots({ row }: { row?: CodeRow }) {
  const fz = useFz()
  return (
    <View accessibilityLabel={row ? `${row.exact} exact, ${row.near} near` : undefined}
      style={{ width: 52, flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', alignContent: 'center' }}>
      <View style={{ width: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {row && Array.from({ length: CODE_LENGTH }, (_, k) => {
          const x = k < row.exact, n = !x && k < row.exact + row.near
          return <View key={k} style={{
            width: 10, height: 10, borderRadius: 5,
            borderWidth: n ? 2.5 : 1.5, borderColor: x || n ? fz.C.ink : fz.C.muted, backgroundColor: x ? fz.C.ink : 'transparent',
          }} />
        })}
      </View>
    </View>
  )
}

/** `.cb-row` — number | four pegs | key dots; `now` is the row being entered. */
function GuessRow({ i, row, live, cur }: { i: number; row?: CodeRow; live: boolean; cur: number[] }) {
  const fz = useFz()
  const ac = useAccent()
  const pegs = row ? row.pegs : live ? cur : []
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12,
      backgroundColor: live ? ac.tint : fz.C.sunken, borderWidth: 1.5, borderColor: live ? ac.a : 'transparent',
    }}>
      <Txt size={11} w={700} tone="muted" style={{ width: 26 }}>{i + 1}</Txt>
      <View style={{ flex: 1 }}><Pegs pegs={Array.from({ length: CODE_LENGTH }, (_, k) => pegs[k])} /></View>
      <KeyDots row={row} />
    </View>
  )
}

function PaletteBtn({ c, disabled, onPress }: { c: number; disabled: boolean; onPress: () => void }) {
  const fz = useFz()
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={PEG_NAMES[c]} accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: 44, height: 44, borderRadius: 22, backgroundColor: PEG_COLOURS[c], opacity: disabled ? 0.4 : 1,
        boxShadow: `inset 0 -4px 0 rgba(0,0,0,0.25), 0 3px 0 ${fz.keycap}`, transform: [{ translateY: pressed && !disabled ? 2 : 0 }],
      })} />
  )
}

export function CodeBreaker({ onBack }: Props) {
  const [code, setCode] = React.useState<number[]>(() => newCode(rand))
  const [rows, setRows] = React.useState<CodeRow[]>([])
  const [cur, setCur] = React.useState<number[]>([])
  const [round, setRound] = React.useState(1)
  const won = rows.some(r => r.exact === CODE_LENGTH)
  const lost = !won && rows.length >= CODE_TRIES
  const over = won || lost

  const add = (c: number) => { if (!over && cur.length < CODE_LENGTH) setCur([...cur, c]) }
  const undo = () => setCur(cur.slice(0, -1))
  const submit = () => {
    if (over || cur.length !== CODE_LENGTH) return
    setRows([...rows, { pegs: cur, ...scoreGuess(code, cur) }]); setCur([])
  }
  const restart = () => { setCode(newCode(rand)); setRows([]); setCur([]); setRound(r => r + 1) }
  const fz = useFz()

  return (
    <Frame code="codebreak" onBack={onBack} confetti={won ? round : 0}
      aside={<Stat label="tries left" value={CODE_TRIES - rows.length} hot bump />}>
      <Status text={won ? `Cracked in ${rows.length} ${rows.length === 1 ? 'try' : 'tries'}` : lost ? 'Out of tries' : `Guess ${rows.length + 1} of ${CODE_TRIES}`}
        tone={won ? 'win' : lost ? 'lose' : undefined} />
      {over && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: fz.C.sunken, width: '100%', maxWidth: 360 }}>
          <Txt size={11} w={700} tone="muted">Code</Txt>
          <Pegs pegs={code} />
        </View>
      )}
      <View style={{ gap: 6, width: '100%', maxWidth: 360 }}>
        {Array.from({ length: CODE_TRIES }, (_, i) => (
          <GuessRow key={i} i={i} row={rows[i]} cur={cur} live={i === rows.length && !over} />
        ))}
      </View>
      {!over && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
            {Array.from({ length: CODE_COLOURS }, (_, c) => (
              <PaletteBtn key={c} c={c} disabled={cur.length >= CODE_LENGTH} onPress={() => add(c)} />
            ))}
          </View>
          <Row>
            <Key title="Undo" soft size="sm" onPress={undo} disabled={!cur.length} />
            <Key title="Check guess" onPress={submit} disabled={cur.length !== CODE_LENGTH} />
          </Row>
        </>
      )}
      {over && <Key title="New code" onPress={restart} />}
      <Hint>● right colour, right place · ○ right colour, wrong place. Colours can repeat.</Hint>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// LIGHTS OUT
// ═════════════════════════════════════════════════════════════════════════

/** design/funzone.css `.lo button` (off) and `.lo button.on`. */
const LIGHT_OFF = '#2A2650'
const LIGHT_ON = '#FDE047'
const LIGHT_ON_EDGE = '#CA8A04'
const LIGHT_GLOW = 'rgba(253,224,71,0.65)'

function LightCell({ i, on, size, disabled, onPress }: { i: number; on: boolean; size: number; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      accessibilityLabel={`Light ${i + 1}, ${on ? 'on' : 'off'}`} accessibilityState={{ disabled, checked: on }}
      style={({ pressed }) => ({
        width: size, height: size, borderRadius: 12, backgroundColor: on ? LIGHT_ON : LIGHT_OFF,
        boxShadow: on ? `inset 0 -4px 0 ${LIGHT_ON_EDGE}, 0 0 18px ${LIGHT_GLOW}` : 'inset 0 -4px 0 rgba(0,0,0,0.35)',
        transform: [{ scale: pressed && !disabled ? 0.92 : 1 }],
      })} />
  )
}

export function LightsOut({ onBack }: Props) {
  const fz = useFz()
  const { mobile, room } = useFit()
  const [board, setBoard] = React.useState<boolean[]>(() => lightsPuzzle(rand))
  const [start, setStart] = React.useState<boolean[]>(board)
  const [moves, setMoves] = React.useState(0)
  const [round, setRound] = React.useState(1)
  const done = lightsOut(board)
  const lit = board.filter(Boolean).length

  const press = (i: number) => { if (!done) { setBoard(lightsPress(board, i)); setMoves(m => m + 1) } }
  const fresh = () => { const b = lightsPuzzle(rand); setBoard(b); setStart(b); setMoves(0); setRound(r => r + 1) }
  const retry = () => { setBoard(start); setMoves(0) }

  // .lo: 5 × --l (58, mobile 50), gap 8 (mobile 6), padding 12.
  const gap = mobile ? 6 : 8
  const cell = mobile ? Math.min(50, Math.floor((room - 24 - gap * 4) / 5)) : 58
  return (
    <Frame code="lights" onBack={onBack} confetti={done ? round : 0}
      aside={<><Stat label="lit" value={lit} hot bump /><Stat label="moves" value={moves} /></>}>
      <Status text={done ? `Lights out in ${moves} moves` : `${lit} ${lit === 1 ? 'light' : 'lights'} still on`} tone={done ? 'win' : undefined} />
      <View style={{ width: cell * 5 + gap * 4 + 24, flexDirection: 'row', flexWrap: 'wrap', gap, padding: 12, borderRadius: 18, backgroundColor: fz.stage }}>
        {board.map((on, i) => <LightCell key={i} i={i} on={on} size={cell} disabled={done} onPress={() => press(i)} />)}
      </View>
      <Row>
        <Key title="Restart this one" soft onPress={retry} disabled={!moves} />
        <Key title="New puzzle" onPress={fresh} />
      </Row>
    </Frame>
  )
}

// ═════════════════════════════════════════════════════════════════════════
// MINESWEEPER
// ═════════════════════════════════════════════════════════════════════════

const CELLS = MINES_SIZE * MINES_SIZE
/** design/funzone.css `.ms button` states and `[data-n]` number colours. */
const MS_HIDDEN = '#3F3A78'
const MS_OPEN = '#EFEBFA'
const MS_BOOM = '#DC2626'
const MS_MINE = '#FECACA'
const MS_N: Record<number, string> = { 1: '#1D4ED8', 2: '#15803D', 3: '#B91C1C', 4: '#6D28D9', 5: '#9A3412', 6: '#0E7490', 7: '#1E1B4B', 8: '#1E1B4B' }

function MineCell({ i, size, isOpen, n, flagged, mine, boom, disabled, onPress, onLongPress }: {
  i: number; size: number; isOpen: boolean; n: number; flagged: boolean; mine: boolean; boom: boolean; disabled: boolean
  onPress: () => void; onLongPress: () => void
}) {
  const calm = useReduceMotion()
  const s = React.useState(() => new Animated.Value(1))[0]
  React.useEffect(() => {
    // fz-open: an opened square grows in from .7 (.2 s).
    if (!isOpen || calm) return
    s.setValue(0.7)
    Animated.timing(s, { toValue: 1, duration: 200, useNativeDriver: true }).start()
  }, [isOpen, calm, s])
  const label = isOpen ? (n ? String(n) : '') : mine ? '💣' : flagged ? '🚩' : ''
  const bg = mine ? (boom ? MS_BOOM : MS_MINE) : isOpen ? MS_OPEN : MS_HIDDEN
  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled}
        accessibilityRole="button" accessibilityState={{ disabled }}
        accessibilityLabel={`Row ${Math.floor(i / MINES_SIZE) + 1}, column ${i % MINES_SIZE + 1}: ${isOpen ? (n ? `${n} nearby` : 'clear') : flagged ? 'flagged' : 'hidden'}`}
        style={{
          width: size, height: size, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: bg,
          boxShadow: isOpen ? undefined : 'inset 0 -3px 0 rgba(0,0,0,0.35)',
        }}>
        {!!label && <Txt size={17} w={800} color={isOpen && n ? MS_N[n] : '#fff'} style={{ fontFamily: DISPLAY, lineHeight: 21 }}>{label}</Txt>}
      </Pressable>
    </Animated.View>
  )
}

/** `.toggle` — the Tap action switch (⛏ Dig / 🚩 Flag). */
function TapToggle({ flagMode, onPick }: { flagMode: boolean; onPick: (flag: boolean) => void }) {
  const fz = useFz()
  const ac = useAccent()
  const opt = (flag: boolean, text: string) => {
    const on = flagMode === flag
    return (
      <Pressable onPress={() => onPick(flag)} accessibilityRole="button" accessibilityState={{ selected: on }}
        style={{ minHeight: 40, justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 16, borderRadius: 99, backgroundColor: on ? ac.solid : 'transparent' }}>
        <Txt size={13} w={700} color={on ? '#fff' : fz.C.inkSoft}>{text}</Txt>
      </Pressable>
    )
  }
  return (
    <View accessibilityLabel="Tap action" style={{ flexDirection: 'row', padding: 3, borderRadius: 99, backgroundColor: fz.C.sunken, borderWidth: 1.5, borderColor: fz.edge }}>
      {opt(false, '⛏ Dig')}
      {opt(true, '🚩 Flag')}
    </View>
  )
}

export function Minesweeper({ onBack }: Props) {
  const fz = useFz()
  const { mobile, room } = useFit()
  const [mines, setMines] = React.useState<boolean[]>([])
  const [open, setOpen] = React.useState<boolean[]>(() => Array(CELLS).fill(false))
  const [flags, setFlags] = React.useState<boolean[]>(() => Array(CELLS).fill(false))
  const [boom, setBoom] = React.useState<number | null>(null)
  const [flagMode, setFlagMode] = React.useState(false)
  const [started, setStarted] = React.useState<number | null>(null)
  const [now, setNow] = React.useState(0)
  const [round, setRound] = React.useState(1)
  const shake = useShake(boom !== null ? `${round}-${boom}` : 0)

  const counts = mines.length ? mineCounts(mines) : []
  const won = mines.length > 0 && boom === null && minesCleared(mines, open)
  const over = won || boom !== null
  const flagged = flags.filter(Boolean).length

  React.useEffect(() => {
    if (started === null || over) return
    const t = setInterval(() => setNow(wallClock()), 500)
    return () => clearInterval(t)
  }, [started, over])
  // `now` ticks every 500 ms while playing and is stamped at the first dig and at the end.
  const secs = started === null ? 0 : Math.max(0, Math.floor((now - started) / 1000))

  const flag = (i: number) => {
    if (over || open[i]) return
    const f = [...flags]; f[i] = !f[i]; setFlags(f)
  }
  const dig = (i: number) => {
    if (over || flags[i] || open[i]) return
    let m = mines
    if (!m.length) { m = layMines(i, rand); setMines(m); setStarted(wallClock()); setNow(wallClock()) }
    if (m[i]) { setBoom(i); setNow(wallClock()); return }
    const o = openSquare(m, open, flags, i)
    setOpen(o)
    if (minesCleared(m, o)) setNow(wallClock())
  }
  const tap = (i: number) => (flagMode ? flag(i) : dig(i))
  const restart = () => {
    setMines([]); setOpen(Array(CELLS).fill(false)); setFlags(Array(CELLS).fill(false))
    setBoom(null); setStarted(null); setRound(r => r + 1)
  }

  // .ms: 9 × --m (36; mobile (100vw - 90px) / 9 with gap 2), padding 8 — fitted to the stage.
  const gap = mobile ? 2 : 3
  const cell = mobile ? Math.min(36, Math.floor((room - 16 - gap * 8) / 9)) : 36
  return (
    <Frame code="mines" onBack={onBack} confetti={won ? round : 0}
      aside={<><Stat label="mines left" value={MINES_COUNT - flagged} hot /><Stat label="seconds" value={secs} /></>}>
      <Status text={won ? `Field cleared in ${secs} s` : boom !== null ? 'Boom. That one was a mine.' : mines.length ? 'Right-click or use flag mode to mark a mine' : 'Tap anywhere to start. The first square is always safe'}
        tone={won ? 'win' : boom !== null ? 'lose' : undefined} />
      <TapToggle flagMode={flagMode} onPick={setFlagMode} />
      <Animated.View style={[{ width: cell * 9 + gap * 8 + 16, flexDirection: 'row', flexWrap: 'wrap', gap, padding: 8, borderRadius: 14, backgroundColor: fz.stage }, shake]}>
        {Array.from({ length: CELLS }, (_, i) => {
          const isOpen = open[i]
          return (
            <MineCell key={`${round}-${i}`} i={i} size={cell} isOpen={isOpen} n={counts[i] ?? 0} flagged={flags[i]}
              mine={boom !== null && mines[i]} boom={i === boom} disabled={over && !isOpen}
              onPress={() => tap(i)} onLongPress={() => flag(i)} />
          )
        })}
      </Animated.View>
      <Key title="New field" onPress={restart} />
    </Frame>
  )
}
