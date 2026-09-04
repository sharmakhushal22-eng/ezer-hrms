'use client'
// components/funzone/LiveTicTacToe.tsx — the same game, across two screens.
//
// Supabase Realtime broadcast, one channel per session. There is no server in
// the loop while playing, so every packet from the other browser is validated
// against the pure rules in lib/funzone/games.ts before it is applied — the
// peer is the other player, not a trusted party.
//
// THE THREE THINGS THAT MAKE THIS SURVIVABLE IN A REAL OFFICE
//
//   A reload does not lose the game. The returning client announces itself
//   with an empty move list; the other answers with the real one, and the
//   board comes back. `reconcile` keeps the longer list, which can only have
//   been reached by legal moves.
//
//   A closed tab is noticed. Presence tells us when the other side leaves,
//   and the game says so instead of waiting forever for a move.
//
//   A failed socket says so. If the channel will not open, the screen states
//   it plainly rather than sitting on "connecting" until somebody gives up.

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { funzone } from '@/lib/funzone/client'
import { C, F, W, S, R } from '@/lib/ui'
import { boardFrom, outcome, canApply, resultOf, other,
         type Move, type Mark } from '@/lib/funzone/games'
import { channelFor, EVENT, isPacket, reconcile, markFor, STATUS_TEXT,
         type Packet, type LiveStatus } from '@/lib/funzone/live'

export default function LiveTicTacToe({ sessionId, meId, hostId, opponentName, onExit }: {
  sessionId: string
  meId: string
  hostId: string
  opponentName: string
  onExit: () => void
}) {
  const [moves, setMoves] = useState<Move[]>([])
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [rejected, setRejected] = useState<string | null>(null)
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const movesRef = useRef<Move[]>([])
  movesRef.current = moves

  const me: Mark = markFor(meId, hostId)
  const board = boardFrom(moves)
  const state = outcome(board)
  const myTurn = state.kind === 'playing' && state.turn === me

  const send = useCallback((p: Packet) => {
    chan.current?.send({ type: 'broadcast', event: EVENT, payload: p })
  }, [])

  useEffect(() => {
    const ch = supabase.channel(channelFor(sessionId), {
      config: { broadcast: { self: false }, presence: { key: meId } },
    })
    chan.current = ch

    ch.on('broadcast', { event: EVENT }, ({ payload }) => {
      if (!isPacket(payload)) return              // malformed: drop, never throw
      const p = payload as Packet
      if (p.from === meId) return

      if (p.t === 'sync') {
        setMoves(cur => reconcile(cur, p.moves))
        // Answer with ours, so whoever is behind catches up. Only when we
        // actually have more — otherwise two fresh clients ping-pong forever.
        if (movesRef.current.length > p.moves.length) {
          send({ t: 'sync', from: meId, moves: movesRef.current })
        }
        return
      }
      if (p.t === 'move') {
        setMoves(cur => {
          const v = canApply(cur, p.move)
          if (!v.legal) {
            // Not applied. Usually a duplicate after a reconnect, which is
            // harmless; anything else is worth showing rather than hiding.
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
    })

    ch.on('presence', { event: 'leave' }, () => {
      if (movesRef.current.length > 0) setStatus('opponent_left')
    })
    ch.on('presence', { event: 'sync' }, () => {
      const n = Object.keys(ch.presenceState()).length
      setStatus(s => (s === 'opponent_left' ? s : n >= 2 ? 'playing' : 'waiting'))
    })

    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') {
        ch.track({ id: meId })
        send({ t: 'sync', from: meId, moves: movesRef.current })
        setStatus('waiting')
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        setStatus('failed')
      }
    })

    return () => {
      // Announce the exit rather than just vanishing — a socket that simply
      // dies leaves the other side waiting on a move that is never coming.
      try { ch.send({ type: 'broadcast', event: EVENT,
                      payload: { t: 'leave', from: meId } }) } catch { /* closing */ }
      supabase.removeChannel(ch)
    }
  }, [sessionId, meId, send])

  // Persist the result once, when the game ends. Server-side, from the moves.
  const saved = useRef(false)
  useEffect(() => {
    if (saved.current || state.kind === 'playing' || !resultOf(moves)) return
    saved.current = true
    // Through the route: finish_game identifies the player from a session
    // setting PostgREST cannot set, so called directly it recorded the result
    // against nobody.
    funzone('finish', { session: sessionId, moves })
      .then(() => {}, () => {})   // a lost score must not break the screen
  }, [state.kind, moves, sessionId])

  const play = (cell: number) => {
    const m: Move = { n: moves.length, by: me, cell }
    if (!canApply(moves, m).legal) return
    setMoves(cur => [...cur, m])
    send({ t: 'move', from: meId, move: m })
  }

  const line = state.kind === 'won' ? state.line : []

  return (
    <div>
      <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap',
                    marginBottom: S.md }}>
        <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
          You are {me}
        </span>
        <span style={{ fontSize: F.small, color: C.muted }}>vs {opponentName}</span>
        <span style={{ marginLeft: 'auto', fontSize: F.micro, fontWeight: W.semi,
                       padding: '3px 10px', borderRadius: 999,
                       background: status === 'playing' ? C.positiveTint : C.sunken,
                       color: status === 'playing' ? C.positive : C.muted }}>
          {status === 'playing' ? 'Live' : status === 'connecting' ? 'Connecting' :
           status === 'waiting' ? 'Waiting' : status === 'failed' ? 'No connection' : 'Ended'}
        </span>
      </div>

      {STATUS_TEXT[status] && (
        <div style={{ fontSize: F.small, borderRadius: R.sm, padding: '9px 12px',
                      marginBottom: S.md,
                      background: status === 'failed' ? C.criticalTint : C.warningTint,
                      color: status === 'failed' ? C.critical : C.warning }}>
          {STATUS_TEXT[status]}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                    maxWidth: 300, margin: '0 auto' }}>
        {board.map((c, i) => {
          const winning = line.includes(i)
          const open = c === '' && myTurn && status === 'playing'
          return (
            <button key={i} onClick={() => play(i)} disabled={!open}
              aria-label={c ? `Square ${i + 1}, ${c}` : `Square ${i + 1}, empty`}
              style={{ aspectRatio: '1', fontFamily: 'inherit', fontSize: 34,
                       fontWeight: W.bold, cursor: open ? 'pointer' : 'default',
                       borderRadius: R.md, border: `1px solid ${winning ? C.positive : C.line}`,
                       background: winning ? C.positiveTint : C.surface,
                       color: c === 'X' ? C.brand : C.critical }}>
              {c}
            </button>
          )
        })}
      </div>

      <div style={{ textAlign: 'center', marginTop: S.md, fontSize: F.body,
                    fontWeight: W.semi, color: C.ink, minHeight: 24 }}>
        {state.kind === 'won'
          ? (state.by === me ? 'You won.' : `${opponentName} won.`)
          : state.kind === 'draw' ? 'A draw.'
          : status === 'playing' ? (myTurn ? 'Your turn.' : `${opponentName}'s turn.`)
          : ''}
      </div>

      {rejected && (
        <div style={{ textAlign: 'center', fontSize: F.micro, color: C.muted,
                      marginTop: 4 }}>{rejected}</div>
      )}

      <div style={{ display: 'flex', gap: S.sm, justifyContent: 'center', marginTop: S.md }}>
        {state.kind !== 'playing' && status !== 'opponent_left' && (
          <button onClick={() => { saved.current = false; setMoves([])
                                   send({ t: 'rematch', from: meId }) }}
            style={{ fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.bold,
                     padding: '8px 16px', borderRadius: R.sm, border: 'none',
                     background: C.brand, color: C.onAccent, cursor: 'pointer' }}>
            Play again
          </button>
        )}
        <button onClick={onExit}
          style={{ fontFamily: 'inherit', fontSize: F.tiny, fontWeight: W.semi,
                   padding: '8px 14px', borderRadius: R.sm,
                   border: `1px solid ${C.line}`, background: C.surface,
                   color: C.inkSoft, cursor: 'pointer' }}>
          Leave
        </button>
      </div>
    </div>
  )
}
