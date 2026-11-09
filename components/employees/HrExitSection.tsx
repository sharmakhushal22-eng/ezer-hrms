'use client'
// components/employees/HrExitSection.tsx — the Exit section in People → Employees → employee →
// HR Actions (it took the place of "Initiate resignation"), for the hiring and HR roles
// (lib/exit/hr-exit.ts EXIT_ROLES):
//   • no exit yet      → reason, sub-reason, last working day, additional information,
//                        documents, "Start exit process"
//   • exit running     → its status and the whole approval flow (each step's approvers by
//                        employee code), with Cancel
//   • exit rejected    → the same flow, with Reset in place of Cancel
// Every rule is enforced by app/api/ess/exit-employee; this only shows what it says.
import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { Button, Badge as Chip, C, F, W, S, R, E, inputStyle } from '@/lib/ui'
import { stepWords, type ChainStep } from '@/lib/exit/hr-exit'

type Person = { id: string; emp_code: string | null; full_name: string }
type Step = { stage: string; label: string; status: 'WAITING' | 'PENDING' | 'HOLD' | 'APPROVED' | 'REJECTED' | 'SKIPPED'; approvers: Person[]; acted_by?: Person | null; acted_at?: string | null; note?: string | null; action?: string | null; lwd?: string | null }
type Doc = { name: string; path: string; size: number; uploaded_at: string; uploaded_by: string | null }
type Req = { id: string; reason_code: string; reason_label: string; sub_reason: string | null; last_working_day: string; remarks: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; chain: Step[]; initiated_by_name: string | null; created_at: string; decided_at: string | null
  documents: Doc[]; abscond_stage: 'REMINDING' | 'READY' | null; reminders_sent: number; last_reminder_at: string | null; destination_company: string | null }
type Reason = { code: string; label: string; sub_reasons: string[]; lwd: string; lwd_hint: string; chain: string[]; rehire: string }
type State = { allowed: boolean; reasons: Reason[]; request: Req | null; blocked: string | null; employee: { full_name: string; emp_code: string | null } | null; companies?: { id: string; name: string }[] }

async function call(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
  return j
}
async function upload(requestId: string, file: File) {
  const h = await authHeaders(); delete (h as any)['Content-Type']
  const fd = new FormData(); fd.append('request_id', requestId); fd.append('file', file)
  const r = await fetch('/api/exit/documents', { method: 'POST', headers: h, body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`)
  return j.documents as Doc[]
}
async function openDoc(requestId: string, path: string) {
  const j = await call(`/api/exit/documents?request_id=${encodeURIComponent(requestId)}&path=${encodeURIComponent(path)}`)
  window.open(j.url, '_blank', 'noopener')
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
  HOLD: { label: 'Retention requested', dot: C.warning },
  REJECTED: { label: 'Rejected', dot: C.critical },
  SKIPPED: { label: 'Skipped', dot: C.faint },
  WAITING: { label: 'Not reached yet', dot: C.lineStrong },
}

const lbl: React.CSSProperties = { display: 'block', fontSize: F.tiny, fontWeight: W.semi, color: C.muted, marginBottom: 4 }
const inp: React.CSSProperties = { ...inputStyle(), width: '100%', boxSizing: 'border-box' }

/** Supporting documents: open any; add more while the exit is live. */
function Docs({ req, onAdded, onError }: { req: Req; onAdded: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ marginBottom: S.md, fontSize: F.small }}>
      <span style={{ color: C.muted }}>Documents: </span>
      {req.documents.length === 0 && <span style={{ color: C.faint }}>none </span>}
      {req.documents.map(d => (
        <button key={d.path} type="button" onClick={() => openDoc(req.id, d.path).catch(e => onError(e.message))}
          style={{ border: 'none', background: 'none', color: C.info, cursor: 'pointer', padding: 0, marginRight: 10, font: 'inherit', textDecoration: 'underline' }}>{d.name}</button>
      ))}
      {req.status !== 'REJECTED' && (
        <label style={{ color: C.brand, cursor: busy ? 'wait' : 'pointer', fontWeight: W.semi }}>
          {busy ? 'Uploading…' : '+ Add'}
          <input type="file" hidden disabled={busy} accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f) return
            setBusy(true)
            try { await upload(req.id, f); onAdded() } catch (er) { onError((er as Error).message) }
            setBusy(false)
          }} />
        </label>
      )}
    </div>
  )
}

/** The whole approval flow, top to bottom. */
function Flow({ req }: { req: Req }) {
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, position: 'relative' }}>
      <span aria-hidden style={{ position: 'absolute', left: 5, top: 10, bottom: 18, width: 2, background: C.line }} />
      <li style={{ display: 'flex', gap: S.sm, paddingBottom: S.md }}>
        <span style={ring(C.positive)} />
        <div style={{ fontSize: F.small }}>
          <b>Started</b> by {req.initiated_by_name || 'HR'} <span style={{ color: C.faint }}>· {fmtT(req.created_at)}</span>
        </div>
      </li>
      {req.chain.map((s, i) => (
        <li key={i} style={{ display: 'flex', gap: S.sm, paddingBottom: S.md }}>
          <span style={ring(STEP[s.status].dot)} />
          <div style={{ fontSize: F.small, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{s.label}</b>
              <Chip t={s.status === 'APPROVED' ? 'positive' : s.status === 'REJECTED' ? 'critical' : s.status === 'PENDING' || s.status === 'HOLD' ? 'warning' : undefined}>{stepWords(s as ChainStep)}{s.lwd ? `: ${fmt(s.lwd)}` : ''}</Chip>
            </div>
            {s.approvers.length > 0 && (
              <div style={{ color: C.muted, marginTop: 3, lineHeight: 1.6 }}>
                Approvers: {s.approvers.map(p => <span key={p.id} style={{ display: 'inline-block', marginRight: 8, color: C.inkSoft }}>{code(p)}</span>)}
              </div>
            )}
            {s.acted_by && s.action !== 'STARTED' && <div style={{ color: C.muted, marginTop: 2 }}>{s.status === 'REJECTED' ? 'Rejected' : stepWords(s as ChainStep)} by {code(s.acted_by)} <span style={{ color: C.faint }}>· {fmtT(s.acted_at)}</span></div>}
            {s.note && <div style={{ color: s.status === 'REJECTED' ? C.critical : C.muted, marginTop: 2 }}>{s.status === 'REJECTED' ? 'Reason: ' : ''}{s.note}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function StartForm({ reasons, companies, busy, onStart }: { reasons: Reason[]; companies: { id: string; name: string }[]; busy: boolean; onStart: (x: { reason_code: string; sub_reason: string; lwd: string; remarks: string; destination_company_id?: string }, files: File[]) => void }) {
  const [reason, setReason] = useState('')
  const [dest, setDest] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sub, setSub] = useState('')
  const [lwd, setLwd] = useState('')
  const [info, setInfo] = useState('')
  const r = reasons.find(x => x.code === reason)
  const transfer = r?.code === 'TRANSFER'
  const ready = !!r && !!sub && !!lwd && !!info.trim() && (!transfer || !!dest)
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
        {transfer && (
          <div>
            <label style={lbl}>Transferring to *</label>
            <select style={inp} value={dest} onChange={e => setDest(e.target.value)}>
              <option value="">{companies.length ? 'Select the company…' : 'No other company in the group'}</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div style={{ marginTop: S.md }}>
        <label style={lbl}>Additional information *</label>
        <textarea style={{ ...inp, height: 'auto', minHeight: 84, padding: '9px 11px', resize: 'vertical', lineHeight: 1.5 }} maxLength={2000}
          value={info} onChange={e => setInfo(e.target.value)} placeholder="Why the exit is happening: warnings given, inquiry outcome, attempts to reach the employee…" />
      </div>
      <div style={{ marginTop: S.md }}>
        <label style={lbl}>Supporting documents <span style={{ fontWeight: 400 }}>(warning letters, inquiry report · PDF / Word / image, 10 MB each)</span></label>
        <input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 10))} style={{ fontSize: F.small }} />
        {files.length > 0 && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 3 }}>{files.map(f => f.name).join(', ')}</div>}
      </div>
      {r && (
        <div style={{ marginTop: S.md, fontSize: F.small, color: C.inkSoft, background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px`, lineHeight: 1.6 }}>
          {r.code === 'ABSCOND' && <>Three reminders go to the employee a week apart (the first now); after 21 days with no response the approval starts. </>}
          Approval flow, the same as a resignation: <b>{r.chain.length ? r.chain.join(' → ') : 'nobody resolved: HR sets the final last working day'}</b>. The managers acknowledge it, accept it with their date or request retention; the HR Manager sets the final last working day, and only then does anything change for the employee.{r.rehire ? ` Rehire flag: ${r.rehire}.` : ''}{r.code === 'TRANSFER' ? ' Group date of joining is kept; the new company onboards them from the day after.' : ''}{r.code === 'DEATH' ? ' Nothing is sent to the employee’s own bell or mail; gratuity (no minimum service), the F&F and the PF / EDLI claim go to the nominee.' : ''}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: S.lg }}>
        <Button variant="danger" disabled={!ready || busy} onClick={() => onStart({ reason_code: reason, sub_reason: sub, lwd, remarks: info.trim(), ...(transfer ? { destination_company_id: dest } : {}) }, files)}>
          {busy ? 'Starting…' : 'Start exit process'}
        </Button>
      </div>
    </div>
  )
}

/** A step of the approval flow as a timeline node. */
const ring = (dot: string): React.CSSProperties => ({ width: 12, height: 12, borderRadius: 99, background: dot, boxShadow: `0 0 0 3px ${C.surface}, 0 0 0 4px ${C.line}`, marginTop: 4, flexShrink: 0, position: 'relative' })

export default function HrExitSection({ employeeId, onChanged }: { employeeId: string; onChanged?: () => void }) {
  const [st, setSt] = useState<State | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [confirm, setConfirm] = useState<'cancel' | 'reset' | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(() => call(`/api/ess/exit-employee?target=${encodeURIComponent(employeeId)}`).then(setSt).catch(() => setSt(null)).finally(() => setLoaded(true)), [employeeId])
  useEffect(() => { setLoaded(false); setMsg(''); setErr(''); setConfirm(null); load() }, [load])

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, boxShadow: E.flat, marginBottom: S.md, overflow: 'hidden' }
  if (!loaded) return <div style={{ ...card, padding: S.lg, fontSize: F.small, color: C.faint }}>Loading the exit…</div>
  if (!st?.allowed) return (
    <div style={{ ...card, padding: S.lg }}>
      <div style={{ fontSize: F.body, fontWeight: W.semi, color: C.ink }}>Exit</div>
      <div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.55 }}>Exits are started by HR and Hiring Managers. Ask your HR Manager if this employee is leaving.</div>
    </div>
  )

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setErr('')
    try { await call('/api/ess/exit-employee', { method: 'POST', body: JSON.stringify(body) }); setMsg(done); setConfirm(null); setNote(''); await load(); onChanged?.() }
    catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const req = st.request
  const name = st.employee ? `${st.employee.full_name}${st.employee.emp_code ? ` (${st.employee.emp_code})` : ''}` : 'this employee'
  const accent = req ? (req.status === 'APPROVED' ? C.positive : req.status === 'REJECTED' ? C.critical : C.warning) : C.critical

  return (
    <div style={{ ...card, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: S.md, padding: `${S.lg}px ${S.lg + 2}px ${S.md}px`, flexWrap: 'wrap' }}>
        <span aria-hidden style={{ width: 38, height: 38, borderRadius: R.md, display: 'grid', placeItems: 'center', background: req?.status === 'APPROVED' ? C.positiveTint : req?.status === 'PENDING' ? C.warningTint : C.criticalTint, color: accent, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink }}>{req ? 'Exit in progress' : 'Exit employee'}</div>
          <div style={{ fontSize: F.small, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
            {req ? `The exit of ${name} and where it stands in its approval flow.` : `Start the exit of ${name}. It goes through its approval flow before anything changes for the employee.`}
          </div>
        </div>
        {req && <Chip t={STATUS[req.status].t} dot>{STATUS[req.status].label}</Chip>}
      </div>

      <div style={{ padding: `0 ${S.lg + 2}px ${S.lg}px` }}>
        {msg && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.positive, background: C.positiveTint, border: `1px solid ${C.positiveEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{msg}</div>}
        {err && <div style={{ marginBottom: S.md, fontSize: F.small, color: C.critical, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{err}</div>}

        {!req && st.blocked && <div style={{ fontSize: F.small, color: C.inkSoft, background: C.sunken, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>{st.blocked}</div>}
        {!req && !st.blocked && (
          <StartForm reasons={st.reasons} companies={st.companies || []} busy={busy}
            onStart={async (x, files) => {
              setBusy(true); setErr('')
              try {
                const j = await call('/api/ess/exit-employee', { method: 'POST', body: JSON.stringify({ action: 'start', target_id: employeeId, ...x }) })
                const failed: string[] = []
                for (const f of files) { try { await upload(j.request.id, f) } catch (e) { failed.push(`${f.name}: ${(e as Error).message}`) } }
                setMsg(`Exit started for ${name}.${x.reason_code === 'ABSCOND' ? ' Reminder 1 of 3 has been sent.' : ' It is now with the approvers below.'}`)
                if (failed.length) setErr(`Some documents did not upload. ${failed.join(' · ')}`)
                await load(); onChanged?.()
              } catch (e) { setErr((e as Error).message) }
              setBusy(false)
            }} />
        )}

        {req && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: S.sm, marginBottom: S.md }}>
              {([['Reason', req.reason_label], ['Sub-reason', req.sub_reason || '-'], ['Last working day', fmt(req.last_working_day)], ['Started by', req.initiated_by_name || 'HR'], ...(req.destination_company ? [['Transferring to', req.destination_company]] : [])] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ background: C.sunken, border: `1px solid ${C.line}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>
                  <div style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.semi }}>{k}</div>
                  <div style={{ fontSize: F.small, color: C.ink, fontWeight: W.semi, marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            {req.remarks && <div style={{ fontSize: F.small, color: C.inkSoft, marginBottom: S.md, lineHeight: 1.6, borderLeft: `3px solid ${C.line}`, paddingLeft: S.md }}>{req.remarks}</div>}
            {req.abscond_stage === 'REMINDING' && (
              <div style={{ marginBottom: S.md, fontSize: F.small, color: C.ink, background: C.warningTint, border: `1px solid ${C.warningEdge}`, borderRadius: R.md, padding: `${S.sm}px ${S.md}px` }}>
                Reminder {req.reminders_sent} of 3 sent{req.last_reminder_at ? ` (last on ${fmt(req.last_reminder_at)})` : ''}. The approval starts after the third reminder and 21 days from {fmt(req.created_at)} with no response. If the employee responds, Cancel exit revokes the abscond.
              </div>
            )}
            <Docs req={req} onAdded={load} onError={setErr} />
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
    </div>
  )
}
