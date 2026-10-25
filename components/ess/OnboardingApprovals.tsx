'use client'
// components/ess/OnboardingApprovals.tsx — ESS → HRIS → Tasks & Approvals → "Onboarding approvals".
//
// The onboardings the HR Manager has accepted, for whichever head teams the person acts for
// (IT, Admin, Payroll). A card per joiner; the approval form opens as the same paper sheet the
// HR Manager reviews on (components/onboarding/ReviewDrawer.tsx): the team's own checklist first
// — the laptop, the email, the ID card, the salary structure — then, for Payroll, the salary
// breakdown they are approving, then the documents and every detail the candidate filled in.
// The checklist has to be complete to approve; the form can also be returned to the candidate
// with a remark. When the third head approves, the HR Manager generates
// the employee code from the onboarding card.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/ess/api'
import { C as TK, Z } from '@/lib/ui'
import { CHECKLISTS, missingItems, confirmationsOnly, type ChecklistField, type HeadTeam } from '@/lib/onboarding/checklists'
import { rebuildFor, type SalaryBreakdown } from '@/lib/onboarding/salary-breakdown'
import { SHEET_CSS, SectionView, SCHEMA, TEAM } from '@/components/onboarding/ReviewDrawer'

type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null; acted_at: string | null }
type Item = { id: string; full_name: string; designation: string | null; department: string | null; employment_type: string | null; date_of_joining: string | null; status: string; submitted_at: string | null; approvals: Approval[]; waiting_on_me: string[] }
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`
const NO_MARKS = {}

const card: React.CSSProperties = { background: TK.surface, borderRadius: 10, border: `1px solid ${TK.line}`, padding: '14px 16px', marginBottom: 10 }
const section: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TK.brand, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }
const btn: React.CSSProperties = { padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', background: TK.brand, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 500 }
const pill = (s: Approval['status']): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  background: s === 'APPROVED' ? TK.positiveTint : s === 'RETURNED' ? TK.criticalTint : TK.warningTint,
  color: s === 'APPROVED' ? TK.positive : s === 'RETURNED' ? TK.critical : TK.warning,
})
const TEAM_BLURB: Record<HeadTeam, string> = {
  IT: 'What the joiner walks in to on day one — tick each item once it is actually ready. The details shown are on record; only HR changes them.',
  ADMIN: 'What Admin has arranged for the joiner — tick each item once it is actually ready. The details shown are on record; only HR changes them.',
  PAYROLL: 'The structure the joiner will be paid on, as negotiated. Check the breakdown below and confirm it is entered in payroll; if the figures are wrong, return the form to HR with a remark instead.',
}

// ── Sub-components live OUTSIDE the parent so typing never remounts them ──────────────────

/** The team's checklist as tiles (yes / no items) and fields. */
function Checklist({ team, values, onChange, readOnly }: { team: HeadTeam; values: Record<string, any>; onChange: (k: string, v: any) => void; readOnly: boolean }) {
  const def = CHECKLISTS[team]
  const missing = new Set(missingItems(team, values))
  const bools = def.fields.filter(f => f.kind === 'bool'), inputs = def.fields.filter(f => f.kind !== 'bool')
  const done = def.fields.filter(f => f.required).length - def.fields.filter(f => f.required && missing.has(f.label)).length
  const total = def.fields.filter(f => f.required).length
  // The typed details are facts on the record (kept by HR) — shown, never edited here.
  const fact = (f: ChecklistField) => {
    const v = values[f.key]
    const shown = v == null || v === '' ? '' : f.kind === 'select' ? (f.options?.find(o => o.value === v)?.label || String(v)) : f.kind === 'number' ? `₹${Math.round(Number(v)).toLocaleString('en-IN')}` : String(v)
    return (
      <div key={f.key} className="rv-cell">
        <div className="rv-lbl">{f.label}</div>
        <div className="rv-val" style={{ color: shown ? TK.ink : TK.faint }}>{shown || '—'}</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, color: TK.inkSoft }}>{TEAM_BLURB[team]}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: done === total ? TK.positive : TK.muted, whiteSpace: 'nowrap' }}>{done} of {total} confirmed</div>
      </div>
      <div className="rv-prog" style={{ marginBottom: 14 }}><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
      {inputs.length > 0 && <div className="rv-grid" style={{ marginBottom: 14 }}>{inputs.map(fact)}</div>}
      <div className="rv-tiles">
        {bools.map(f => {
          const on = values[f.key] === true
          const need = !readOnly && missing.has(f.label)
          return (
            <div key={f.key} className={`rv-tile${on ? ' on' : ''}${need ? ' need' : ''}${readOnly ? ' ro' : ''}`} role={readOnly ? undefined : 'checkbox'} aria-checked={on} tabIndex={readOnly ? undefined : 0}
              onClick={readOnly ? undefined : () => onChange(f.key, !on)} onKeyDown={readOnly ? undefined : e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(f.key, !on) } }}>
              <div className="rv-tick">{on ? '✓' : ''}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: TK.ink }}>{f.label}{f.required && !on && <span style={{ color: TK.critical }}> *</span>}</div>
                <div style={{ fontSize: 11, color: on ? TK.positive : TK.muted, fontWeight: on ? 700 : 400 }}>{on ? 'Ready' : readOnly ? 'Not confirmed' : 'Click when ready'}</div>
              </div>
            </div>
          )
        })}
      </div>
      {!readOnly && missing.size > 0 && <div style={{ fontSize: 11.5, color: TK.warning, marginTop: 10 }}>To approve, still needed: {[...missing].join(', ')}.</div>}
    </div>
  )
}

/** The salary structure the Payroll head approves, as the statement rows. */
function SalaryTable({ s, annual }: { s: SalaryBreakdown; annual: number }) {
  const b = useMemo(() => rebuildFor(s, annual), [s, annual])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: TK.muted }}>{b.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', color: TK.ink }}>{inr(b.annual_ctc)} <span style={{ fontSize: 12, fontWeight: 500, color: TK.muted }}>a year{b.basic_monthly ? ` · basic ${inr(b.basic_monthly)} a month (${b.basic_pct}%)` : ''}</span></div>
        </div>
        {b.source !== 'none' && <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: b.source === 'computed' ? TK.warningTint : TK.infoTint, color: b.source === 'computed' ? TK.warning : TK.info }}>{b.source === 'negotiation' ? 'From the negotiation' : b.source === 'stipend' ? 'Fees / stipend' : b.source === 'offer_letter' ? 'From the offer letter' : 'Computed'}</div>}
      </div>
      {b.too_low && <div style={{ fontSize: 12.5, color: TK.critical, padding: '10px 12px', background: TK.criticalTint, borderRadius: 8, marginBottom: 8 }}>{b.note}</div>}
      {b.rows.length > 0 && (
        <table className="rv-sal">
          <thead><tr><th>Component</th><th>Monthly</th><th>Annual</th></tr></thead>
          <tbody>
            {b.rows.map((r, i) => r.kind === 'head' || r.kind === 'note'
              ? <tr key={i} className={r.kind}><td colSpan={3}>{r.label}</td></tr>
              : <tr key={i} className={r.kind}><td>{r.label}{r.basis && <small>{r.basis}</small>}</td><td>{inr(r.monthly)}</td><td>{inr(r.annual)}</td></tr>)}
          </tbody>
        </table>
      )}
      {!b.too_low && b.note && <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 8 }}>{b.note}</div>}
    </div>
  )
}

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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])
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
      const r = await api('/api/ess/onboarding-approvals', employeeId, { method: 'POST', body: JSON.stringify({ onboarding_id: open.item.id, team, action, remark, checklist: confirmationsOnly(team, check[team]) }) })
      if (action === 'save') { say('Checklist saved.'); setBusy(false); return }
      if (r.all_approved) say(`Approved for ${TEAM[team]} — IT, Admin and Payroll have all approved. The HR Manager now generates the employee code (team, roles and the code).`, 'success')
      else say(action === 'approve' ? `Approved for ${TEAM[team]}.` : 'Returned to the candidate with your remark.')
      setOpen(null); load()
    } catch (e: any) { say(e.message, 'error') } finally { setBusy(false) }
  }

  const waiting = d.items.filter(i => i.waiting_on_me.length)
  const others = d.items.filter(i => !i.waiting_on_me.length)
  // Called as a function, not mounted as <Card/> — a component declared inside the parent is a
  // new type every render, which remounts the whole list on each keystroke elsewhere on the page.
  const renderItem = (it: Item) => (
    <div key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: `1px solid ${it.waiting_on_me.length ? TK.warningEdge : TK.line}`, borderRadius: 10, padding: '11px 13px', flexWrap: 'wrap', marginBottom: 8, background: it.waiting_on_me.length ? TK.warningTint : TK.surface }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TK.ink }}>{it.full_name} <span style={{ color: TK.muted, fontWeight: 400 }}>· {it.designation || '—'}{it.department ? ` · ${it.department}` : ''}</span></div>
        <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 1 }}>Joining {day(it.date_of_joining)} · submitted {day(it.submitted_at)}{it.waiting_on_me.length ? ` · waiting on you for ${it.waiting_on_me.map(t => TEAM[t]).join(', ')}` : ''}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {it.approvals.map(a => <span key={a.team} style={pill(a.status)} title={a.acted_by_name ? `${a.status === 'RETURNED' ? 'Returned' : 'Approved'} by ${a.acted_by_name} on ${day(a.acted_at)}${a.remark ? ` — ${a.remark}` : ''}` : 'Not decided yet'}>{TEAM[a.team]} · {a.status === 'APPROVED' ? `✓ ${a.acted_by_name || 'approved'}` : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>)}
        </div>
      </div>
      <button disabled={busy} onClick={() => review(it)} style={it.waiting_on_me.length ? btn : btnO}>{it.waiting_on_me.length ? 'Open approval form' : 'View'}</button>
    </div>
  )

  const item = open?.item
  const mine: Approval | null = open ? open.approvals.find((a: Approval) => a.team === team) : null
  const decided = mine?.status === 'APPROVED'
  const missingNow = open ? missingItems(team, check[team]) : []
  const salary: SalaryBreakdown | null = open?.salary || null
  const n = (i: number) => String(i).padStart(2, '0')
  let sec = 0

  return (
    <div style={card}>
      <div style={section}>Onboarding approvals · {d.teams.map(t => TEAM[t]).join(' / ')}{waiting.length ? ` · ${waiting.length} waiting on you` : ''}</div>
      {waiting.map(renderItem)}
      {others.map(renderItem)}
      <div style={{ fontSize: 12, color: TK.muted, marginTop: 6 }}>These forms are accepted by the HR Manager. Confirm your team's checklist and approve; once IT, Admin and Payroll have all approved, the HR Manager generates the employee code. Returning the form reopens the candidate's link for 48 hours.</div>

      {open && item && (
        <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) setOpen(null) }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px 40px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
          <style>{SHEET_CSS}</style>
          <div className="rv-paper">
            {/* ── Letterhead ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: TK.muted }}>Onboarding approval · {CHECKLISTS[team].title}</div>
              <button onClick={() => setOpen(null)} className="rv-ghost" aria-label="Close">✕ Close</button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15 }}>{item.full_name}</div>
                {(item.designation || item.department) && <div style={{ fontSize: 13, color: TK.inkSoft, marginTop: 4 }}>{[item.designation, item.department].filter(Boolean).join(' · ')}</div>}
                <div style={{ fontSize: 12, color: TK.muted, marginTop: 2 }}>{item.employment_type || 'Employee'} · joining {day(item.date_of_joining)} · submitted {day(item.submitted_at)}{item.email ? ` · ${item.email}` : ''}{item.mobile ? ` · ${item.mobile}` : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {(open.approvals as Approval[]).map(a => {
                  const c = a.status === 'APPROVED' ? TK.positive : a.status === 'RETURNED' ? TK.critical : TK.muted
                  return <span key={a.team} className="rv-stamp" style={{ color: c, borderColor: c, background: a.status === 'APPROVED' ? TK.positiveTint : a.status === 'RETURNED' ? TK.criticalTint : TK.sunken }} title={a.remark || ''}>{TEAM[a.team]} {a.status === 'APPROVED' ? '✓' : a.status === 'RETURNED' ? '↩' : '·'} {a.status === 'APPROVED' ? (a.acted_by_name || 'approved') : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>
                })}
              </div>
            </div>
            {d.teams.length > 1 && (
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12 }}>
                <span style={{ color: TK.muted }}>Acting as</span>
                {d.teams.map(t => <button key={t} onClick={() => setTeam(t as HeadTeam)} className="rv-ghost" style={team === t ? { background: TK.brand, color: TK.onAccent, borderColor: TK.brand } : undefined}>{TEAM[t]}</button>)}
              </div>
            )}
            {decided
              ? <div style={{ marginTop: 14, padding: '8px 12px', borderRadius: 8, background: TK.positiveTint, color: TK.positive, fontSize: 12.5, fontWeight: 600 }}>Approved for {TEAM[team]} by {mine?.acted_by_name || '—'} on {day(mine?.acted_at)}.</div>
              : <div style={{ marginTop: 14, fontSize: 12.5, color: TK.inkSoft }}>Confirm your checklist, look through what the candidate filled in, then <b>approve for {TEAM[team]}</b>. If something is wrong in the form, return it to the candidate with a remark.</div>}

            {/* ── The team's checklist ── */}
            <section style={{ marginTop: 28 }}>
              <h3 className="rv-h">{n(++sec)} <span>{CHECKLISTS[team].title} · your checklist</span></h3>
              <div style={{ marginTop: 14 }}><Checklist team={team} values={check[team] || {}} onChange={setField} readOnly={decided} /></div>
            </section>

            {/* ── Payroll: the salary structure being approved ── */}
            {team === 'PAYROLL' && salary && (
              <section style={{ marginTop: 28 }}>
                <h3 className="rv-h">{n(++sec)} <span>Salary structure</span></h3>
                <div style={{ marginTop: 12 }}><SalaryTable s={salary} annual={salary.annual_ctc} /></div>
              </section>
            )}

            {/* ── Details, section by section (read-only; the documents stay with the HR Manager's review) ── */}
            {SCHEMA.map(s => item.form_data?.[s.step] ? <SectionView key={s.step} n={++sec} sec={s} obj={item.form_data[s.step]} marks={NO_MARKS} pick={false} onToggle={() => null} /> : null)}

            {/* ── Foot: the decision ── */}
            <div className="rv-bar">
              {item.status === 'EMPLOYEE_CREATED' || decided ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: TK.inkSoft }}>{decided ? `Already approved for ${TEAM[team]}.` : 'The employee code is already generated.'}</span>
                  <button onClick={() => setOpen(null)} className="rv-ghost" style={{ marginLeft: 'auto' }}>Close</button>
                </div>
              ) : mode === 'return' ? (
                <>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: TK.critical, marginBottom: 6 }}>Return to the candidate</div>
                  <textarea value={remark} onChange={e => setRemark(e.target.value)} className="rv-ta" placeholder="What should the candidate fix? e.g. the bank account number does not match the cancelled cheque." autoFocus />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                    <button disabled={busy || !remark.trim()} onClick={() => decide('return')} className="rv-btn" style={{ background: TK.critical }}>{busy ? 'Sending…' : 'Return with this remark'}</button>
                    <button disabled={busy} onClick={() => setMode('view')} className="rv-ghost">Cancel</button>
                    <span style={{ fontSize: 12, color: TK.muted }}>The candidate is emailed your remark and the link, valid 48 hours.</span>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <button disabled={busy || missingNow.length > 0} onClick={() => decide('approve')} className="rv-btn" style={{ background: missingNow.length ? TK.faint : TK.positive }}>{busy ? 'Saving…' : `✓ Approve for ${TEAM[team]}`}</button>
                  <button disabled={busy} onClick={() => decide('save')} className="rv-ghost">Save checklist</button>
                  <button disabled={busy} onClick={() => setMode('return')} className="rv-ghost">Return to candidate…</button>
                  <span style={{ fontSize: 12, color: missingNow.length ? TK.warning : TK.muted, marginLeft: 'auto' }}>{missingNow.length ? `${missingNow.length} item${missingNow.length === 1 ? '' : 's'} still to confirm` : 'Checklist complete'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
