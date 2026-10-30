// src/features/funzone/live/LiveTicTacToe.tsx — Tic-Tac-Toe across two screens.
// Port of components/funzone/LiveTicTacToe.tsx (spec 08 §5.11.3).
//
// Supabase Realtime broadcast, one channel per session, no server in the loop
// while playing: every packet from the other screen is validated against the
// pure rules in lib/funzone/games.ts before it is applied. The result is
// persisted once, server-side, from the move list.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { boardFrom, outcome, canApply, resultOf, type Move, type Mark, type Board } from '@web/funzone/games'
import { reconcile, markFor, type Packet, type LiveStatus } from '@web/funzone/live'
import { funzone } from './client'
import { Foot, LiveHead, SquareGrid, StatusBanner, useLiveChannel } from './common'

export interface LiveTicTacToeProps {
  sessionId: string
  meId: string
  hostId: string
  opponentName: string
  onExit: () => void
}

function Square({ i, c, size, winning, open, onPress }: {
  i: number; c: Board[number]; size: number; winning: boolean; open: boolean; onPress: () => void
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={!open} accessibilityRole="button"
      accessibilityLabel={c ? `Square ${i + 1}, ${c}` : `Square ${i + 1}, empty`} accessibilityState={{ disabled: !open }}
      style={({ pressed }) => ({
        width: size, height: size, alignItems: 'center', justifyContent: 'center', borderRadius: R.md, borderWidth: 1,
        borderColor: winning ? C.positive : C.line,
        backgroundColor: winning ? C.positiveTint : pressed && open ? C.brandTint : C.surface,
      })}>
      <Txt size={34} w={700} color={c === 'X' ? C.brand : C.critical} style={{ lineHeight: 40 }}>{c}</Txt>
    </Pressable>
  )
}

export default function LiveTicTacToe({ sessionId, meId, hostId, opponentName, onExit }: LiveTicTacToeProps) {
  const { C } = useTheme()
  const [moves, setMoves] = React.useState<Move[]>([])
  const [status, setStatus] = React.useState<LiveStatus>('connecting')
  const [rejected, setRejected] = React.useState<string | null>(null)
  const movesRef = React.useRef<Move[]>([])

  const me: Mark = markFor(meId, hostId)
  const board = boardFrom(moves)
  const state = outcome(board)
  const myTurn = state.kind === 'playing' && state.turn === me

  const sendRef = React.useRef<(p: Packet) => void>(() => {})
  const onPacket = (p: Packet) => {
    if (p.t === 'sync') {
      setMoves(cur => reconcile(cur, p.moves))
      // Answer with ours, so whoever is behind catches up. Only when we
      // actually have more — otherwise two fresh clients ping-pong forever.
      if (movesRef.current.length > p.moves.length) {
        sendRef.current({ t: 'sync', from: meId, moves: movesRef.current })
      }
      return
    }
    if (p.t === 'move') {
      setMoves(cur => {
        const v = canApply(cur, p.move)
        if (!v.legal) {
          // Not applied. Usually a duplicate after a reconnect; anything else
          // is worth showing rather than hiding.
          setRejected(v.because)
          return cur
        }
        setRejected(null)
        return [...cur, p.move]
      })
      return
    }
    if (p.t === 'leave') { setStatus('opponent_left'); return }
    if (p.t === 'rematch') { setMoves([]); setStatus('playing'); return }
  }

  const send = useLiveChannel({
    sessionId, meId, onPacket, setStatus,
    syncPacket: () => ({ t: 'sync', from: meId, moves: movesRef.current }),
    hasProgress: () => movesRef.current.length > 0,
  })
  // Refs mirror the committed state for the socket handlers (written after render, not during it).
  React.useLayoutEffect(() => { movesRef.current = moves; sendRef.current = send })

  // Persist the result once, when the game ends. Server-side, from the moves.
  const saved = React.useRef(false)
  React.useEffect(() => {
    if (saved.current || state.kind === 'playing' || !resultOf(moves)) return
    saved.current = true
    funzone('finish', { session: sessionId, moves }).then(() => {}, () => {})   // a lost score must not break the screen
  }, [state.kind, moves, sessionId])

  const play = (cell: number) => {
    const m: Move = { n: moves.length, by: me, cell }
    if (!canApply(moves, m).legal) return
    setMoves(cur => [...cur, m])
    send({ t: 'move', from: meId, move: m })
  }

  const line = state.kind === 'won' ? state.line : []

  return (
    <View>
      <LiveHead strong={`You are ${me}`} soft={`vs ${opponentName}`} status={status} />
      <StatusBanner status={status} />

      <SquareGrid count={9} cols={3} maxWidth={300}>
        {(i, size) => (
          <Square key={i} i={i} c={board[i]} size={size} winning={line.includes(i)}
            open={board[i] === '' && myTurn && status === 'playing'} onPress={() => play(i)} />
        )}
      </SquareGrid>

      <View style={{ marginTop: S.md, minHeight: 24 }}>
        <Txt size={F.body} w={600} center>
          {state.kind === 'won'
            ? (state.by === me ? 'You won.' : `${opponentName} won.`)
            : state.kind === 'draw' ? 'A draw.'
            : status === 'playing' ? (myTurn ? 'Your turn.' : `${opponentName}'s turn.`)
            : ''}
        </Txt>
      </View>

      {!!rejected && <Txt size={F.micro} color={C.muted} center style={{ marginTop: 4 }}>{rejected}</Txt>}

      <Foot ended={state.kind !== 'playing'} status={status} onExit={onExit}
        onAgain={() => { saved.current = false; setMoves([]); send({ t: 'rematch', from: meId }) }} />
    </View>
  )
}
