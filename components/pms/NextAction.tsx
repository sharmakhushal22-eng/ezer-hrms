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
import { C, F, W, R, S, IconCheck, IconClock, IconAlert, IconChevron } from '@/lib/ui'

export interface NextActionProps {
  action: Action | null
  onGo?: (tab: string) => void
  /** Shown when nothing is owed — the "you are done" state still needs to
   *  say so, or an empty space reads as a screen that failed to load. */
  restingTitle?: string
  restingWhy?: string
}

// THE DEADLINE CHIP WAS UNREADABLE AND MEASURED IT: 3.49 against a 4.5 bar.
// White text on a 22% white wash is the trap — the wash lightens the ground
// underneath it and moves it TOWARDS the ink, so a chip meant to make the
// deadline stand out was the least legible thing on the card. A near-opaque
// chip carrying the card's own colour as ink inverts that and lands above 8.
// Edition 2: a gradient fill per urgency, and on-accent text that FOLLOWS
// THE THEME. The previous sub-line and chip were white literals, which on
// the dark theme's light-blue brand dropped to about 2.5:1.
const TONE: Record<Urgency, { bg: string; ink: string; sub: string; chip: string; chipInk: string }> = {
  overdue: { bg: `linear-gradient(135deg, ${C.critical}, color-mix(in oklab, ${C.critical} 78%, black))`,
             ink: C.onAccent, sub: C.onAccentSoft, chip: C.onAccent, chipInk: C.critical },
  due:     { bg: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`,
             ink: C.onAccent, sub: C.onAccentSoft, chip: C.onAccent, chipInk: C.brand },
  info:    { bg: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`,
             ink: C.onAccent, sub: C.onAccentSoft, chip: C.onAccent, chipInk: C.brand },
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
        background: `linear-gradient(90deg, ${C.positiveTint}, ${C.surface})`,
        border: `1px solid ${C.positiveEdge}`,
        borderRadius: 16, padding: `${S.md}px ${S.lg}px`, display: 'flex',
        alignItems: 'center', gap: S.md,
      }}>
        <span aria-hidden style={{
          width: 36, height: 36, borderRadius: 12, background: C.positive, color: C.onAccent,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          boxShadow: `0 6px 14px -8px ${C.positive}`,
        }}>
          <IconCheck size={18} strokeWidth={2.2} />
        </span>
        <div>
          <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink }}>
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
  const Lead = blocked ? IconClock : action.urgency === 'overdue' ? IconAlert : IconChevron

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      background: blocked ? `linear-gradient(90deg, ${C.warningTint}, ${C.surface})` : t.bg,
      border: blocked ? `1px solid ${C.warningEdge}` : '1px solid transparent',
      borderRadius: 16, padding: `${S.md + 2}px ${S.lg + 2}px`,
      display: 'flex', flexWrap: 'wrap', gap: S.md,
      alignItems: 'center', justifyContent: 'space-between',
      boxShadow: blocked ? 'none' : `0 14px 30px -18px ${action.urgency === 'overdue' ? C.critical : C.brandDeep}`,
    }}>
      <div style={{ minWidth: 0, flex: '1 1 320px', display: 'flex', gap: S.md, alignItems: 'flex-start' }}>
        <span aria-hidden style={{
          width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: blocked ? C.surface : `color-mix(in oklab, ${C.onAccent} 18%, transparent)`,
          color: blocked ? C.warning : t.ink,
          boxShadow: blocked ? `inset 0 0 0 1px ${C.warningEdge}`
                             : `inset 0 0 0 1px color-mix(in oklab, ${C.onAccent} 30%, transparent)`,
        }}>
          <Lead size={19} strokeWidth={2} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: F.micro, fontWeight: W.bold, letterSpacing: 0, 
            color: blocked ? C.warning : t.sub, marginBottom: 4,
          }}>
            {blocked ? 'Waiting' : action.urgency === 'overdue' ? 'Overdue' : 'Your next step'}
          </div>
          <div style={{
            fontSize: F.title, fontWeight: W.bold, color: blocked ? C.ink : t.ink,
            lineHeight: 1.2, letterSpacing: '-.015em',
          }}>
            {action.title}
          </div>
          {/* The reason, and on a blocked step WHO it is waiting on, first. */}
          <div style={{
            fontSize: F.small, color: blocked ? C.inkSoft : t.sub,
            marginTop: 5, lineHeight: 1.5, maxWidth: '64ch',
          }}>
            {action.blockedBy ? <strong style={{ color: C.ink }}>{action.blockedBy} </strong> : null}
            {action.why}
          </div>
        </div>
      </div>

      {/* The deadline and the button travel together. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm,
                    flexWrap: 'wrap', minWidth: 0 }}>
        {when && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: F.micro, fontWeight: W.bold, padding: '6px 11px', borderRadius: 999,
            background: blocked ? C.surface : t.chip, color: blocked ? C.warning : t.chipInk,
            whiteSpace: 'nowrap', boxShadow: blocked ? `inset 0 0 0 1px ${C.warningEdge}` : 'none',
          }}>
            <IconClock size={12} strokeWidth={2} />
            {when}
          </span>
        )}
        <button
          type="button"
          className="ez-cta"
          onClick={() => onGo?.(action.tab)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold, cursor: 'pointer',
            padding: '11px 18px', borderRadius: R.md, maxWidth: '100%',
            border: blocked ? `1px solid ${C.lineStrong}` : 'none',
            background: blocked ? C.surface : C.onAccent,
            color: blocked ? C.ink : (action.urgency === 'overdue' ? C.critical : C.brand),
            boxShadow: blocked ? 'none' : '0 8px 18px -10px rgba(6,17,58,.55)',
          }}
        >
          {action.cta}
          <span className="ez-cta-arrow" aria-hidden style={{ display: 'inline-flex' }}>
            <IconChevron size={14} strokeWidth={2.2} />
          </span>
        </button>
      </div>
    </div>
  )
}
