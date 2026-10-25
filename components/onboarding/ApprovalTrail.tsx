'use client'
// components/onboarding/ApprovalTrail.tsx — the approvals cell of the onboarding table and the
// popover behind it.
//
// The cell is one compact line — "2/4 · with Payroll" with a four-segment meter — because the
// names do not fit a column without wrecking the table. Hover it (or click / tap / Enter) and
// the popover lists every step of the sign-off (lib/onboarding/approval-trail.ts): the team,
// who acts for it, and what happened — approved by whom on which day, waiting on whom since
// when, returned with what remark, or not started yet — under a "Now with" line. Below that,
// the reporting line set on the review sheet and the joiner's readiness items.
import { C as TK, R, tone as toneOf } from '@/lib/ui'
import { AnchoredPopover } from './AnchoredPopover'
import { dayLabel, daysFromToday, peopleLine, type Trail, type TrailStep } from '@/lib/onboarding/approval-trail'

export interface Readiness { label: string; done: boolean }
export interface ReportingLine { l1?: string | null; l2?: string | null; hod?: string | null }

const STATE: Record<TrailStep['state'], { mark: string; t: 'positive' | 'warning' | 'critical' | 'neutral' }> = {
  done: { mark: '✓', t: 'positive' },
  waiting: { mark: '…', t: 'warning' },
  returned: { mark: '↩', t: 'critical' },
  not_started: { mark: '', t: 'neutral' },
  skipped: { mark: '–', t: 'neutral' },
}

const since = (v: string | null) => {
  if (!v) return ''
  const d = daysFromToday(v)
  const ago = d === null ? '' : d === 0 ? ' (today)' : d === -1 ? ' (1 day)' : d < 0 ? ` (${-d} days)` : ''
  return ` since ${dayLabel(v)}${ago}`
}

function stepLine(s: TrailStep, holdersKnown: boolean): React.ReactNode {
  const who = peopleLine(s.people, 3)
  switch (s.state) {
    case 'done':
      return s.key === 'CODE'
        ? <>Generated{s.remark ? <> · <b>{s.remark}</b></> : null}{s.by ? ` by ${s.by}` : ''}{s.at ? ` on ${dayLabel(s.at)}` : ''}</>
        : <>Approved{s.by ? <> by <b>{s.by}</b></> : ''}{s.at ? ` on ${dayLabel(s.at)}` : ''}</>
    case 'waiting':
      return <>Waiting on {who ? <b>{who}</b> : holdersKnown ? <span style={{ color: TK.critical }}>nobody — no one holds this role</span> : 'the team'}{since(s.since)}</>
    case 'returned':
      return <>Returned{s.by ? <> by <b>{s.by}</b></> : ''}{s.at ? ` on ${dayLabel(s.at)}` : ''}{s.remark ? <span style={{ display: 'block', color: TK.inkSoft, marginTop: 2 }}>“{s.remark}”</span> : null}</>
    case 'skipped':
      return <>Not on record — the code was generated without it</>
    default:
      return s.key === 'HR_MANAGER' ? <>Starts when the candidate submits the form{who ? ` · ${who}` : ''}</>
        : s.key === 'CODE' ? <>After IT, Admin and Payroll approve{who ? ` · ${who}` : ''}</>
        : <>Starts after the HR Manager accepts{who ? ` · ${who}` : ''}</>
  }
}

function Step({ s, holdersKnown, last }: { s: TrailStep; holdersKnown: boolean; last: boolean }) {
  const st = STATE[s.state], k = toneOf(st.t)
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '20px minmax(0,1fr)', gap: 10, position: 'relative', paddingBottom: last ? 0 : 12 }}>
      {!last && <span aria-hidden="true" style={{ position: 'absolute', left: 9, top: 20, bottom: 0, width: 2, background: TK.line }} />}
      <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: R.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
        background: s.state === 'not_started' ? TK.surface : k.bg, color: k.fg, border: `1.5px solid ${s.state === 'not_started' ? TK.lineStrong : k.edge}` }}>{st.mark}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: s.state === 'not_started' ? TK.muted : TK.ink }}>{s.label}</span>
          {s.state === 'waiting' && <span style={{ fontSize: 10.5, fontWeight: 700, color: TK.warning, textTransform: 'uppercase', letterSpacing: '.05em' }}>Now</span>}
        </div>
        <div style={{ fontSize: 12, color: TK.muted, marginTop: 1, lineHeight: 1.45 }}>{stepLine(s, holdersKnown)}</div>
      </div>
    </li>
  )
}

/** The popover's content. */
export function ApprovalTrailPanel({ name, trail, holdersKnown, managers, readiness }: {
  name: string; trail: Trail; holdersKnown: boolean; managers?: ReportingLine | null; readiness?: Readiness[]
}) {
  const head = toneOf(trail.tone)
  const line = managers && (managers.l1 || managers.l2 || managers.hod)
  return (
    <div>
      <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${TK.line}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: TK.muted }}>Approvals · {name}</div>
          {!trail.beforeSubmit && <div style={{ fontSize: 11.5, fontWeight: 700, color: TK.inkSoft, whiteSpace: 'nowrap' }}>{trail.approved} of {trail.total}</div>}
        </div>
        <div style={{ marginTop: 6, padding: '6px 9px', borderRadius: R.sm, background: head.bg, border: `1px solid ${head.edge}`, color: TK.ink, fontSize: 12.5 }}>
          <span style={{ fontWeight: 700, color: head.fg }}>Now with: </span>{trail.nowWith}
        </div>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: '12px 14px' }}>
        {trail.steps.map((s, i) => <Step key={s.key} s={s} holdersKnown={holdersKnown} last={i === trail.steps.length - 1} />)}
      </ol>
      {line && (
        <div style={{ padding: '9px 14px', borderTop: `1px solid ${TK.line}`, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TK.muted }}>Reports to</span>
          {([['L1', managers!.l1], ['L2', managers!.l2], ['HOD', managers!.hod]] as const).map(([k, v]) => (
            <span key={k}><span style={{ color: TK.muted, fontWeight: 700, fontSize: 10.5, marginRight: 4 }}>{k}</span>{v || <span style={{ color: TK.faint }}>—</span>}</span>
          ))}
        </div>
      )}
      {readiness && readiness.length > 0 && (
        <div style={{ padding: '9px 14px 12px', borderTop: `1px solid ${TK.line}` }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: TK.muted, marginBottom: 6 }}>Joining readiness · {readiness.filter(r => r.done).length}/{readiness.length}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {readiness.map(r => {
              const k = toneOf(r.done ? 'positive' : 'neutral')
              return <span key={r.label} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: R.pill, background: k.bg, color: r.done ? k.fg : TK.inkSoft, border: `1px solid ${k.edge}` }}>{r.done ? '✓ ' : ''}{r.label}</span>
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Four segments: one per team approval. */
function Meter({ trail }: { trail: Trail }) {
  const seg = trail.steps.filter(s => s.key !== 'CODE')
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
      {seg.map(s => {
        const bg = s.state === 'done' ? TK.positive : s.state === 'returned' ? TK.critical : s.state === 'waiting' ? TK.warning : TK.lineStrong
        return <span key={s.key} style={{ width: 7, height: 4, borderRadius: R.pill, background: bg }} />
      })}
    </span>
  )
}

/** The table cell: the summary, opening the trail on hover / click / tap / keyboard. */
export function ApprovalsCell({ name, trail, holdersKnown, managers, readiness }: {
  name: string; trail: Trail; holdersKnown: boolean; managers?: ReportingLine | null; readiness?: Readiness[]
}) {
  const k = toneOf(trail.tone)
  const waiting = trail.steps.filter(s => s.state === 'waiting')
  const sub = trail.beforeSubmit ? (trail.summary === 'Returned' ? 'back with the candidate' : 'after the form is submitted')
    : waiting.length ? peopleLine(waiting.flatMap(s => s.people), 1) || 'see who' : trail.summary === 'Complete' ? 'all signed off' : ''
  return (
    <AnchoredPopover hover width={360} label={`Approvals for ${name}: ${trail.summary}. Now with ${trail.nowWith}`}
      triggerStyle={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '4px 8px', margin: '-4px -8px', borderRadius: R.sm,
        border: '1px solid transparent', background: 'transparent', color: TK.ink, textAlign: 'left', maxWidth: 160 }}
      trigger={<>
        <span style={{ fontSize: 12, fontWeight: 700, color: trail.beforeSubmit && trail.tone === 'neutral' ? TK.muted : k.fg, whiteSpace: 'nowrap' }}>{trail.summary}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 150, fontSize: 11, color: TK.muted }}>
          {!trail.beforeSubmit && <Meter trail={trail} />}
          {sub && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: `1px dotted ${TK.lineStrong}` }}>{sub}</span>}
        </span>
      </>}>
      <ApprovalTrailPanel name={name} trail={trail} holdersKnown={holdersKnown} managers={managers} readiness={readiness} />
    </AnchoredPopover>
  )
}
