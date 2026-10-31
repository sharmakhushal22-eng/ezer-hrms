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
  buildSections, apptProblems, apptWarnings, inrNum, longDate,
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

type SetF = <K extends keyof ApptFields>(k: K, v: ApptFields[K]) => void

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${TK.line}`, borderRadius: 10, padding: '12px 14px 14px', background: TK.surface }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TK.ink }}>{title}</div>
      {hint && <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 1 }}>{hint}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginTop: 10 }}>{children}</div>
    </div>
  )
}

function DetailsTab({ f, set }: { f: ApptFields; set: SetF }) {
  const t = (k: keyof ApptFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(k, e.target.value as any)
  // A required detail the records did not have: outlined red until it is filled in.
  const need = (v: string | number) => (typeof v === 'number' ? !(v > 0) : !String(v || '').trim()) ? { ...inp, borderColor: TK.critical, background: TK.criticalTint } : inp
  // A detail the letter reads better with: outlined amber when blank.
  const want = (v: string) => !String(v || '').trim() ? { ...inp, borderColor: TK.warning } : inp
  const txt = (k: keyof ApptFields, o: { req?: boolean; soft?: boolean; ph?: string } = {}) =>
    <input value={String(f[k] ?? '')} onChange={t(k)} placeholder={o.ph} style={o.req ? need(String(f[k] ?? '')) : o.soft ? want(String(f[k] ?? '')) : inp} />
  const num = (k: keyof ApptFields) => <Num value={Number(f[k]) || 0} onChange={v => set(k, v as any)} />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Group title="Employee" hint="Addressee block: name, father's / husband's name and permanent address">
        <Field label="Salutation"><select value={f.salutation} onChange={t('salutation')} style={inp}><option>Mr.</option><option>Ms.</option><option>Mrs.</option><option>Dr.</option></select></Field>
        <Field label="Name *">{txt('name', { req: true })}</Field>
        <Field label="Employee code *">{txt('emp_code', { req: true })}</Field>
        <Field label="Relation"><select value={f.relation} onChange={t('relation')} style={inp}><option>S/o</option><option>D/o</option><option>W/o</option></select></Field>
        <Field label="Father's / husband's name">{txt('father_name', { soft: true })}</Field>
        <Field label="Permanent address" wide>{txt('perm_address', { soft: true })}</Field>
      </Group>
      <Group title="Company & letter">
        <Field label="Company *">{txt('company_name', { req: true })}</Field>
        <Field label="Registered office address" wide>{txt('company_address')}</Field>
        <Field label="CIN">{txt('cin', { ph: 'Leave blank if not applicable' })}</Field>
        <Field label="Letter date"><input type="date" value={f.letter_date} onChange={t('letter_date')} style={inp} /></Field>
      </Group>
      <Group title="Position & reporting">
        <Field label="Designation *">{txt('designation', { req: true })}</Field>
        <Field label="Department / function *">{txt('department', { req: true })}</Field>
        <Field label="Grade / level / band">{txt('grade', { soft: true })}</Field>
        <Field label="Employment type">{txt('employment_type')}</Field>
        <Field label="Reporting manager">{txt('reporting_manager', { soft: true })}</Field>
        <Field label="Functional (dotted-line) manager">{txt('functional_manager', { ph: 'Only if different' })}</Field>
        <Field label="Date of joining *"><input type="date" value={f.doj} onChange={t('doj')} style={need(f.doj)} /></Field>
        <Field label="Place of posting *">{txt('place', { req: true, ph: 'e.g. Gurugram' })}</Field>
      </Group>
      <Group title="Compensation" hint="The salary table (Annexure A) comes from the recruitment negotiation">
        <Field label="Total CTC (INR / year) *"><Num value={f.ctc_annual} onChange={v => set('ctc_annual', v)} /></Field>
        <Field label="Joining bonus — total"><Num value={f.jb_total} onChange={v => { const split = f.jb_second > 0; set('jb_total', v); set('jb_first', split ? Math.round(v / 2) : v); set('jb_second', split ? v - Math.round(v / 2) : 0) }} /></Field>
        <Field label="… paid with first salary">{num('jb_first')}</Field>
        <Field label="… paid after 6 months">{num('jb_second')}</Field>
        <Field label="Retention bonus (INR)">{num('retention_bonus')}</Field>
        <Field label="ESOP value (INR)">{num('esop_value')}</Field>
        <Field label="ESOP vesting">{txt('esop_vesting', { ph: '4-year vesting with 1 year cliff' })}</Field>
        <Field label="ESI">
          <select value={f.esi_applicable ? 'y' : 'n'} onChange={e => set('esi_applicable', e.target.value === 'y')} style={inp}><option value="n">Not covered (gross above limit)</option><option value="y">Covered under ESIC</option></select>
        </Field>
        <Field label="Medical policy" wide>{txt('medical')}</Field>
        <Field label="Gratuity (INR / year)">{num('gratuity_annual')}</Field>
        <Field label="Gratuity is">
          <select value={f.gratuity_in_ctc ? 'in' : 'over'} onChange={e => set('gratuity_in_ctc', e.target.value === 'in')} style={inp}>
            <option value="over">Over and above the CTC</option><option value="in">Included in the CTC</option>
          </select>
        </Field>
      </Group>
      <Group title="Probation & notice">
        <Field label="Probation (months)">{num('probation_months')}</Field>
        <Field label="Extendable by (months)">{num('probation_extension_months')}</Field>
        <Field label="Notice in probation (days)">{num('probation_notice_days')}</Field>
        <Field label="Notice after confirmation (days)">{num('notice_days')}</Field>
        <Field label="F&F within (days)">{num('fnf_days')}</Field>
      </Group>
      <Group title="Working hours" hint="From the company's shift where one is set up">
        <Field label="Working days">{txt('working_days')}</Field>
        <Field label="Working hours" wide>{txt('working_hours')}</Field>
        <Field label="Effective hours">{txt('effective_hours')}</Field>
        <Field label="Overtime" wide>{txt('overtime')}</Field>
      </Group>
      <Group title="Leave (Annexure B)" hint="From the company's leave policy where one is set up">
        <Field label="Earned leave / year">{num('el_days')}</Field>
        <Field label="EL carry forward (max)">{num('el_carry_max')}</Field>
        <Field label="Casual leave / year">{num('cl_days')}</Field>
        <Field label="Sick leave / year">{num('sl_days')}</Field>
        <Field label="Maternity (weeks)">{num('maternity_weeks')}</Field>
        <Field label="Paternity (days)">{num('paternity_days')}</Field>
        <Field label="Bereavement (days)">{txt('bereavement_days')}</Field>
        <Field label="Marriage (days)">{num('marriage_days')}</Field>
      </Group>
      <Group title="Confidentiality, non-compete & conduct">
        <Field label="Confidentiality after exit (years)">{num('confidentiality_years')}</Field>
        <Field label="Non-compete (months)">{num('non_compete_months')}</Field>
        <Field label="Non-solicitation (months)">{num('non_solicit_months')}</Field>
        <Field label="Non-compete region">{txt('non_compete_region')}</Field>
        <Field label="Gift limit (INR)">{num('gift_limit')}</Field>
        <Field label="BGV within (days)">{num('bgv_days')}</Field>
      </Group>
      <Group title="Law & signatures">
        <Field label="Courts of jurisdiction">{txt('jurisdiction', { ph: 'Gurugram, Haryana' })}</Field>
        <Field label="Authorised signatory">{txt('signatory_name', { soft: true, ph: 'Name' })}</Field>
        <Field label="Signatory designation">{txt('signatory_designation', { ph: 'HR Head / Managing Director' })}</Field>
        <Field label="Witness (optional)">{txt('witness_name')}</Field>
        <Field label="Witness designation">{txt('witness_designation')}</Field>
      </Group>
    </div>
  )
}

function SectionCard({ s, edited, onChange, onReset }: { s: ApptSection; edited: boolean; onChange: (body: string) => void; onReset: () => void }) {
  const rows = Math.min(16, Math.max(3, Math.ceil(s.body.length / 110) + s.body.split('\n').length))
  const title = s.heading || (s.key === 'intro' ? 'Appointment (opening)' : s.key === 'closing' ? 'Closing paragraph' : s.key === 'declaration' ? 'Employee declaration' : s.key === 'annex_note' ? 'Annexure A notes' : 'Paragraph')
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

const KIND_LABEL: Record<string, string> = { row: 'Line', head: 'Heading', sum: 'Subtotal', total: 'Total', ded: 'Deduction', net: 'Net pay', extra: 'One-time' }

function AnnexureTab({ rows, setRows, ctc, source }: { rows: AnnexRow[]; setRows: (r: AnnexRow[]) => void; ctc: number; source: string }) {
  const upd = (i: number, k: keyof AnnexRow, v: any) => setRows(rows.map((r, j) => j === i ? { ...r, [k]: v, ...(k === 'monthly' ? { annual: v * 12 } : {}), ...(k === 'kind' ? { bold: v !== 'row' && v !== 'ded' && v !== 'extra' } : {}) } : r))
  const total = rows.find(r => r.kind === 'total') || rows.find(r => /^total/i.test(r.label))
  const mismatch = total && ctc && Math.abs(total.annual - ctc) > 12
  return (
    <div>
      <div style={{ fontSize: 12.5, color: TK.muted, marginBottom: 10 }}>Exactly the breakup from <b style={{ color: TK.ink }}>{source || 'the salary record'}</b>. Edit a line only if the negotiation itself was wrong.</div>
      {mismatch && <div style={{ background: TK.warningTint, border: `1px solid ${TK.warningEdge}`, color: TK.ink, borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>The Total CTC row (INR {inrNum(total!.annual)}) differs from the CTC on the Details tab (INR {inrNum(ctc)}). Correct one of them before sending.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.7fr) 1fr 1fr 110px 34px', gap: 8, alignItems: 'center' }}>
        {['Component', 'Monthly', 'Yearly', 'Type', ''].map(h => <span key={h} style={lbl}>{h}</span>)}
        {rows.map((r, i) => r.kind === 'head' ? [
          <input key={`l${i}`} value={r.label} onChange={e => upd(i, 'label', e.target.value)} style={{ ...inp, gridColumn: 'span 3', fontWeight: 700, background: TK.sunken, letterSpacing: '.03em' }} />,
          <select key={`k${i}`} value="head" onChange={e => upd(i, 'kind', e.target.value)} style={inp}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>,
          <button key={`d${i}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove row" style={{ ...btn('danger'), height: 32, padding: 0, width: 32 }}>×</button>,
        ] : [
          <input key={`l${i}`} value={r.label} onChange={e => upd(i, 'label', e.target.value)} style={{ ...inp, fontWeight: r.bold ? 700 : 400 }} />,
          <Num key={`m${i}`} value={r.monthly} onChange={v => upd(i, 'monthly', v)} />,
          <Num key={`a${i}`} value={r.annual} onChange={v => upd(i, 'annual', v)} />,
          <select key={`k${i}`} value={r.kind || 'row'} onChange={e => upd(i, 'kind', e.target.value)} style={inp}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>,
          <button key={`d${i}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} title="Remove row" style={{ ...btn('danger'), height: 32, padding: 0, width: 32 }}>×</button>,
        ])}
      </div>
      <button onClick={() => setRows([...rows, { label: '', monthly: 0, annual: 0, kind: 'row' }])} style={{ ...btn(), marginTop: 10 }}>+ Add row</button>
    </div>
  )
}

export default function AppointmentLetterModal({ onboardingId, employeeId, name, onClose, onDone }: {
  /** The joiner's onboarding record, or — People → Letters → Issue a letter — the employee. */
  onboardingId?: string | null; employeeId?: string | null; name: string
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
        const q = onboardingId ? `onboarding_id=${encodeURIComponent(onboardingId)}` : `employee_id=${encodeURIComponent(employeeId || '')}`
        const res = await fetch(`/api/onboarding/appointment-letter?${q}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load the letter')
        if (!alive) return
        setDraft(d.draft); setSource(d.salary_source || ''); setLastSent(d.last_sent || null)
        setMail({ to: d.to || '', cc: '', subject: d.email?.subject || '', body: d.email?.body || '' })
      } catch (e: any) { if (alive) setErr(e.message) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current) }
  }, [onboardingId, employeeId])

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
  const warnings = useMemo(() => draft ? apptWarnings(draft.fields) : [], [draft])

  const post = async (action: 'preview' | 'send') => {
    if (!draft) return null
    return fetch('/api/onboarding/appointment-letter', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ ...(onboardingId ? { onboarding_id: onboardingId } : { employee_id: employeeId }), draft, action, ...(action === 'send' ? mail : {}) }),
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
      onDone(d.ess_saved ? `Letter of Appointment ${d.doc_id || ''} mailed to ${d.sent_to} and saved in their ESS → My Letters` : `Letter of Appointment mailed to ${d.sent_to}, but NOT saved in ESS: ${d.ess_error}`, d.ess_saved ? 'ok' : 'err')
      onClose()
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }

  const TABS: { k: Tab; label: string }[] = [
    { k: 'details', label: 'Details' }, { k: 'letter', label: 'Letter text (20 sections)' }, { k: 'annexure', label: 'Annexure A · Salary' },
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
                {warnings.length > 0 && <div style={{ fontSize: 12.5, color: TK.ink, background: TK.warningTint, border: `1px solid ${TK.warningEdge}`, borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  <b>Not on record (optional):</b> {warnings.join(', ')}. Fill {warnings.length === 1 ? 'it' : 'them'} in (outlined in amber) or the line is left out of the letter.
                </div>}
                <DetailsTab f={draft.fields} set={setField} />
              </>}
              {tab === 'letter' && <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12.5, color: TK.muted }}>Opens with the reference number, {longDate(draft.fields.letter_date)}, “Private &amp; Confidential”, “{draft.fields.salutation} {draft.fields.name}” with their father’s name and address, and “Subject: Letter of Appointment”. Headed sections are numbered in the PDF; Acceptance &amp; Signatures, Annexure A (salary), B (leave) and C (code of conduct) follow. A line starting with “• ” prints as a bullet, “- ” as a sub-bullet.</div>
                {draft.sections.map(s => <SectionCard key={s.key} s={s} edited={edited.has(s.key)} onChange={b => setBody(s.key, b)} onReset={() => resetSection(s.key)} />)}
              </div>}
              {tab === 'annexure' && <AnnexureTab rows={draft.annexure} setRows={r => setDraft(d => d && { ...d, annexure: r })} ctc={draft.fields.ctc_annual} source={source} />}
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
