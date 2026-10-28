'use client'
// components/employees/HrExitButton.tsx — the red Exit button on People → Employees → employee
// detail, for the hiring and HR roles (lib/exit/hr-exit.ts EXIT_ROLES). It opens a popup:
//   • no exit yet      → reason, sub-reason, last working day, additional information,
//                        "Start exit process"
//   • exit running     → its status and the whole approval flow (each step's approvers by
//                        employee code), with Cancel
//   • exit rejected    → the same flow, with Reset in place of Cancel
// Every rule is enforced by app/api/ess/exit-employee; this only shows what it says.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { authHeaders } from '@/lib/auth-headers'
import { Button, Badge as Chip, C, F, W, S, R, E, Z, inputStyle } from '@/lib/ui'

type Person = { id: string; emp_code: string | null; full_name: string }
type Step = { stage: string; label: string; status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'; approvers: Person[]; acted_by?: Person | null; acted_at?: string | null; note?: string | null }
type Req = { id: string; reason_label: string; sub_reason: string | null; last_working_day: string; remarks: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; chain: Step[]; initiated_by_name: string | null; created_at: string; decided_at: string | null }
type Reason = { code: string; label: string; sub_reasons: string[]; lwd: string; lwd_hint: string; chain: string[]; rehire: string }
type State = { allowed: boolean; reasons: Reason[]; request: Req | null; blocked: string | null; employee: { full_name: string; emp_code: string | null } | null }

async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}
const fmt = (d?: string | null) => d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
const fmtT = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const code = (p: Person) => `${p.emp_code || '-'} · ${p.full_name}`

const STATUS: Record<Req['status'], { label: string; t: 'warning' | 'positive' | 'critical' }> = {
  PENDING: { label: 'Waiting for approval', t: 'warning' },
  APPROVED: { label: 'Approved: exit in effect', t: 'positive' },
  REJECTED: { label: 'Rejected', t: 'critical' },
}
const STEP: Record<Step['status'], { label: string; dot: string }> = {
  APPROVED: { label: 'Approved', dot: C.positive },
  PENDING: { label: 'Waiting', dot: C.warning },
  REJECTED: { label: 'Rejected', dot: C.critical },
  SKIPPED: { label: 'Skipped', dot: C.faint },
  WAITING: { label: 'Not reached yet', dot: C.lineStrong },
}

const lbl: React.CSSProperties = { display: 'block', fontSize: F.tiny, fontWeight: W.semi, color: C.muted, marginBottom: 4 }
const inp: React.CSSProperties = { ...inputStyle(), width: '100%', boxSizing: 'border-box' }

/** The whole approval flow, top to bottom. */
function Flow({ req }: { req: Req }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <li style={{ display: 'flex', gap: S.sm, paddingBottom: S.md }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: C.positive, marginTop: 5, flexShrink: 0 }} />
        <div style={{ fontSize: F.small }}>
          <b>Started</b> by {req.initiated_by_name || 'HR'} <span style={{ color: C.faint }}>· {fmtT(req.created_at)}</span>
        </div>
      </li>
      {req.chain.map((s, i) => (
        <li key={i} style={{ display: 'flex', gap: S.sm, paddingBottom: S.md }}>
          <span style={{ width: 10, height: 10, borderRadius: 99, background: STEP[s.status].dot, marginTop: 5, flexShrink: 0 }} />
          <div style={{ fontSize: F.small, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{s.label}</b>
              <Chip t={s.status === 'APPROVED' ? 'positive' : s.status === 'REJECTED' ? 'critical' : s.status === 'PENDING' ? 'warning' : undefined}>{STEP[s.status].label}</Chip>
            </div>
            {s.approvers.length > 0 && (
              <div style={{ color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
                Approvers: {s.approvers.map(p => <span key={p.id} style={{ display: 'inline-block', marginRight: 8, color: C.inkSoft }}>{code(p)}</span>)}
              </div>
            )}
            {s.acted_by && <div style={{ color: C.muted, marginTop: 2 }}>{s.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {code(s.acted_by)} <span style={{ color: C.faint }}>· {fmtT(s.acted_at)}</span></div>}
            {s.note && <div style={{ color: s.status === 'REJECTED' ? C.critical : C.muted, marginTop: 2 }}>{s.status === 'REJECTED' ? 'Reason: ' : ''}{s.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function StartForm({ reasons, busy, onStart }: { reasons: Reason[]; busy: boolean; onStart: (x: { reason_code: string; sub_reason: string; lwd: string; remarks: string }) => void }) {
  const [reason, setReason] = useState('')
  const [sub, setSub] = useState('')
  const [lwd, setLwd] = useState('')
  const [info, setInfo] = useState('')
  const r = reasons.find(x => x.code === reason)
  const ready = !!r && !!sub && !!lwd && !!info.trim()
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: S.md }}>
        <div>
          <label style={lbl}>Reason *</label>
          <select style={inp} value={reason} onChange={e => { const n = reasons.find(x => x.code === e.target.value); setReason(e.target.value); setSub(''); setLwd(n?.lwd || '') }}>
            <option value="">Select…</option>
            {reasons.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Sub-reason *</label>
          <select style={inp} value={sub} onChange={e => setSub(e.target.value)} disabled={!r}>
            <option value="">{r ? 'Select…' : 'Pick the reason first'}</option>
            {(r?.sub_reasons || []).map(x => <option key={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Last working day *</label>
          <input type="date" style={inp} value={lwd} onChange={e => setLwd(e.target.value)} disabled={!r} />
          {r && <div style={{ fontSize: F.tiny, color: C.faint, marginTop: 3 }}>Rule: {r.lwd_hint}</div>}
        </div>
      </div>
      <div style={{ marginTop: S.md }}>
        <label style={lbl}>Additional information *</label>
        <textarea style={{ ...inp, height: 'auto', minHeight: 84, padding: '9px 11px', resize: 'vertical', lineHeight: 1.5 }} maxLength={2000}
          value={info} onChange={e => setInfo(e.target.value)} placeholder="Why the exit is happening: warnings given, inquiry outcome, attempts to reach the employee…" />
      </div>
      {r && (
        <div style={{ marginTop: S.md, fontSize: F.small, color: C.inkSoft, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px`, lineHeight: 1.6 }}>
          Approval flow: <b>{r.chain.join(' → ')}</b>. Nothing changes for the employee until the last approval. Rehire flag: {r.rehire}.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: S.lg }}>
        <Button variant="danger" disabled={!ready || busy} onClick={() => onStart({ reason_code: reason, sub_reason: sub, lwd, remarks: info.trim() })}>
          {busy ? 'Starting…' : 'Start exit process'}
        </Button>
      </div>
    </div>
  )
}

export default function HrExitButton({ employeeId }: { employeeId: string }) {
  const [st, setSt] = useState<State | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [confirm, setConfirm] = useState<'cancel' | 'reset' | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(() => call(`/api/ess/exit-employee?target=${encodeURIComponent(employeeId)}`).then(setSt).catch(() => setSt(null)), [employeeId])
  useEffect(() => { load() }, [load])
  if (!st?.allowed) return null

  const close = () => { if (busy) return; setOpen(false); setErr(''); setMsg(''); setConfirm(null); setNote('') }
  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setErr('')
    try { await call('/api/ess/exit-employee', { method: 'POST', body: JSON.stringify(body) }); setMsg(done); setConfirm(null); setNote(''); await load() }
    catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const req = st.request
  const name = st.employee ? `${st.employee.full_name}${st.employee.emp_code ? ` (${st.employee.emp_code})` : ''}` : 'this employee'

  return (
    <>
      <Button variant="danger" onClick={() => { setOpen(true); load() }}>{req ? `Exit · ${STATUS[req.status].label.split(':')[0]}` : 'Exit'}</Button>
      {open && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal aria-label={`Exit ${name}`} onMouseDown={e => { if (e.target === e.currentTarget) close() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: Z.modal, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px' }}>
          <div style={{ background: C.surface, color: C.ink, borderRadius: R.xl, boxShadow: E.overlay, width: 'min(680px, 100%)', padding: S.xl, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, marginBottom: S.lg }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: F.title, fontWeight: W.bold }}>Exit {name}</div>
                <div style={{ fontSize: F.small, color: C.muted, marginTop: 2 }}>
                  {req ? 'Status of the exit and its approval flow' : 'Start the exit. It goes for approval before anything changes for the employee.'}
                </div>
              </div>
              <Button size="sm" onClick={close}>Close</Button>
            </div>

            {msg && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.positive, background: C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{msg}</div>}
            {err && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{err}</div>}

            {!req && st.blocked && <div style={{ fontSize: F.small, color: C.inkSoft }}>{st.blocked}</div>}
            {!req && !st.blocked && (
              <StartForm reasons={st.reasons} busy={busy}
                onStart={x => act({ action: 'start', employee_id: employeeId, ...x }, `Exit started for ${name}. It is now with the approvers below.`)} />
            )}

            {req && (
              <div>
                <div style={{ display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap', marginBottom: S.md }}>
                  <Chip t={STATUS[req.status].t} dot>{STATUS[req.status].label}</Chip>
                  <span style={{ fontSize: F.small, color: C.inkSoft }}><b>{req.reason_label}</b>{req.sub_reason ? ` · ${req.sub_reason}` : ''} · last working day <b>{fmt(req.last_working_day)}</b></span>
                </div>
                {req.remarks && <div style={{ fontSize: F.small, color: C.muted, marginBottom: S.lg, lineHeight: 1.6 }}>{req.remarks}</div>}
                <div style={{ border: `1px solid ${C.line}`, borderRadius: R.lg, padding: `${S.md}px ${S.lg}px 0`, background: C.sunken }}>
                  <div style={{ fontSize: F.tiny, fontWeight: W.bold, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: S.sm }}>Approval flow</div>
                  <Flow req={req} />
                </div>

                {confirm ? (
                  <div style={{ marginTop: S.lg, border: `1px solid ${confirm === 'cancel' ? C.criticalEdge : C.line}`, borderRadius: R.lg, padding: S.md }}>
                    <div style={{ fontSize: F.small, fontWeight: W.semi, marginBottom: S.sm }}>
                      {confirm === 'cancel'
                        ? (req.status === 'APPROVED' ? `Cancel this exit? ${name}'s last working day is cleared and they continue in their role.` : 'Cancel this exit? The approvers are told it is withdrawn.')
                        : 'Reset this rejected exit? It is closed and a new one can be started.'}
                    </div>
                    {confirm === 'cancel' && <textarea style={{ ...inp, height: 'auto', minHeight: 56, padding: '8px 10px', resize: 'vertical' }} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for cancelling (optional)" />}
                    <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end', marginTop: S.sm }}>
                      <Button onClick={() => { setConfirm(null); setNote('') }} disabled={busy}>Back</Button>
                      <Button variant="danger" disabled={busy} onClick={() => act({ action: confirm, id: req.id, note }, confirm === 'cancel' ? 'Exit cancelled.' : 'Exit reset. You can start a new one.')}>
                        {busy ? '…' : confirm === 'cancel' ? 'Yes, cancel exit' : 'Yes, reset'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: S.lg }}>
                    {req.status === 'REJECTED'
                      ? <Button variant="primary" onClick={() => setConfirm('reset')}>Reset</Button>
                      : <Button variant="danger" onClick={() => setConfirm('cancel')}>Cancel exit</Button>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>, document.body)}
    </>
  )
}
