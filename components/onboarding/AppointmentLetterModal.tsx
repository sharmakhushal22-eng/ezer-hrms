'use client'
// components/onboarding/AppointmentLetterModal.tsx — the Letter of Appointment popup, opened
// from a joiner's row once their employee code is generated. The letter arrives auto-filled
// (GET /api/onboarding/appointment-letter): the details, every section in the company's wording
// and Annexure A from the joiner's CTC structure. The HR Manager can change any of it — a
// section they edit stops following the details, the rest keep up — preview the PDF and mail
// it to the candidate (POST … action 'send').
import { useEffect, useMemo, useRef, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z, E } from '@/lib/ui'
import {
  buildSections, apptProblems, inrNum, longDate,
  type ApptDraft, type ApptFields, type ApptSection, type AnnexRow,
} from '@/lib/onboarding/appointment-letter'

type Tab = 'details' | 'letter' | 'annexure' | 'send' | 'preview'
type LastSent = { at: string; to: string | null; by: string | null } | null

const inp: React.CSSProperties = { width: '100%', height: 36, padding: '0 10px', border: `1px solid ${TK.lineStrong}`, borderRadius: 8, background: TK.surface, color: TK.ink, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 650, color: TK.muted, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }
const btn = (kind: 'primary' | 'ghost' | 'danger' = 'ghost'): React.CSSProperties => ({
  height: 36, padding: '0 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
  border: `1px solid ${kind === 'primary' ? TK.brandDeep : kind === 'danger' ? TK.criticalEdge : TK.lineStrong}`,
  background: kind === 'primary' ? TK.brand : TK.surface, color: kind === 'primary' ? TK.onAccent : kind === 'danger' ? TK.critical : TK.ink,
})

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div style={{ gridColumn: wide ? '1 / -1' : undefined }}><label style={lbl}>{label}</label>{children}</div>
}

function Num({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <input inputMode="numeric" value={value ? String(value) : ''} placeholder="0" onChange={e => onChange(Math.max(0, Math.round(Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)))} style={inp} />
}

function DetailsTab({ f, set }: { f: ApptFields; set: <K extends keyof ApptFields>(k: K, v: ApptFields[K]) => void }) {
  const t = (k: keyof ApptFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, e.target.value as any)
  // A required detail the records did not have: outlined red until it is filled in.
  const need = (v: string | number) => (typeof v === 'number' ? !(v > 0) : !String(v || '').trim()) ? { ...inp, borderColor: TK.critical, background: TK.criticalTint } : inp
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
      <Field label="Salutation"><select value={f.salutation} onChange={t('salutation')} style={inp}><option>Mr.</option><option>Ms.</option><option>Mrs.</option><option>Dr.</option></select></Field>
      <Field label="Name"><input value={f.name} onChange={t('name')} style={need(f.name)} /></Field>
      <Field label="Employee code"><input value={f.emp_code} onChange={t('emp_code')} style={need(f.emp_code)} /></Field>
      <Field label="Letter date"><input type="date" value={f.letter_date} onChange={t('letter_date')} style={inp} /></Field>
      <Field label="Designation"><input value={f.designation} onChange={t('designation')} style={need(f.designation)} /></Field>
      <Field label="Function / department"><input value={f.department} onChange={t('department')} style={need(f.department)} /></Field>
      <Field label="Company"><input value={f.company_name} onChange={t('company_name')} style={need(f.company_name)} /></Field>
      <Field label="Date of joining"><input type="date" value={f.doj} onChange={t('doj')} style={need(f.doj)} /></Field>
      <Field label="Place of posting"><input value={f.place} onChange={t('place')} placeholder="e.g. Gurugram" style={need(f.place)} /></Field>
      <Field label="Total CTC (INR / year)"><Num value={f.ctc_annual} onChange={v => set('ctc_annual', v)} /></Field>
      <Field label="Joining bonus — total"><Num value={f.jb_total} onChange={v => { const split = f.jb_second > 0; set('jb_total', v); set('jb_first', split ? Math.round(v / 2) : v); set('jb_second', split ? v - Math.round(v / 2) : 0) }} /></Field>
      <Field label="… paid with first salary"><Num value={f.jb_first} onChange={v => set('jb_first', v)} /></Field>
      <Field label="… paid after 6 months"><Num value={f.jb_second} onChange={v => set('jb_second', v)} /></Field>
      <Field label="ESOP value (INR)"><Num value={f.esop_value} onChange={v => set('esop_value', v)} /></Field>
      <Field label="ESOP vesting"><input value={f.esop_vesting} onChange={t('esop_vesting')} placeholder="4-year vesting with 1 year cliff" style={inp} /></Field>
      <Field label="Notice in probation (days)"><Num value={f.probation_notice_days} onChange={v => set('probation_notice_days', v)} /></Field>
      <Field label="Notice after probation (days)"><Num value={f.notice_days} onChange={v => set('notice_days', v)} /></Field>
      <Field label="Courts of jurisdiction"><input value={f.jurisdiction} onChange={t('jurisdiction')} style={inp} /></Field>
      <Field label="Medical policy" wide><input value={f.medical} onChange={t('medical')} style={inp} /></Field>
      <Field label="Gratuity (INR / year)"><Num value={f.gratuity_annual} onChange={v => set('gratuity_annual', v)} /></Field>
      <Field label="Gratuity is">
        <select value={f.gratuity_in_ctc ? 'in' : 'over'} onChange={e => set('gratuity_in_ctc', e.target.value === 'in')} style={inp}>
          <option value="over">Over and above the CTC</option><option value="in">Included in the CTC</option>
        </select>
      </Field>
    </div>
  )
}

function SectionCard({ s, edited, onChange, onReset }: { s: ApptSection; edited: boolean; onChange: (body: string) => void; onReset: () => void }) {
  const rows = Math.min(16, Math.max(3, Math.ceil(s.body.length / 110) + s.body.split('\n').length))
  const title = s.heading || (s.key === 'intro' ? 'Opening paragraph' : s.key === 'declaration' ? 'Employee declaration' : s.key === 'annex_note' ? 'Annexure A notes' : 'Paragraph')
  return (
    <div style={{ border: `1px solid ${edited ? TK.warningEdge : TK.line}`, borderRadius: 10, padding: 12, background: TK.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <b style={{ fontSize: 13, color: TK.ink }}>{title}</b>
        {edited && <span style={{ fontSize: 11, fontWeight: 600, color: TK.warning, background: TK.warningTint, borderRadius: 99, padding: '1px 8px' }}>Edited</span>}
        {edited && <button onClick={onReset} style={{ ...btn(), height: 26, padding: '0 10px', fontSize: 12, marginLeft: 'auto' }}>Reset to auto</button>}
      </div>
      <textarea value={s.body} onChange={e => onChange(e.target.value)} rows={rows} style={{ ...inp, height: 'auto', padding: 10, lineHeight: 1.5, resize: 'vertical' }} />
    </div>
  )
}

function AnnexureTab({ rows, setRows, ctc }: { rows: AnnexRow[]; setRows: (r: AnnexRow[]) => void; ctc: number }) {
  const upd = (i: number, k: keyof AnnexRow, v: any) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v, ...(k === 'monthly' ? { annual: v * 12 } : {}) } : r))
  const total = rows.find(r => /^total/i.test(r.label))
  const mismatch = total && ctc && Math.abs(total.annual - ctc) > 12
  return (
    <div>
      {mismatch && <div style={{ background: TK.warningTint, border: `1px solid ${TK.warningEdge}`, color: TK.ink, borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>The Total CTC row (INR {inrNum(total!.annual)}) differs from the CTC on the Details tab (INR {inrNum(ctc)}). Correct one of them before sending.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) 1fr 1fr 70px 34px', gap: 8, alignItems: 'center' }}>
        {['Component', 'Monthly', 'Yearly', 'Bold', ''].map(h => <span key={h} style={lbl}>{h}</span>)}
        {rows.map((r, i) => [
          <input key={`l${i}`} value={r.label} onChange={e => upd(i, 'label', e.target.value)} style={{ ...inp, fontWeight: r.bold ? 700 : 400 }} />,
          <Num key={`m${i}`} value={r.monthly} onChange={v => upd(i, 'monthly', v)} />,
          <Num key={`a${i}`} value={r.annual} onChange={v => upd(i, 'annual', v)} />,
          <input key={`b${i}`} type="checkbox" checked={!!r.bold} onChange={e => upd(i, 'bold', e.target.checked)} style={{ width: 18, height: 18 }} />,
          <button key={`d${i}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove row" style={{ ...btn('danger'), height: 32, padding: 0, width: 32 }}>×</button>,
        ])}
      </div>
      <button onClick={() => setRows([...rows, { label: '', monthly: 0, annual: 0 }])} style={{ ...btn(), marginTop: 10 }}>+ Add row</button>
    </div>
  )
}

export default function AppointmentLetterModal({ onboardingId, name, onClose, onDone }: {
  onboardingId: string; name: string
  onClose: () => void; onDone: (msg: string, type?: 'ok' | 'err') => void
}) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('details')
  const [draft, setDraft] = useState<ApptDraft | null>(null)
  const [edited, setEdited] = useState<Set<string>>(new Set())
  const [mail, setMail] = useState({ to: '', cc: '', subject: '', body: '' })
  const [source, setSource] = useState('')
  const [lastSent, setLastSent] = useState<LastSent>(null)
  const [busy, setBusy] = useState<'' | 'preview' | 'send'>('')
  const [pdfUrl, setPdfUrl] = useState('')
  const urlRef = useRef('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onboarding/appointment-letter?onboarding_id=${encodeURIComponent(onboardingId)}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load the letter')
        if (!alive) return
        setDraft(d.draft); setSource(d.salary_source || ''); setLastSent(d.last_sent || null)
        setMail({ to: d.to || '', cc: '', subject: d.email?.subject || '', body: d.email?.body || '' })
      } catch (e: any) { if (alive) setErr(e.message) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [onboardingId])

  // A change to the details re-words every section the HR Manager has not edited by hand.
  const setField = <K extends keyof ApptFields>(k: K, v: ApptFields[K]) => setDraft(d => {
    if (!d) return d
    const fields = { ...d.fields, [k]: v }
    const auto = buildSections(fields)
    return { ...d, fields, sections: d.sections.map(s => edited.has(s.key) ? s : (auto.find(a => a.key === s.key) || s)) }
  })
  const setBody = (key: string, body: string) => {
    setEdited(e => new Set(e).add(key))
    setDraft(d => d && { ...d, sections: d.sections.map(s => s.key === key ? { ...s, body } : s) })
  }
  const resetSection = (key: string) => {
    setEdited(e => { const n = new Set(e); n.delete(key); return n })
    setDraft(d => d && { ...d, sections: d.sections.map(s => s.key === key ? (buildSections(d.fields).find(a => a.key === key) || s) : s) })
  }

  const problems = useMemo(() => draft ? apptProblems(draft.fields) : [], [draft])

  const post = async (action: 'preview' | 'send') => {
    if (!draft) return null
    return fetch('/api/onboarding/appointment-letter', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ onboarding_id: onboardingId, draft, action, ...(action === 'send' ? mail : {}) }),
    })
  }
  const preview = async () => {
    setBusy('preview'); setErr('')
    try {
      const res = await post('preview')
      if (!res) return
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Preview failed')
      const url = URL.createObjectURL(await res.blob())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url; setPdfUrl(url); setTab('preview')
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const send = async () => {
    if (!mail.to.trim()) { setTab('send'); setErr('Give the candidate’s email address.'); return }
    if (!window.confirm(`Send the Letter of Appointment to ${mail.to}?`)) return
    setBusy('send'); setErr('')
    try {
      const res = await post('send')
      if (!res) return
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Send failed')
      setLastSent(d.last_sent || null)
      onDone(d.ess_saved ? `Letter of Appointment mailed to ${d.sent_to} ✉️ and saved in their ESS → My Letters` : `Letter of Appointment mailed to ${d.sent_to}, but NOT saved in ESS: ${d.ess_error}`, d.ess_saved ? 'ok' : 'err')
      onClose()
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  const TABS: { k: Tab; label: string }[] = [
    { k: 'details', label: 'Details' }, { k: 'letter', label: 'Letter text' }, { k: 'annexure', label: 'Annexure A' },
    { k: 'send', label: 'Email' }, ...(pdfUrl ? [{ k: 'preview' as Tab, label: 'PDF preview' }] : []),
  ]

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px 40px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <div role="dialog" aria-label="Letter of Appointment" style={{ background: TK.surface, color: TK.ink, borderRadius: 14, width: 'min(1000px,100%)', margin: '0 auto', boxShadow: E.overlay, fontSize: 13, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${TK.line}`, display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: TK.brand }}>Letter of Appointment</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 3 }}>{draft?.fields.name || name}{draft?.fields.emp_code ? <span style={{ color: TK.muted, fontWeight: 500, fontSize: 14 }}> · {draft.fields.emp_code}</span> : null}</div>
            <div style={{ fontSize: 12, color: TK.muted, marginTop: 3 }}>
              {source ? `CTC structure: ${source}` : ''}
              {lastSent ? <span style={{ color: TK.positive, fontWeight: 600 }}>{source ? ' · ' : ''}Last sent {new Date(lastSent.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} to {lastSent.to}{lastSent.by ? ` by ${lastSent.by}` : ''}</span> : null}
            </div>
          </div>
          <button onClick={onClose} disabled={!!busy} style={btn()}>Close</button>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TK.muted }}>Filling in the letter…</div>
          : !draft ? <div style={{ padding: 30, color: TK.critical }}>{err || 'Could not load the letter.'}</div>
          : <>
            <div style={{ display: 'flex', gap: 4, padding: '10px 22px 0', borderBottom: `1px solid ${TK.line}`, flexWrap: 'wrap' }}>
              {TABS.map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} style={{ border: 'none', borderBottom: `2px solid ${tab === t.k ? TK.brand : 'transparent'}`, background: 'transparent', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? TK.brand : TK.inkSoft }}>
                  {t.label}{t.k === 'letter' && edited.size ? ` (${edited.size} edited)` : ''}
                </button>
              ))}
            </div>
            <div style={{ padding: '18px 22px', maxHeight: '62vh', overflowY: 'auto' }}>
              {tab === 'details' && <>
                <div style={{ fontSize: 12.5, color: TK.muted, marginBottom: 12 }}>Filled from the employee record, the onboarding form, the MRF, the approved offer and the CTC structure. Changing a detail updates every section you have not edited by hand.</div>
                {problems.length > 0 && <div style={{ fontSize: 12.5, color: TK.ink, background: TK.criticalTint, border: `1px solid ${TK.criticalEdge}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  <b>Not on record for this joiner:</b> {problems.join(', ')}. Fill {problems.length === 1 ? 'it' : 'them'} in below (outlined in red); the letter cannot go out with a blank.
                </div>}
                <DetailsTab f={draft.fields} set={setField} />
              </>}
              {tab === 'letter' && <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12.5, color: TK.muted }}>Opens with “{draft.fields.salutation} {draft.fields.name}”, {longDate(draft.fields.letter_date)} and “Subject: Letter of Appointment”. A line starting with “• ” prints as a bullet, “- ” as a sub-bullet.</div>
                {draft.sections.map(s => <SectionCard key={s.key} s={s} edited={edited.has(s.key)} onChange={b => setBody(s.key, b)} onReset={() => resetSection(s.key)} />)}
              </div>}
              {tab === 'annexure' && <AnnexureTab rows={draft.annexure} setRows={r => setDraft(d => d && { ...d, annexure: r })} ctc={draft.fields.ctc_annual} />}
              {tab === 'send' && <div style={{ display: 'grid', gap: 12 }}>
                <Field label="To (candidate)"><input value={mail.to} onChange={e => setMail(m => ({ ...m, to: e.target.value }))} style={inp} /></Field>
                <Field label="CC (optional, comma separated)"><input value={mail.cc} onChange={e => setMail(m => ({ ...m, cc: e.target.value }))} style={inp} /></Field>
                <Field label="Subject"><input value={mail.subject} onChange={e => setMail(m => ({ ...m, subject: e.target.value }))} style={inp} /></Field>
                <Field label="Message"><textarea value={mail.body} onChange={e => setMail(m => ({ ...m, body: e.target.value }))} rows={10} style={{ ...inp, height: 'auto', padding: 10, lineHeight: 1.5, resize: 'vertical' }} /></Field>
                <div style={{ fontSize: 12, color: TK.muted }}>The letter goes as a PDF attachment on the company letterhead, and a copy is saved in the employee’s ESS → Profile → My Letters (a re-send replaces it).</div>
              </div>}
              {tab === 'preview' && pdfUrl && <iframe src={pdfUrl} title="Appointment letter preview" style={{ width: '100%', height: '60vh', border: `1px solid ${TK.line}`, borderRadius: 8 }} />}
            </div>
            <div style={{ padding: '14px 22px', borderTop: `1px solid ${TK.line}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: TK.sunken }}>
              <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: err || problems.length ? TK.critical : TK.muted }}>
                {err || (problems.length ? `Fill in ${problems.join(', ')}.` : `To ${mail.to || '—'}`)}
              </div>
              <button onClick={preview} disabled={!!busy || problems.length > 0} style={{ ...btn(), opacity: busy || problems.length ? .6 : 1 }}>{busy === 'preview' ? 'Drawing…' : 'Preview PDF'}</button>
              <button onClick={send} disabled={!!busy || problems.length > 0} style={{ ...btn('primary'), opacity: busy || problems.length ? .6 : 1 }}>{busy === 'send' ? 'Sending…' : lastSent ? 'Send again' : 'Send to candidate'}</button>
            </div>
          </>}
      </div>
    </div>
  )
}
