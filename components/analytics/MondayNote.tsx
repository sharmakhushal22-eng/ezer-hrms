'use client'
// components/analytics/MondayNote.tsx — a manager's start of the week (ESS → Insights →
// My team): how the team is, the one thing to do first, who is out, what is waiting,
// the dates that matter, and a way to open a conversation with anyone showing several
// warning signs. The same note can arrive by email on Monday morning
// (app/api/cron/analytics-digest).

import * as React from 'react'
import { C, F, W, R, S } from '@/lib/ui'
import type { TeamAnalytics } from '@/lib/analytics/types'
import type { MondayNote as Note } from '@/lib/analytics/briefs'
import { dLabel, dLabelLong } from '@/lib/analytics/format'
import { addDays } from '@/lib/analytics/period'
import { WrittenCard, AiMark, SourceLine, type WrittenState } from './Written'
import { Pill } from './charts'
import { usePrinting } from './printing'
import { api } from '@/lib/ess/api'

export function MondayNoteCard({ d, state, today, extra }: { d: TeamAnalytics; state: WrittenState<Note>; today: string; extra?: React.ReactNode }) {
  const printing = usePrinting()
  const n = state.res?.result
  const week = d.upcoming.filter(u => u.date >= today && u.date <= addDays(today, 7))
  const waiting = d.approvals.leave + d.approvals.regularisation + d.performance.awaitingYou
  return (
    <WrittenCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginBottom: S.md }}>
        <AiMark label="Your Monday note" ai={n?.source === 'ai'} />
        {n && <span style={{ fontSize: F.tiny, color: C.muted }}>· week of {n.weekOf}</span>}
        <span style={{ flex: 1 }} />
        {!printing && extra}
      </div>
      {!n && !state.error && <div style={{ fontSize: F.small, color: C.muted }}>Putting your week together…</div>}
      {state.error && !n && <div style={{ fontSize: F.small, color: C.muted }}>{state.error}</div>}
      {n && (
        <div style={{ opacity: state.busy ? 0.6 : 1, transition: 'opacity .2s' }}>
          <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink }}>{n.greeting}</div>
          <p style={{ margin: '4px 0 0', fontSize: F.small, color: C.inkSoft, lineHeight: 1.6 }}>{n.summary}</p>
          <div style={{ margin: `${S.md}px 0`, padding: '10px 14px', borderRadius: R.md, background: C.brandTint, border: `1px solid ${C.brandEdge}` }}>
            <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brandDeep, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>This week, start with</div>
            <div style={{ fontSize: F.small, color: C.ink, fontWeight: W.medium, lineHeight: 1.5 }}>{n.focus}</div>
          </div>
          <div style={{ display: 'grid', gap: S.md, gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
            <Box title={`Out this week · ${d.outThisWeek.length}`}>
              {d.outThisWeek.length ? d.outThisWeek.slice(0, 6).map(o => <Line key={o.name + o.from} main={o.name} side={`${o.type} · ${dLabel(o.from)}–${dLabel(o.to)}`} />) : <Quiet>Everyone is in.</Quiet>}
              {d.outThisWeek.length > 6 && <Quiet>and {d.outThisWeek.length - 6} more</Quiet>}
            </Box>
            <Box title={`Waiting on you · ${waiting}`}>
              <Line main="Leave requests" side={String(d.approvals.leave)} warn={d.approvals.leave > 0} />
              <Line main="Attendance corrections" side={String(d.approvals.regularisation)} warn={d.approvals.regularisation > 0} />
              <Line main="Reviews to rate" side={String(d.performance.awaitingYou)} warn={d.performance.awaitingYou > 0} />
              {d.approvals.oldestDays != null && <Quiet>Oldest has waited {d.approvals.oldestDays} day{d.approvals.oldestDays === 1 ? '' : 's'}.</Quiet>}
            </Box>
            <Box title={`Dates this week · ${week.length}`}>
              {week.length ? week.slice(0, 6).map(u => <Line key={u.kind + u.name + u.date} main={u.name} side={`${u.note} · ${dLabelLong(u.date)}`} warn={u.kind === 'probation'} />) : <Quiet>No birthdays, anniversaries or probation dates.</Quiet>}
            </Box>
          </div>
          {n.openers.length > 0 && (
            <div style={{ marginTop: S.lg }}>
              <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: S.sm }}>Conversation openers</div>
              <div style={{ display: 'grid', gap: S.sm }}>
                {n.openers.map(o => (
                  <div key={o.id} style={{ padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: R.md }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: F.small, color: C.ink }}>{o.name}</strong>
                      {o.signals.slice(0, 3).map(s => <Pill key={s}>{s}</Pill>)}
                    </div>
                    <div style={{ marginTop: 6, fontSize: F.small, color: C.inkSoft, lineHeight: 1.55, fontStyle: 'italic' }}>“{o.opener}”</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: F.micro, color: C.faint, marginTop: 6 }}>A way to start a one-to-one, not a script. The signs are prompts for a conversation, never a verdict — only you and HR see them.</div>
            </div>
          )}
          <SourceLine state={state} />
        </div>
      )}
    </WrittenCard>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', background: C.sunken, borderRadius: R.md, minWidth: 0 }}>
      <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'grid', gap: 5 }}>{children}</div>
    </div>
  )
}
function Line({ main, side, warn }: { main: string; side: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2px 8px', fontSize: F.tiny, flexWrap: 'wrap' }}>
      <span style={{ color: C.ink, minWidth: 0 }}>{main}</span>
      <span style={{ color: warn ? C.warning : C.muted, fontWeight: warn ? W.semi : W.regular, textAlign: 'right', marginLeft: 'auto' }}>{side}</span>
    </div>
  )
}
const Quiet = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: F.tiny, color: C.muted }}>{children}</div>

/** "Email me this on Mondays" — shown only when HR has switched the Monday email on. */
export function MondayEmailToggle({ employeeId }: { employeeId: string }) {
  const [st, setSt] = React.useState<{ on: boolean; off: boolean } | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let live = true
    api('/api/analytics/digest', employeeId).then(b => { if (live && b.ready && b.mondayOn) setSt({ on: true, off: !!b.me?.mondayOptedOut }) }, () => { /* not offered */ })
    return () => { live = false }
  }, [employeeId])
  if (!st) return null
  const flip = async (want: boolean) => {
    setBusy(true)
    try { await api('/api/analytics/digest', employeeId, { method: 'POST', body: JSON.stringify({ action: 'optout', kind: 'monday_note', off: !want }) }); setSt({ on: true, off: !want }) }
    catch { /* leave as it was */ } finally { setBusy(false) }
  }
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: F.tiny, color: C.inkSoft, cursor: busy ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={!st.off} disabled={busy} onChange={e => flip(e.target.checked)} style={{ accentColor: C.brand }} />
      Email me this on Mondays
    </label>
  )
}
