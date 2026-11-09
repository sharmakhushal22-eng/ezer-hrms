'use client'
/**
 * HR Services → Exit Clearance & F&F (Exit Module spec v2 §8–§12).
 *
 *  • ClearanceInbox — the department forms waiting on this person (IT / Admin / Finance / HR /
 *    the manager), also mounted in Tasks & Approvals. HR Head sees overdue ones to override.
 *  • ExitFnf — the consolidated view (§12.3): every exit with its LWD, the five clearances and
 *    the F&F status; open one for its forms, the F&F statement (Payroll edits and reviews, the
 *    HR Manager approves, Finance marks it paid) and the letters.
 * Every rule is the server's (app/api/exit/*); this draws what it says.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { authToken } from '@/lib/rms/client'
import { Z } from '@/lib/ui'
import { fmtDate, fmtDateTime, useToast } from './ui'

type Api = (path: string, init?: RequestInit) => Promise<any>
type Item = { key: string; label: string; options: string[]; remark?: string; amount?: boolean; auto?: string }
type Form = { dept: string; label: string; formId: string; items: Item[]; signoff: string[] }
type Line = { key: string; label: string; amount: number; note?: string }

const DEPTS = ['IT', 'ADMIN', 'FINANCE', 'HR', 'HOD'] as const
const DEPT_SHORT: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', FINANCE: 'Finance', HR: 'HR', HOD: 'HOD' }
const SIGNOFF: Record<string, string> = {
  PENDING: 'Pending', CLEARED: 'Cleared', CLEARED_WITH_DUES: 'Cleared with dues', NOT_CLEARED: 'Not cleared',
  CLEARED_WITH_CONDITIONS: 'Cleared with conditions', CLEARED_WITH_REMARKS: 'Cleared with remarks',
}
const FNF: Record<string, string> = { CALCULATED: 'Calculated: Payroll to review', REVIEWED: 'Reviewed: HR to approve', APPROVED: 'Approved: Finance to pay', PAID: 'Paid' }
const rs = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const pillOf = (s: string | null | undefined) => !s ? 'mut' : s === 'PENDING' || s === 'NOT_CLEARED' ? 'warn' : s.startsWith('CLEARED') ? (s === 'CLEARED' ? 'ok' : 'info') : 'mut'

async function openPdf(path: string) {
  const token = await authToken()
  const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`) }
  const url = URL.createObjectURL(await r.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div data-ez-keep-open onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: Z.modal, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '28px 14px' }}>
      <div className="hx" style={{ width: wide ? 'min(1080px,100%)' : 'min(820px,100%)' }}>
        <div className="hx-card pad" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ez-ink)' }}>{title}</div>
              {sub && <div style={{ fontSize: 12, color: 'var(--ez-muted)', marginTop: 2 }}>{sub}</div>}
            </div>
            <button className="hx-btn o sm" onClick={onClose}>Close</button>
          </div>
          {children}
        </div>
      </div>
    </div>, document.body)
}

/** One department's form: every item, then the sign-off. Read-only when `readOnly`. */
function ClearanceForm({ api, row, form, readOnly, canOverride, onDone, onClose }: { api: Api; row: any; form: Form; readOnly?: boolean; canOverride?: boolean; onDone: () => void; onClose: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Record<string, any>>(() => ({ ...(row.items || {}) }))
  const [signoff, setSignoff] = useState(row.status && row.status !== 'PENDING' ? row.status : '')
  const [remarks, setRemarks] = useState(row.remarks || '')
  const [busy, setBusy] = useState(false)
  const [overriding, setOverriding] = useState(false)
  const set = (k: string, f: string, v: any) => setItems(s => ({ ...s, [k]: { ...(s[k] || {}), [f]: v } }))
  const dues = form.items.reduce((t, it) => t + (it.amount && !(form.dept === 'FINANCE' && it.key === 'expenses') ? Number(items[it.key]?.amount) || 0 : 0), 0)
  const payable = form.dept === 'FINANCE' ? Number(items.expenses?.amount) || 0 : 0
  const submit = async () => {
    setBusy(true)
    try {
      const j = await api('/api/exit/clearance', { method: 'POST', body: JSON.stringify(overriding ? { action: 'override', id: row.id, remarks } : { action: 'submit', id: row.id, items, signoff, remarks }) })
      toast(j.fnf ? `Signed off. All five departments are clear: F&F calculated (net ${rs(j.fnf.net_payable)}).` : 'Clearance signed off.')
      onDone(); onClose()
    } catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }
  const emp = row.employees || {}
  return (
    <Modal title={`${form.label} clearance · ${emp.full_name || ''}`} sub={`${form.formId}-${emp.emp_code || ''} · last working day ${fmtDate(row.lwd || row.employee_resignation?.final_lwd)}${row.cleared_by_name ? ` · signed by ${row.cleared_by_name} ${fmtDateTime(row.cleared_at)}` : ''}`} onClose={onClose} wide>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ background: 'var(--ez-sunken)' }}>
            {['#', 'Clearance item', 'Status', 'Remarks', form.items.some(i => i.amount) ? 'Amount (₹)' : ''].filter(Boolean).map(h => <th key={h} style={{ textAlign: 'left', padding: '7px 8px', fontSize: 10.5, color: 'var(--ez-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>)}
          </tr></thead>
          <tbody>{form.items.map((it, i) => (
            <tr key={it.key} style={{ borderTop: '1px solid var(--ez-line)' }}>
              <td style={{ padding: '6px 8px', color: 'var(--ez-faint)' }}>{i + 1}</td>
              <td style={{ padding: '6px 8px', minWidth: 200 }}>{it.label}{it.auto && <span className="hx-pill info" style={{ marginLeft: 6 }}>auto</span>}</td>
              <td style={{ padding: '6px 8px', minWidth: 170 }}>
                <select className="hx-select" disabled={readOnly || overriding} value={items[it.key]?.status || ''} onChange={e => set(it.key, 'status', e.target.value)}>
                  <option value="">Select…</option>{it.options.map(o => <option key={o}>{o}</option>)}
                </select>
              </td>
              <td style={{ padding: '6px 8px', minWidth: 170 }}><input className="hx-input" disabled={readOnly || overriding} value={items[it.key]?.remark || ''} placeholder={it.remark || ''} onChange={e => set(it.key, 'remark', e.target.value)} /></td>
              {form.items.some(x => x.amount) && <td style={{ padding: '6px 8px', width: 120 }}>{it.amount && <input className="hx-input" type="number" min={0} disabled={readOnly || overriding} value={items[it.key]?.amount ?? ''} onChange={e => set(it.key, 'amount', e.target.value === '' ? null : Number(e.target.value))} />}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="hx-grid2" style={{ marginTop: 14 }}>
        <div>
          <label className="hx-label">{overriding ? 'Override (HR Head)' : 'Clearance status'}</label>
          {overriding ? <div style={{ fontSize: 13, color: 'var(--ez-ink)', paddingTop: 8 }}>Cleared with conditions (override)</div> : (
            <select className="hx-select" disabled={readOnly} value={signoff} onChange={e => setSignoff(e.target.value)}>
              <option value="">Select…</option>{form.signoff.map(s => <option key={s} value={s}>{SIGNOFF[s] || s}</option>)}
            </select>
          )}
          <div style={{ fontSize: 12, color: 'var(--ez-muted)', marginTop: 6 }}>Total recovery from employee: <b style={{ color: dues ? 'var(--ez-critical)' : 'var(--ez-ink)' }}>{rs(dues)}</b>{form.dept === 'FINANCE' && <> · payable to employee: <b>{rs(payable)}</b> · net: <b>{rs(dues - payable)}</b></>}</div>
        </div>
        <div>
          <label className="hx-label">{overriding ? 'Reason for overriding *' : 'Remarks / conditions'}</label>
          <textarea className="hx-area" disabled={readOnly && !overriding} value={remarks} onChange={e => setRemarks(e.target.value)} style={{ minHeight: 64 }} />
        </div>
      </div>
      {!readOnly && (
        <div className="hx-actions" style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="hx-btn" disabled={busy || !signoff} onClick={submit}>{busy ? 'Saving…' : 'Sign off clearance'}</button>
        </div>
      )}
      {readOnly && canOverride && row.status === 'PENDING' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {overriding
            ? <><button className="hx-btn o" onClick={() => setOverriding(false)}>Back</button><button className="hx-btn d" disabled={busy || !remarks.trim()} onClick={submit}>{busy ? '…' : 'Override and clear'}</button></>
            : <button className="hx-btn d" onClick={() => { setOverriding(true); setRemarks('') }}>Override (HR Head)</button>}
        </div>
      )}
    </Modal>
  )
}

/** The clearance forms waiting on this person. Nothing when there are none. */
export function ClearanceInbox({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [items, setItems] = useState<any[] | null>(null)
  const [open, setOpen] = useState<any | null>(null)
  const load = useCallback(() => api('/api/exit/clearance?inbox=1').then(d => setItems(d.items || [])).catch(() => setItems([])), [api])
  useEffect(() => { load() }, [load])
  if (!items || !items.length) return null
  return (
    <div className="hx-card pad" style={{ marginBottom: 14 }}>
      <div className="hx-sec"><h2>Exit clearance waiting on you ({items.length})</h2></div>
      {items.map(c => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--ez-line)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ez-ink)' }}>{c.employees?.full_name} <span style={{ color: 'var(--ez-muted)', fontWeight: 500 }}>{c.employees?.emp_code}{c.employees?.designation ? ` · ${c.employees.designation}` : ''}</span> <span className="hx-pill info">{c.form?.label}</span>
              {c.escalated_to && <span className="hx-pill dang" style={{ marginLeft: 4 }}>Overdue · escalated to {c.escalated_to === 'HR_HEAD' ? 'HR Head' : 'HR Manager'}</span>}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ez-muted)', marginTop: 2 }}>Last working day {fmtDate(c.lwd)} · opened {fmtDate(c.started_at)}</div>
          </div>
          <button className="hx-btn sm" onClick={() => setOpen(c)}>{c.can_fill ? 'Fill clearance form' : 'Review / override'}</button>
        </div>
      ))}
      {open && <ClearanceForm api={api} row={open} form={open.form} readOnly={!open.can_fill} canOverride={open.can_override} onDone={() => { load(); onChanged?.() }} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** The F&F statement: lines editable by Payroll while CALCULATED; the workflow buttons. */
function FnfPanel({ api, resignationId, onChanged }: { api: Api; resignationId: string; onChanged: () => void }) {
  const toast = useToast()
  const [d, setD] = useState<any | null>(null)
  const [clr, setClr] = useState<{ rows: any[]; forms: Record<string, Form> } | null>(null)
  const [earn, setEarn] = useState<Line[]>([]); const [ded, setDed] = useState<Line[]>([])
  const [notes, setNotes] = useState(''); const [cbc, setCbc] = useState(false)
  const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<any | null>(null)
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api(`/api/exit/fnf?resignation_id=${resignationId}`), api(`/api/exit/clearance?resignation_id=${resignationId}`)])
    setD(a); setClr(b)
    if (a.fnf) { setEarn(a.fnf.earnings || []); setDed(a.fnf.deductions || []); setNotes(a.fnf.notes || ''); setCbc(!!a.fnf.letters_case_by_case) }
  }, [api, resignationId])
  useEffect(() => { load().catch(e => toast(e.message, 'error')) }, [load, toast])
  if (!d) return <div className="hx-skel" style={{ height: 120 }} />
  const f = d.fnf, can = d.can || {}
  const editable = f?.status === 'CALCULATED' && can.review
  const tot = (l: Line[]) => l.reduce((t, x) => t + (Number(x.amount) || 0), 0)
  const net = tot(earn) - tot(ded)
  const act = async (body: any, msg: string) => {
    setBusy(true)
    try { await api('/api/exit/fnf', { method: 'POST', body: JSON.stringify(body) }); toast(msg); await load(); onChanged() }
    catch (e) { toast((e as Error).message, 'error') }
    setBusy(false)
  }
  const lines = (l: Line[], setL: (x: Line[]) => void, title: string) => (
    <div style={{ flex: '1 1 380px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ez-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{title}</div>
      {l.map((x, i) => (
        <div key={x.key + i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid var(--ez-line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editable && x.key.startsWith('line_') ? <input className="hx-input" value={x.label} onChange={e => setL(l.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} /> : <div style={{ fontSize: 12.5, color: 'var(--ez-ink)' }}>{x.label}</div>}
            {x.note && <div style={{ fontSize: 11, color: 'var(--ez-faint)', marginTop: 2 }}>{x.note}</div>}
          </div>
          {editable ? <input className="hx-input" type="number" min={0} style={{ width: 120 }} value={x.amount} onChange={e => setL(l.map((y, j) => j === i ? { ...y, amount: Number(e.target.value) || 0 } : y))} />
            : <div style={{ width: 120, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{rs(x.amount)}</div>}
        </div>
      ))}
      {editable && <button className="hx-btn o sm" style={{ marginTop: 6 }} onClick={() => setL([...l, { key: `line_${Date.now()}`, label: 'Other', amount: 0 }])}>+ Add line</button>}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--ez-line)', marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13 }}><span>Total {title.toLowerCase()}</span><span>{rs(tot(l))}</span></div>
    </div>
  )
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ez-inkSoft, var(--ez-ink))', marginBottom: 10 }}>
        <b>{d.exit.employee?.full_name}</b> ({d.exit.employee?.emp_code}) · {d.exit.reason} · last working day <b>{fmtDate(d.exit.lwd)}</b>
      </div>
      <div className="hx-sec"><h2>Clearance</h2></div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {DEPTS.map(dep => {
          const c = clr?.rows.find(r => r.dept === dep)
          return (
            <button key={dep} className="hx-btn o sm" disabled={!c || !clr?.forms} onClick={() => c && setForm(c)} title={c?.remarks || ''}>
              {DEPT_SHORT[dep]} <span className={`hx-pill ${pillOf(c?.status)}`} style={{ marginLeft: 6 }}>{c ? SIGNOFF[c.status] || c.status : 'Not started'}</span>{c && Number(c.recovery) > 0 && <span style={{ marginLeft: 6, color: 'var(--ez-critical)' }}>{rs(c.recovery)}</span>}
            </button>
          )
        })}
        {!clr?.rows.length && can.startClearance && <button className="hx-btn sm" disabled={busy} onClick={async () => { setBusy(true); try { const j = await api('/api/exit/clearance', { method: 'POST', body: JSON.stringify({ action: 'start', resignation_id: resignationId }) }); toast(`Clearance opened (${j.started} forms).`); await load(); onChanged() } catch (e) { toast((e as Error).message, 'error') } setBusy(false) }}>Start clearance now</button>}
      </div>

      <div className="hx-sec"><h2>Full &amp; Final settlement</h2>{f && <span className={`hx-pill ${f.status === 'PAID' ? 'ok' : 'info'}`} style={{ marginLeft: 8 }}>{FNF[f.status] || f.status}</span>}</div>
      {!f && <div className="hx-note">The F&amp;F is calculated automatically once all five departments have cleared (spec §8.1).</div>}
      {f && (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>{lines(earn, setEarn, 'Earnings')}{lines(ded, setDed, 'Deductions')}</div>
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--ez-brand-tint)', display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}><span>Net payable to employee</span><span>{rs(net)}</span></div>
          {editable && (
            <div className="hx-grid2" style={{ marginTop: 10 }}>
              <div><label className="hx-label">Notes</label><textarea className="hx-area" value={notes} onChange={e => setNotes(e.target.value)} style={{ minHeight: 56 }} /></div>
              <div>{f.reason_code === 'TERMINATION' && <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginTop: 22 }}><input type="checkbox" checked={cbc} onChange={e => setCbc(e.target.checked)} /> Issue Experience &amp; Relieving letters for this termination (case-by-case)</label>}</div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--ez-muted)', marginTop: 8, lineHeight: 1.7 }}>
            {f.reviewed_by_name && <>Reviewed by {f.reviewed_by_name} {fmtDateTime(f.reviewed_at)} · </>}
            {f.approved_by_name && <>Approved by {f.approved_by_name} {fmtDateTime(f.approved_at)} · </>}
            {f.paid_ref && <>Paid ({f.paid_ref}) by {f.paid_by_name} {fmtDateTime(f.paid_at)}</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
            <button className="hx-btn o sm" onClick={() => openPdf(`/api/exit/letters?resignation_id=${resignationId}&kind=FNF_STATEMENT`).catch(e => toast(e.message, 'error'))}>F&amp;F statement PDF</button>
            {editable && <button className="hx-btn o" disabled={busy} onClick={() => act({ action: 'calculate', resignation_id: resignationId }, 'Recalculated from the latest data.')}>Recalculate</button>}
            {editable && <button className="hx-btn o" disabled={busy} onClick={() => act({ action: 'save', id: f.id, earnings: earn, deductions: ded, notes, letters_case_by_case: cbc }, 'Saved.')}>Save changes</button>}
            {editable && <button className="hx-btn" disabled={busy} onClick={async () => { await act({ action: 'save', id: f.id, earnings: earn, deductions: ded, notes, letters_case_by_case: cbc }, 'Saved.'); await act({ action: 'review', id: f.id }, 'Marked reviewed. The HR Manager approves it next.') }}>Mark reviewed</button>}
            {f.status === 'REVIEWED' && (can.review || can.approve) && <button className="hx-btn o" disabled={busy} onClick={() => act({ action: 'reopen', id: f.id }, 'Reopened for changes.')}>Reopen</button>}
            {f.status === 'REVIEWED' && can.approve && <button className="hx-btn" disabled={busy} onClick={() => act({ action: 'approve', id: f.id }, 'F&F approved. Letters issued and the employee told.')}>Approve F&amp;F</button>}
            {f.status === 'APPROVED' && can.pay && <>
              <input className="hx-input" style={{ width: 220 }} placeholder="Payment reference (UTR)" value={ref} onChange={e => setRef(e.target.value)} />
              <button className="hx-btn" disabled={busy || !ref.trim()} onClick={() => act({ action: 'pay', id: f.id, paid_ref: ref }, 'Marked paid.')}>Mark paid</button>
            </>}
          </div>
          {d.letters?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="hx-sec"><h2>Letters</h2></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {d.letters.map((l: any) => <button key={l.kind} className="hx-btn o sm" onClick={() => openPdf(`/api/exit/letters?resignation_id=${resignationId}&kind=${l.kind}`).catch(e => toast(e.message, 'error'))}>{l.label}</button>)}
              </div>
            </div>
          )}
        </>
      )}
      {form && clr?.forms && <ClearanceForm api={api} row={{ ...form, lwd: d.exit.lwd }} form={clr.forms[form.dept]} readOnly onDone={load} onClose={() => setForm(null)} />}
    </div>
  )
}

/** HR Services → Exit Clearance & F&F. */
export function ExitFnf({ api }: { api: Api }) {
  const [d, setD] = useState<{ exits: any[]; can: any } | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<any | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(() => api('/api/exit/fnf').then(x => { setD(x); setErr('') }).catch(e => setErr(e.message)), [api])
  useEffect(() => { load() }, [load])
  const shown = useMemo(() => (d?.exits || []).filter(x => !q.trim() || `${x.employee?.full_name} ${x.employee?.emp_code}`.toLowerCase().includes(q.trim().toLowerCase())), [d, q])
  return (
    <>
      <ClearanceInbox api={api} onChanged={load} />
      {err && <div className="hx-note d">{err}</div>}
      {d?.can?.view && (
        <div className="hx-card pad">
          <div className="hx-sec" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2>Exits in progress</h2><span className="grow" style={{ flex: 1 }} />
            <input className="hx-input" style={{ width: 220 }} placeholder="Search name or code…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {!shown.length && <div style={{ fontSize: 12.5, color: 'var(--ez-muted)', padding: '6px 0' }}>No exits in the last six months.</div>}
          {shown.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ background: 'var(--ez-sunken)' }}>{['Employee', 'Last working day', 'Reason', ...DEPTS.map(x => DEPT_SHORT[x]), 'F&F', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px', fontSize: 10.5, color: 'var(--ez-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>{shown.map(x => (
                  <tr key={x.resignation_id} style={{ borderTop: '1px solid var(--ez-line)' }}>
                    <td style={{ padding: '8px' }}><b>{x.employee?.full_name}</b><div style={{ color: 'var(--ez-muted)', fontSize: 11 }}>{x.employee?.emp_code}{x.employee?.designation ? ` · ${x.employee.designation}` : ''}</div></td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{x.final_lwd_set ? fmtDate(x.lwd) : <span className="hx-pill mut">In approval</span>}</td>
                    <td style={{ padding: '8px' }}>{x.reason}</td>
                    {DEPTS.map(dep => { const c = x.clearance?.[dep]; return <td key={dep} style={{ padding: '8px' }}><span className={`hx-pill ${pillOf(c?.status)}`}>{c ? (c.status === 'CLEARED_WITH_DUES' ? `Dues ${rs(c.recovery)}` : SIGNOFF[c.status]) : '—'}</span></td> })}
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>{x.fnf ? <><span className={`hx-pill ${x.fnf.status === 'PAID' ? 'ok' : 'info'}`}>{x.fnf.status}</span> <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rs(x.fnf.net_payable)}</span></> : <span className="hx-pill mut">{Object.values(x.clearance || {}).some(Boolean) ? 'Blocked' : '—'}</span>}</td>
                    <td style={{ padding: '8px' }}><button className="hx-btn o sm" disabled={!x.final_lwd_set} onClick={() => setOpen(x)}>Open</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {open && <Modal title={`Exit · ${open.employee?.full_name}`} sub="Clearance, Full & Final settlement and letters" onClose={() => setOpen(null)} wide>
        <FnfPanel api={api} resignationId={open.resignation_id} onChanged={load} />
      </Modal>}
    </>
  )
}

/** The employee's own view, under their Exit screen: clearance status and, once the F&F is
 *  approved, the statement and letters to download (spec §6, §12.2). */
export function MyExitDocuments({ api, resignationId }: { api: Api; resignationId: string | null | undefined }) {
  const toast = useToast()
  const [d, setD] = useState<any | null>(null)
  const [clr, setClr] = useState<any[]>([])
  useEffect(() => {
    if (!resignationId) return
    api(`/api/exit/fnf?resignation_id=${resignationId}`).then(setD).catch(() => setD(null))
    api(`/api/exit/clearance?resignation_id=${resignationId}`).then(x => setClr(x.rows || [])).catch(() => setClr([]))
  }, [api, resignationId])
  if (!resignationId || (!clr.length && !d?.fnf)) return null
  return (
    <div className="hx-card pad" style={{ marginTop: 14 }}>
      <div className="hx-sec"><h2>Clearance &amp; settlement</h2></div>
      {clr.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {DEPTS.map(dep => { const c = clr.find(r => r.dept === dep); return <span key={dep} className={`hx-pill ${pillOf(c?.status)}`}>{DEPT_SHORT[dep]}: {c ? (c.status === 'CLEARED_WITH_DUES' ? `Dues ${rs(c.recovery)}` : SIGNOFF[c.status]) : '—'}</span> })}
      </div>}
      {d?.fnf && <div style={{ fontSize: 13, marginBottom: 10 }}>Full &amp; Final: <b>{rs(d.fnf.net_payable)}</b> · {d.fnf.status === 'PAID' ? `paid (${d.fnf.paid_ref})` : 'approved, payment in progress'}</div>}
      {(d?.letters || []).length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {d.letters.map((l: any) => <button key={l.kind} className="hx-btn o sm" onClick={() => openPdf(`/api/exit/letters?resignation_id=${resignationId}&kind=${l.kind}`).catch(e => toast(e.message, 'error'))}>Download {l.label}</button>)}
      </div>}
    </div>
  )
}
