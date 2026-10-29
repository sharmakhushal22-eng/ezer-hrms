'use client'
// components/te/TeChain.tsx — how far a request has got through its approvers.
//
// WHY IT IS ON THE DESK. A travel desk books against a date, so "waiting for
// approval" is not enough to act on: on a two-step chain it covers both a trip
// nobody has opened and one where R1 has signed and only the Head of department
// is left. The first is a week away, the second is probably tomorrow, and the
// desk has to decide today whether to hold a fare.
//
// The sentence and the ordering rules are chainState() in
// lib/te/approval-chain.ts, which is tested. This file only draws them.
//
// TWO SHAPES. A compact one — the sentence as a chip — for a row that has
// nothing to act on, and the full one, which adds the steps themselves so the
// desk can see who is next by name without opening the trip.
import { chainState, chainTone, shortRole, type ChainStep } from '@/lib/te/approval-chain'
import TeIcon from './TeIcon'

/** The glyph for one step: what happened, not what it is called. */
function mark(status: string): { icon: string; cls: string } {
  if (status === 'approved' || status === 'auto') return { icon: 'check', cls: 'ok' }
  if (status === 'rejected') return { icon: 'close', cls: 'no' }
  if (status === 'sent_back') return { icon: 'back', cls: 'back' }
  if (status === 'cancelled') return { icon: 'close', cls: 'off' }
  return { icon: 'clock', cls: 'wait' }
}

export default function TeChain({ steps, compact }: {
  steps: ChainStep[]
  /** Just the sentence, for a row with no room and nothing to do. */
  compact?: boolean
}) {
  const s = chainState(steps)
  const tone = chainTone(s.state)

  // A trip that needed nobody says so once, in the compact form. Drawing an
  // empty chain under it would be a diagram of nothing.
  if (compact || !steps.length) {
    return <span className={`chip t-${tone}`}>{s.text}</span>
  }

  return (
    <div className="chain">
      <div className="chain-say">
        <span className={`chip t-${tone}`}>{s.text}</span>
        {s.total > 1 ? <span className="small muted">{s.done} of {s.total} done</span> : null}
      </div>
      <ol className="chain-steps">
        {steps.map(step => {
          const m = mark(step.status)
          // Delegation: the person who acted is not always the person the step
          // belongs to, and on a desk screen "who actually signed" is the fact
          // that matters.
          const acted = step.actedBy && step.actedBy !== step.who ? step.actedBy : null
          return (
            <li key={step.stepNo} className={`chain-step ${m.cls}`}>
              <span className="cs-m"><TeIcon name={m.icon} size="sm" /></span>
              <span className="cs-t">
                <b>{shortRole(step.roleLabel)}</b>
                {step.who ? <span className="cs-who">{step.who}</span> : null}
                {acted ? <span className="cs-who">signed by {acted}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
