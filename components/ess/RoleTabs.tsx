'use client'
// components/ess/RoleTabs.tsx — the role-wise ESS screens (EZER-ESS-RM-HRHead-View.html
// mapped onto the live design tokens, answers G1):
//
//   useEssMenu      the nav as data — /api/ess/menu; nothing here compares a role code
//   PendingOnYou    Home card: KPIs + "pending on you" with inline actions
//   TeamRoster      scope-aware roster with the status pill (MyTeam, RM / HOD only)
//   ApprovalsSection  full list, actions, resignation chain viewer
//   CompanySection  headcount by department, exit reasons, regime election
//   ReportsSection  five reports, CSV export
//   ExitSection     the employee's own resignation: submit / chain / withdraw
//
// Every screen fetches its own scoped data; the same component renders for an
// employee, an RM and an HR Head because the query differs, not the component.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { authToken } from '@/lib/rms/client'
import { C as TK } from '@/lib/ui'
import MrfForm from './MrfForm'

const C = {
  ink: '#1E1B4B', muted: '#6B7280', faint: '#9CA3AF', border: 'rgba(124,58,237,0.12)', card: '#FFFFFF',
  purple: '#7C3AED', purpleD: '#6D28D9', soft: 'rgba(124,58,237,0.08)', green: '#059669', greenBg: '#ECFDF5',
  amber: '#B45309', amberBg: '#FFFBEB', red: '#DC2626', redBg: '#FEF2F2', blue: '#2563EB', blueBg: '#EFF6FF', bg: '#F5F3FF',
}
const S = {
  card: { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: '14px 16px', marginBottom: 10, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as React.CSSProperties,
  section: { fontSize: 12, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 } as React.CSSProperties,
  btn: { padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', background: C.purple, color: '#fff' } as React.CSSProperties,
  btnO: { padding: '6px 12px', borderRadius: 7, border: '1px solid #DDD6FE', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: C.purpleD, whiteSpace: 'nowrap' } as React.CSSProperties,
  btnD: { padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(220,38,38,.2)', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: C.redBg, color: C.red, whiteSpace: 'nowrap' } as React.CSSProperties,
  input: { width: '100%', padding: '9px 11px', background: '#FAFAF8', border: '1px solid #DDD6FE', borderRadius: 7, color: C.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' } as React.CSSProperties,
  label: { fontSize: 11, fontWeight: 600, color: C.purpleD, textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 4 } as React.CSSProperties,
  th: { background: C.ink, color: '#fff', textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' } as React.CSSProperties,
  td: { padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, verticalAlign: 'middle' } as React.CSSProperties,
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as React.CSSProperties,
  note: (tone: 'w' | 'd' | 'g' | 'i' = 'i') => ({
    fontSize: 12, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, marginTop: 10,
    background: tone === 'w' ? C.amberBg : tone === 'd' ? C.redBg : tone === 'g' ? C.greenBg : C.bg,
    color: tone === 'w' ? '#8a5a08' : tone === 'd' ? '#9b1c1c' : tone === 'g' ? '#046c4e' : C.muted,
    borderLeft: `3px solid ${tone === 'w' ? C.amber : tone === 'd' ? C.red : tone === 'g' ? C.green : C.purple}`,
  }) as React.CSSProperties,
}
const pill = (tone: 'ok' | 'warn' | 'dang' | 'info' | 'mut') => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  background: tone === 'ok' ? C.greenBg : tone === 'warn' ? C.amberBg : tone === 'dang' ? C.redBg : tone === 'info' ? C.blueBg : C.bg,
  color: tone === 'ok' ? C.green : tone === 'warn' ? C.amber : tone === 'dang' ? C.red : tone === 'info' ? C.blue : C.muted,
  border: tone === 'mut' ? `1px solid ${C.border}` : 'none',
}) as React.CSSProperties

// ── fetch helper: ESS token or the dashboard session; employee_id always sent so the
//    admin preview (legacy login) can name whose portal it is looking at ─────────
async function api(path: string, employeeId: string, init?: RequestInit) {
  const token = await authToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
    ...init, cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
  return body
}

export interface EssMenuData {
  tabs: { id: string; label: string }[]
  is_rm: boolean; direct_reports: number; is_hod: boolean; hod_departments: string[]
  roles: { code: string; name: string; scope: string | null }[]
  approval_types: string[]
  /** Module name → NONE | VIEW | EDIT | FULL, for the employee whose portal this is. */
  modules: Record<string, string>
  can: { approvals: boolean; company: boolean; reports: boolean }
  super_admin: boolean; view_as: boolean
}
const EMPTY_MENU: EssMenuData = { tabs: [{ id: 'home', label: 'Home' }], is_rm: false, direct_reports: 0, is_hod: false, hod_departments: [], roles: [], approval_types: [], modules: {}, can: { approvals: false, company: false, reports: false }, super_admin: false, view_as: false }

export function useEssMenu(employeeId: string | null | undefined) {
  const [menu, setMenu] = useState<EssMenuData>(EMPTY_MENU)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!employeeId) return
    let live = true
    api('/api/ess/menu', employeeId)
      .then(m => { if (live) { setMenu(m); setError('') } })
      .catch(e => { if (live) setError(e?.message || String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [employeeId])
  return { menu, loading, error }
}

// ── shared bits ────────────────────────────────────────────────────────────
function Kpis({ items }: { items: { label: string; value: string | number; note?: string; tone?: 'ok' | 'warn' | 'dang' }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 10 }}>
      {items.map(k => (
        <div key={k.label} style={{ ...S.card, marginBottom: 0, padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: C.muted, textTransform: 'uppercase' }}>{k.label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, letterSpacing: '-.3px', color: k.tone === 'dang' ? C.red : k.tone === 'warn' ? C.amber : k.tone === 'ok' ? C.green : C.ink }}>{k.value}</div>
          {k.note && <div style={{ fontSize: 11, color: C.faint }}>{k.note}</div>}
        </div>
      ))}
    </div>
  )
}

interface PendingItem {
  kind: 'LEAVE' | 'TRAVEL' | 'RESIGNATION'; id: string; employee_id: string; who: string; what: string; meta: string; stage: string
  raised_at: string | null; surfaced_via: string; mine: boolean; actions: string[]; tone?: 'w' | 'd'; link?: string
}

/** One pending item with its actions. Resignation actions that need input (a date,
 *  a note) open a small inline form instead of firing blind. */
function PendingCard({ item, employeeId, go, onDone }: { item: PendingItem; employeeId: string; go: (k: string) => void; onDone: (msg: string) => void }) {
  const [ask, setAsk] = useState<string | null>(null)     // which action is collecting input
  const [note, setNote] = useState('')
  const [lwd, setLwd] = useState('')
  const [regret, setRegret] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [chain, setChain] = useState<any[] | null>(null)

  const needsInput = (a: string) => ['Accept with my date', 'Request retention', 'Set final LWD', 'Decline'].includes(a)
  async function fire(a: string) {
    setErr('')
    if (a === 'Open claim') { go(item.link || 'claims'); return }
    if (a === 'View' ) return
    if (a === 'View full chain') {
      try { const r = await api(`/api/ess/approvals?resignation_id=${item.id}`, employeeId); setChain(r.chain || []) } catch (e: any) { setErr(e.message) }
      return
    }
    if (needsInput(a) && ask !== a) { setAsk(a); return }
    if (a === 'Set final LWD' && !lwd) { setErr('Pick the final last working day'); return }
    setBusy(true)
    try {
      await api('/api/ess/approvals', employeeId, { method: 'POST', body: JSON.stringify({ kind: item.kind, id: item.id, action: a, note: note || null, lwd: lwd || null, regrettable: regret }) })
      onDone(`${a} — done`)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8, opacity: busy ? .6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{item.who}</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{item.what}</div>
        </div>
        <span style={pill(item.mine ? 'warn' : 'mut')}>{item.mine ? item.stage : `${item.stage} · ${item.surfaced_via}`}</span>
      </div>
      {item.meta && <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>{item.meta}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {item.actions.map((a, i) => (
          <button key={a} disabled={busy} onClick={() => fire(a)}
            style={i === 0 && item.mine && a !== 'View' ? S.btn : /decline|retention/i.test(a) ? S.btnD : S.btnO}>{a}</button>
        ))}
      </div>
      {ask && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: C.bg, display: 'grid', gap: 8 }}>
          {(ask === 'Accept with my date' || ask === 'Set final LWD') && (
            <div><label style={S.label}>{ask === 'Set final LWD' ? 'Final last working day' : 'Proposed last working day'}</label><input type="date" value={lwd} onChange={e => setLwd(e.target.value)} style={S.input} /></div>
          )}
          {ask === 'Set final LWD' && (
            <div><label style={S.label}>Regrettable exit?</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setRegret(true)} style={regret === true ? S.btn : S.btnO}>Yes — regrettable</button>
                <button onClick={() => setRegret(false)} style={regret === false ? S.btn : S.btnO}>No</button>
              </div></div>
          )}
          <div><label style={S.label}>{ask === 'Request retention' ? 'What you plan to discuss' : ask === 'Decline' ? 'Reason (shown to the employee)' : 'Note (optional)'}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...S.input, resize: 'vertical' }} /></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={busy} onClick={() => fire(ask)} style={S.btn}>Confirm — {ask}</button>
            <button onClick={() => { setAsk(null); setNote(''); setLwd('') }} style={S.btnO}>Cancel</button>
          </div>
        </div>
      )}
      {item.tone && !ask && <div style={S.note(item.tone)}>{item.tone === 'w' ? 'Time-sensitive.' : 'Needs a conversation, not just a click.'}</div>}
      {err && <div style={{ ...S.note('d'), marginTop: 8 }}>{err}</div>}
      {chain && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
          <div style={S.section}>Full chain</div>
          {chain.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No stage entries yet.</div>}
          {chain.map((c, i) => (
            <div key={i} style={{ fontSize: 12, padding: '4px 0', color: C.ink }}>
              <b>{c.stage}</b> · {c.action.toLowerCase().replace(/_/g, ' ')}{c.approver?.full_name ? ` · ${c.approver.full_name}` : ''}{c.proposed_lwd ? ` · LWD ${c.proposed_lwd}` : ''}
              <span style={{ color: C.faint, marginLeft: 6 }}>{new Date(c.actioned_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              {c.note && <div style={{ color: C.muted, marginLeft: 8 }}>“{c.note}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── HOME card ──────────────────────────────────────────────────────────────
export function PendingOnYou({ employeeId, go, notify }: { employeeId: string; go: (k: string) => void; notify: (m: string, t?: 'success' | 'error') => void }) {
  const [data, setData] = useState<{ kpis: any[]; pending: PendingItem[]; pending_title: string } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api('/api/ess/home', employeeId).then(d => { setData(d); setErr('') }).catch(e => setErr(e.message)), [employeeId])
  useEffect(() => { load() }, [load])
  if (err) return <div style={S.note('w')}>Role-wise home could not load: {err}</div>
  if (!data) return null
  const mine = data.pending.filter(p => p.mine)
  const rest = data.pending.filter(p => !p.mine)
  return (
    <>
      <Kpis items={data.kpis} />
      {(data.pending.length > 0) && (
        <div style={S.card}>
          <div style={S.section}>{data.pending_title}{mine.length ? ` · ${mine.length}` : ''}</div>
          {mine.slice(0, 5).map(p => <PendingCard key={`${p.kind}:${p.id}`} item={p} employeeId={employeeId} go={go} onDone={m => { notify(m); load() }} />)}
          {mine.length > 5 && <button onClick={() => go('approvals')} style={S.btnO}>See all {mine.length} in Approvals →</button>}
          {rest.length > 0 && <div style={S.note()}>{rest.length} more item{rest.length === 1 ? '' : 's'} in your wider scope are listed under Approvals — stamped to somebody else, visible to you for oversight.</div>}
        </div>
      )}
    </>
  )
}

// ── TEAM roster (RM / HOD) ────────────────────────────────────────────────
export function TeamRoster({ employeeId, isHod, isRm }: { employeeId: string; isHod: boolean; isRm: boolean }) {
  const [scope, setScope] = useState<'TEAM' | 'DEPT'>(isRm ? 'TEAM' : 'DEPT')
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    api(`/api/ess/team?scope=${scope}`, employeeId).then(d => { if (live) { setRows(d.rows || []); setErr('') } }).catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [employeeId, scope])
  if (!isRm && !isHod) return null
  return (
    <div style={S.card}>
      <div style={{ ...S.section, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span>{scope === 'DEPT' ? 'My department' : 'My team — direct reports'}{rows ? ` (${rows.length})` : ''}</span>
        {isRm && isHod && (
          <span style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setScope('TEAM')} style={scope === 'TEAM' ? S.btn : S.btnO}>Direct reports</button>
            <button onClick={() => setScope('DEPT')} style={scope === 'DEPT' ? S.btn : S.btnO}>Whole department</button>
          </span>
        )}
      </div>
      {err && <div style={S.note('w')}>{err}</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>Nobody in this scope yet.</div>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Code</th><th style={S.th}>Name</th><th style={S.th}>Designation</th>{scope === 'DEPT' && <th style={S.th}>Reports to you</th>}<th style={S.th}>Status</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace' }}>{r.code || '—'}</td>
                <td style={{ ...S.td, fontWeight: 600 }}>{r.name}</td>
                <td style={S.td}>{r.designation || '—'}{r.department && scope === 'DEPT' ? '' : ''}</td>
                {scope === 'DEPT' && <td style={S.td}>{r.direct ? 'Direct' : '—'}</td>}
                <td style={S.td}><span style={pill(r.tone === 'warn' ? 'warn' : r.tone === 'info' ? 'info' : 'ok')}>{r.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div style={S.note()}>{scope === 'DEPT' ? 'DEPT scope — everyone in the department(s) you head. Company-wide headcount is under the Company tab.' : 'TEAM scope — your direct reports only. Your HOD sees this list plus every other team in the department.'}</div>
    </div>
  )
}

// ── APPROVALS ──────────────────────────────────────────────────────────────
// ── MRF (Manpower Requisition) — raise + approve, shown inside Approvals ──────
export function MrfApprovals({ employeeId, notify }: { employeeId: string; notify: (m: string, t?: 'success' | 'error') => void }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [reviewFor, setReviewFor] = useState<any | null>(null)   // the MRF open in the review popup
  const [reviewStep, setReviewStep] = useState<'details' | 'assign'>('details')
  const [selHr, setSelHr] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api('/api/ess/mrf', employeeId).then(x => { setD(x); setErr('') }).catch(e => setErr(e.message)), [employeeId])
  useEffect(() => { load() }, [load])

  const decide = async (id: string, action: 'approve' | 'reject', extra: Record<string, any> = {}) => {
    const note = action === 'reject' ? (window.prompt('Reason for rejection (optional):') || '') : ''
    setBusy(true)
    try {
      await api('/api/ess/mrf', employeeId, { method: 'POST', body: JSON.stringify({ action, id, note, ...extra }) })
      notify(action === 'approve' ? 'MRF approved.' : 'MRF rejected.'); setReviewFor(null); setSelHr([]); setReviewStep('details'); load()
    } catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  // The role of the step this MRF is currently waiting on.
  const curRole = (m: any) => {
    const ch = Array.isArray(m.approval_chain) ? m.approval_chain : []
    return (ch.find((s: any) => s.status === 'PENDING') || {}).role
  }
  const openReview = (m: any) => { setSelHr([]); setReviewStep('details'); setReviewFor(m) }
  const closeReview = () => { if (!busy) { setReviewFor(null); setSelHr([]); setReviewStep('details') } }
  const acknowledge = async (id: string) => {
    try { await api('/api/ess/mrf', employeeId, { method: 'POST', body: JSON.stringify({ action: 'acknowledge', id }) }); notify('Acknowledged — this MRF is now in your Recruitment.'); load() }
    catch (e: any) { notify(e.message, 'error') }
  }

  if (err) return <div style={S.note('d')}>{err}</div>
  if (!d) return null
  const stepLabel = (m: any) => {
    const ch = Array.isArray(m.approval_chain) ? m.approval_chain : []
    const cur = ch.find((s: any) => s.status === 'PENDING')
    if (m.status === 'APPROVED') return 'Approved'
    if (m.status === 'REJECTED') return 'Rejected'
    return cur ? `With ${cur.role === 'HR_HEAD' ? 'HR Head' : 'RM2'} · ${cur.approver_name}` : m.status
  }

  return (
    <div style={S.card}>
      <div style={S.section}>Hiring Requests · MRF</div>

      {(d.myAssignments && d.myAssignments.length > 0) && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.green, margin: '6px 0 4px' }}>Assigned to you ({d.myAssignments.length})</div>
        {d.myAssignments.map((m: any) => (
          <div key={m.id} style={{ borderBottom: `1px solid ${C.border}`, padding: '9px 0', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{m.designation || m.position} · {m.no_of_openings || m.openings || 1} opening(s)</div>
              <div style={{ fontSize: 11.5, color: C.muted }}>{m.departments?.dept_name || '—'} · You’ve been assigned to hire for this — run it in Recruitment.</div>
            </div>
            {m.acknowledged
              ? <span style={pill('ok')}>Acknowledged ✓</span>
              : <button style={{ ...S.btn, background: C.green }} onClick={() => acknowledge(m.id)}>Acknowledge</button>}
          </div>
        ))}
      </>}

      {d.toApprove.length > 0 && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, margin: '6px 0 4px' }}>Waiting on you ({d.toApprove.length})</div>
        {d.toApprove.map((m: any) => (
          <div key={m.id} style={{ borderBottom: `1px solid ${C.border}`, padding: '8px 0' }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.designation || m.position} · {m.no_of_openings || m.openings || 1} opening(s)</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>{m.departments?.dept_name || '—'} · raised by {m.raised_by_name || '—'}{m.raised_by_role ? ` (${m.raised_by_role})` : ''} · {m.urgency || 'Normal'}</div>
            {m.reason && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{m.reason}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button style={{ ...S.btn, background: C.green }} onClick={() => openReview(m)}>Review &amp; Approve</button>
              <button style={S.btnD} onClick={() => decide(m.id, 'reject')}>Reject</button>
            </div>
          </div>
        ))}
      </>}

      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, margin: '10px 0 4px' }}>My requests ({d.mine.length})</div>
      {d.mine.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>You haven’t raised any MRF yet.</div>}
      {d.mine.map((m: any) => (
        <div key={m.id} style={{ borderBottom: `1px solid ${C.border}`, padding: '7px 0', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.designation || m.position} · {m.no_of_openings || m.openings || 1}</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>{m.departments?.dept_name || '—'}</div>
          </div>
          <span style={{ fontSize: 11.5, alignSelf: 'center', fontWeight: 600, color: m.status === 'APPROVED' ? C.green : m.status === 'REJECTED' ? C.red : C.amber }}>{stepLabel(m)}</span>
        </div>
      ))}

      {reviewFor && createPortal((() => {
        const m = reviewFor
        const isHrHead = curRole(m) === 'HR_HEAD'
        const onAssignStep = isHrHead && reviewStep === 'assign'
        const money = (v: any) => (v || v === 0) ? `₹${Number(v).toLocaleString('en-IN')}` : ''
        const groups: [string, [string, any][]][] = [
          ['Position', [
            ['Designation', m.designation || m.position], ['Job Title', m.job_title], ['No. of Openings', m.no_of_openings || m.openings || 1],
            ['Company', m.companies?.company_name], ['Department', m.departments?.dept_name], ['Location', m.locations?.location_name],
            ['Business Unit', m.business_unit], ['Grade', m.grade], ['Job Code', m.job_code],
            ['Employment Type', m.employment_type], ['Work Mode', m.work_mode],
          ]],
          ['Budget & Cost', [
            ['Budget', (m.budget_min || m.budget_max) ? `${money(m.budget_min)} – ${money(m.budget_max)}${m.pay_period === 'MONTHLY' ? ' /mo' : m.pay_period === 'ANNUAL' ? ' /yr' : ''}` : ''],
            ['Cost Center', m.cost_center], ['Budgeted', m.is_budgeted === true ? 'Yes' : m.is_budgeted === false ? 'No' : ''], ['Headcount Ref', m.headcount_ref],
          ]],
          ['Candidate Requirements', [
            ['Experience', (m.experience_min || m.experience_max) ? `${m.experience_min ?? '—'}–${m.experience_max ?? '—'} yrs` : ''],
            ['Education', (m.education_min || m.education_max) ? `${m.education_min || 'Any'} – ${m.education_max || 'Any'}` : ''],
            ['Mandatory Skills', m.skills_required], ['Good-to-have Skills', m.good_to_have_skills],
          ]],
          ['Timeline & Meta', [
            ['Type', m.mrf_type], ['Requisition', m.hiring_type], ['Priority', m.urgency],
            ['Reason for Hire', m.reason || m.reason_for_hire], ['Sourcing', m.sourcing_mode],
            ['Target Joining', m.target_joining_date], ['Validity', m.validity_date],
            ['MRF No.', m.mrf_number], ['Raised by', m.raised_by_name ? `${m.raised_by_name}${m.raised_by_role ? ` (${m.raised_by_role})` : ''}` : ''],
          ]],
        ]
        const wide = new Set(['Mandatory Skills', 'Good-to-have Skills', 'Reason for Hire'])
        return (
          <div onClick={closeReview} style={{ position: 'fixed', inset: 0, background: 'rgba(30,27,75,.5)', backdropFilter: 'blur(2px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(620px,96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(30,27,75,.4)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '16px 22px 14px', background: `linear-gradient(135deg, ${C.purple}, #4F46E5)`, color: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{m.designation || m.position}</div>
                  <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,.22)', borderRadius: 99, padding: '2px 9px' }}>{m.no_of_openings || m.openings || 1} opening{(m.no_of_openings || m.openings || 1) > 1 ? 's' : ''}</span>
                  {m.mrf_number && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.85)' }}>{m.mrf_number}</span>}
                </div>
                {isHrHead ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                    {(['details', 'assign'] as const).map((s, i) => (
                      <span key={s} style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: reviewStep === s ? '#fff' : 'rgba(255,255,255,.2)', color: reviewStep === s ? C.purple : 'rgba(255,255,255,.9)' }}>
                        {i + 1}. {s === 'details' ? 'Review' : 'Assign Hiring Manager'}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.85)', marginTop: 4 }}>Review the requisition, then approve below.</div>
                )}
              </div>

              {/* Body */}
              <div style={{ padding: '16px 22px', overflowY: 'auto', flex: 1 }}>
                {!onAssignStep ? (
                  <>
                    {groups.map(([title, gr]) => {
                      const shown = gr.filter(([, v]) => v !== null && v !== undefined && v !== '')
                      if (!shown.length) return null
                      return (
                        <div key={title} style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{title}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 22px', background: C.bg, borderRadius: 9, padding: '4px 14px' }}>
                            {shown.map(([label, v]) => (
                              <div key={label} style={{ padding: '7px 0', borderBottom: `1px solid ${C.border}`, ...(wide.has(label) ? { gridColumn: '1 / -1' } : {}) }}>
                                <div style={{ fontSize: 9, color: C.faint, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 700 }}>{label}</div>
                                <div style={{ fontSize: 12.5, color: C.ink, marginTop: 2, fontWeight: 500 }}>{String(v)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {m.business_justification && (
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.purple, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Business Justification</div>
                        <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.55, background: C.bg, borderRadius: 9, padding: '10px 14px' }}>{m.business_justification}</div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 3 }}>Assign Hiring Manager(s)</div>
                    <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>This requisition is approved. Pick one or more hiring managers to run the hiring.</div>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
                      {(!d.hrOptions || d.hrOptions.length === 0) && <div style={{ fontSize: 12.5, color: C.faint, padding: '16px' }}>No hiring manager found in your company. Assign the “Hiring Manager / Recruiter” role first (ESS &amp; Access → Assign Roles).</div>}
                      {(d.hrOptions || []).map((h: any, i: number) => {
                        const on = selHr.includes(h.id)
                        return (
                          <label key={h.id} style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 14px', cursor: 'pointer', background: on ? C.greenBg : '#fff', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
                            <input type="checkbox" checked={on} onChange={e => setSelHr(s => e.target.checked ? [...s, h.id] : s.filter(x => x !== h.id))} />
                            <span style={{ width: 30, height: 30, borderRadius: '50%', background: on ? C.green : C.soft, color: on ? '#fff' : C.purpleD, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(h.name || '?').split(' ').slice(0, 2).map((x: string) => x[0]).join('').toUpperCase()}</span>
                            <span style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{h.name}</div>
                              <div style={{ fontSize: 11, color: C.faint }}>{h.code} · Hiring Manager</div>
                            </span>
                            {on && <span style={{ fontSize: 15, color: C.green }}>✓</span>}
                          </label>
                        )
                      })}
                    </div>
                    {selHr.length > 0 && <div style={{ fontSize: 11.5, color: C.green, fontWeight: 600, marginTop: 8 }}>{selHr.length} hiring manager{selHr.length > 1 ? 's' : ''} selected</div>}
                  </>
                )}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '13px 22px', borderTop: `1px solid ${C.border}`, background: '#fff' }}>
                {onAssignStep ? (
                  <>
                    <button style={S.btnO} disabled={busy} onClick={() => setReviewStep('details')}>← Back</button>
                    <button style={{ ...S.btn, background: C.green, marginLeft: 'auto' }} disabled={busy || selHr.length === 0}
                      onClick={() => decide(m.id, 'approve', { assigned_hr_ids: selHr })}>
                      {busy ? 'Submitting…' : `Submit & Assign${selHr.length ? ` (${selHr.length})` : ''}`}
                    </button>
                  </>
                ) : (
                  <>
                    <button style={S.btnO} disabled={busy} onClick={closeReview}>Cancel</button>
                    <button style={{ ...S.btnD, marginLeft: 'auto' }} disabled={busy} onClick={() => decide(m.id, 'reject')}>Reject</button>
                    <button style={{ ...S.btn, background: C.green }} disabled={busy}
                      onClick={() => { if (isHrHead) setReviewStep('assign'); else decide(m.id, 'approve') }}>
                      {busy ? 'Approving…' : isHrHead ? 'Approve →' : 'Approve'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })(), document.body)}
    </div>
  )
}

// ── Raise MRF — its own sidebar section (beside Tasks & Approvals) ───────────
export function RaiseMrfSection({ employeeId, notify, go }: { employeeId: string; notify: (m: string, t?: 'success' | 'error') => void; go?: (k: string) => void }) {
  const [canRaise, setCanRaise] = useState<boolean | null>(null)
  const [formKey, setFormKey] = useState(0)   // remount the form to raise another after a submit
  useEffect(() => { api('/api/ess/mrf', employeeId).then(d => setCanRaise(!!d.canRaise)).catch(() => setCanRaise(true)) }, [employeeId])
  return (
    <div>
      <div style={{ ...S.section, fontSize: 14, marginBottom: 4 }}>Raise a Manpower Requisition (MRF)</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Fill the form to open a hiring requisition. It routes through your reporting chain to the HR Head, company-scoped.</div>
      {canRaise === false ? (
        <div style={S.note()}>Raising an MRF is available to reporting managers (RM1 / RM2) and heads of department. If you should have this, ask HR to set your reporting line.</div>
      ) : (
        <MrfForm key={formKey} employeeId={employeeId} notify={notify}
          onDone={() => { setFormKey(k => k + 1); window.scrollTo({ top: 0 }) }}
          onCancel={() => { if (go) go('approvals') }} />
      )}
    </div>
  )
}

export function ApprovalsSection({ employeeId, go, notify }: { employeeId: string; go: (k: string) => void; notify: (m: string, t?: 'success' | 'error') => void }) {
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'MINE' | 'LEAVE' | 'TRAVEL' | 'RESIGNATION'>('MINE')
  const load = useCallback(() => api('/api/ess/approvals', employeeId).then(d => { setItems(d.items || []); setErr('') }).catch(e => setErr(e.message)), [employeeId])
  useEffect(() => { load() }, [load])
  if (err) return <div style={S.note('d')}>{err}</div>
  if (!items) return <div style={{ fontSize: 12, color: C.faint }}>Loading…</div>
  const shown = items.filter(i => filter === 'ALL' ? true : filter === 'MINE' ? i.mine : i.kind === filter)
  const mine = items.filter(i => i.mine).length
  return (
    <div>
      <MrfApprovals employeeId={employeeId} notify={notify} />
      <Kpis items={[
        { label: 'Waiting on you', value: mine, tone: mine ? 'warn' : 'ok' },
        { label: 'In your scope', value: items.length - mine },
        { label: 'Resignations', value: items.filter(i => i.kind === 'RESIGNATION').length },
        { label: 'Leave & travel', value: items.filter(i => i.kind !== 'RESIGNATION').length },
      ]} />
      <div style={S.card}>
        <div style={{ ...S.section, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>Approvals</span>
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['MINE', 'ALL', 'LEAVE', 'TRAVEL', 'RESIGNATION'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={filter === f ? S.btn : S.btnO}>{f === 'MINE' ? 'Waiting on me' : f === 'ALL' ? 'Everything' : f.charAt(0) + f.slice(1).toLowerCase()}</button>
            ))}
          </span>
        </div>
        {shown.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: '8px 0' }}>Nothing here — {filter === 'MINE' ? 'nothing is waiting on you.' : 'nothing in this view.'}</div>}
        {shown.map(p => <PendingCard key={`${p.kind}:${p.id}`} item={p} employeeId={employeeId} go={go} onDone={m => { notify(m); load() }} />)}
        <div style={S.note()}>Items stamped to you can be actioned here. Items in your wider scope (HOD department, HR / Finance role) are shown for oversight; the person they are stamped to acts on them. Travel claims are actioned from the Travel Claims screen.</div>
      </div>
    </div>
  )
}

// ── COMPANY (HR Head) ─────────────────────────────────────────────────────
export function CompanySection({ employeeId }: { employeeId: string }) {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api('/api/ess/company', employeeId).then(x => { setD(x); setErr('') }).catch(e => setErr(e.message)) }, [employeeId])
  if (err) return <div style={S.note('d')}>{err}</div>
  if (!d) return <div style={{ fontSize: 12, color: C.faint }}>Loading…</div>
  return (
    <div>
      <Kpis items={d.kpis} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 10 }}>
        <div style={S.card}>
          <div style={S.section}>Headcount by department</div>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Department</th><th style={{ ...S.th, ...S.num }}>Headcount</th><th style={{ ...S.th, ...S.num }}>Open exits</th><th style={{ ...S.th, ...S.num }}>Push-reason</th></tr></thead>
            <tbody>{d.departments.map((x: any) => (
              <tr key={x.dept}><td style={S.td}>{x.dept}</td><td style={{ ...S.td, ...S.num }}>{x.headcount}</td><td style={{ ...S.td, ...S.num }}>{x.open_exits || '—'}</td>
                <td style={{ ...S.td, ...S.num, color: x.push ? C.red : undefined, fontWeight: x.push ? 700 : 400 }}>{x.push || '—'}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
        <div style={S.card}>
          <div style={S.section}>Why people are leaving, this quarter</div>
          {d.reasons.length === 0 && <div style={{ fontSize: 12.5, color: C.muted }}>No exits recorded with a reason this quarter.</div>}
          {d.reasons.length > 0 && (
            <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={S.th}>Category</th><th style={S.th}>Reason</th><th style={{ ...S.th, ...S.num }}>Exits</th><th style={{ ...S.th, ...S.num }}>Regrettable</th><th style={S.th}>Concentration</th></tr></thead>
              <tbody>{d.reasons.map((x: any) => (
                <tr key={x.category + x.reason}><td style={S.td}><span style={pill(x.category === 'PUSH' ? 'dang' : x.category === 'PULL' ? 'info' : 'mut')}>{x.category}</span></td>
                  <td style={S.td}>{x.reason}</td><td style={{ ...S.td, ...S.num }}>{x.exits}</td><td style={{ ...S.td, ...S.num }}>{x.regrettable}</td><td style={{ ...S.td, color: C.muted, fontSize: 12 }}>{x.concentration || '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {d.attrition_note && <div style={S.note('d')}><b>{d.attrition_note.split('.')[0]}.</b>{d.attrition_note.split('.').slice(1).join('.')}</div>}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>Regime election — FY {d.fy}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={S.th}>Regime elected</th><th style={{ ...S.th, ...S.num }}>Employees</th><th style={{ ...S.th, ...S.num }}>Costlier for how many</th></tr></thead>
          <tbody>{d.regime.map((x: any) => (
            <tr key={x.regime}><td style={S.td}>{x.regime}</td><td style={{ ...S.td, ...S.num }}>{x.employees}</td><td style={{ ...S.td, ...S.num, color: x.costlier ? C.amber : undefined }}>{x.costlier}</td></tr>
          ))}</tbody>
        </table>
        {d.regime_note && <div style={S.note('w')}>{d.regime_note}</div>}
      </div>
    </div>
  )
}

// ── REPORTS ────────────────────────────────────────────────────────────────
function toCsv(columns: string[], rows: any[][]) {
  const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
}
export function ReportsSection({ employeeId }: { employeeId: string }) {
  const [list, setList] = useState<{ key: string; title: string; desc: string }[]>([])
  const [open, setOpen] = useState<{ key: string; title: string; columns: string[]; rows: any[][] } | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { api('/api/ess/reports', employeeId).then(d => setList(d.reports || [])).catch(e => setErr(e.message)) }, [employeeId])
  async function run(key: string, download = false) {
    setBusy(key); setErr('')
    try {
      const d = await api(`/api/ess/reports?report=${key}`, employeeId)
      if (download) {
        const blob = new Blob([toCsv(d.columns, d.rows)], { type: 'text/csv' })
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${d.title.replace(/[^A-Za-z0-9]+/g, '_')}.csv`; document.body.appendChild(a); a.click(); a.remove()
      } else setOpen({ key, ...d })
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  return (
    <div>
      {err && <div style={S.note('d')}>{err}</div>}
      <div style={S.card}>
        <div style={S.section}>Reports</div>
        {list.map(r => (
          <div key={r.key} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{r.title}</div><div style={{ fontSize: 12, color: C.muted }}>{r.desc}</div></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button disabled={!!busy} onClick={() => run(r.key)} style={S.btnO}>{busy === r.key ? '…' : 'Open'}</button>
              <button disabled={!!busy} onClick={() => run(r.key, true)} style={S.btnO}>Export CSV</button>
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div style={S.card}>
          <div style={{ ...S.section, display: 'flex', justifyContent: 'space-between' }}><span>{open.title} · {open.rows.length} rows</span><button onClick={() => setOpen(null)} style={S.btnO}>Close</button></div>
          <div style={{ overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{open.columns.map(c => <th key={c} style={S.th}>{c}</th>)}</tr></thead>
              <tbody>{open.rows.slice(0, 500).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ ...S.td, ...(typeof v === 'number' ? S.num : {}) }}>{typeof v === 'number' ? v.toLocaleString('en-IN') : String(v ?? '—')}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {open.rows.length > 500 && <div style={S.note()}>Showing the first 500 rows — export CSV for everything.</div>}
        </div>
      )}
    </div>
  )
}

// ── EXIT (employee's own resignation) ─────────────────────────────────────
export function ExitSection({ employeeId, notify }: { employeeId: string; notify: (m: string, t?: 'success' | 'error') => void }) {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const load = useCallback(() => api('/api/ess/resignation', employeeId).then(x => { setD(x); setErr('') }).catch(e => setErr(e.message)), [employeeId])
  useEffect(() => { load() }, [load])
  if (err) return <div style={S.note('d')}>{err}</div>
  if (!d) return <div style={{ fontSize: 12, color: C.faint }}>Loading…</div>
  const cur = d.current
  const open = cur && !['SETTLED', 'WITHDRAWN'].includes(cur.status)
  async function submit() {
    setBusy(true)
    try { await api('/api/ess/resignation', employeeId, { method: 'POST', body: JSON.stringify({ reason_code: reason, date, remarks }) }); notify('Resignation submitted'); setConfirm(false); load() }
    catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  async function withdraw() {
    if (!window.confirm('Withdraw your resignation? This closes the chain.')) return
    setBusy(true)
    try { await api('/api/ess/resignation', employeeId, { method: 'POST', body: JSON.stringify({ action: 'WITHDRAW', id: cur.id }) }); notify('Resignation withdrawn'); load() }
    catch (e: any) { notify(e.message, 'error') } finally { setBusy(false) }
  }
  const STAGE: Record<string, string> = { PENDING_RM_L1: 'With your reporting manager', PENDING_RM_L2: 'With your L2 manager', PENDING_HOD: 'With your head of department', PENDING_HR_MANAGER: 'With HR — final last working day', RETENTION_HOLD: 'On hold — your manager wants to talk', RECOVERY_PENDING: 'Accepted — notice recovery pending', SETTLED: 'Settled', WITHDRAWN: 'Withdrawn', INITIATED: 'Initiated by HR' }
  return (
    <div>
      {open ? (
        <div style={S.card}>
          <div style={S.section}>Your resignation</div>
          <Kpis items={[
            { label: 'Status', value: STAGE[cur.status] || cur.status, tone: cur.status === 'RETENTION_HOLD' ? 'warn' : undefined },
            { label: 'Submitted', value: cur.submitted_at ? new Date(cur.submitted_at).toLocaleDateString('en-IN') : new Date(cur.created_at).toLocaleDateString('en-IN') },
            { label: 'Notice period', value: `${cur.notice_period_days ?? '—'} days` },
            { label: 'Last working day', value: cur.final_lwd || cur.proposed_lwd || cur.lwd_as_per_policy || '—', note: cur.final_lwd ? 'confirmed by HR' : cur.proposed_lwd ? 'proposed by your manager' : 'as per policy' },
          ]} />
          {cur.reason_code && <div style={{ fontSize: 12.5, color: C.muted }}>Reason: <b style={{ color: C.ink }}>{cur.exit_reason_master?.label || cur.reason_code}</b></div>}
          <div style={{ marginTop: 12 }}>
            <div style={S.section}>Chain</div>
            {d.chain.length === 0 && <div style={{ fontSize: 12, color: C.faint }}>No stage entries yet.</div>}
            {d.chain.map((c: any, i: number) => (
              <div key={i} style={{ fontSize: 12.5, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
                <b>{c.stage.replace('_', ' ')}</b> · {c.action.toLowerCase().replace(/_/g, ' ')}{c.approver?.full_name ? ` · ${c.approver.full_name}` : ''}
                <span style={{ color: C.faint, marginLeft: 6, fontSize: 11 }}>{new Date(c.actioned_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                {c.note && c.action !== 'STAMPED' && <div style={{ color: C.muted }}>“{c.note}”</div>}
              </div>
            ))}
          </div>
          {!['RECOVERY_PENDING', 'SETTLED'].includes(cur.status) && cur.submitted_by_employee && (
            <div style={{ marginTop: 12 }}><button disabled={busy} onClick={withdraw} style={S.btnD}>Withdraw resignation</button></div>
          )}
          <div style={S.note()}>Retention pauses the chain; only you can withdraw it. Your last working day becomes final at the HR stage.</div>
        </div>
      ) : (
        <div style={S.card}>
          <div style={S.section}>Resign</div>
          {cur && <div style={S.note()}>Your previous resignation is {STAGE[cur.status]?.toLowerCase() || cur.status.toLowerCase()}.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, marginTop: 8 }}>
            <div><label style={S.label}>Reason</label>
              <select value={reason} onChange={e => setReason(e.target.value)} style={S.input}>
                <option value="">Select…</option>
                {d.reasons.map((r: any) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select></div>
            <div><label style={S.label}>Date of resignation</label><input type="date" value={date} onChange={e => setDate(e.target.value)} style={S.input} /></div>
          </div>
          <div style={{ marginTop: 10 }}><label style={S.label}>Anything you want to say (optional)</label><textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} style={{ ...S.input, resize: 'vertical' }} /></div>
          <div style={S.note('w')}>Notice period on record: <b>{d.notice_period_days} days</b>. Submitting starts the acknowledgement chain — your reporting manager first, then L2 / HOD, then HR sets the final last working day.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {!confirm ? <button disabled={!reason} onClick={() => setConfirm(true)} style={{ ...S.btn, opacity: reason ? 1 : .5 }}>Submit resignation</button>
              : <><button disabled={busy} onClick={submit} style={{ ...S.btn, background: C.red }}>Yes, submit</button><button onClick={() => setConfirm(false)} style={S.btnO}>Not now</button></>}
          </div>
        </div>
      )}
    </div>
  )
}

export const EssTk = TK
