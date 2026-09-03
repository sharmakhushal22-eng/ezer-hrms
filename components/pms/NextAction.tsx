'use client'
// components/pms/NextAction.tsx — "what do I do now", answered.
//
// The stepper says where the cycle is. This says what the reader owes it,
// and it is the difference between a screen you can read and a screen you
// can operate. It is deliberately the loudest thing on the page.
//
// Every card carries FOUR parts, and dropping any one of them is what makes
// enterprise software feel unusable:
//
//   the ask        imperative, in their words     "Rate yourself"
//   the reason     why it is being asked          so it is not bureaucracy
//   the control    one button that does it        no hunting for the tab
//   the deadline   when, and how close            only when one exists
//
// A blocked action keeps all four but swaps the control for the reason it
// cannot proceed. Showing a disabled button with no explanation is the exact
// confusion this component exists to remove.

import type { Action, Urgency } from '@/lib/pms/cycle'
import { C, F, W, R, S } from '@/lib/ui'

export interface NextActionProps {
  action: Action | null
  onGo?: (tab: string) => void
  /** Shown when nothing is owed — the "you are done" state still needs to
   *  say so, or an empty space reads as a screen that failed to load. */
  restingTitle?: string
  restingWhy?: string
}

const TONE: Record<Urgency, { bg: string; ink: string; sub: string; chip: string; chipInk: string }> = {
  overdue: { bg: C.critical, ink: '#FFFFFF', sub: 'rgba(255,255,255,.86)', chip: 'rgba(255,255,255,.22)', chipInk: '#FFFFFF' },
  due:     { bg: C.brand,    ink: '#FFFFFF', sub: 'rgba(255,255,255,.86)', chip: 'rgba(255,255,255,.22)', chipInk: '#FFFFFF' },
  info:    { bg: C.brand,    ink: '#FFFFFF', sub: 'rgba(255,255,255,.86)', chip: 'rgba(255,255,255,.22)', chipInk: '#FFFFFF' },
  none:    { bg: C.surface,  ink: C.ink,     sub: C.muted,                chip: C.sunken,                chipInk: C.inkSoft },
}

/** "5 days left", "due today", "3 days overdue". Never a bare date — the
 *  reader wants the distance, not the coordinate. */
function deadline(d: number | null | undefined): string | null {
  if (d === null || d === undefined) return null
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
  if (d === 0) return 'due today'
  if (d === 1) return '1 day left'
  return `${d} days left`
}

export default function NextAction({ action, onGo, restingTitle, restingWhy }: NextActionProps) {
  if (!action) {
    return (
      <div style={{
        background: C.positiveTint, border: `1px solid ${C.positive}33`,
        borderRadius: R.sm, padding: `${S.md}px ${S.lg}px`, display: 'flex',
        alignItems: 'center', gap: S.sm,
      }}>
        <span aria-hidden style={{
          width: 22, height: 22, borderRadius: '50%', background: C.positive, color: '#FFFFFF',
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-6.5" /></svg>
        </span>
        <div>
          <div style={{ fontSize: F.body, fontWeight: W.semi, color: C.ink }}>
            {restingTitle ?? 'Nothing needs you right now'}
          </div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 2 }}>
            {restingWhy ?? 'You are up to date on this cycle. You will see a task here the moment one is yours.'}
          </div>
        </div>
      </div>
    )
  }

  const t = TONE[action.urgency]
  const when = deadline(action.daysLeft)
  const blocked = Boolean(action.blockedBy)

  return (
    <div style={{
      background: blocked ? C.warningTint : t.bg,
      border: blocked ? `1px solid ${C.warning}44` : 'none',
      borderRadius: R.sm, padding: `${S.md}px ${S.lg}px`,
      display: 'flex', flexWrap: 'wrap', gap: S.md,
      alignItems: 'center', justifyContent: 'space-between',
      boxShadow: blocked ? 'none' : '0 6px 18px -8px rgba(6,17,58,.45)',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 320px' }}>
        <div style={{
          fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.12em', textTransform: 'uppercase',
          color: blocked ? C.warning : t.sub, marginBottom: 5,
        }}>
          {blocked ? 'Waiting' : action.urgency === 'overdue' ? 'Overdue' : 'Your next step'}
        </div>
        <div style={{
          fontSize: F.lead, fontWeight: W.bold, color: blocked ? C.ink : t.ink,
          lineHeight: 1.25, letterSpacing: '-.01em',
        }}>
          {action.title}
        </div>
        {/* The reason. Never optional — an instruction without one is an
            order, and people work around orders they do not understand. */}
        <div style={{
          fontSize: F.small, color: blocked ? C.inkSoft : t.sub,
          marginTop: 5, lineHeight: 1.5, maxWidth: '64ch',
        }}>
          {action.blockedBy ? <strong style={{ color: C.ink }}>{action.blockedBy} </strong> : null}
          {action.why}
        </div>
      </div>

      {/* flexShrink 0 on this group cost 47px of page overflow at 320px: the
          chip and a button reading "Ask your manager to reopen it" cannot
          both fit, and neither was allowed to give. It wraps now, and the
          button is free to take two lines rather than push the page wide. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm,
                    flexWrap: 'wrap', minWidth: 0 }}>
        {when && (
          <span style={{
            fontSize: F.micro, fontWeight: W.bold, padding: '5px 10px', borderRadius: 999,
            background: blocked ? C.surface : t.chip, color: blocked ? C.warning : t.chipInk,
            whiteSpace: 'nowrap',
          }}>
            {when}
          </span>
        )}
        <button
          type="button"
          onClick={() => onGo?.(action.tab)}
          style={{
            fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold, cursor: 'pointer',
            padding: '10px 16px', borderRadius: R.sm, maxWidth: '100%',
            border: blocked ? `1px solid ${C.lineStrong}` : 'none',
            background: blocked ? C.surface : '#FFFFFF',
            color: blocked ? C.ink : (action.urgency === 'overdue' ? C.critical : C.brand),
            boxShadow: blocked ? 'none' : '0 1px 2px rgba(6,17,58,.18)',
          }}
        >
          {action.cta}
        </button>
      </div>
    </div>
  )
}
