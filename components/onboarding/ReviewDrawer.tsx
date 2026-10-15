'use client'
// components/onboarding/ReviewDrawer.tsx — the HR Manager's review of a submitted onboarding
// form, opened from the onboarding card (Review form). Every document is viewed and accepted or
// rejected with a reason; any detail the candidate filled in can be flagged with a reason. Then:
//   Accept form        → the HR Manager's team approval (the fourth approval generates the code)
//   Return to candidate→ link reopens 48h, the candidate is mailed the list; the card shows
//                        Resend link until they resubmit
// Read-only after acceptance (View form). API: /api/onboarding/review.
import { useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z } from '@/lib/ui'

type Doc = { doc_code: string; label: string; file_name: string | null; url: string | null; hr_verified: boolean | null; note: string | null; ai_status: string | null; uploaded_at: string | null }
type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null }
type Flag = { section: string; field: string; reason: string }
type Verdict = { ok: boolean | null; reason: string }

const LABEL: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }
const STEP_TITLES: Record<string, string> = { step_3: 'Personal', step_4: 'Contact and addresses', step_5: 'Emergency contacts, experience and education', step_7: 'PAN, PF, bank, nominees and family' }
const HIDE = new Set(['bank_confirm', 'docs_uploaded'])
const pretty = (k: string) => k.replace(/^(fe|emrg|prev|grat|nominee|eps)_/, m => ({ fe_: 'Foreign ', emrg_: 'Emergency ', prev_: 'Previous ', grat_: 'Gratuity ', nominee_: 'Nominee ', eps_: 'EPS ' }[m] || '')).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const val = (v: any): string => v === true ? 'Yes' : v === false ? 'No' : v == null || v === '' ? '—' : typeof v === 'object' ? '' : String(v)
const day = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const section: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: TK.brand, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }
const btn: React.CSSProperties = { padding: '7px 13px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', background: TK.brand, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 500 }
const tiny: React.CSSProperties = { padding: '2px 7px', borderRadius: 99, border: `1px solid ${TK.brandEdge}`, cursor: 'pointer', fontSize: 10, fontWeight: 600, fontFamily: 'inherit', background: TK.surface, color: TK.brandDeep }
const input: React.CSSProperties = { width: '100%', padding: '7px 10px', border: `1px solid ${TK.brandEdge}`, borderRadius: 7, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box', background: TK.surface, color: TK.ink }
const pill = (s: Approval['status']): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
  background: s === 'APPROVED' ? TK.positiveTint : s === 'RETURNED' ? TK.criticalTint : TK.warningTint,
  color: s === 'APPROVED' ? TK.positive : s === 'RETURNED' ? TK.critical : TK.warning,
})

// Sub-components live OUTSIDE the drawer so typing a reason never remounts them.
function Rows({ obj, title, canFlag, flagged, onFlag }: { obj: Record<string, any>; title: string; canFlag: boolean; flagged: Set<string>; onFlag: (section: string, field: string) => void }) {
  const flat = Object.entries(obj || {}).filter(([k, v]) => !HIDE.has(k) && typeof v !== 'object')
  const nested = Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object')
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '6px 14px' }}>
        {flat.map(([k, v]) => {
          const on = flagged.has(`${title}|${pretty(k)}`)
          return (
            <div key={k} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: TK.muted }}>{pretty(k)}: </span><b style={{ color: on ? TK.critical : TK.ink }}>{val(v)}</b></span>
              {canFlag && <button type="button" onClick={() => onFlag(title, pretty(k))} title={on ? 'Flagged — click to clear' : 'Flag this detail for correction'} style={{ ...tiny, background: on ? TK.criticalTint : TK.surface, color: on ? TK.critical : TK.brandDeep, borderColor: on ? TK.critical : TK.brandEdge }}>{on ? '⚑ flagged' : '⚑'}</button>}
            </div>
          )
        })}
      </div>
      {nested.map(([k, v]) => (
        <div key={k} style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TK.brandDeep, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            {pretty(k)}
            {canFlag && <button type="button" onClick={() => onFlag(title, pretty(k))} style={{ ...tiny, ...(flagged.has(`${title}|${pretty(k)}`) ? { background: TK.criticalTint, color: TK.critical, borderColor: TK.critical } : {}) }}>{flagged.has(`${title}|${pretty(k)}`) ? '⚑ flagged' : '⚑'}</button>}
          </div>
          {Array.isArray(v)
            ? v.map((row, i) => <div key={i} style={{ fontSize: 12, padding: '4px 8px', background: TK.sunken, borderRadius: 6, marginBottom: 4 }}>{Object.entries(row || {}).map(([a, b]) => `${pretty(a)}: ${val(b)}`).join(' · ')}</div>)
            : <Rows obj={v} title={title} canFlag={canFlag} flagged={flagged} onFlag={onFlag} />}
        </div>
      ))}
    </>
  )
}

function DocRow({ doc, v, canDecide, onSet }: { doc: Doc; v: Verdict; canDecide: boolean; onSet: (v: Verdict) => void }) {
  const state = v.ok === true ? 'ok' : v.ok === false ? 'no' : 'none'
  return (
    <div style={{ border: `1px solid ${state === 'no' ? TK.critical : state === 'ok' ? TK.positive : TK.line}`, background: state === 'no' ? TK.criticalTint : state === 'ok' ? TK.positiveTint : TK.surface, borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 160px' }}>
          <b>{doc.label}</b>
          <div style={{ color: TK.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name || '—'}{doc.uploaded_at ? ` · ${day(doc.uploaded_at)}` : ''}{doc.note && /carried over/i.test(doc.note) ? ' · from pre-offer collection' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer" style={{ ...btnO, textDecoration: 'none', padding: '4px 9px' }}>View</a> : <span style={{ color: TK.faint }}>no file</span>}
          {canDecide && <>
            <button type="button" onClick={() => onSet({ ok: true, reason: '' })} style={{ ...tiny, ...(state === 'ok' ? { background: TK.positive, color: TK.onAccent, borderColor: TK.positive } : {}) }}>Accept</button>
            <button type="button" onClick={() => onSet({ ok: false, reason: v.reason })} style={{ ...tiny, ...(state === 'no' ? { background: TK.critical, color: TK.onAccent, borderColor: TK.critical } : {}) }}>Reject</button>
          </>}
          {!canDecide && state !== 'none' && <span style={{ fontSize: 10, fontWeight: 700, color: state === 'ok' ? TK.positive : TK.critical }}>{state === 'ok' ? 'Accepted ✓' : 'Rejected'}</span>}
        </div>
      </div>
      {state === 'no' && (canDecide
        ? <input value={v.reason} onChange={e => onSet({ ok: false, reason: e.target.value })} placeholder="Why is it rejected? (goes to the candidate, e.g. blurred — upload a clear scan)" style={{ ...input, marginTop: 6, borderColor: TK.critical }} />
        : <div style={{ marginTop: 4, color: TK.critical }}>{v.reason}</div>)}
    </div>
  )
}

export default function ReviewDrawer({ onboardingId, readOnly = false, onClose, onDone }: {
  onboardingId: string; readOnly?: boolean; onClose: () => void; onDone: (msg: string, type?: 'ok' | 'err') => void
}) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({})
  const [flags, setFlags] = useState<Flag[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onboarding/review?onboarding_id=${onboardingId}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load the form')
        if (!alive) return
        setData(d)
        // Start from what is already decided on each file.
        const v: Record<string, Verdict> = {}
        for (const doc of d.documents as Doc[]) v[doc.doc_code] = { ok: doc.hr_verified ?? null, reason: doc.hr_verified === false ? (doc.note || '').replace(/^Rejected:\s*/i, '') : '' }
        setVerdicts(v)
        if (d.hr_review?.outcome === 'RETURNED') { setFlags(d.hr_review.details || []); setNote(d.hr_review.note || '') }
      } catch (e: any) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [onboardingId])

  const item = data?.item
  const canDecide = !readOnly && !!item && ['SUBMITTED', 'HR_REVIEW', 'APPROVED'].includes(item.status) && data.approvals?.find((a: Approval) => a.team === 'HR_MANAGER')?.status !== 'APPROVED'
  const docs: Doc[] = data?.documents || []
  const rejected = docs.filter(d => verdicts[d.doc_code]?.ok === false)
  const undecided = docs.filter(d => verdicts[d.doc_code]?.ok == null)
  const flagged = new Set(flags.map(f => `${f.section}|${f.field}`))
  const toggleFlag = (sec: string, field: string) => setFlags(fs => fs.some(f => f.section === sec && f.field === field) ? fs.filter(f => !(f.section === sec && f.field === field)) : [...fs, { section: sec, field, reason: '' }])

  async function send(outcome: 'ACCEPTED' | 'RETURNED') {
    if (outcome === 'ACCEPTED' && undecided.length) { onDone(`Accept or reject every document first (${undecided.map(d => d.label).join(', ')}).`, 'err'); return }
    if (outcome === 'RETURNED' && rejected.some(d => !verdicts[d.doc_code].reason.trim())) { onDone('Give a reason for every rejected document — the candidate reads it.', 'err'); return }
    if (outcome === 'RETURNED' && !rejected.length && !flags.length && !note.trim()) { onDone('Reject a document, flag a detail, or write a note before returning.', 'err'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/review', {
        method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_id: onboardingId, outcome, note, documents: docs.map(d => ({ doc_code: d.doc_code, ok: verdicts[d.doc_code]?.ok !== false, reason: verdicts[d.doc_code]?.reason || null })), details: flags }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      if (outcome === 'ACCEPTED') onDone(d.all_approved ? (d.employee_code ? `Accepted. All four teams have approved — employee code ${d.employee_code} generated.` : `Accepted, but the employee could not be created: ${d.create_error}`) : 'Form accepted. Generate the employee code once IT, Admin and Payroll have approved too.', d.create_error ? 'err' : 'ok')
      else onDone(`Returned to the candidate${d.mailed ? ' — they have been emailed the list of corrections' : ' (no email on file — resend the link or share it)'}.`, 'ok')
      onClose()
    } catch (e: any) { onDone(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: Z.modal, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '24px 12px' }}>
      <div style={{ background: TK.surface, borderRadius: 12, width: 'min(980px, 100%)', padding: '18px 20px', boxShadow: '0 24px 70px rgba(15,23,42,.3)', fontFamily: '"DM Sans","Segoe UI",sans-serif', fontSize: 13, color: TK.ink }}>
        {err && <div style={{ color: TK.critical }}>{err} <button onClick={onClose} style={btnO}>Close</button></div>}
        {!err && !data && <div style={{ color: TK.muted, padding: 20 }}>Loading the form…</div>}
        {item && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{item.full_name} · {item.designation || '—'}</div>
                <div style={{ fontSize: 12, color: TK.muted }}>{item.employment_type || 'Employee'} · joining {day(item.date_of_joining)} · submitted {day(item.submitted_at)} · {item.email || 'no email'}</div>
                <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>{(data.approvals as Approval[]).map(a => <span key={a.team} style={pill(a.status)} title={a.remark || ''}>{LABEL[a.team]} · {a.status === 'APPROVED' ? `✓ ${a.acted_by_name || ''}` : a.status === 'RETURNED' ? 'returned' : 'pending'}</span>)}</div>
                {data.hr_review && <div style={{ fontSize: 11, color: TK.muted, marginTop: 4 }}>Last review: {data.hr_review.outcome.toLowerCase()} by {data.hr_review.by_name || '—'} on {day(data.hr_review.at)}{data.hr_review.outcome === 'RESUBMITTED' ? ' — the candidate has resubmitted since' : ''}</div>}
              </div>
              <button onClick={onClose} style={btnO}>Close</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={section}>Documents · {docs.length}{canDecide ? ` · ${undecided.length} to decide` : ''}</div>
              {docs.length === 0 && <div style={{ fontSize: 12, color: TK.muted }}>No documents uploaded.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 6 }}>
                {docs.map(doc => <DocRow key={doc.doc_code} doc={doc} v={verdicts[doc.doc_code] || { ok: null, reason: '' }} canDecide={canDecide} onSet={v => setVerdicts(s => ({ ...s, [doc.doc_code]: v }))} />)}
              </div>
              {canDecide && docs.length > 0 && <div style={{ marginTop: 6 }}><button type="button" onClick={() => setVerdicts(s => Object.fromEntries(docs.map(d => [d.doc_code, s[d.doc_code]?.ok === false ? s[d.doc_code] : { ok: true, reason: '' }])))} style={tiny}>Accept all the rest</button></div>}
            </div>

            {Object.entries(STEP_TITLES).map(([k, title]) => item.form_data?.[k] ? (
              <div key={k} style={{ marginTop: 14 }}>
                <div style={section}>{title}{canDecide ? <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: TK.muted }}> · ⚑ flags a detail the candidate must correct</span> : null}</div>
                <Rows obj={item.form_data[k]} title={title} canFlag={canDecide} flagged={flagged} onFlag={toggleFlag} />
              </div>
            ) : null)}

            {(flags.length > 0 || (!canDecide && data.hr_review?.details?.length)) && (
              <div style={{ marginTop: 14 }}>
                <div style={section}>Details to correct · {flags.length}</div>
                {flags.map((f, i) => (
                  <div key={`${f.section}|${f.field}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, minWidth: 180 }}><b>{f.field}</b> <span style={{ color: TK.muted }}>({f.section})</span></span>
                    {canDecide
                      ? <><input value={f.reason} onChange={e => setFlags(fs => fs.map((x, j) => j === i ? { ...x, reason: e.target.value } : x))} placeholder="What is wrong / what should it be?" style={{ ...input, flex: '1 1 240px' }} /><button type="button" onClick={() => toggleFlag(f.section, f.field)} style={tiny}>remove</button></>
                      : <span style={{ fontSize: 12, color: TK.critical }}>{f.reason}</span>}
                  </div>
                ))}
              </div>
            )}

            {canDecide && (
              <div style={{ marginTop: 18, borderTop: `1px solid ${TK.line}`, paddingTop: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: TK.brandDeep, display: 'block', marginBottom: 4 }}>NOTE TO THE CANDIDATE (optional — included in the return mail)</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} placeholder="Anything else they should know or fix." />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                  {rejected.length || flags.length
                    ? <>
                        <button disabled={busy} onClick={() => send('RETURNED')} style={{ ...btn, background: TK.critical }}>{busy ? 'Sending…' : `Return to candidate — ${rejected.length} document${rejected.length === 1 ? '' : 's'} rejected, ${flags.length} detail${flags.length === 1 ? '' : 's'} flagged`}</button>
                        <span style={{ fontSize: 11.5, color: TK.muted }}>The candidate is emailed this list; the link reopens for 48 hours.</span>
                      </>
                    : <>
                        <button disabled={busy || undecided.length > 0} onClick={() => send('ACCEPTED')} style={{ ...btn, background: undecided.length ? TK.faint : TK.positive, cursor: undecided.length ? 'not-allowed' : 'pointer' }}>{busy ? 'Saving…' : 'Accept form'}</button>
                        <button disabled={busy || !note.trim()} onClick={() => send('RETURNED')} style={{ ...btnO, opacity: note.trim() ? 1 : .6 }}>Return with the note only</button>
                        {undecided.length > 0 && <span style={{ fontSize: 11.5, color: TK.muted }}>Decide every document to accept the form.</span>}
                      </>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
