'use client'
// components/funzone/LiveMemoryMatch.tsx — Memory Match across two screens.
//
// TURNS ARE SENT WHOLE. A player flips two cards locally and only then
// broadcasts the pair. The opponent never watches a half-finished turn, which
// removes the entire "one card is face up on my screen but not yours" class
// of bug — and there is no third state to reconcile after a reload.
//
// The deck comes from the session seed, so both sides deal identically
// without a server. See shuffled() in lib/funzone/games.ts.
//
// A hit keeps the turn, which is the standard rule and the reason the turn
// cannot be derived from a turn count the way tic-tac-toe's can — it has to
// be replayed.

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { funzone } from '@/lib/funzone/client'
import { C, F, W, S, R } from '@/lib/ui'
import { memDeck, memReplay, memCanApply, memResult, MEM_CARDS,
         type MemTurn } from '@/lib/funzone/games'
import { channelFor, EVENT, isPacket, reconcileList, sideFor, STATUS_TEXT,
         type Packet, type LiveStatus } from '@/lib/funzone/live'

const PEEK_MS = 900

export default function LiveMemoryMatch({ sessionId, seed, meId, hostId, opponentName, onExit }: {
  sessionId: string; seed: number; meId: string; hostId: string
  opponentName: string; onExit: () => void
}) {
  const [turns, setTurns] = useState<MemTurn[]>([])
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [faceUp, setFaceUp] = useState<number[]>([])
  const [peek, setPeek] = useState<MemTurn | null>(null)
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const turnsRef = useRef<MemTurn[]>([])
  turnsRef.current = turns
  const lock = useRef(false)

  const deck = memDeck(seed)
  const me = sideFor(meId, hostId)
  const state = memReplay(deck, turns)
  const myTurn = state.turn === me && !state.done

  const send = useCallback((p: Packet) => {
    chan.current?.send({ type: 'broadcast', event: EVENT, payload: p })
  }, [])

  /** Show a miss for a moment before it flips back — on BOTH screens, so the
   *  opponent sees what was turned over. Without it their board changes with
   *  nothing to learn from, which is the whole point of the game. */
  const showThen = useCallback((t: MemTurn, then: () => void) => {
    setPeek(t)
    setTimeout(() => { setPeek(null); then() }, PEEK_MS)
  }, [])

  useEffect(() => {
    const ch = supabase.channel(channelFor(sessionId), {
      config: { broadcast: { self: false }, presence: { key: meId } },
    })
    chan.current = ch

    ch.on('broadcast', { event: EVENT }, ({ payload }) => {
      if (!isPacket(payload)) return
      const p = payload as Packet
      if (p.from === meId) return

      if (p.t === 'memSync') {
        setTurns(cur => reconcileList(cur, p.turns))
        if (turnsRef.current.length > p.turns.length) {
          send({ t: 'memSync', from: meId, turns: turnsRef.current })
        }
        return
      }
      if (p.t === 'mem') {
        const t = p.turn
        if (!memCanApply(deck, turnsRef.current, t).legal) return
        showThen(t, () => setTurns(cur =>
          memCanApply(deck, cur, t).legal ? [...cur, t] : cur))
        return
      }
      if (p.t === 'leave') { setStatus('opponent_left'); return }
      if (p.t === 'rematch') { setTurns([]); setFaceUp([]); setStatus('playing'); return }
    })

    ch.on('presence', { event: 'leave' }, () => {
      if (turnsRef.current.length > 0) setStatus('opponent_left')
    })
    ch.on('presence', { event: 'sync' }, () => {
      const n = Object.keys(ch.presenceState()).length
      setStatus(s => (s === 'opponent_left' ? s : n >= 2 ? 'playing' : 'waiting'))
    })

    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') {
        ch.track({ id: meId })
        send({ t: 'memSync', from: meId, turns: turnsRef.current })
        setStatus('waiting')
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('failed')
    })

    return () => {
      try { ch.send({ type: 'broadcast', event: EVENT,
                      payload: { t: 'leave', from: meId } }) } catch { /* closing */ }
      supabase.removeChannel(ch)
    }
  }, [sessionId, meId, send, deck, showThen])

  const saved = useRef(false)
  useEffect(() => {
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
      setTurns(cur => memCanApply(deck, cur, t).legal ? [...cur, t] : cur)
      setFaceUp([]); lock.current = false
    })
  }

  const shown = new Set<number>([
    ...state.matched, ...faceUp,
    ...(peek ? [peek.a, peek.b] : []),
  ])
  const result = memResult(deck, turns)

  return (
    <div>
      <Head me={me} opponentName={opponentName} status={status}
            scores={state.scores} />

      {STATUS_TEXT[status] && (
        <div style={{ fontSize: F.small, borderRadius: R.sm, padding: '9px 12px',
                      marginBottom: S.md,
                      background: status === 'failed' ? C.criticalTint : C.warningTint,
                      color: status === 'failed' ? C.critical : C.warning }}>
          {STATUS_TEXT[status]}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
                    maxWidth: 360, margin: '0 auto' }}>
        {deck.map((face, i) => {
          const open = shown.has(i)
          const done = state.matched.includes(i)
          return (
            <button key={i} onClick={() => flip(i)}
              disabled={!myTurn || open || status !== 'playing'}
              aria-label={open ? `Card ${i + 1}, ${face}` : `Card ${i + 1}, face down`}
              style={{ aspectRatio: '1', fontSize: 26, fontFamily: 'inherit',
                       cursor: myTurn && !open ? 'pointer' : 'default',
                       borderRadius: R.md,
                       border: `1px solid ${done ? C.positive : C.line}`,
                       background: done ? C.positiveTint : open ? C.surface : C.sunken,
                       opacity: done ? .65 : 1 }}>
              {open ? face : ''}
            </button>
          )
        })}
      </div>

      <div style={{ textAlign: 'center', marginTop: S.md, fontSize: F.body,
                    fontWeight: W.semi, color: C.ink, minHeight: 24 }}>
        {result
          ? result.draw ? `A draw, ${result.scores.HOST} each.`
            : result.winner === me ? `You won, ${state.scores[me]} pairs to ${state.scores[me === 'HOST' ? 'GUEST' : 'HOST']}.`
            : `${opponentName} won.`
          : status === 'playing' ? (myTurn ? 'Your turn — turn over two.' : `${opponentName}'s turn.`)
          : ''}
      </div>

      <Foot ended={!!result} status={status} onExit={onExit}
        onAgain={() => { saved.current = false; setTurns([]); setFaceUp([])
                         send({ t: 'rematch', from: meId }) }} />
    </div>
  )
}

export function Head({ me, opponentName, status, scores }: {
  me: 'HOST' | 'GUEST'; opponentName: string; status: LiveStatus
  scores: { HOST: number; GUEST: number }
}) {
  const mine = scores[me], theirs = scores[me === 'HOST' ? 'GUEST' : 'HOST']
  return (
    <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap',
                  marginBottom: S.md }}>
      <span style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink }}>
        You {mine}
      </span>
      <span style={{ fontSize: F.small, color: C.muted }}>
        {opponentName} {theirs}
      </span>
      <span style={{ marginLeft: 'auto', fontSize: F.micro, fontWeight: W.semi,
                     padding: '3px 10px', borderRadius: 999,
                     background: status === 'playing' ? C.positiveTint : C.sunken,
                     color: status === 'playing' ? C.positive : C.muted }}>
        {status === 'playing' ? 'Live' : status === 'connecting' ? 'Connecting'
         : status === 'waiting' ? 'Waiting' : status === 'failed' ? 'No connection' : 'Ended'}
      </span>
    </div>
  )
}

export function Foot({ ended, status, onAgain, onExit }: {
  ended: boolean; status: LiveStatus; onAgain: () => void; onExit: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: S.sm, justifyContent: 'center', marginTop: S.md }}>
      {ended && status !== 'opponent_left' && (
        <button onClick={onAgain}
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
  )
}
