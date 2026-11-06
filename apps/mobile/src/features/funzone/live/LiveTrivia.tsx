// src/features/funzone/live/LiveTrivia.tsx — the quiz, head to head.
// Port of components/funzone/LiveTrivia.tsx (spec 08 §5.11.5).
//
// Both players answer the same question; it moves on once both have. Answering
// is two-phase so a choice never reaches the other screen before they have
// answered: first {t:'ready', q} (no choice), then, once both are ready, each
// side sends {t:'answer'} with the choice itself.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S, R } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { quizFor, quizReplay, quizCanApply, quizResult, type Answer } from '@web/funzone/games'
import { reconcileList, sideFor, type Packet, type LiveStatus } from '@web/funzone/live'
import { funzone } from './client'
import { Foot, ScoreHead, StatusBanner, useLiveChannel } from './common'
import type { LiveSeededProps } from './LiveMemoryMatch'

function Option({ text, chosen, dim, disabled, onPress }: {
  text: string; chosen: boolean; dim: boolean; disabled: boolean; onPress: () => void
}) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled, selected: chosen }}
      style={({ pressed }) => ({
        minHeight: 44, justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: R.sm, borderWidth: 1,
        borderColor: chosen ? C.brand : C.line,
        backgroundColor: chosen ? C.brandTint : pressed && !disabled ? C.sunken : C.surface,
        opacity: dim ? 0.55 : 1,
      })}>
      <Txt size={F.small}>{text}</Txt>
    </Pressable>
  )
}

export default function LiveTrivia({ sessionId, seed, meId, hostId, opponentName, onExit }: LiveSeededProps) {
  const { C } = useTheme()
  const [answers, setAnswers] = React.useState<Answer[]>([])
  const [status, setStatus] = React.useState<LiveStatus>('connecting')
  /** My locked-in choice for the current question, held back until they are ready too. */
  const [pending, setPending] = React.useState<number | null>(null)
  const [theyReady, setTheyReady] = React.useState<number | null>(null)
  const aRef = React.useRef<Answer[]>([])
  const pendRef = React.useRef<number | null>(null)

  // One question order per seed (the website rebuilds it every render and lists
  // it in the channel effect's deps — see the report).
  const qs = React.useMemo(() => quizFor(seed), [seed])
  const me = sideFor(meId, hostId)
  const state = quizReplay(qs, answers)
  const q = qs[state.at]
  const iAnswered = answers.some(a => a.q === state.at && a.by === me) || pending !== null

  const sendRef = React.useRef<(p: Packet) => void>(() => {})

  /** Release my held choice. Called once both sides have declared ready. */
  const release = (at: number) => {
    const choice = pendRef.current
    if (choice === null) return
    const a: Answer = { q: at, by: me, choice }
    pendRef.current = null
    setPending(null)
    setAnswers(cur => (quizCanApply(qs, cur, a).legal ? [...cur, a] : cur))
    sendRef.current({ t: 'answer', from: meId, answer: a })
  }

  const onPacket = (p: Packet) => {
    if (p.t === 'quizSync') {
      setAnswers(cur => reconcileList(cur, p.answers))
      if (aRef.current.length > p.answers.length) {
        sendRef.current({ t: 'quizSync', from: meId, answers: aRef.current })
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
      setAnswers(cur => (quizCanApply(qs, cur, p.answer).legal ? [...cur, p.answer] : cur))
      setTheyReady(null)
      return
    }
    if (p.t === 'leave') { setStatus('opponent_left'); return }
    if (p.t === 'rematch') {
      setAnswers([]); setPending(null); setTheyReady(null); setStatus('playing'); return
    }
  }

  const send = useLiveChannel({
    sessionId, meId, onPacket, setStatus,
    syncPacket: () => ({ t: 'quizSync', from: meId, answers: aRef.current }),
    hasProgress: () => aRef.current.length > 0,
  })
  // Refs mirror the committed state for the socket handlers (written after render, not during it).
  React.useLayoutEffect(() => { aRef.current = answers; pendRef.current = pending; sendRef.current = send })

  const saved = React.useRef(false)
  React.useEffect(() => {
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
  const progress =
    iAnswered && theyReady === null ? `Locked in. Waiting for ${opponentName}…`
    : !iAnswered && theyReady === state.at ? `${opponentName} has answered. Your turn.`
    : iAnswered && theyReady === state.at ? 'Both in, revealing…'
    : ''

  return (
    <View>
      <ScoreHead me={me} opponentName={opponentName} status={status} scores={state.scores} />
      <StatusBanner status={status} />

      {result ? (
        <View style={{ alignItems: 'center', paddingVertical: 18 }}>
          <Txt size={22} w={700} center>
            {result.draw ? `A draw, ${result.scores.HOST} each.`
              : result.winner === me ? 'You won.' : `${opponentName} won.`}
          </Txt>
          <Txt size={F.small} tone="muted" center style={{ marginTop: 6 }}>
            {state.scores[me]} right out of {qs.length}.
          </Txt>
        </View>
      ) : q ? (
        <View>
          <Txt size={F.micro} tone="faint" style={{ marginBottom: 6 }}>Question {state.at + 1} of {qs.length}</Txt>
          <Txt size={F.lead} w={600} style={{ lineHeight: 22, marginBottom: 14 }}>{q.q}</Txt>
          <View style={{ gap: 8 }}>
            {q.opts.map((o, i) => {
              const chosen = pending === i
              return (
                <Option key={i} text={o} chosen={chosen} dim={iAnswered && !chosen}
                  disabled={iAnswered || status !== 'playing'} onPress={() => lockIn(i)} />
              )
            })}
          </View>
          <Txt size={F.micro} tone="muted" style={{ marginTop: 10, minHeight: 18 }}>{progress}</Txt>
        </View>
      ) : null}

      {revealed && !result && (
        <View style={{ marginTop: S.md, paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.line }}>
          <Txt size={F.micro} tone="muted" style={{ lineHeight: 19 }}>
            Last one: <Txt size={F.micro} w={700}>{revealed.opts[revealed.correct]}</Txt>
            {lastAnswers.map(a => (
              ` · ${a.by === me ? 'you' : opponentName} ${a.choice === revealed.correct ? 'got it' : 'missed it'}`
            )).join('')}
          </Txt>
        </View>
      )}

      <Foot ended={!!result} status={status} onExit={onExit}
        onAgain={() => { saved.current = false; setAnswers([]); setPending(null); setTheyReady(null); send({ t: 'rematch', from: meId }) }} />
    </View>
  )
}
