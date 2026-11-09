'use client'
// components/ess/InvestmentProofs.tsx — ESS → Investment Proofs.
//
// The declaration is a promise; this is the bill behind it. Normally the window opens at
// year-end, but a resigning employee will not be here in March — so their deadline is
// their Date of Leaving and the window is already open (sql99: investment_proof_deadline).
//
// The line that costs money: anything declared but not proven — rejected, or simply never
// submitted before the deadline — stops being exempt. The screen says so plainly, because
// an employee who does not know that only finds out in their final settlement.
//
// Every declared line takes documents — receipts, policy statements, rent receipts — through
// /api/ess/investment-proofs (private bucket, signed URLs). A reference number alone used
// to be the whole "proof"; HR now opens the actual file before approving.
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { authHeaders } from '@/lib/auth-headers'
import PayStyles from '@/components/ess/payroll/PayStyles'

const FY = '2026-27'
const inr = (n: any) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')
const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)
const fmtDate = (d: any) => {
  if (!d) return '-'
  const x = new Date(d)
  return `${String(x.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][x.getMonth()]} ${x.getFullYear()}`
}
const fmtSize = (b: number | null | undefined) => {
  const n = Number(b) || 0
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp'

interface Proof {
  id: string; section: string; declared_item: string
  declared_amount: number; submitted_amount: number
  proof_reference: string | null; status: string; rejection_reason: string | null; deadline: string | null
}
export interface ProofFile {
  id: string; proof_id: string; file_name: string; mime_type: string | null; size_bytes: number | null
  uploaded_at: string; url: string | null
}

const TONE: Record<string, { cls: string; label: string }> = {
  PENDING:   { cls: '', label: 'Proof pending' },
  SUBMITTED: { cls: 'is-warn', label: 'Under review' },
  APPROVED:  { cls: 'is-ok', label: 'Approved' },
  REJECTED:  { cls: 'is-bad', label: 'Rejected' },
}

/** The documents attached to one line: what is there, and a way to add more. Also used
 *  read-only (no `onUpload`) by HR's review screen, so the two never drift apart. */
export function ProofDocuments({ files, locked, onUpload, onRemove, uploading, compact }: {
  files: ProofFile[]; locked: boolean
  onUpload?: (f: File) => void; onRemove?: (f: ProofFile) => void; uploading?: boolean; compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label className="ezp-label" style={{ margin: 0 }}>Documents</label>
        <span className="ezp-muted" style={{ fontSize: 12 }}>
          {files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'none yet'}
        </span>
        {!locked && onUpload && (
          <>
            <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
            <button type="button" className="ezp-ghost" style={{ marginLeft: 'auto' }} disabled={uploading}
              onClick={() => inputRef.current?.click()}>
              {uploading ? 'Uploading…' : '＋ Upload document'}
            </button>
          </>
        )}
      </div>
      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
          {files.map(f => (
            <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 10, background: 'var(--ez-sunken)', border: '1px solid var(--ez-line)' }}>
              <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>{f.mime_type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                <div className="ezp-muted" style={{ fontSize: 11 }}>{fmtSize(f.size_bytes)} · {fmtDate(f.uploaded_at)}</div>
              </div>
              {f.url && <a className="ezp-ghost" href={f.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>View</a>}
              {!locked && onRemove && (
                <button type="button" className="ezp-ghost is-danger" onClick={() => onRemove(f)} aria-label={`Remove ${f.file_name}`}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && onUpload && files.length === 0 && (
        <div className="ezp-muted" style={{ fontSize: 12, marginTop: 6 }}>PDF, JPG, PNG or WEBP, up to 10 MB each. Receipts, policy statements, rent receipts — whatever proves this line.</div>
      )}
    </div>
  )
}

// Outside the parent so typing in an amount box never remounts the row.
function ProofRow({ p, files, draftAmt, draftRef, onAmt, onRef, onSave, onUpload, onRemove, busy, uploading }: {
  p: Proof; files: ProofFile[]; draftAmt: string; draftRef: string
  onAmt: (v: string) => void; onRef: (v: string) => void; onSave: () => void
  onUpload: (f: File) => void; onRemove: (f: ProofFile) => void; busy: boolean; uploading: boolean
}) {
  const t = TONE[p.status] || TONE.PENDING
  const locked = p.status === 'APPROVED'
  const shortfall = Math.max(0, num(p.declared_amount) - num(draftAmt || p.submitted_amount))
  return (
    <div className="ezp-panel">
      <div className="ezp-head">
        <span className="ezp-chip is-brand">{p.section}</span>
        <h3 style={{ flex: 1, minWidth: 160 }}>{p.declared_item}</h3>
        <span className={`ezp-chip ${t.cls}`}>{t.label}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, alignItems: 'end' }}>
        <div className="ezp-stat">
          <div className="ezp-stat-name">Declared</div>
          <div className="ezp-stat-num">{inr(p.declared_amount)}</div>
        </div>
        <div>
          <label className="ezp-label">Proof amount</label>
          <input className="ezp-input ezp-num"
            value={draftAmt} readOnly={locked} inputMode="numeric"
            onChange={e => onAmt(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label className="ezp-label">Bill / policy reference</label>
          <input className="ezp-input"
            value={draftRef} readOnly={locked} placeholder="Policy no. / receipt no."
            onChange={e => onRef(e.target.value)} />
        </div>
      </div>

      <ProofDocuments files={files} locked={locked} onUpload={onUpload} onRemove={onRemove} uploading={uploading} />

      {!locked && shortfall > 0 && (
        <div className="ezp-note is-warn" style={{ margin: '12px 0 0' }}>
          Proof for <b>{inr(shortfall)}</b> is still pending. That much will not stay exempt.
        </div>
      )}
      {p.status === 'REJECTED' && p.rejection_reason && (
        <div className="ezp-note is-bad" style={{ margin: '12px 0 0' }}>
          <b>Rejected:</b> {p.rejection_reason}
        </div>
      )}
      {!locked && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="ezp-btn" onClick={onSave} disabled={busy}>
            {p.status === 'PENDING' ? 'Submit proof' : 'Update proof'}
          </button>
          {files.length === 0 && (
            <span className="ezp-muted" style={{ fontSize: 12 }}>Attach the bill or receipt before submitting — HR approves against the document.</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function InvestmentProofs({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<Proof[]>([])
  const [files, setFiles] = useState<ProofFile[]>([])
  const [draft, setDraft] = useState<Record<string, { amt: string; ref: string }>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [uploading, setUploading] = useState('')
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [leaving, setLeaving] = useState<string | null>(null)
  const [hasDecl, setHasDecl] = useState(false)
  const [regime, setRegime] = useState('')

  const loadFiles = useCallback(async () => {
    try {
      const r = await fetch(`/api/ess/investment-proofs?employee_id=${encodeURIComponent(employeeId)}&fy=${FY}`, { headers: await authHeaders() })
      const j = await r.json().catch(() => ({}))
      if (r.ok) setFiles((j.files || []) as ProofFile[])
    } catch { /* the list stays as it was */ }
  }, [employeeId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: emp } = await supabase.from('employees')
        .select('date_of_leaving, last_working_date, relieving_date').eq('id', employeeId).maybeSingle()
      setLeaving((emp as any)?.date_of_leaving || (emp as any)?.last_working_date || (emp as any)?.relieving_date || null)

      const { data: d } = await supabase.from('tds_declarations')
        .select('regime').eq('employee_id', employeeId).eq('fy', FY).maybeSingle()
      setHasDecl(!!d); setRegime((d as any)?.regime || '')

      const { data, error } = await supabase.from('investment_proofs')
        .select('*').eq('employee_id', employeeId).eq('fy', FY).order('section')
      if (error) throw new Error(error.message)
      const list = (data || []) as any as Proof[]
      setRows(list)
      const dr: Record<string, { amt: string; ref: string }> = {}
      list.forEach(p => { dr[p.id] = { amt: num(p.submitted_amount) ? String(num(p.submitted_amount)) : '', ref: p.proof_reference || '' } })
      setDraft(dr)
      await loadFiles()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [employeeId, loadFiles])
  useEffect(() => { load() }, [load])

  async function openWindow() {
    setErr(''); setMsg(''); setBusy('open')
    const { data, error } = await supabase.rpc('open_investment_proof_window', { p_employee_id: employeeId, p_fy: FY })
    setBusy('')
    if (error) { setErr(error.message); return }
    if (!Number(data)) { setErr('No declared line found. Fill in and submit the Investment Declaration first.'); return }
    setMsg(`Proof window opened for ${data} line${Number(data) === 1 ? '' : 's'}.`)
    load()
  }

  async function saveProof(p: Proof) {
    setErr(''); setMsg(''); setBusy(p.id)
    const d = draft[p.id] || { amt: '', ref: '' }
    const { error } = await supabase.from('investment_proofs').update({
      submitted_amount: num(d.amt), proof_reference: d.ref.trim() || null,
      status: 'SUBMITTED', rejection_reason: null, updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    setBusy('')
    if (error) { setErr(error.message); return }
    setMsg(`${p.section} proof submitted. HR will review it.`)
    load()
  }

  async function uploadFile(p: Proof, file: File) {
    setErr(''); setMsg(''); setUploading(p.id)
    try {
      const fd = new FormData()
      fd.append('proof_id', p.id)
      fd.append('file', file)
      const r = await fetch('/api/ess/investment-proofs', { method: 'POST', headers: await authHeaders(), body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setErr(j.error || 'The document could not be uploaded.'); return }
      setFiles(fs => [j.file as ProofFile, ...fs])
      setMsg(j.resubmitted ? `${file.name} attached to ${p.section}; the line has gone back to HR for review.` : `${file.name} attached to ${p.section}.`)
      if (j.resubmitted) load()
    } catch { setErr('The document could not be uploaded. Check your connection and try again.') }
    finally { setUploading('') }
  }

  async function removeFile(p: Proof, f: ProofFile) {
    if (!window.confirm(`Remove ${f.file_name} from ${p.section}?`)) return
    setErr(''); setMsg('')
    const r = await fetch(`/api/ess/investment-proofs?id=${encodeURIComponent(f.id)}`, { method: 'DELETE', headers: await authHeaders() })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error || 'The document could not be removed.'); return }
    setFiles(fs => fs.filter(x => x.id !== f.id))
  }

  const deadline = rows[0]?.deadline || null
  const overdue = deadline ? new Date(deadline) < new Date() : false
  const declared = rows.reduce((a, p) => a + num(p.declared_amount), 0)
  const proven = rows.filter(p => p.status === 'APPROVED').reduce((a, p) => a + num(p.submitted_amount), 0)

  if (loading) return <div className="ezp ezp-muted" style={{ padding: 24 }}>Loading…</div>

  return (
    <div className="ezp">
      <PayStyles />
      <div className="ezp-title">
        <div>
          <h2>Investment Proofs</h2>
          <p>FY {FY}: bills for what you declared</p>
        </div>
      </div>

      {leaving && (
        <div className="ezp-note is-warn">
          <span className="ezp-note-t">Your proof window is open now</span>
          Your last working day is <b>{fmtDate(leaving)}</b>, so the deadline is not the end of the year, it is <b>that day</b>.
          Anything not proved by then will not stay exempt and will be taxed in the final settlement.
        </div>
      )}

      {!hasDecl ? (
        <div className="ezp-panel">
          <div className="ezp-empty">
            No <b style={{ display: 'inline' }}>Investment Declaration</b> found for this FY. Proofs are submitted against it. Fill in and submit the declaration first.
          </div>
        </div>
      ) : regime === 'NEW' ? (
        <div className="ezp-note is-ok">
          You are on the <b>New regime</b>: the 80C/80D/HRA exemptions do not apply, so no proof is needed.
        </div>
      ) : (
        <>
          <section className="ezp-hero">
            <p className="ezp-hero-label">Declared</p>
            <p className="ezp-hero-num"><b>{inr(declared)}</b></p>
            <div className="ezp-tiles">
              <div className="ezp-tile"><div className="ezp-tile-name">Proven</div><div className="ezp-tile-num ezp-ok">{inr(proven)}</div></div>
              <div className="ezp-tile"><div className="ezp-tile-name">Not yet proven</div><div className={`ezp-tile-num${declared - proven > 0 ? ' ezp-warn' : ''}`}>{inr(Math.max(0, declared - proven))}</div></div>
              <div className="ezp-tile"><div className="ezp-tile-name">Documents</div><div className="ezp-tile-num">{files.length}</div></div>
              {deadline && (
                <div className="ezp-tile"><div className="ezp-tile-name">Deadline</div><div className={`ezp-tile-num${overdue ? ' ezp-bad' : ''}`}>{fmtDate(deadline)}</div></div>
              )}
            </div>
          </section>

          {rows.length === 0 ? (
            <div className="ezp-panel">
              <p className="ezp-muted" style={{ margin: '0 0 12px', lineHeight: 1.6 }}>
                The proof window is not open yet. Use the button below to open a window for each line of your declaration.
              </p>
              <button className="ezp-btn" onClick={openWindow} disabled={busy === 'open'}>
                {busy === 'open' ? 'Opening…' : 'Proof window kholein'}
              </button>
            </div>
          ) : (
            rows.map(p => (
              <ProofRow key={p.id} p={p} files={files.filter(f => f.proof_id === p.id)}
                draftAmt={draft[p.id]?.amt ?? ''} draftRef={draft[p.id]?.ref ?? ''}
                onAmt={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], amt: v } }))}
                onRef={v => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], ref: v } }))}
                onSave={() => saveProof(p)} busy={busy === p.id}
                onUpload={f => uploadFile(p, f)} onRemove={f => removeFile(p, f)} uploading={uploading === p.id} />
            ))
          )}
        </>
      )}

      {msg && <div className="ezp-note is-ok" style={{ marginTop: 12 }}>✓ {msg}</div>}
      {err && <div className="ezp-note is-bad" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  )
}
