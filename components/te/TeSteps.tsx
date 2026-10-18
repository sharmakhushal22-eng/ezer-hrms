'use client'
// components/te/TeSteps.tsx — "What › How › Details", the three steps shown on
// every screen of the entry flow. The prototype's flowSteps (ui-09).
//
// The `data-a` attribute is the prototype's and is kept on purpose: te.css keys
// the pointer cursor and the hover wash off `.fs[data-a]`, so a step that can be
// gone back to carries it and a step that cannot does not. The click itself is
// React's; nothing reads data-a at runtime.
import { Fragment } from 'react'
import { flowSteps, type FlowKind, type WayId } from '@/lib/te/entry-flow'
import TeIcon from './TeIcon'

export default function TeSteps({ on, kind, way, onTo }: {
  /** Which step the employee is on: 1 what, 2 how, 3 the form. */
  on: 1 | 2 | 3
  kind: FlowKind | null
  way: WayId | null
  /** Go back to an earlier step. Only earlier steps are clickable. */
  onTo: (step: 1 | 2) => void
}) {
  return (
    <nav className="fsteps" aria-label="Progress">
      {flowSteps(kind, way).map((s, i) => {
        const n = i + 1
        const past = n < on
        return (
          // A Fragment, not a wrapper element: .fsteps is a flex row and .fsep
          // stretches inside it, so the separator must be its own flex item.
          <Fragment key={s.small}>
            {i ? <span className="fsep" /> : null}
            <button
              type="button"
              className={`fs ${past ? 'done' : n === on ? 'on' : ''}`}
              {...(past ? { 'data-a': 'flowTo' } : { disabled: true })}
              aria-current={n === on ? 'step' : 'false'}
              onClick={past ? () => onTo(n as 1 | 2) : undefined}
            >
              <span className="fn">{past ? <TeIcon name="check" size="sm" /> : n}</span>
              <span><small>{s.small}</small><b>{s.label}</b></span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}
