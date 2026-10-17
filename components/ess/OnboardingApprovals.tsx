'use client'
// components/ess/OnboardingApprovals.tsx — ESS → HRIS → Tasks & Approvals → "Onboarding approvals".
//
// The onboardings the HR Manager has accepted, for whichever head teams the person acts for
// (IT, Admin, Payroll). A card per joiner with every team's state; the approval form shows what
// the candidate filled in and uploaded, and the team's own checklist — the laptop, the email,
// the ID card, the salary structure — which has to be complete to approve. The form can also
// be returned to the candidate with a remark. When the third head approves, the HR Manager
// assigns the role and generates the employee code from the onboarding card.
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/ess/api'
import { C as TK, Z } from '@/lib/ui'
import { CHECKLISTS, missingItems, type ChecklistField, type HeadTeam } from '@/lib/onboarding/checklists'

type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null; acted_at: string | null }
type Item = { id: string; full_name: string; designation: string | null; department: string | null; employment_type: string | null; date_of_joining: string | null; status: string; submitted_at: string | null; approvals: Approval[]; waiting_on_me: string[] }
const LABEL: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const card: React.CSSProperties = { background: TK.surface, borderRadius: 10, border: `1px solid ${TK.line}`, padding: '14px 16px', marginBottom: 10 }
const section: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TK.brand, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }
const btn: React.CSSProperties = { padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', background: TK.brand, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 500 }
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', background: TK.surface, color: TK.ink }
const pill = (s: Approval['status']): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  background: s === 'APPROVED' ? TK.positiveTint : s === 'RETURNED' ? TK.criticalTint : TK.warningTint,
  color: s === 'APPROVED' ? TK.positive : s === 'RETURNED' ? TK.critical : TK.warning,
})

const HIDE = new Set(['bank_confirm', 'docs_uploaded'])
const pretty = (k: string) => k.replace(/^(fe|emrg|prev|grat|nominee|eps)_/, m => ({ fe_: 'Foreign ', emrg_: 'Emergency ', prev_: 'Previous ', grat_: 'Gratuity ', nominee_: 'Nominee ', eps_: 'EPS ' }[m] || '')).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const val = (v: any): string => v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '—' : typeof v === 'object' ? '' : String(v)

// Sub-components live OUTSIDE the parent so typing never remounts them.
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

/** The team's checklist: what is ready for the joiner. Required items are starred. */
function Checklist({ team, values, onChange, readOnly }: { team: HeadTeam; values: Record<string, any>; onChange: (k: string, v: any) => void; readOnly: boolean }) {
  const def = CHECKLISTS[team]
  const missing = new Set(missingItems(team, values))
  const field = (f: ChecklistField) => {
    const v = values[f.key]
    const bad = !readOnly && missing.has(f.label)
    if (f.kind === 'bool') return (
      <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: `1px solid ${v === true ? TK.positiveEdge : bad ? TK.warningEdge : TK.line}`, background: v === true ? TK.positiveTint : TK.surface, borderRadius: 8, cursor: readOnly ? 'default' : 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={v === true} disabled={readOnly} onChange={e => onChange(f.key, e.target.checked)} style={{ width: 16, height: 16 }} />
        <span style={{ fontWeight: 600, color: TK.ink }}>{f.label}{f.required && <span style={{ color: TK.critical }}> *</span>}</span>
        {v === true && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: TK.positive }}>Ready ✓</span>}
      </label>
    )
    return (
      <div key={f.key}>
        <label style={{ fontSize: 11, fontWeight: 600, color: TK.brandDeep, display: 'block', marginBottom: 4 }}>{f.label}{f.required && <span style={{ color: TK.critical }}> *</span>}</label>
        {f.kind === 'select'
          ? <select value={v ?? ''} disabled={readOnly} onChange={e => onChange(f.key, e.target.value)} style={input}><option value="">—</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          : <input value={v ?? ''} type={f.kind === 'number' ? 'number' : 'text'} disabled={readOnly} onChange={e => onChange(f.key, e.target.value)} placeholder={f.hint || ''} style={{ ...input, borderColor: bad ? TK.warning : TK.brandEdge }} />}
      </div>
    )
  }
  return (
    <div style={{ border: `1px solid ${TK.brandEdge}`, background: TK.brandTint, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TK.ink }}>{def.title} · your checklist</div>
      <div style={{ fontSize: 12, color: TK.inkSoft, margin: '2px 0 10px' }}>{def.intro}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>{def.fields.map(field)}</div>
      {!readOnly && missing.size > 0 && <div style={{ fontSize: 11.5, color: TK.warning, marginTop: 8 }}>To approve, still needed: {[...missing].join(', ')}.</div>}
    </div>
  )
}

const STEP_TITLES: Record<string, string> = { step_3: 'Personal', step_4: 'Contact and addresses', step_5: 'Emergency contacts, experience and education', step_7: 'PAN, PF, bank, nominees and family' }

export default function OnboardingApprovals({ employeeId, notify }: { employeeId: string; notify?: (m: string, t?: 'success' | 'error') => void }) {
  const [d, setD] = useState<{ teams: string[]; items: Item[] } | null>(null)
  const [open, setOpen] = useState<any | null>(null)
  const [mode, setMode] = useState<'view' | 'return'>('view')
  const [team, setTeam] = useState<HeadTeam>('IT')
  const [check, setCheck] = useState<Record<string, Record<string, any>>>({})
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api('/api/ess/onboarding-approvals', employeeId).then(setD).catch(() => setD({ teams: [], items: [] })), [employeeId])
  useEffect(() => { load() }, [load])
  if (!d || !d.teams.length || !d.items.length) return null
  const say = (m: string, t?: 'success' | 'error') => notify ? notify(m, t) : (t === 'error' ? alert(m) : null)

  async function review(it: Item) {
    setBusy(true)
    try {
      const x = await api(`/api/ess/onboarding-approvals?open=${it.id}`, employeeId)
      setOpen(x); setMode('view'); setRemark(''); setCheck(x.checklists || {})
      setTeam((it.waiting_on_me[0] || d!.teams[0]) as HeadTeam)
    } catch (e: any) { say(e.message, 'error') } finally { setBusy(false) }
  }
  const setField = (k: string, v: any) => setCheck(c => ({ ...c, [team]: { ...(c[team] || {}), [k]: v } }))

  async function decide(action: 'approve' | 'return' | 'save') {
    if (!open) return
    if (action === 'return' && !remark.trim()) { say('Say what the candidate should fix.', 'error'); return }
    if (action === 'approve') { const m = missingItems(team, check[team]); if (m.length) { say(`Confirm the checklist first: ${m.join(', ')}.`, 'error'); return } }
    setBusy(true)
    try {
      const r = await api('/api/ess/onboarding-approvals', employeeId, { method: 'POST', body: JSON.stringify({ onboarding_id: open.item.id, team, action, remark, checklist: check[team] || {} }) })
      if (action === 'save') { say('Checklist saved.'); setBusy(false); return }
      if (r.all_approved) say(`Approved for ${LABEL[team]} — IT, Admin and Payroll have all approved. The HR Manager now assigns the role and generates the employee code.`, 'success')
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
      <button disabled={busy} onClick={() => review(it)} style={it.waiting_on_me.length ? btn : btnO}>{it.waiting_on_me.length ? 'Open approval form' : 'View'}</button>
    </div>
  )

  const mine = open ? open.approvals.find((a: Approval) => a.team === team) : null
  const decided = mine?.status === 'APPROVED'
  const missingNow = open ? missingItems(team, check[team]) : []

  return (
    <div style={card}>
      <div style={section}>Onboarding approvals · {d.teams.map(t => LABEL[t]).join(' / ')}{waiting.length ? ` · ${waiting.length} waiting on you` : ''}</div>
      {waiting.map(it => <Card key={it.id} it={it} />)}
      {others.map(it => <Card key={it.id} it={it} />)}
      <div style={{ fontSize: 12, color: TK.muted, marginTop: 6 }}>These forms are accepted by the HR Manager. Confirm your team's checklist and approve; once IT, Admin and Payroll have all approved, the HR Manager assigns the role and generates the employee code. Returning the form reopens the candidate's link for 48 hours.</div>

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

            {open.item.status !== 'EMPLOYEE_CREATED' && (
              <div style={{ marginTop: 14 }}>
                {d.teams.length > 1 && (
                  <div style={{ marginBottom: 10, fontSize: 12 }}>
                    <span style={{ color: TK.muted }}>Acting as </span>
                    {d.teams.map(t => <button key={t} onClick={() => setTeam(t as HeadTeam)} style={{ ...(team === t ? btn : btnO), marginRight: 6 }}>{LABEL[t]}</button>)}
                  </div>
                )}
                <Checklist team={team} values={check[team] || {}} onChange={setField} readOnly={decided} />
                {decided && <div style={{ fontSize: 12, color: TK.positive, marginTop: 6 }}>Approved for {LABEL[team]} by {mine.acted_by_name || '—'} on {day(mine.acted_at)}.</div>}
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <div style={section}>Documents</div>
              {open.documents.length === 0 && <div style={{ fontSize: 12, color: TK.muted }}>No documents uploaded.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                {open.documents.map((doc: any) => (
                  <div key={doc.doc_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, border: `1px solid ${TK.line}`, borderRadius: 8, padding: '7px 10px', fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}><b>{doc.label || doc.doc_code.replace(/_/g, ' ')}</b><div style={{ color: TK.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name || '—'}</div></div>
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

            {open.item.status !== 'EMPLOYEE_CREATED' && !decided && (
              <div style={{ marginTop: 18, borderTop: `1px solid ${TK.line}`, paddingTop: 14 }}>
                {mode === 'return' && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: TK.brandDeep, display: 'block', marginBottom: 4 }}>WHAT SHOULD THE CANDIDATE FIX?</label>
                    <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={3} style={{ ...input, resize: 'vertical' }} placeholder="e.g. the bank account number does not match the cancelled cheque" />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {mode === 'view'
                    ? <>
                        <button disabled={busy || missingNow.length > 0} onClick={() => decide('approve')} style={{ ...btn, background: missingNow.length ? TK.faint : TK.positive, cursor: missingNow.length ? 'not-allowed' : 'pointer' }}>Approve for {LABEL[team]}</button>
                        <button disabled={busy} onClick={() => decide('save')} style={btnO}>Save checklist</button>
                        <button disabled={busy} onClick={() => setMode('return')} style={btnO}>Return to candidate…</button>
                      </>
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
