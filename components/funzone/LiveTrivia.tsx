'use client'
// components/funzone/LiveTrivia.tsx — the quiz, head to head.
//
// Both players see the same questions in the same order, from the session
// seed. Unlike the other two this is not turn-based: both answer the same
// question, and it only moves on once both have.
//
// THE PEEK PROBLEM, AND WHAT IS DONE ABOUT IT
//
// Broadcast reaches the other browser immediately. Sending a choice the
// moment it is picked would put it in the opponent's client BEFORE they had
// answered, and a modified client could read it off the wire.
//
// So answering is two phases. First a 'ready' packet carrying only the
// question number — enough for a "they have answered" indicator, nothing to
// copy. Then, once both are ready, each side sends the choice itself.
//
// This is not cryptography and does not pretend to be: a determined person
// could still hold their own answer back and wait. It costs two packets
// instead of one and removes the casual version entirely, which for a
// break-time quiz between colleagues is the right amount of effort.

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { funzone } from '@/lib/funzone/client'
import { C, F, W, S, R } from '@/lib/ui'
import { quizFor, quizReplay, quizCanApply, quizResult, type Answer } from '@/lib/funzone/games'
import { channelFor, EVENT, isPacket, reconcileList, sideFor, STATUS_TEXT,
         type Packet, type LiveStatus } from '@/lib/funzone/live'
import { Head, Foot } from './LiveMemoryMatch'

export default function LiveTrivia({ sessionId, seed, meId, hostId, opponentName, onExit }: {
  sessionId: string; seed: number; meId: string; hostId: string
  opponentName: string; onExit: () => void
}) {
  const [answers, setAnswers] = useState<Answer[]>([])
  const [status, setStatus] = useState<LiveStatus>('connecting')
  /** My locked-in choice for the current question, held back until they are
   *  ready too. */
  const [pending, setPending] = useState<number | null>(null)
  const [theyReady, setTheyReady] = useState<number | null>(null)
  const chan = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const aRef = useRef<Answer[]>([]); aRef.current = answers
  const pendRef = useRef<number | null>(null); pendRef.current = pending

  const qs = quizFor(seed)
  const me = sideFor(meId, hostId)
  const them = me === 'HOST' ? 'GUEST' : 'HOST'
  const state = quizReplay(qs, answers)
  const q = qs[state.at]
  const iAnswered = answers.some(a => a.q === state.at && a.by === me) || pending !== null

  const send = useCallback((p: Packet) => {
    chan.current?.send({ type: 'broadcast', event: EVENT, payload: p })
  }, [])

  /** Release my held choice. Called once both sides have declared ready. */
  const release = useCallback((at: number) => {
    const choice = pendRef.current
    if (choice === null) return
    const a: Answer = { q: at, by: me, choice }
    pendRef.current = null
    setPending(null)
    setAnswers(cur => quizCanApply(qs, cur, a).legal ? [...cur, a] : cur)
    send({ t: 'answer', from: meId, answer: a })
  }, [me, meId, qs, send])

  useEffect(() => {
    const ch = supabase.channel(channelFor(sessionId), {
      config: { broadcast: { self: false }, presence: { key: meId } },
    })
    chan.current = ch

    ch.on('broadcast', { event: EVENT }, ({ payload }) => {
      if (!isPacket(payload)) return
      const p = payload as Packet
      if (p.from === meId) return

      if (p.t === 'quizSync') {
        setAnswers(cur => reconcileList(cur, p.answers))
        if (aRef.current.length > p.answers.length) {
          send({ t: 'quizSync', from: meId, answers: aRef.current })
        }
        return
      }
      if (p.t === 'ready') {
        setTheyReady(p.q)
        // They are in. If I am too, both choices can now go out.
        if (pendRef.current !== null) release(p.q)
        return
      }
      if (p.t === 'answer') {
        setAnswers(cur => quizCanApply(qs, cur, p.answer).legal ? [...cur, p.answer] : cur)
        setTheyReady(null)
        return
      }
      if (p.t === 'leave') { setStatus('opponent_left'); return }
      if (p.t === 'rematch') {
        setAnswers([]); setPending(null); setTheyReady(null); setStatus('playing'); return
      }
    })

    ch.on('presence', { event: 'leave' }, () => {
      if (aRef.current.length > 0) setStatus('opponent_left')
    })
    ch.on('presence', { event: 'sync' }, () => {
      const n = Object.keys(ch.presenceState()).length
      setStatus(s => (s === 'opponent_left' ? s : n >= 2 ? 'playing' : 'waiting'))
    })

    ch.subscribe(st => {
      if (st === 'SUBSCRIBED') {
        ch.track({ id: meId })
        send({ t: 'quizSync', from: meId, answers: aRef.current })
        setStatus('waiting')
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') setStatus('failed')
    })

    return () => {
      try { ch.send({ type: 'broadcast', event: EVENT,
                      payload: { t: 'leave', from: meId } }) } catch { /* closing */ }
      supabase.removeChannel(ch)
    }
  }, [sessionId, meId, send, qs, release])

  const saved = useRef(false)
  useEffect(() => {
    const r = quizResult(qs, answers)
    if (saved.current || !r) return
    saved.current = true
    funzone('finish', {
      session: sessionId, moves: [],
      claim: { winner: r.winner, draw: r.draw, host: r.scores.HOST, guest: r.scores.GUEST },
    }).then(() => {}, () => {})
  }, [answers, qs, sessionId])

  const lockIn = (choice: number) => {
    if (iAnswered || status !== 'playing' || state.done) return
    setPending(choice); pendRef.current = choice
    send({ t: 'ready', from: meId, q: state.at })
    // They were already waiting on me — let both go now.
    if (theyReady === state.at) release(state.at)
  }

  const result = quizResult(qs, answers)
  const lastAnswers = answers.filter(a => a.q === state.at - 1)
  const revealed = state.at > 0 ? qs[state.at - 1] : null

  return (
    <div>
      <Head me={me} opponentName={opponentName} status={status} scores={state.scores} />

      {STATUS_TEXT[status] && (
        <div style={{ fontSize: F.small, borderRadius: R.sm, padding: '9px 12px',
                      marginBottom: S.md,
                      background: status === 'failed' ? C.criticalTint : C.warningTint,
                      color: status === 'failed' ? C.critical : C.warning }}>
          {STATUS_TEXT[status]}
        </div>
      )}

      {result ? (
        <div style={{ textAlign: 'center', padding: '18px 0' }}>
          <div style={{ fontSize: 22, fontWeight: W.bold, color: C.ink }}>
            {result.draw ? `A draw, ${result.scores.HOST} each.`
              : result.winner === me ? 'You won.' : `${opponentName} won.`}
          </div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 6 }}>
            {state.scores[me]} right out of {qs.length}.
          </div>
        </div>
      ) : q ? (
        <div>
          <div style={{ fontSize: F.micro, color: C.faint, marginBottom: 6 }}>
            Question {state.at + 1} of {qs.length}
          </div>
          <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink,
                        lineHeight: 1.5, marginBottom: 14 }}>
            {q.q}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {q.opts.map((o, i) => {
              const chosen = pending === i
              return (
                <button key={i} onClick={() => lockIn(i)}
                  disabled={iAnswered || status !== 'playing'}
                  style={{ textAlign: 'left', fontFamily: 'inherit', fontSize: F.small,
                           padding: '11px 14px', borderRadius: R.sm,
                           cursor: iAnswered ? 'default' : 'pointer',
                           border: `1px solid ${chosen ? C.brand : C.line}`,
                           background: chosen ? C.brandTint : C.surface,
                           color: C.ink, opacity: iAnswered && !chosen ? .55 : 1 }}>
                  {o}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: F.micro, color: C.muted, marginTop: 10, minHeight: 18 }}>
            {iAnswered && theyReady === null && `Locked in. Waiting for ${opponentName}…`}
            {!iAnswered && theyReady === state.at && `${opponentName} has answered. Your turn.`}
            {iAnswered && theyReady === state.at && 'Both in — revealing…'}
          </div>
        </div>
      ) : null}

      {revealed && !result && (
        <div style={{ marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${C.line}`,
                      fontSize: F.micro, color: C.muted, lineHeight: 1.7 }}>
          Last one: <strong style={{ color: C.ink }}>{revealed.opts[revealed.correct]}</strong>
          {lastAnswers.map(a => (
            <span key={a.by}>
              {' · '}{a.by === me ? 'you' : opponentName}{' '}
              {a.choice === revealed.correct ? 'got it' : 'missed it'}
            </span>
          ))}
        </div>
      )}

      <Foot ended={!!result} status={status} onExit={onExit}
        onAgain={() => { saved.current = false; setAnswers([]); setPending(null)
                         setTheyReady(null); send({ t: 'rematch', from: meId }) }} />
    </div>
  )
}
