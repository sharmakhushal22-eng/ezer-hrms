'use client'
// components/ess/OnboardingApprovals.tsx — ESS → Tasks & Approvals → "Onboarding approvals".
//
// The submitted onboarding forms of the company, for whichever of the four teams the person
// acts for (IT, Admin, Payroll, HR Manager). A card per joiner with every team's state; the
// review drawer shows what the candidate filled in and uploaded, and the team approves or
// returns it with a remark. When the fourth team approves, the employee code is generated.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/ess/api'
import { C as TK, Z } from '@/lib/ui'

type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null; acted_at: string | null }
type Item = { id: string; full_name: string; designation: string | null; department: string | null; employment_type: string | null; date_of_joining: string | null; status: string; submitted_at: string | null; approvals: Approval[]; waiting_on_me: string[] }
const LABEL: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const card: React.CSSProperties = { background: TK.surface, borderRadius: 10, border: `1px solid ${TK.line}`, padding: '14px 16px', marginBottom: 10 }
const section: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TK.brand, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }
const btn: React.CSSProperties = { padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', background: TK.brand, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 500 }
const pill = (s: Approval['status']): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  background: s === 'APPROVED' ? TK.positiveTint : s === 'RETURNED' ? TK.criticalTint : TK.warningTint,
  color: s === 'APPROVED' ? TK.positive : s === 'RETURNED' ? TK.critical : TK.warning,
})

const HIDE = new Set(['bank_confirm', 'docs_uploaded'])
const pretty = (k: string) => k.replace(/^(fe|emrg|prev|grat|nominee|eps)_/, m => ({ fe_: 'Foreign ', emrg_: 'Emergency ', prev_: 'Previous ', grat_: 'Gratuity ', nominee_: 'Nominee ', eps_: 'EPS ' }[m] || '')).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const val = (v: any): string => v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '—' : typeof v === 'object' ? '' : String(v)

function Rows({ obj }: { obj: Record<string, any> }) {
  const flat = Object.entries(obj || {}).filter(([k, v]) => !HIDE.has(k) && typeof v !== 'object')
  const nested = Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object')
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 14px' }}>
        {flat.map(([k, v]) => <div key={k} style={{ fontSize: 12 }}><span style={{ color: TK.muted }}>{pretty(k)}: </span><b style={{ color: TK.ink }}>{val(v)}</b></div>)}
      </div>
      {nested.map(([k, v]) => (
        <div key={k} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TK.brandDeep, marginBottom: 4 }}>{pretty(k)}</div>
          {Array.isArray(v)
            ? v.map((row, i) => <div key={i} style={{ fontSize: 12, padding: '4px 8px', background: TK.sunken, borderRadius: 6, marginBottom: 4 }}>{Object.entries(row || {}).map(([a, b]) => `${pretty(a)}: ${val(b)}`).join(' · ')}</div>)
            : <Rows obj={v} />}
        </div>
      ))}
    </>
  )
}

const STEP_TITLES: Record<string, string> = { step_3: 'Personal', step_4: 'Contact and addresses', step_5: 'Emergency contacts, experience and education', step_7: 'PAN, PF, bank, nominees and family' }

export default function OnboardingApprovals({ employeeId, notify }: { employeeId: string; notify?: (m: string, t?: 'success' | 'error') => void }) {
  const [d, setD] = useState<{ teams: string[]; items: Item[] } | null>(null)
  const [open, setOpen] = useState<any | null>(null)
  const [mode, setMode] = useState<'view' | 'return'>('view')
  const [team, setTeam] = useState<string>('')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api('/api/ess/onboarding-approvals', employeeId).then(setD).catch(() => setD({ teams: [], items: [] })), [employeeId])
  useEffect(() => { load() }, [load])
  if (!d || !d.teams.length || !d.items.length) return null
  const say = (m: string, t?: 'success' | 'error') => notify ? notify(m, t) : (t === 'error' ? alert(m) : null)

  async function review(it: Item) {
    setBusy(true)
    try { const x = await api(`/api/ess/onboarding-approvals?open=${it.id}`, employeeId); setOpen(x); setMode('view'); setRemark(''); setTeam(it.waiting_on_me[0] || d!.teams[0]) }
    catch (e: any) { say(e.message, 'error') } finally { setBusy(false) }
  }
  async function decide(action: 'approve' | 'return') {
    if (!open) return
    if (action === 'return' && !remark.trim()) { say('Say what the candidate should fix.', 'error'); return }
    setBusy(true)
    try {
      const r = await api('/api/ess/onboarding-approvals', employeeId, { method: 'POST', body: JSON.stringify({ onboarding_id: open.item.id, team, action, remark }) })
      if (r.all_approved) say(r.employee_code ? `All four teams approved — employee code ${r.employee_code} generated.` : `All four teams approved, but the employee could not be created: ${r.create_error}`, r.employee_code ? 'success' : 'error')
      else say(action === 'approve' ? `Approved for ${LABEL[team]}.` : 'Returned to the candidate with your remark.')
      setOpen(null); load()
    } catch (e: any) { say(e.message, 'error') } finally { setBusy(false) }
  }

  const waiting = d.items.filter(i => i.waiting_on_me.length)
  const others = d.items.filter(i => !i.waiting_on_me.length)
  const Card = ({ it }: { it: Item }) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${TK.line}`, borderRadius: 9, padding: '10px 12px', flexWrap: 'wrap', marginBottom: 8, background: it.waiting_on_me.length ? TK.warningTint : TK.surface }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: TK.ink }}>{it.full_name} · {it.designation || '—'}{it.department ? <span style={{ color: TK.muted, fontWeight: 400 }}> · {it.department}</span> : null}</div>
        <div style={{ fontSize: 11.5, color: TK.muted }}>Joining {day(it.date_of_joining)} · submitted {day(it.submitted_at)}{it.waiting_on_me.length ? ` · waiting on you for ${it.waiting_on_me.map(t => LABEL[t]).join(', ')}` : ''}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {it.approvals.map(a => <span key={a.team} style={pill(a.status)} title={a.acted_by_name ? `${a.acted_by_name} · ${day(a.acted_at)}${a.remark ? ` · ${a.remark}` : ''}` : ''}>{LABEL[a.team]} · {a.status === 'APPROVED' ? '✓' : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>)}
        </div>
      </div>
      <button disabled={busy} onClick={() => review(it)} style={it.waiting_on_me.length ? btn : btnO}>{it.waiting_on_me.length ? 'Review & approve' : 'View'}</button>
    </div>
  )

  return (
    <div style={card}>
      <div style={section}>Onboarding approvals · {d.teams.map(t => LABEL[t]).join(' / ')}{waiting.length ? ` · ${waiting.length} waiting on you` : ''}</div>
      {waiting.map(it => <Card key={it.id} it={it} />)}
      {others.map(it => <Card key={it.id} it={it} />)}
      <div style={{ fontSize: 12, color: TK.muted, marginTop: 6 }}>The employee code is generated automatically once IT, Admin, Payroll and the HR Manager have all approved. Returning the form reopens the candidate's link for 48 hours.</div>

      {open && (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) setOpen(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: Z.modal, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '24px 12px' }}>
          <div style={{ background: TK.surface, borderRadius: 12, width: 'min(960px, 100%)', padding: '18px 20px', boxShadow: '0 24px 70px rgba(15,23,42,.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: TK.ink }}>{open.item.full_name} · {open.item.designation || '—'}</div>
                <div style={{ fontSize: 12, color: TK.muted }}>{open.item.employment_type || 'Employee'} · joining {day(open.item.date_of_joining)} · submitted {day(open.item.submitted_at)}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>{open.approvals.map((a: Approval) => <span key={a.team} style={pill(a.status)}>{LABEL[a.team]} · {a.status === 'APPROVED' ? `✓ ${a.acted_by_name || ''}` : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>)}</div>
              </div>
              <button onClick={() => setOpen(null)} style={btnO}>Close</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={section}>Documents</div>
              {open.documents.length === 0 && <div style={{ fontSize: 12, color: TK.muted }}>No documents uploaded.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                {open.documents.map((doc: any) => (
                  <div key={doc.doc_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: `1px solid ${TK.line}`, borderRadius: 8, padding: '7px 10px', fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}><b>{doc.doc_code.replace(/_/g, ' ')}</b><div style={{ color: TK.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name || '—'}{doc.note ? ` · ${doc.note}` : ''}</div></div>
                    {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer" style={{ ...btnO, textDecoration: 'none', padding: '4px 9px' }}>View</a> : <span style={{ color: TK.faint }}>no file</span>}
                  </div>
                ))}
              </div>
            </div>

            {Object.entries(STEP_TITLES).map(([k, title]) => open.item.form_data?.[k] ? (
              <div key={k} style={{ marginTop: 14 }}>
                <div style={section}>{title}</div>
                <Rows obj={open.item.form_data[k]} />
              </div>
            ) : null)}

            {open.item.status !== 'EMPLOYEE_CREATED' && (
              <div style={{ marginTop: 18, borderTop: `1px solid ${TK.line}`, paddingTop: 14 }}>
                {d.teams.length > 1 && (
                  <div style={{ marginBottom: 10, fontSize: 12 }}>
                    <span style={{ color: TK.muted }}>Deciding as </span>
                    {d.teams.map(t => <button key={t} onClick={() => setTeam(t)} style={{ ...(team === t ? btn : btnO), marginRight: 6 }}>{LABEL[t]}</button>)}
                  </div>
                )}
                {mode === 'return' && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: TK.brandDeep, display: 'block', marginBottom: 4 }}>WHAT SHOULD THE CANDIDATE FIX?</label>
                    <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={3} style={{ width: '100%', padding: '9px 11px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }} placeholder="e.g. The bank proof is for a different account holder — upload a cancelled cheque in your own name." />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {open.approvals.find((a: Approval) => a.team === team)?.status === 'APPROVED'
                    ? <span style={{ fontSize: 12, color: TK.positive, alignSelf: 'center' }}>Already approved for {LABEL[team]}.</span>
                    : mode === 'view'
                      ? <><button disabled={busy} onClick={() => decide('approve')} style={{ ...btn, background: TK.positive }}>Approve for {LABEL[team]}</button><button disabled={busy} onClick={() => setMode('return')} style={btnO}>Return to candidate…</button></>
                      : <><button disabled={busy} onClick={() => decide('return')} style={{ ...btn, background: TK.critical }}>Return with this remark</button><button disabled={busy} onClick={() => setMode('view')} style={btnO}>Cancel</button></>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
