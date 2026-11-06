// src/features/funzone/live/LiveMemoryMatch.tsx — Memory Match across two screens.
// Port of components/funzone/LiveMemoryMatch.tsx (spec 08 §5.11.4).
//
// Turns are sent whole: a player flips two cards locally and only then
// broadcasts the pair, so the opponent never watches a half-finished turn. The
// deck comes from the session seed, so both sides deal identically. A hit keeps
// the turn. Both clients post the same claim when the game ends.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { memDeck, memReplay, memCanApply, memResult, type MemTurn } from '@web/funzone/games'
import { reconcileList, sideFor, type Packet, type LiveStatus } from '@web/funzone/live'
import { funzone } from './client'
import { Foot, ScoreHead, SquareGrid, StatusBanner, useLiveChannel } from './common'
import { useTimers } from '../kit'

const PEEK_MS = 900

export interface LiveSeededProps {
  sessionId: string; seed: number; meId: string; hostId: string
  opponentName: string; onExit: () => void
}

function Card({ i, face, size, open, done, disabled, onPress }: {
  i: number; face: string; size: number; open: boolean; done: boolean; disabled: boolean; onPress: () => void
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      accessibilityLabel={open ? `Card ${i + 1}, ${face}` : `Card ${i + 1}, face down`} accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: R.md, borderWidth: 1,
        borderColor: done ? C.positive : C.line,
        backgroundColor: done ? C.positiveTint : open ? C.surface : pressed && !disabled ? C.brandTint : C.sunken,
        opacity: done ? 0.65 : 1,
      })}>
      <Txt size={26} style={{ lineHeight: 32 }}>{open ? face : ''}</Txt>
    </Pressable>
  )
}

export default function LiveMemoryMatch({ sessionId, seed, meId, hostId, opponentName, onExit }: LiveSeededProps) {
  const [turns, setTurns] = React.useState<MemTurn[]>([])
  const [status, setStatus] = React.useState<LiveStatus>('connecting')
  const [faceUp, setFaceUp] = React.useState<number[]>([])
  const [peek, setPeek] = React.useState<MemTurn | null>(null)
  const turnsRef = React.useRef<MemTurn[]>([])
  const lock = React.useRef(false)
  const timers = useTimers()

  // One deck per seed. (The website rebuilds it every render and lists it in
  // the channel effect's deps, which re-opens the channel on every render — see
  // the report. Here the channel lives as long as the session.)
  const deck = React.useMemo(() => memDeck(seed), [seed])
  const me = sideFor(meId, hostId)
  const state = memReplay(deck, turns)
  const myTurn = state.turn === me && !state.done

  /** Show a turn for a moment before it flips back — on BOTH screens. */
  const showThen = (t: MemTurn, then: () => void) => {
    setPeek(t)
    timers.after(PEEK_MS, () => { setPeek(null); then() })
  }

  const sendRef = React.useRef<(p: Packet) => void>(() => {})
  const onPacket = (p: Packet) => {
    if (p.t === 'memSync') {
      setTurns(cur => reconcileList(cur, p.turns))
      if (turnsRef.current.length > p.turns.length) {
        sendRef.current({ t: 'memSync', from: meId, turns: turnsRef.current })
      }
      return
    }
    if (p.t === 'mem') {
      const t = p.turn
      if (!memCanApply(deck, turnsRef.current, t).legal) return
      showThen(t, () => setTurns(cur => (memCanApply(deck, cur, t).legal ? [...cur, t] : cur)))
      return
    }
    if (p.t === 'leave') { setStatus('opponent_left'); return }
    if (p.t === 'rematch') { setTurns([]); setFaceUp([]); setStatus('playing'); return }
  }

  const send = useLiveChannel({
    sessionId, meId, onPacket, setStatus,
    syncPacket: () => ({ t: 'memSync', from: meId, turns: turnsRef.current }),
    hasProgress: () => turnsRef.current.length > 0,
  })
  // Refs mirror the committed state for the socket handlers (written after render, not during it).
  React.useLayoutEffect(() => { turnsRef.current = turns; sendRef.current = send })

  const saved = React.useRef(false)
  React.useEffect(() => {
    const r = memResult(deck, turns)
    if (saved.current || !r) return
    saved.current = true
    funzone('finish', {
      session: sessionId, moves: [],
      claim: { winner: r.winner, draw: r.draw, host: r.scores.HOST, guest: r.scores.GUEST },
    }).then(() => {}, () => {})
  }, [turns, deck, sessionId])

  const flip = (i: number) => {
    if (!myTurn || lock.current || status !== 'playing') return
    if (state.matched.includes(i) || faceUp.includes(i)) return
    const next = [...faceUp, i]
    if (next.length < 2) { setFaceUp(next); return }

    const t: MemTurn = { n: turns.length, by: me, a: next[0], b: next[1] }
    if (!memCanApply(deck, turns, t).legal) { setFaceUp([]); return }
    lock.current = true
    setFaceUp(next)
    send({ t: 'mem', from: meId, turn: t })
    showThen(t, () => {
      setTurns(cur => (memCanApply(deck, cur, t).legal ? [...cur, t] : cur))
      setFaceUp([]); lock.current = false
    })
  }

  const shown = new Set<number>([...state.matched, ...faceUp, ...(peek ? [peek.a, peek.b] : [])])
  const result = memResult(deck, turns)
  const them = me === 'HOST' ? 'GUEST' : 'HOST'

  return (
    <View>
      <ScoreHead me={me} opponentName={opponentName} status={status} scores={state.scores} />
      <StatusBanner status={status} />

      <SquareGrid count={deck.length} cols={4} maxWidth={360}>
        {(i, size) => {
          const open = shown.has(i)
          return (
            <Card key={i} i={i} face={deck[i]} size={size} open={open} done={state.matched.includes(i)}
              disabled={!myTurn || open || status !== 'playing'} onPress={() => flip(i)} />
          )
        }}
      </SquareGrid>

      <View style={{ marginTop: S.md, minHeight: 24 }}>
        <Txt size={F.body} w={600} center>
          {result
            ? result.draw ? `A draw, ${result.scores.HOST} each.`
              : result.winner === me ? `You won, ${state.scores[me]} pairs to ${state.scores[them]}.`
              : `${opponentName} won.`
            : status === 'playing' ? (myTurn ? 'Your turn: turn over two.' : `${opponentName}'s turn.`)
            : ''}
        </Txt>
      </View>

      <Foot ended={!!result} status={status} onExit={onExit}
        onAgain={() => { saved.current = false; setTurns([]); setFaceUp([]); send({ t: 'rematch', from: meId }) }} />
    </View>
  )
}
