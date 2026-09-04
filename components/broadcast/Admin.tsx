'use client'
// components/broadcast/Admin.tsx — the inbox admin setup for the channel.
//
// Two jobs, deliberately on one screen:
//
//   Compose        write the notice and send it to everybody
//   Who can post   the publisher list, which is what makes this a channel
//                  the company controls rather than one HR happens to own
//
// They belong together because the second is the answer to the first
// question anybody asks about the first ("who else can do this?"), and
// splitting them means the permission screen is never found.

import { useState } from 'react'
import { C, F, W, S, R } from '@/lib/ui'
import { checkDraft, canPublish, audienceLine, PRIORITY_LABEL, PRIORITY_MEANING,
         type Draft, type Priority, type Publisher, type Broadcast }
  from '@/lib/broadcast/channel'

const PRIORITIES: Priority[] = ['NORMAL', 'IMPORTANT', 'URGENT']

function Card({ title, sub, children }: {
  title: string; sub?: string; children: React.ReactNode
}) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`,
                      borderRadius: R.lg, padding: '16px 18px', marginBottom: S.md }}>
      <h3 style={{ margin: 0, fontSize: F.body, fontWeight: W.bold, color: C.ink }}>{title}</h3>
      {sub && <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3,
                            marginBottom: 12, lineHeight: 1.6 }}>{sub}</div>}
      {!sub && <div style={{ height: 12 }} />}
      {children}
    </section>
  )
}

const field: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: R.sm, fontSize: F.small,
  fontFamily: 'inherit', background: C.surface, color: C.ink,
  border: `1px solid ${C.line}`,
}
const label: React.CSSProperties = {
  display: 'block', fontSize: F.micro, fontWeight: W.bold, color: C.inkSoft,
  textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5,
}

// ── compose ──────────────────────────────────────────────────────────────

export function Compose({ me, publishers, headcount, departments, onSend, sending }: {
  me: string
  publishers: Publisher[]
  headcount: number | null
  departments: { id: string; name: string }[]
  onSend?: (d: Draft) => void
  sending?: boolean
}) {
  const [d, setD] = useState<Draft>({ title: '', body: '', priority: 'NORMAL',
                                      sourceDepartmentId: null, isPinned: false })
  const check = checkDraft(d, publishers, me)
  const may = canPublish(me, publishers)
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })

  if (!may.allowed) {
    return (
      <Card title="You cannot publish to this channel">
        <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.7, maxWidth: 560 }}>
          {may.because} The list below shows who currently can — it is not a secret,
          because knowing who speaks for the company is most of what makes a notice
          believable.
        </div>
      </Card>
    )
  }

  return (
    <Card title="Write a broadcast"
          sub="It reaches everybody in the company at once, and nobody can reply to it in public.">
      <div style={{ display: 'grid', gap: S.md }}>
        <div>
          <label htmlFor="bc-title" style={label}>Subject</label>
          <input id="bc-title" style={field} value={d.title}
                 onChange={e => set({ title: e.target.value })}
                 placeholder="What this is about, in one line" />
        </div>

        <div>
          <label htmlFor="bc-body" style={label}>Message</label>
          <textarea id="bc-body" rows={7} style={{ ...field, resize: 'vertical' }}
                    value={d.body} onChange={e => set({ body: e.target.value })}
                    placeholder="What changed, when it takes effect, and who to ask about it. Nobody can reply here, so answer the obvious question before it is asked." />
        </div>

        <div style={{ display: 'grid', gap: S.md,
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))' }}>
          <div>
            <label htmlFor="bc-pri" style={label}>Priority</label>
            <select id="bc-pri" style={field} value={d.priority}
                    onChange={e => set({ priority: e.target.value as Priority })}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 5, lineHeight: 1.6 }}>
              {PRIORITY_MEANING[d.priority]}
            </div>
          </div>

          <div>
            <label htmlFor="bc-dept" style={label}>From which department</label>
            <select id="bc-dept" style={field} value={d.sourceDepartmentId ?? ''}
                    onChange={e => set({ sourceDepartmentId: e.target.value || null })}>
              <option value="">The company</option>
              {departments.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 5, lineHeight: 1.6 }}>
              Says who is speaking. It does not narrow who receives it — everybody does.
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                        fontSize: F.small, color: C.inkSoft, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!d.isPinned} style={{ marginTop: 3 }}
                 onChange={e => set({ isPinned: e.target.checked })} />
          <span>
            Pin to the top
            <span style={{ display: 'block', fontSize: F.micro, color: C.muted,
                           marginTop: 2, lineHeight: 1.6 }}>
              Stays first until somebody unpins it. Nothing unpins on its own — an
              expiry that quietly drops a live safety notice is worse than one somebody
              has to clear.
            </span>
          </span>
        </label>

        {check.faults.length > 0 && (
          <Note tone="bad" title="Before this can go out">{check.faults}</Note>
        )}
        {check.ok && check.warnings.length > 0 && (
          <Note tone="warn" title="Worth a second look">{check.warnings}</Note>
        )}

        <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={!check.ok || sending || !onSend}
                  onClick={() => onSend?.(d)}
                  style={{ cursor: check.ok ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                           fontSize: F.small, fontWeight: W.bold, padding: '10px 18px',
                           borderRadius: R.sm, border: 'none',
                           background: check.ok ? C.brand : C.sunken,
                           color: check.ok ? C.onAccent : C.faint }}>
            {sending ? 'Sending…' : 'Send to everybody'}
          </button>
          <span style={{ fontSize: F.micro, color: C.muted }}>
            {audienceLine(headcount)}
          </span>
        </div>
      </div>
    </Card>
  )
}

function Note({ tone, title, children }: {
  tone: 'bad' | 'warn'; title: string; children: string[]
}) {
  const fg = tone === 'bad' ? C.critical : C.warning
  const bg = tone === 'bad' ? C.criticalTint : C.warningTint
  return (
    <div style={{ background: bg, border: `1px solid ${fg}`, borderRadius: R.sm,
                  padding: '10px 13px' }}>
      <div style={{ fontSize: F.small, fontWeight: W.bold, color: fg }}>{title}</div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: F.small, color: fg,
                   lineHeight: 1.7 }}>
        {children.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
    </div>
  )
}

// ── who can post ─────────────────────────────────────────────────────────

export function PublisherSetup({ publishers, staff, onGrant, onRevoke, busy }: {
  publishers: Publisher[]
  staff: { id: string; name: string; code?: string | null }[]
  onGrant?: (employeeId: string, reason: string) => void
  onRevoke?: (employeeId: string, reason: string) => void
  busy?: boolean
}) {
  const [pick, setPick] = useState('')
  const [reason, setReason] = useState('')
  const active = publishers.filter(p => p.isActive)
  const revoked = publishers.filter(p => !p.isActive)

  return (
    <Card title="Who can post to this channel"
          sub="A list of people, not a job title — so it does not need a developer when the person changes, and it does not exclude somebody senior who holds no HR role.">
      {active.length === 0 ? (
        <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.7,
                      background: C.warningTint, border: `1px solid ${C.warning}`,
                      borderRadius: R.sm, padding: '11px 13px' }}>
          <strong style={{ color: C.warning }}>Nobody can publish yet.</strong> Until
          somebody is added here the channel is silent — the database refuses a
          broadcast from anyone not on this list, so this is not a formality.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.small }}>
            <thead>
              <tr>
                {['Who', 'Added by', 'Why', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0 10px 8px',
                                       fontSize: F.micro, fontWeight: W.bold,
                                       textTransform: 'uppercase', letterSpacing: '.05em',
                                       color: C.muted, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map(p => (
                <tr key={p.employeeId} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ padding: '9px 10px', fontWeight: W.semi, color: C.ink }}>
                    {p.name}
                  </td>
                  <td style={{ padding: '9px 10px', color: C.muted }}>
                    {p.grantedBy ?? '—'}
                  </td>
                  <td style={{ padding: '9px 10px', color: C.muted }}>
                    {p.grantReason || <span style={{ color: C.faint }}>no reason recorded</span>}
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    <button type="button" disabled={!onRevoke || busy}
                      onClick={() => onRevoke?.(p.employeeId, '')}
                      style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: F.micro,
                               fontWeight: W.semi, padding: '5px 11px', borderRadius: R.sm,
                               border: `1px solid ${C.line}`, background: C.surface,
                               color: C.critical }}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* min(180px, 100%) rather than a flat 180px minimum. A fixed minimum
          cannot shrink below itself, so three columns needed 540px and the
          row pushed the whole page sideways at 430px and under. These are
          inline styles, so there is no media query to fall back on — the
          track itself has to be able to give way. */}
      <div style={{ marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${C.line}`,
                    display: 'grid', gap: S.sm,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
                    alignItems: 'end' }}>
        <div>
          <label htmlFor="bc-who" style={label}>Add somebody</label>
          <select id="bc-who" style={field} value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">Choose an employee</option>
            {staff.filter(s => !active.some(a => a.employeeId === s.id)).map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bc-why" style={label}>Why</label>
          <input id="bc-why" style={field} value={reason}
                 onChange={e => setReason(e.target.value)}
                 placeholder="Head of Communications" />
        </div>
        <button type="button" disabled={!pick || !reason.trim() || busy || !onGrant}
          onClick={() => { onGrant?.(pick, reason.trim()); setPick(''); setReason('') }}
          style={{ cursor: pick && reason.trim() ? 'pointer' : 'not-allowed',
                   fontFamily: 'inherit', fontSize: F.small, fontWeight: W.bold,
                   padding: '10px 16px', borderRadius: R.sm, border: 'none',
                   background: pick && reason.trim() ? C.brand : C.sunken,
                   color: pick && reason.trim() ? C.onAccent : C.faint }}>
          Add
        </button>
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
        A reason is required. In a year somebody will ask why a name is on this list, and
        &ldquo;granted by X on this date, because Y&rdquo; is the difference between an
        answer and a shrug.
      </div>

      {revoked.length > 0 && (
        <div style={{ marginTop: S.md, paddingTop: S.md, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: F.micro, fontWeight: W.bold, textTransform: 'uppercase',
                        letterSpacing: '.05em', color: C.faint, marginBottom: 6 }}>
            Removed
          </div>
          <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.8 }}>
            {revoked.map(p => p.name).join(' · ')}
          </div>
          <div style={{ fontSize: F.micro, color: C.faint, marginTop: 4 }}>
            Kept rather than deleted, so the record of who could once speak for the
            company survives the removal.
          </div>
        </div>
      )}
    </Card>
  )
}

// ── what came back ───────────────────────────────────────────────────────

export function Responses({ rows, onOpen }: {
  rows: { id: string; broadcastTitle: string; authorName: string; body: string
          createdAt: string; readAt: string | null }[]
  onOpen?: (id: string) => void
}) {
  return (
    <Card title="Replies to you"
          sub="Private answers to broadcasts you published. Only you can see these — the sender knows that, which is why they used it.">
      {rows.length === 0 ? (
        <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.7 }}>
          Nothing yet. Employees cannot reply in public, so anything they send about a
          notice arrives here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: S.sm }}>
          {rows.map(r => (
            <div key={r.id} onMouseEnter={() => !r.readAt && onOpen?.(r.id)}
                 style={{ border: `1px solid ${r.readAt ? C.line : C.brand}`,
                          borderRadius: R.sm, padding: '11px 13px',
                          background: r.readAt ? C.surface : C.brandTint }}>
              <div style={{ fontSize: F.micro, color: C.muted }}>
                <strong style={{ color: C.ink }}>{r.authorName}</strong> · on {r.broadcastTitle}
              </div>
              <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 5,
                            lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{r.body}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
