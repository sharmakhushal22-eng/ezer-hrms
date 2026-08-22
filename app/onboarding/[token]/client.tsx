// app/onboarding/[token]/client.tsx
// 8-step employee onboarding wizard with AI doc verification
'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK } from '@/lib/ui'

// ── Types ────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
interface DocStatus { doc_code: string; ai_status: string; ai_extracted_data: any; ai_confidence: number; ai_flags: string[]; file_name: string }

// ── EZER Theme ───────────────────────────────────────────────────
const P = TK.brand
const S = {
  page: { background: TK.canvas, minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: TK.ink } as const,
  card: { background: '#fff', borderRadius: 12, border: '1px solid rgba(124,58,237,0.12)', padding: '18px 20px', marginBottom: 12, boxShadow: '0 1px 4px rgba(124,58,237,0.06)' } as const,
  lbl: { fontSize: 10, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase' as const, letterSpacing: '.06em', display: 'block', marginBottom: 4 },
  inp: (err = false) => ({ width: '100%', padding: '9px 12px', background: err ? TK.criticalTint : TK.sunken, border: `1px solid ${err ? '#FCA5A5' : TK.brandEdge}`, borderRadius: 8, color: TK.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }),
  sel: { width: '100%', padding: '9px 12px', background: TK.sunken, border: '1px solid #DDD6FE', borderRadius: 8, color: TK.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' },
  btnP: { padding: '11px 24px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', background: P, color: '#fff', transition: 'opacity .2s' } as const,
  btnO: { padding: '10px 18px', borderRadius: 9, border: `1px solid ${P}`, cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', background: '#fff', color: P } as const,
  g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } as const,
  g3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 } as const,
}

const STEPS = ['Welcome', 'Documents', 'AI Review', 'Personal', 'KYC & EPF', 'Nominees', 'ESIC & Family', 'Education', 'Forms Review', 'Policies', 'ACK Doc', 'Aadhaar']
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal']
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Canada', 'Australia', 'Germany', 'France', 'Singapore', 'Japan', 'China', 'Nepal', 'Bangladesh', 'Sri Lanka', 'Pakistan', 'Bhutan', 'Myanmar', 'Maldives', 'Afghanistan', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Oman', 'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'South Korea', 'Hong Kong', 'Taiwan', 'New Zealand', 'Ireland', 'Netherlands', 'Belgium', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Italy', 'Spain', 'Portugal', 'Austria', 'Poland', 'Russia', 'Turkey', 'Israel', 'Egypt', 'South Africa', 'Nigeria', 'Kenya', 'Mauritius', 'Brazil', 'Mexico', 'Argentina', 'Chile', 'Luxembourg', 'Greece', 'Czech Republic', 'Hungary', 'Other']

// ── Misc helpers ──────────────────────────────────────────────────
const ageFromDob = (dob: string) => dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)) : 0

// ── Field helpers ─────────────────────────────────────────────────
const Fld = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div style={{ marginBottom: 12 }}>
    <label style={S.lbl}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 11, color: TK.faint, marginTop: 3 }}>{hint}</div>}
  </div>
)

// ── API helper ────────────────────────────────────────────────────
async function api(path: string, body: any, method = 'POST') {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return r.json()
}

// ── Toast ─────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'ok' | 'err' }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, borderRadius: 10, padding: '12px 20px', fontSize: 13, fontWeight: 500, background: type === 'ok' ? TK.positive : TK.critical, color: '#fff', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxWidth: 320 }}>
      {type === 'ok' ? '' : ''} {msg}
    </div>
  )
}

// ── Step Progress bar ─────────────────────────────────────────────
function StepBar({ current }: { current: Step }) {
  const pct = Math.round((current / STEPS.length) * 100)
  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #EDE9FE' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px 4px', overflowX: 'auto', gap: 0 }}>
        {STEPS.map((s, i) => {
          const n = i + 1
          const done = n < current
          const active = n === current
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: done ? TK.positive : active ? P : TK.brandTint, color: done || active ? '#fff' : TK.faint, transition: 'all .3s' }}>
                  {done ? '' : n}
                </div>
                <div style={{ fontSize: 9, color: active ? P : done ? TK.positive : TK.faint, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{s}</div>
              </div>
              {i < STEPS.length - 1 && <div style={{ width: 24, height: 2, background: done ? TK.positive : TK.brandTint, margin: '0 2px', marginBottom: 16, transition: 'background .3s' }} />}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px 10px' }}>
        <div style={{ flex: 1, height: 6, background: 'rgba(124,58,237,0.1)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: P, borderRadius: 99, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: P, whiteSpace: 'nowrap' }}>Step {current} of {STEPS.length} · {pct}%</span>
      </div>
    </div>
  )
}

// ── Document upload box ───────────────────────────────────────────
function DocUpload({
  docCode, docName, required, token,
  status, onSuccess,
}: {
  docCode: string; docName: string; required: boolean; token: string
  status: DocStatus | null
  onSuccess: (code: string, data: any) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate
    const maxMB = 5
    if (file.size > maxMB * 1024 * 1024) { alert(`File too large. Max ${maxMB}MB.`); return }
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    if (!allowed.includes(file.type)) { alert('Only JPG, PNG, PDF allowed.'); return }

    setUploading(true)
    setProgress('Uploading...')

    const fd = new FormData()
    fd.append('token', token)
    fd.append('doc_code', docCode)
    fd.append('file', file)

    try {
      setProgress('Verifying with AI...')
      const res = await fetch('/api/onboarding/verify-document', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setProgress('')
      onSuccess(docCode, data)
    } catch (err: any) {
      alert('Upload failed: ' + err.message)
      setProgress('')
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const aiStatus = status?.ai_status
  // The file is saved whenever a record exists. MISMATCH is the only real warning;
  // FAILED just means AI auto-check was skipped (no AI key) — the upload still succeeded.
  const isMismatch = aiStatus === 'MISMATCH'
  const isOk = !!status && !isMismatch
  const isPending = !status

  const borderColor = isMismatch ? '#FCD34D' : isOk ? '#A7F3D0' : TK.brandEdge
  const bgColor = isMismatch ? TK.warningTint : isOk ? TK.positiveTint : TK.sunken
  const icon = isMismatch ? '' : isOk ? '' : isPending ? '' : ''

  return (
    <div style={{ border: `2px dashed ${borderColor}`, borderRadius: 10, padding: '14px 16px', background: bgColor, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon} {docName} {required && <span style={{ color: TK.critical, fontSize: 11 }}>*Required</span>}
          </div>
          {status && (
            <div style={{ fontSize: 11, color: TK.muted, marginTop: 4, lineHeight: 1.6 }}>
              {status.file_name}
              {aiStatus === 'VERIFIED' && (
                <span style={{ color: TK.positive, marginLeft: 8 }}>
                  AI verified ({Math.round((status.ai_confidence || 0) * 100)}% confidence)
                </span>
              )}
              {aiStatus === 'MISMATCH' && (
                <span style={{ color: TK.warning, marginLeft: 8 }}>AI flagged — HR will review</span>
              )}
              {aiStatus === 'FAILED' && (
                <span style={{ color: TK.positive, marginLeft: 8 }}>Uploaded ✓ — HR will verify</span>
              )}
            </div>
          )}
          {/* Show extracted data */}
          {status?.ai_extracted_data && Object.keys(status.ai_extracted_data).length > 0 && (
            <div style={{ marginTop: 8, background: TK.brandTint, borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#534AB7' }}>Extracted: {Object.entries(status.ai_extracted_data).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </div>
          )}
          {uploading && <div style={{ fontSize: 11, color: P, marginTop: 4 }}>⏳ {progress}</div>}
        </div>
        <div style={{ marginLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${P}`, cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 12, background: status ? TK.brandTint : P, color: status ? P : '#fff', fontFamily: 'inherit', opacity: uploading ? .6 : 1 }}>
            {status ? 'Re-upload' : 'Upload'}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.pdf" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  )
}

// ── Document list + reusable upload grid (used in Step 2 AND the pre-Policies gate) ──
const DOC_LIST = (esic: boolean, isFresher: boolean, isForeign = false) => [
  { code: 'AADHAAR_FRONT', name: 'Aadhaar Card (Front)', required: true },
  { code: 'AADHAAR_BACK', name: 'Aadhaar Card (Back)', required: true },
  { code: 'PAN', name: 'PAN Card', required: true },
  { code: 'PHOTO', name: 'Passport Size Photo', required: true },
  ...(esic ? [{ code: 'FAMILY_PHOTO', name: 'Family Photo (all members — for ESIC e-Pehchan card)', required: true }] : []),
  { code: 'DEGREE', name: 'Highest Degree Certificate', required: true },
  { code: 'EXP_LETTER', name: 'Experience/Relieving Letter', required: !isFresher },
  { code: 'BANK_PROOF', name: 'Cancelled Cheque / Bank Passbook', required: true },
  { code: 'UAN_CARD', name: 'UAN Card (if existing PF)', required: false },
  ...(isForeign ? [
    { code: 'PASSPORT', name: 'Passport (front page)', required: true },
    { code: 'VISA', name: 'Visa copy', required: true },
    { code: 'WORK_PERMIT', name: 'Work Permit', required: false },
  ] : []),
]
const REQUIRED_DOC_CODES = (esic: boolean) => ['AADHAAR_FRONT', 'AADHAAR_BACK', 'PAN', 'PHOTO', 'DEGREE', 'BANK_PROOF', ...(esic ? ['FAMILY_PHOTO'] : [])]
function DocsGrid({ docs, token, esicApplicable, isFresher, isForeign = false, onUploaded }: {
  docs: Record<string, DocStatus>; token: string; esicApplicable: boolean; isFresher: boolean; isForeign?: boolean; onUploaded: (code: string, data: any) => void
}) {
  return (
    <>
      {DOC_LIST(esicApplicable, isFresher, isForeign).map(doc => (
        <DocUpload key={doc.code} docCode={doc.code} docName={doc.name} required={doc.required} token={token} status={docs[doc.code] || null} onSuccess={onUploaded} />
      ))}
    </>
  )
}

// ── Phase 2: AI document-extraction review table ──────────────────
function AIReviewTable({ docs }: { docs: Record<string, DocStatus> }) {
  const aadhaar = docs['AADHAAR_FRONT']?.ai_extracted_data || {}
  const pan = docs['PAN']?.ai_extracted_data || {}
  const bank = docs['BANK']?.ai_extracted_data || docs['BANK_PROOF']?.ai_extracted_data || {}
  const srcConf = (d?: DocStatus | null) => Math.round(((d?.ai_confidence) || 0) * 100)
  const rows: { field: string; value: any; conf: number; src?: DocStatus }[] = [
    { field: 'Full name', value: aadhaar.name || pan.name || '', conf: srcConf(docs['AADHAAR_FRONT'] || docs['PAN']), src: docs['AADHAAR_FRONT'] || docs['PAN'] },
    { field: 'Date of birth', value: aadhaar.dob || '', conf: srcConf(docs['AADHAAR_FRONT']), src: docs['AADHAAR_FRONT'] },
    { field: 'PAN number', value: pan.pan_number || '', conf: srcConf(docs['PAN']), src: docs['PAN'] },
    { field: 'Bank account', value: bank.account_number || bank.account || '', conf: srcConf(docs['BANK'] || docs['BANK_PROOF']), src: docs['BANK'] || docs['BANK_PROOF'] },
    { field: 'IFSC', value: bank.ifsc || '', conf: srcConf(docs['BANK'] || docs['BANK_PROOF']), src: docs['BANK'] || docs['BANK_PROOF'] },
  ]
  if (!rows.some(r => r.value)) return null
  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, background: TK.brandTint, color: '#534AB7' }}>AI extracted this from your documents — please verify below</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'rgba(124,58,237,0.04)' }}>
            {['Field', 'Extracted value', 'Confidence', 'Status'].map(h => <th key={h} style={{ padding: '7px 14px', textAlign: 'left', fontSize: 10, color: TK.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const mismatch = r.src?.ai_status === 'MISMATCH'
            const ok = !!r.value && r.conf >= 80 && !mismatch
            return (
              <tr key={r.field} style={{ borderTop: '1px solid rgba(124,58,237,0.08)', background: mismatch ? TK.criticalTint : !r.value ? TK.warningTint : 'transparent' }}>
                <td style={{ padding: '7px 14px', color: TK.muted }}>{r.field}</td>
                <td style={{ padding: '7px 14px', fontWeight: 500 }}>{r.value || '—'}</td>
                <td style={{ padding: '7px 14px' }}>{r.value ? <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: ok ? TK.positiveTint : TK.warningTint, color: ok ? TK.positive : TK.warning }}>{r.conf}%</span> : '—'}</td>
                <td style={{ padding: '7px 14px' }}>{!r.value ? <span style={{ color: TK.faint }}>— Manual entry</span> : mismatch ? <span style={{ color: TK.critical }}>Mismatch — review</span> : ok ? <span style={{ color: TK.positive }}>Verified</span> : <span style={{ color: TK.warning }}>Low confidence</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Phase 8: read-only statutory form previews (Form 11/2/F/ESIC) ──
function FormRow({ l, v }: { l: string; v: any }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid #F3F0FF' }}>
      <span style={{ fontSize: 11, color: TK.muted }}>{l}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: TK.ink, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  )
}
function StatutoryFormCard({ code, title, rows }: { code: string; title: string; rows: [string, any][] }) {
  const [ok, setOk] = useState(false)
  return (
    <div style={{ ...S.card, border: `1px solid ${ok ? '#A7F3D0' : TK.brandTint}`, background: ok ? '#F6FFF9' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: TK.brand, background: TK.brandTint, padding: '2px 8px', borderRadius: 99 }}>{code}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {ok && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: TK.positive }}>Looks correct</span>}
      </div>
      <div>{rows.map(([l, v]) => <FormRow key={l} l={l} v={v} />)}</div>
      {!ok && <button onClick={() => setOk(true)} style={{ ...S.btnO, marginTop: 10, fontSize: 12, padding: '6px 14px' }}>Looks correct</button>}
    </div>
  )
}
function StatutoryFormsPreview({ personal, contact, statutory, insurance, esic, candidate, esicApplicable, isForeign = false, epsFamily = [], epsFallback = {} }: {
  personal: any; contact: any; statutory: any; insurance: any; esic: any; candidate: any; esicApplicable: boolean; isForeign?: boolean
  epsFamily?: any[]; epsFallback?: any
}) {
  const doj = candidate.date_of_joining ? new Date(candidate.date_of_joining).toLocaleDateString('en-IN') : '—'
  // Form III: date of superannuation = DOB + 60 years
  const superannuation = personal.dob ? (() => { const d = new Date(personal.dob); d.setFullYear(d.getFullYear() + 60); return d.toLocaleDateString('en-IN') })() : '—'
  // Form III needs the address split into Village / PO / Thana / Sub-Division
  const permAddr = [contact?.perm_village, contact?.perm_po, contact?.perm_thana, contact?.perm_sub_division, contact?.perm_line1, contact?.perm_city, contact?.perm_district, contact?.perm_state, contact?.perm_pin].filter(Boolean).join(', ')
  const fam = [
    insurance.spouse_name && `${insurance.spouse_name} (Spouse)`,
    insurance.father_name && `${insurance.father_name} (Father)`,
    insurance.mother_name && `${insurance.mother_name} (Mother)`,
    insurance.kid1_name && `${insurance.kid1_name} (Child)`,
    insurance.kid2_name && `${insurance.kid2_name} (Child)`,
  ].filter(Boolean).join(', ')

  // EPS Form 2 Part B — family members + fallback nominee
  const epsFamStr = (epsFamily || [])
    .filter((m: any) => m && (m.name || m.relation))
    .map((m: any) => `${m.name || '—'}${m.relation ? ` (${m.relation})` : ''}`)
    .join(', ')
  const epsFallbackStr = epsFallback && (epsFallback.name || epsFallback.relation)
    ? `${epsFallback.name || '—'}${epsFallback.relation ? ` (${epsFallback.relation})` : ''}`
    : ''

  // ── Tabbed view ──────────────────────────────────────────────────
  const tabs: { id: string; label: string }[] = [
    { id: 'form11', label: 'Form 11' },
    { id: 'form2', label: 'Form 2' },
    { id: 'form3', label: 'Form III' },
    ...(esicApplicable ? [{ id: 'esic1', label: 'ESIC Form 1' }] : []),
  ]
  const [tab, setTab] = useState('form11')
  // Keep active tab valid if ESIC tab disappears
  const activeTab = tabs.some(t => t.id === tab) ? tab : 'form11'

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Review your statutory forms</div>
      <div style={{ fontSize: 12, color: TK.muted, marginBottom: 12 }}>Auto-filled from your data — verify each before signing.</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const on = t.id === activeTab
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', border: `1px solid ${P}`, background: on ? P : '#fff', color: on ? '#fff' : P }}>
              {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'form11' && (
        <StatutoryFormCard code="EPF FORM 11" title="PF Declaration (new member)" rows={[
          ['Name of member', personal.full_name],
          ["Father's / Husband's name", personal.father_name],
          ['Date of birth', personal.dob],
          ['Gender', personal.gender],
          ['Date of joining', doj],
          ['PAN', statutory.pan_number],
          ['Existing PF member', statutory.has_uan ? `Yes — UAN ${statutory.uan_number || '—'}` : 'No'],
          ['International worker', isForeign ? 'Yes' : 'No'],
        ]} />
      )}
      {activeTab === 'form2' && (
        <StatutoryFormCard code="EPF FORM 2" title="PF & Pension Nomination" rows={[
          ['Nominee name', statutory.nominee_name],
          ['Relationship', statutory.nominee_relation],
          ['Nominee date of birth', statutory.nominee_dob],
          ['Share of accumulation', statutory.nominee_share ? `${statutory.nominee_share}%` : '—'],
          ['Nominee address', statutory.nominee_address],
          ['Family members (Part B)', epsFamStr],
          ['Fallback nominee (EPS)', epsFallbackStr],
        ]} />
      )}
      {activeTab === 'form3' && (
        <StatutoryFormCard code="FORM III" title="Gratuity Nomination (Form F)" rows={[
          ['Employee name', personal.full_name],
          ['Religion', personal.religion],
          ['Department', candidate.department],
          ['Designation', candidate.designation],
          ['Date of appointment', doj],
          ['Date of superannuation (DOB + 60)', superannuation],
          ['Permanent address', permAddr],
          ['Nominee name', statutory.grat_nominee_name || statutory.nominee_name],
          ['Relationship', statutory.grat_nominee_relation || statutory.nominee_relation],
          ['Nominee age', statutory.nominee_dob ? `${ageFromDob(statutory.nominee_dob)} yrs` : '—'],
          ['Proportion', '100%'],
        ]} />
      )}
      {activeTab === 'esic1' && esicApplicable && (
        <StatutoryFormCard code="ESIC FORM 1" title="ESIC Declaration & Family" rows={[
          ['Insured person', personal.full_name],
          ['Date of birth', personal.dob],
          ['Family members', fam],
          ['Previous ESIC IP no.', esic.prev_ip],
          ['Nearest dispensary', esic.dispensary],
        ]} />
      )}
    </div>
  )
}

// ── Phase 9: Policy acknowledgement (config-driven per company) ─────
function PolicyCard({ policy, acked, onAck }: { policy: any; acked: boolean; onAck: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [scrolledEnd, setScrolledEnd] = useState(false)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) setScrolledEnd(true)
  }
  // A short policy doesn't produce a scrollbar — there's nothing to scroll to,
  // so treat it as already read and unlock the acknowledgement checkbox.
  useEffect(() => {
    if (!open) return
    const el = bodyRef.current
    if (el && el.scrollHeight <= el.clientHeight + 4) setScrolledEnd(true)
  }, [open])
  return (
    <div style={{ ...S.card, border: `1px solid ${acked ? '#A7F3D0' : TK.brandTint}`, background: acked ? TK.positiveTint : '#fff' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{policy.policy_title}</span>
        <span style={{ fontSize: 10, color: TK.faint }}>{policy.policy_code} · v{policy.version}</span>
        {policy.is_mandatory && <span style={{ fontSize: 9, fontWeight: 700, color: TK.brand, background: TK.brandTint, padding: '1px 7px', borderRadius: 99 }}>MANDATORY</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: acked ? TK.positive : TK.faint }}>{acked ? 'Acknowledged' : (open ? '' : '')}</span>
      </div>
      {open && !acked && (
        <div style={{ marginTop: 10 }}>
          <div ref={bodyRef} onScroll={onScroll} style={{ maxHeight: 200, overflowY: 'auto', background: TK.sunken, border: '1px solid #EDE9FE', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: TK.inkSoft, whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
            {policy.policy_body || 'No content.'}
          </div>
          {!scrolledEnd && <div style={{ fontSize: 10, color: TK.warning, marginTop: 6 }}>Scroll to the bottom to enable acknowledgement</div>}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: scrolledEnd ? 'pointer' : 'not-allowed', opacity: scrolledEnd ? 1 : 0.5, fontSize: 12 }}>
            <input type="checkbox" disabled={!scrolledEnd} checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
            <span>I have read and understood {policy.policy_title} in full.</span>
          </label>
          <button disabled={!checked || busy} onClick={async () => { setBusy(true); await onAck(); setBusy(false) }}
            style={{ ...S.btnP, marginTop: 10, padding: '8px 16px', opacity: checked && !busy ? 1 : 0.5, cursor: checked && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? '…' : 'Acknowledge'}
          </button>
        </div>
      )}
    </div>
  )
}

function PolicyAckPhase({ token, onBack, onNext }: {
  token: string; onBack: () => void; onNext: () => void
}) {
  const [policies, setPolicies] = useState<any[]>([])
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch(`/api/onboarding/policies?token=${token}`).then(r => r.json())
      .then(d => { setPolicies(d.policies || []); setAcked(new Set(d.ackedIds || [])); setLoading(false) })
      .catch(() => setLoading(false))
  }, [token])
  const ack = async (p: any) => {
    await fetch('/api/onboarding/acknowledge-policy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, policy_id: p.id, policy_code: p.policy_code, policy_title: p.policy_title, policy_version: p.version }),
    })
    setAcked(prev => new Set([...prev, p.id]))
  }
  const mandatory = policies.filter(p => p.is_mandatory)
  const allMandatoryAcked = mandatory.every(p => acked.has(p.id))
  const ackedCount = policies.filter(p => acked.has(p.id)).length

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Company Policies</div>
        <div style={{ fontSize: 12, color: TK.muted }}>
          {loading ? 'Loading…' : policies.length === 0 ? 'No policy is configured for this company — you can go ahead and submit.' : `Read and acknowledge each policy. ${ackedCount}/${policies.length} done.`}
        </div>
      </div>
      {policies.map(p => <PolicyCard key={p.id} policy={p} acked={acked.has(p.id)} onAck={() => ack(p)} />)}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={onBack} style={S.btnO}>Back</button>
        <button onClick={onNext} disabled={!allMandatoryAcked}
          style={{ ...S.btnP, flex: 1, padding: 12, fontSize: 15, background: allMandatoryAcked ? P : TK.faint, cursor: !allMandatoryAcked ? 'not-allowed' : 'pointer' }}>
          Review Acknowledgement →
        </button>
      </div>
    </div>
  )
}

// ── Phase 10: Acknowledgement document preview (auto-filled details) ─
function AckPreviewPhase({ token, onBack, onNext }: {
  token: string; onBack: () => void; onNext: () => void
}) {
  const [d, setD] = useState<any>(null)
  useEffect(() => {
    fetch(`/api/onboarding/ack-preview?token=${token}`).then(r => r.json()).then(setD).catch(() => setD({ error: true }))
  }, [token])
  if (!d) return <div style={S.card}>Loading…</div>

  const Row = ({ l, v }: { l: string; v: any }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: TK.sunken, borderRadius: 7, border: '1px solid #EDE9FE' }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: TK.muted }}>{l}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: TK.ink }}>{v || '—'}</span>
    </div>
  )
  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Acknowledgement Document</div>
        <div style={{ fontSize: 12, color: TK.muted, marginBottom: 12 }}>Check your details. After you submit, this document and the policies will also be emailed to you.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          <Row l="Employee Name" v={d.employee_name} />
          <Row l="Father's Name" v={d.father_name} />
          <Row l="Designation" v={d.designation} />
          <Row l="Department" v={d.department} />
          <Row l="Date of Joining" v={d.doj} />
          <Row l="Company" v={d.company_name} />
          <Row l="Work Location" v={d.work_location} />
          <Row l="Aadhaar" v={`XXXX XXXX ${d.aadhaar_last4 || '****'}`} />
          <Row l="Employee ID" v={d.employee_code} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: TK.brand, marginBottom: 6 }}>Policies acknowledged ({(d.policies_acked || []).length})</div>
        {(d.policies_acked || []).length === 0
          ? <div style={{ fontSize: 12, color: TK.faint }}>—</div>
          : (d.policies_acked || []).map((p: any) => (
            <div key={p.policy_code} style={{ fontSize: 12, color: '#065F46', padding: '3px 0' }}>✓ {p.policy_code} — {p.policy_title}</div>
          ))}
        <div style={{ background: TK.brandTint, borderRadius: 10, padding: '12px 14px', marginTop: 14, fontSize: 12, color: TK.brandDeep, lineHeight: 1.7 }}>
          I hereby acknowledge that I have received, read, and understood all the above policies, and confirm the details shown are correct.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onBack} style={S.btnO}>Back</button>
        <button onClick={onNext}
          style={{ ...S.btnP, flex: 1, padding: 12, fontSize: 15, background: P, cursor: 'pointer' }}>
          Proceed to Aadhaar e-Verify →
        </button>
      </div>
    </div>
  )
}

// ── Phase 11: Aadhaar e-Verify + digital signature (demo OTP) ───────
// Records the eSign (mock — UIDAI vendor needed for real OTP) then submits.
function ESignPhase({ token, onBack, onSubmit, submitting }: {
  token: string; onBack: () => void; onSubmit: () => void; submitting: boolean
}) {
  const [aadhaar, setAadhaar] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const clean = aadhaar.replace(/\D/g, '')
  const bundle = ['EPF Form 11 (PF Declaration)', 'EPF Form 2 (Nominee Declaration)', 'Gratuity Form F', 'All Policy Acknowledgements', 'Complete Joining Form (consolidated)']
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 5 }
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', background: TK.sunken, border: `1px solid #DDD6FE`, borderRadius: 8, fontSize: 15, color: TK.ink, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', letterSpacing: 2 }

  const sendOtp = () => {
    if (clean.length !== 12) { setErr('Enter a valid 12-digit Aadhaar number'); return }
    setErr(''); setOtpSent(true)
  }
  const verifyAndSign = async () => {
    if (otp.replace(/\D/g, '').length !== 6) { setErr('Enter the 6-digit OTP'); return }
    setBusy(true); setErr('')
    try {
      await fetch('/api/onboarding/esign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, aadhaar_last4: clean.slice(-4) }) })
      await onSubmit()
    } catch { setErr('Verification failed — please try again.'); setBusy(false) }
  }

  return (
    <div>
      <div style={S.card}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Aadhaar e-Verify &amp; Digital Signature</div>
        <div style={{ fontSize: 12, color: TK.muted, marginBottom: 12 }}>A single OTP e-signs all the forms and policies below at once.</div>
        <div style={{ background: TK.sunken, border: '1px solid #EDE9FE', borderRadius: 8, padding: '10px 14px' }}>
          {bundle.map(b => <div key={b} style={{ fontSize: 12, color: TK.inkSoft, padding: '3px 0' }}>📄 {b}</div>)}
        </div>
      </div>

      <div style={S.card}>
        {!otpSent ? (
          <>
            <label style={lbl}>Aadhaar Number</label>
            <input style={inp} value={aadhaar} maxLength={14} inputMode="numeric"
              onChange={e => setAadhaar(e.target.value)} placeholder="XXXX XXXX XXXX" />
            <button onClick={sendOtp} style={{ ...S.btnP, marginTop: 12, width: '100%', padding: 12, fontSize: 15 }}>Send OTP</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#065F46', marginBottom: 10 }}>OTP sent to the Aadhaar-linked mobile <span style={{ color: TK.faint }}>(demo — enter any 6 digits)</span></div>
            <label style={lbl}>Enter OTP</label>
            <input style={inp} value={otp} maxLength={6} inputMode="numeric"
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="6-digit OTP" autoFocus />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={() => { setOtpSent(false); setOtp('') }} style={S.btnO}>Change Aadhaar</button>
              <button onClick={verifyAndSign} disabled={busy || submitting}
                style={{ ...S.btnP, flex: 1, padding: 12, fontSize: 15, background: TK.positive, cursor: (busy || submitting) ? 'not-allowed' : 'pointer', opacity: (busy || submitting) ? .7 : 1 }}>
                {(busy || submitting) ? 'Verifying & signing…' : 'Verify & e-Sign — Submit'}
              </button>
            </div>
          </>
        )}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: TK.critical, background: TK.criticalTint, borderRadius: 7, padding: '8px 12px' }}>{err}</div>}
      </div>

      <button onClick={onBack} style={S.btnO}>Back</button>
    </div>
  )
}

// ── Phase 3b: Cross-document mismatch resolution ──────────────────
// Gathers the same logical field from multiple source docs, flags mismatches,
// and lets the employee pick the correct value (written back to form state).
function CrossDocCheck({ docs, onResolve, onMismatchChange }: {
  docs: Record<string, DocStatus>
  onResolve: (field: 'name' | 'dob' | 'pan', value: string) => void
  onMismatchChange: (unresolvedCount: number) => void
}) {
  const norm = (v: any) => (v == null ? '' : String(v).trim())
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  const aadhaar = docs['AADHAAR_FRONT']?.ai_extracted_data || {}
  const pan = docs['PAN']?.ai_extracted_data || {}

  type FieldDef = { key: 'name' | 'dob' | 'pan'; label: string; sources: { src: string; value: string }[] }
  const fields: FieldDef[] = [
    { key: 'name', label: 'Name', sources: [
      { src: 'Aadhaar', value: norm(aadhaar.name) },
      { src: 'PAN', value: norm(pan.name) },
    ] },
    { key: 'dob', label: 'Date of birth', sources: [
      { src: 'Aadhaar', value: norm(aadhaar.dob) },
    ] },
    { key: 'pan', label: 'PAN', sources: [
      { src: 'PAN', value: norm(pan.pan_number) },
    ] },
  ].map(f => ({ ...f, sources: f.sources.filter(s => s.value) }))

  // Only fields that have at least one extracted value matter for display
  const present = fields.filter(f => f.sources.length > 0)

  // Classify each field
  const classify = (f: FieldDef): 'match' | 'mismatch' | 'single' => {
    if (f.sources.length < 2) return 'single'
    const first = f.sources[0].value
    return f.sources.every(s => eq(s.value, first)) ? 'match' : 'mismatch'
  }

  const mismatchFields = present.filter(f => classify(f) === 'mismatch')

  // Track which mismatches have been resolved (a choice made)
  const [resolved, setResolved] = useState<Record<string, string>>({})

  const unresolvedCount = mismatchFields.filter(f => !resolved[f.key]).length
  useEffect(() => { onMismatchChange(unresolvedCount) }, [unresolvedCount, onMismatchChange])

  if (present.length === 0) return null

  return (
    <div style={{ ...S.card, padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, background: TK.brandTint, color: '#534AB7' }}>Cross-document check — we compared the same details across your documents</div>
      <div style={{ padding: '6px 14px 12px' }}>
        {present.map(f => {
          const status = classify(f)
          const badge = status === 'match'
            ? { bg: TK.positiveTint, color: TK.positive, txt: 'Match' }
            : status === 'mismatch'
              ? { bg: TK.warningTint, color: TK.warning, txt: 'Mismatch' }
              : { bg: TK.brandTint, color: TK.brand, txt: 'Single source' }
          return (
            <div key={f.key} style={{ padding: '10px 0', borderBottom: '1px solid #F3F0FF' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: TK.ink }}>{f.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>{badge.txt}</span>
              </div>
              <div style={{ fontSize: 11, color: TK.muted, lineHeight: 1.7 }}>
                {f.sources.map(s => <span key={s.src} style={{ marginRight: 12 }}><b style={{ color: '#534AB7' }}>{s.src}:</b> {s.value}</span>)}
              </div>
              {status === 'mismatch' && (
                <div style={{ marginTop: 8 }}>
                  <label style={S.lbl}>Pick the correct {f.label.toLowerCase()}</label>
                  <select
                    style={{ ...S.sel, border: resolved[f.key] ? '1px solid #A7F3D0' : '1px solid #FCD34D', background: resolved[f.key] ? TK.positiveTint : TK.warningTint }}
                    value={resolved[f.key] || ''}
                    onChange={e => {
                      const chosen = e.target.value
                      if (!chosen) return
                      setResolved(r => ({ ...r, [f.key]: chosen }))
                      onResolve(f.key, chosen)
                    }}
                  >
                    <option value="">— Select correct value —</option>
                    {f.sources.map(s => <option key={s.src} value={s.value}>{s.value} (from {s.src})</option>)}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── EPS Family Member row (Form 2 Part B) ─────────────────────────
function EpsFamilyRow({ row, index, canRemove, onChange, onRemove }: {
  row: any; index: number; canRemove: boolean
  onChange: (patch: any) => void; onRemove: () => void
}) {
  return (
    <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: P }}>Family member {index + 1}{row.name ? ` — ${row.name}` : ''}</div>
        {canRemove && (
          <button onClick={onRemove} style={{ ...S.btnO, padding: '3px 10px', fontSize: 11, border: '1px solid #FCA5A5', color: TK.critical }}>Remove</button>
        )}
      </div>
      <div style={S.g2}>
        <Fld label="Name"><input style={S.inp()} value={row.name || ''} onChange={e => onChange({ name: e.target.value })} /></Fld>
        <Fld label="Relation">
          <select style={S.sel} value={row.relation || ''} onChange={e => onChange({ relation: e.target.value })}>
            <option value="">Select</option><option>Spouse</option><option>Son</option><option>Daughter</option><option>Father</option><option>Mother</option><option>Other</option>
          </select>
        </Fld>
        <Fld label="Date of Birth"><input type="date" style={S.inp()} value={row.dob || ''} onChange={e => onChange({ dob: e.target.value })} /></Fld>
        <Fld label="Address"><input style={S.inp()} value={row.address || ''} onChange={e => onChange({ address: e.target.value })} /></Fld>
      </div>
    </div>
  )
}

// ── Dual acknowledgement copy (HR / Employee) ─────────────────────
function AckCopy({ copyFor, ackNo, generatedAt, employeeName, designation, department, doj, forms, docsCount }: {
  copyFor: string; ackNo: string; generatedAt: string; employeeName: string
  designation: string; department: string; doj: string; forms: string[]; docsCount: number
}) {
  const Row = ({ l, v }: { l: string; v: any }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid #F3F0FF' }}>
      <span style={{ fontSize: 11, color: TK.muted }}>{l}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: TK.ink, textAlign: 'right' }}>{v || '—'}</span>
    </div>
  )
  return (
    <div style={{ ...S.card, flex: 1, minWidth: 260, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: TK.brand, background: TK.brandTint, padding: '2px 8px', borderRadius: 99 }}>{copyFor}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Acknowledgement</span>
      </div>
      <Row l="ACK No." v={ackNo} />
      <Row l="Generated" v={generatedAt} />
      <Row l="Employee Name" v={(employeeName || '').toUpperCase()} />
      <Row l="Designation" v={designation} />
      <Row l="Department" v={department} />
      <Row l="Date of Joining" v={doj} />
      <div style={{ fontSize: 11, fontWeight: 600, color: P, margin: '10px 0 4px' }}>Forms e-signed</div>
      {forms.map(f => <div key={f} style={{ fontSize: 12, color: TK.positive, padding: '2px 0' }}>✓ {f}</div>)}
      <div style={{ marginTop: 8 }}><Row l="Documents uploaded" v={docsCount} /></div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function OnboardingClient({ token, candidate, company, uploadedDocs }: {
  token: string
  candidate: any
  company: any
  uploadedDocs: Record<string, DocStatus>
}) {
  // Numbering changed in the 12-phase redesign, so we don't reuse the raw stored
  // current_step. Resume at OTP gate if not verified, else at Documents (step 3).
  const [step, setStep] = useState<Step>((candidate.otp_verified ? 2 : 1) as Step)
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [docs, setDocs] = useState<Record<string, DocStatus>>(uploadedDocs)
  const [submitted, setSubmitted] = useState(false)
  const [employeeCode, setEmployeeCode] = useState<string | null>(null)

  const c = candidate
  const co = company

  // Restore saved form data
  const saved = c.form_data || {}

  // Personal step state
  const [personal, setPersonal] = useState({
    full_name: (saved.step_3?.full_name) || c.full_name || '',
    dob: (saved.step_3?.dob) || '',
    gender: (saved.step_3?.gender) || '',
    father_name: (saved.step_3?.father_name) || '',
    mother_name: (saved.step_3?.mother_name) || '',
    blood_group: (saved.step_3?.blood_group) || '',
    marital_status: (saved.step_3?.marital_status) || '',
    nationality: (saved.step_3?.nationality) || 'Indian',
    religion: (saved.step_3?.religion) || '',
    country: (saved.step_3?.country) || 'India',
  })

  // Contact step
  const [contact, setContact] = useState({
    mobile: (saved.step_4?.mobile) || c.mobile || '',
    alt_mobile: (saved.step_4?.alt_mobile) || '',
    personal_email: (saved.step_4?.personal_email) || c.email || '',
    perm_line1: (saved.step_4?.perm_line1) || '',
    perm_village: (saved.step_4?.perm_village) || '',
    perm_po: (saved.step_4?.perm_po) || '',
    perm_thana: (saved.step_4?.perm_thana) || '',
    perm_sub_division: (saved.step_4?.perm_sub_division) || '',
    perm_city: (saved.step_4?.perm_city) || '',
    perm_district: (saved.step_4?.perm_district) || '',
    perm_state: (saved.step_4?.perm_state) || '',
    perm_pin: (saved.step_4?.perm_pin) || '',
    same_address: (saved.step_4?.same_address) !== undefined ? saved.step_4.same_address : false,
    curr_line1: (saved.step_4?.curr_line1) || '',
    curr_city: (saved.step_4?.curr_city) || '',
    curr_state: (saved.step_4?.curr_state) || '',
    curr_pin: (saved.step_4?.curr_pin) || '',
  })

  // Emergency + prev employment
  const [emergency, setEmergency] = useState({
    emrg1_name: (saved.step_5?.emrg1_name) || '',
    emrg1_relation: (saved.step_5?.emrg1_relation) || '',
    emrg1_mobile: (saved.step_5?.emrg1_mobile) || '',
    emrg2_name: (saved.step_5?.emrg2_name) || '',
    emrg2_relation: (saved.step_5?.emrg2_relation) || '',
    emrg2_mobile: (saved.step_5?.emrg2_mobile) || '',
    is_fresher: (saved.step_5?.is_fresher) !== undefined ? saved.step_5.is_fresher : false,
    prev_company: (saved.step_5?.prev_company) || c.current_company || '',
    prev_designation: (saved.step_5?.prev_designation) || '',
    prev_from: (saved.step_5?.prev_from) || '',
    prev_to: (saved.step_5?.prev_to) || '',
    prev_ctc: (saved.step_5?.prev_ctc) || '',
    reason_leaving: (saved.step_5?.reason_leaving) || '',
  })

  // Statutory & bank step
  const [statutory, setStatutory] = useState({
    pan_number: (saved.step_7?.pan_number) || '',
    has_uan: (saved.step_7?.has_uan) !== undefined ? saved.step_7.has_uan : false,
    uan_number: (saved.step_7?.uan_number) || '',
    prev_pf_id: (saved.step_7?.prev_pf_id) || '',
    pf_transfer: (saved.step_7?.pf_transfer) !== undefined ? saved.step_7.pf_transfer : false,
    // PF Nominee
    nominee_name: (saved.step_7?.nominee_name) || '',
    nominee_relation: (saved.step_7?.nominee_relation) || '',
    nominee_dob: (saved.step_7?.nominee_dob) || '',
    nominee_share: (saved.step_7?.nominee_share) || '100',
    nominee_address: (saved.step_7?.nominee_address) || '',
    // Gratuity nominee
    grat_nominee_name: (saved.step_7?.grat_nominee_name) || '',
    grat_nominee_relation: (saved.step_7?.grat_nominee_relation) || '',
    // Bank
    bank_account: (saved.step_7?.bank_account) || '',
    bank_confirm: '',
    bank_ifsc: (saved.step_7?.bank_ifsc) || '',
    bank_name: (saved.step_7?.bank_name) || '',
    bank_branch: (saved.step_7?.bank_branch) || '',
    account_type: (saved.step_7?.account_type) || 'Savings',
    acc_holder: (saved.step_7?.acc_holder) || c.full_name || '',
    // Foreign employee fields
    fe_passport_number: (saved.step_7?.fe_passport_number) || '',
    fe_passport_country: (saved.step_7?.fe_passport_country) || '',
    fe_passport_expiry: (saved.step_7?.fe_passport_expiry) || '',
    fe_visa_type: (saved.step_7?.fe_visa_type) || '',
    fe_visa_number: (saved.step_7?.fe_visa_number) || '',
    fe_visa_expiry: (saved.step_7?.fe_visa_expiry) || '',
    fe_work_permit_number: (saved.step_7?.fe_work_permit_number) || '',
    fe_frro_number: (saved.step_7?.fe_frro_number) || '',
    fe_tax_residency: (saved.step_7?.fe_tax_residency) || '',
    fe_tax_country: (saved.step_7?.fe_tax_country) || '',
    fe_foreign_tin: (saved.step_7?.fe_foreign_tin) || '',
    fe_ssa_coc: (saved.step_7?.fe_ssa_coc) || '',
    fe_overseas_line: (saved.step_7?.fe_overseas_line) || '',
    fe_overseas_city: (saved.step_7?.fe_overseas_city) || '',
    fe_overseas_country: (saved.step_7?.fe_overseas_country) || '',
  })

  // ── ESIC applicability — from offered CTC (gross ≈ CTC/12), HR can override ──
  const grossMonthly = c.offered_ctc ? Number(c.offered_ctc) / 12 : 0
  const esicApplicable = c.esic_applicable === true || (grossMonthly > 0 && grossMonthly <= 21000)
  // Foreign employee — citizenship country other than India triggers extra KYC + docs.
  const isForeign = (personal.country || 'India').trim().toLowerCase() !== 'india'
  // Documents can be skipped on Step 2; if skipped they become mandatory (non-skippable) before Policies.
  const [docsDeferred, setDocsDeferred] = useState(false)
  const docsComplete = REQUIRED_DOC_CODES(esicApplicable).every(d => docs[d])
  const onDocUploaded = (code: string, data: any) => {
    setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: 'uploaded' } }))
    if (code === 'PAN' && data.ai_extracted?.pan_number) {
      setStatutory(s => ({ ...s, pan_number: data.ai_extracted.pan_number, acc_holder: data.ai_extracted.name || s.acc_holder }))
    }
    showToast(`${code} uploaded & AI verified ✓`)
  }

  // Previous employers (multiple) — seeded from legacy single fields if present
  const [prevEmployers, setPrevEmployers] = useState<any[]>(
    (saved.step_5?.prev_employers?.length) ? saved.step_5.prev_employers : [{
      company: (saved.step_5?.prev_company) || c.current_company || '',
      designation: (saved.step_5?.prev_designation) || '',
      from: (saved.step_5?.prev_from) || '', to: (saved.step_5?.prev_to) || '',
      ctc: (saved.step_5?.prev_ctc) || '', reason: (saved.step_5?.reason_leaving) || '',
    }]
  )

  // Education ladder (10th → 12th → Graduation/Diploma → MBA/PG, + more)
  const [education, setEducation] = useState<any[]>(
    (saved.step_5?.education?.length) ? saved.step_5.education : [
      { qualification: '10th', institute: '', year: '' },
      { qualification: '12th', institute: '', year: '' },
      { qualification: 'Graduation / Diploma', institute: '', year: '' },
      { qualification: 'MBA / PG', institute: '', year: '' },
    ]
  )

  // Insurance family (Group Mediclaim + ESIC Form 1 family particulars)
  const ins0 = saved.step_7?.insurance || {}
  const [insurance, setInsurance] = useState({
    spouse_name: ins0.spouse_name || '', spouse_dob: ins0.spouse_dob || '', spouse_residing: ins0.spouse_residing || 'Yes',
    father_name: ins0.father_name || '', father_dob: ins0.father_dob || '', father_residing: ins0.father_residing || 'Yes',
    mother_name: ins0.mother_name || '', mother_dob: ins0.mother_dob || '', mother_residing: ins0.mother_residing || 'Yes',
    kid1_name: ins0.kid1_name || '', kid1_dob: ins0.kid1_dob || '',
    kid2_name: ins0.kid2_name || '', kid2_dob: ins0.kid2_dob || '',
  })

  // ESIC-specific details (only collected when ESIC applies)
  const esic0 = saved.step_7?.esic_details || {}
  const [esic, setEsic] = useState({ prev_ip: esic0.prev_ip || '', dispensary: esic0.dispensary || '' })

  // EPS Family Members (Form 2 Part B) + fallback nominee
  const [epsFamily, setEpsFamily] = useState<any[]>(
    (saved.step_7?.eps_family?.length) ? saved.step_7.eps_family : [{ name: '', address: '', dob: '', relation: '' }]
  )
  const epsFb0 = saved.step_7?.eps_fallback || {}
  const [epsFallback, setEpsFallback] = useState({ name: epsFb0.name || '', relation: epsFb0.relation || '', address: epsFb0.address || '', dob: epsFb0.dob || '' })

  // Cross-document mismatch tracking (step 3) — Continue blocked until resolved
  const [crossDocUnresolved, setCrossDocUnresolved] = useState(0)
  const onCrossDocResolve = useCallback((field: 'name' | 'dob' | 'pan', value: string) => {
    if (field === 'name') setPersonal(p => ({ ...p, full_name: value }))
    else if (field === 'dob') setPersonal(p => ({ ...p, dob: value }))
    else if (field === 'pan') setStatutory(s => ({ ...s, pan_number: value }))
  }, [])

  const upEmp = (i: number, patch: any) => setPrevEmployers(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e))
  const upEdu = (i: number, patch: any) => setEducation(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e))

  const [declaration, setDeclaration] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ── Save progress ───────────────────────────────────────────────
  const saveStep = async (stepNum: Step, data: any) => {
    setSaving(true)
    await api('/api/onboarding/save-progress', { token, step: stepNum, data })
    setSaving(false)
  }

  // ── OTP send ────────────────────────────────────────────────────
  const sendOtp = async () => {
    if (c.otp_verified) { nextStep(); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token })
    setOtpLoading(false)
    if (res.success) { setOtpSent(true); showToast(res.dev_otp ? `DEV OTP: ${res.dev_otp}` : (res.message || 'OTP sent to your email')) }
    else showToast(res.error || 'Failed to send OTP', 'err')
  }

  const verifyOtp = async () => {
    if (!otp.trim()) { showToast('Please enter OTP', 'err'); return }
    setOtpLoading(true)
    const res = await api('/api/onboarding/otp', { token, otp }, 'PUT')
    setOtpLoading(false)
    if (res.success) { showToast('Mobile verified!'); nextStep() }
    else showToast(res.error || 'Incorrect OTP', 'err')
  }

  // ── IFSC lookup ─────────────────────────────────────────────────
  const lookupIfsc = async (ifsc: string) => {
    if (ifsc.length < 11) return
    try {
      const r = await fetch(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`)
      if (r.ok) {
        const d = await r.json()
        setStatutory(s => ({ ...s, bank_name: d.BANK || '', bank_branch: d.BRANCH || '' }))
      }
    } catch { /* silently fail */ }
  }

  // ── PAN auto-fill from AI-extracted Aadhaar ────────────────────
  const panDoc = docs['PAN']
  const aadhaarDoc = docs['AADHAAR_FRONT']
  const aiPan = panDoc?.ai_extracted_data?.pan_number || ''
  const aiName = aadhaarDoc?.ai_extracted_data?.name || panDoc?.ai_extracted_data?.name || ''

  // ── Navigate steps ───────────────────────────────────────────────
  // ESIC & Family (step 7) only applies when esicApplicable — skip it otherwise,
  // both forward (6 → 8) and backward (8 → 6).
  const nextStep = () => setStep(s => {
    let n = Math.min(12, s + 1)
    if (n === 7 && !esicApplicable) n = 8
    return n as Step
  })
  const prevStep = () => setStep(s => {
    let n = Math.max(1, s - 1)
    if (n === 7 && !esicApplicable) n = 6
    return n as Step
  })

  // ── Final Submit ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!declaration) { showToast('Please accept the declaration', 'err'); return }
    setSubmitting(true)

    const final = {
      step_3: personal,
      step_4: contact,
      step_5: { ...emergency, prev_employers: prevEmployers, education },
      step_7: {
        ...statutory,
        gross_monthly: grossMonthly,
        esic_applicable: esicApplicable,
        esic_details: esic,
        insurance,
        eps_family: epsFamily,
        eps_fallback: epsFallback,
      },
    }

    const res = await api('/api/onboarding/submit', { token, final_form_data: final })
    setSubmitting(false)

    if (res.success) setSubmitted(true)
    else showToast(res.error || 'Submit failed', 'err')
  }

  // ── SUBMITTED screen ─────────────────────────────────────────────
  if (submitted) {
    const ackNo = `EZR-ACK-${(token || '').slice(0, 8).toUpperCase()}`
    const generatedAt = new Date().toLocaleString('en-IN')
    const doj = c.date_of_joining ? new Date(c.date_of_joining).toLocaleDateString('en-IN') : '—'
    const ackForms = ['Form 11', 'Form 2', 'Form III', ...(esicApplicable ? ['ESIC Form 1'] : [])]
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 760, width: '100%', padding: 24, textAlign: 'center' }}>
          <div style={{ ...S.card, padding: 40 }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}></div>
            <div style={{ fontSize: 22, fontWeight: 600, color: TK.ink, marginBottom: 8 }}>Welcome to {co?.company_name || 'the team'}!</div>
            <div style={{ fontSize: 13, color: '#000000ff', lineHeight: 1.8, marginBottom: 20 }}>
              Your joining form has been submitted successfully!<br />
              HR will review it and generate your Employee ID.<br />
              You'll receive an email with your ESS login details.
            </div>
            <div style={{ background: TK.brandTint, borderRadius: 10, padding: 16, marginBottom: 16, textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>Steps completed</div>
              {['Personal details filled', 'Documents uploaded & AI verified', 'Statutory forms submitted', 'PF/Bank details captured', 'Declaration accepted'].map(s => (
                <div key={s} style={{ fontSize: 12, color: TK.positive, marginBottom: 5 }}>✓ {s}</div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: TK.faint, lineHeight: 1.7 }}>
              Questions? Contact HR at {co?.hr_email || 'hr@company.com'}
            </div>
          </div>

          {/* Dual acknowledgement copies */}
          <div style={{ fontSize: 14, fontWeight: 600, color: TK.ink, margin: '4px 0 10px', textAlign: 'left' }}>Acknowledgement Copies</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <AckCopy copyFor="HR MANAGER COPY" ackNo={ackNo} generatedAt={generatedAt} employeeName={personal.full_name || c.full_name} designation={c.designation} department={c.department} doj={doj} forms={ackForms} docsCount={Object.keys(docs).length} />
            <AckCopy copyFor="EMPLOYEE COPY" ackNo={ackNo} generatedAt={generatedAt} employeeName={personal.full_name || c.full_name} designation={c.designation} department={c.department} doj={doj} forms={ackForms} docsCount={Object.keys(docs).length} />
          </div>
          <button onClick={() => window.print()} style={{ ...S.btnP, padding: '10px 20px' }}>⬇ Download / Print copy</button>
        </div>
      </div>
    )
  }

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${P}, #4F46E5)`, padding: '14px 20px', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{co?.company_name || 'EZER HRMS'} — Joining Formalities</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', marginTop: 1 }}>{(c.full_name || '').toUpperCase()} · {c.designation}</div>
        </div>
        {esicApplicable && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99, background: 'rgba(255,255,255,.18)', color: '#fff', border: '1px solid rgba(255,255,255,.35)' }}>ESIC Applicable
          </span>
        )}
      </div>

      {/* Step progress */}
      <StepBar current={step} />

      {/* Save indicator */}
      {saving && <div style={{ background: TK.brandTint, textAlign: 'center', padding: '4px 0', fontSize: 11, color: P }}>Auto-saving...</div>}

      <div style={{ maxWidth: 700, margin: '0 auto', padding: '16px 20px' }}>
        {/* Global country list — shared by the Personal + KYC foreign-block selectors */}
        <datalist id="ezer-countries">{COUNTRIES.map(c => <option key={c} value={c} />)}</datalist>


        {/* ═══ STEP 1: WELCOME + IDENTITY VERIFY ════════════════════ */}
        {step === 1 && (
          <div>
            <div style={{ ...S.card, background: `linear-gradient(135deg, ${P}, #4F46E5)`, color: '#fff' }}>
              <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Welcome, {(c.full_name || '').toUpperCase()}! 👋</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.8)', lineHeight: 1.8 }}>
                We're excited to have you join {co?.company_name}. Let's verify your identity to begin.
              </div>
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Verify Your Identity</div>
              <div style={{ fontSize: 13, color: TK.muted, marginBottom: 16, lineHeight: 1.7 }}>
                We'll email a 6-digit OTP to your registered email: <strong>{c.email?.replace(/^(.{2}).*(@.*)$/, '$1***$2') || 'your email'}</strong>
              </div>
              {c.otp_verified ? (
                <>
                  <div style={{ background: TK.positiveTint, border: '1px solid #A7F3D0', borderRadius: 8, padding: '12px 14px', marginBottom: 14, fontSize: 13, color: TK.positive }}>Identity already verified!
                  </div>
                  <button onClick={nextStep} style={{ ...S.btnP, width: '100%', padding: 12, fontSize: 15 }}>Start Onboarding 🚀</button>
                </>
              ) : !otpSent ? (
                <button onClick={sendOtp} disabled={otpLoading} style={{ ...S.btnP, width: '100%', padding: 12, fontSize: 15, opacity: otpLoading ? .6 : 1 }}>
                  {otpLoading ? 'Sending...' : 'Send OTP to Verify'}
                </button>
              ) : (
                <>
                  <Fld label="Enter 6-digit OTP">
                    <input style={{ ...S.inp(), textAlign: 'center', letterSpacing: 8, fontSize: 22, fontWeight: 600 }} value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6} />
                  </Fld>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <button onClick={verifyOtp} disabled={otpLoading || otp.length < 6} style={{ ...S.btnP, flex: 1, opacity: otpLoading || otp.length < 6 ? .6 : 1, cursor: otp.length < 6 ? 'not-allowed' : 'pointer' }}>
                      {otpLoading ? 'Verifying...' : 'Verify & Start'}
                    </button>
                    <button onClick={() => { setOtpSent(false); setOtp('') }} style={S.btnO}>Resend</button>
                  </div>
                  <div style={{ fontSize: 11, color: TK.faint, textAlign: 'center' }}>OTP valid for 10 minutes</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══ STEP 5: PERSONAL DETAILS ════════════════════════════ */}
        {step === 4 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Personal Details</div>

            <div style={S.g2}>
              <Fld label="Full Name (as per Aadhaar) *">
                <input style={S.inp(!personal.full_name)} value={personal.full_name} onChange={e => setPersonal(p => ({ ...p, full_name: e.target.value }))} />
              </Fld>
              <Fld label="Date of Birth *">
                <input type="date" style={S.inp(!personal.dob)} value={personal.dob} onChange={e => setPersonal(p => ({ ...p, dob: e.target.value }))} />
              </Fld>
              <Fld label="Gender *">
                <select style={S.sel} value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}>
                  <option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Blood Group *">
                <select style={S.sel} value={personal.blood_group} onChange={e => setPersonal(p => ({ ...p, blood_group: e.target.value }))}>
                  <option value="">Select</option>{['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(g => <option key={g}>{g}</option>)}
                </select>
              </Fld>
              <Fld label="Father's Name *">
                <input style={S.inp(!personal.father_name)} value={personal.father_name} onChange={e => setPersonal(p => ({ ...p, father_name: e.target.value }))} placeholder="As per documents" />
              </Fld>
              <Fld label="Mother's Name">
                <input style={S.inp()} value={personal.mother_name} onChange={e => setPersonal(p => ({ ...p, mother_name: e.target.value }))} />
              </Fld>
              <Fld label="Marital Status *">
                <select style={S.sel} value={personal.marital_status} onChange={e => setPersonal(p => ({ ...p, marital_status: e.target.value }))}>
                  <option value="">Select</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
                </select>
              </Fld>
              <Fld label="Nationality">
                <input style={S.inp()} value={personal.nationality} onChange={e => setPersonal(p => ({ ...p, nationality: e.target.value }))} />
              </Fld>
              <Fld label="Religion *" hint="Required for Gratuity Form III">
                <select style={S.sel} value={personal.religion} onChange={e => setPersonal(p => ({ ...p, religion: e.target.value }))}>
                  <option value="">Select</option>{['Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Parsi', 'Other'].map(r => <option key={r}>{r}</option>)}
                </select>
              </Fld>
              <div style={{ gridColumn: 'span 2' }}>
                <Fld label="Country (Citizenship) *" hint="Type to search. Select a country other than India for foreign-employee onboarding.">
                  <input list="ezer-countries" style={S.inp(!personal.country)} value={personal.country} onChange={e => setPersonal(p => ({ ...p, country: e.target.value }))} placeholder="India" />
                </Fld>
              </div>
            </div>
            {isForeign && (
              <div style={{ background: TK.brandTint, border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 12px', margin: '4px 0 10px', fontSize: 12, color: '#534AB7', lineHeight: 1.6 }}>Foreign employee detected — extra passport/visa/tax fields will appear in the KYC &amp; EPF step.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                if (!personal.full_name || !personal.dob || !personal.gender || !personal.father_name || !personal.blood_group) {
                  showToast('Please fill all required fields', 'err'); return
                }
                await saveStep(3, personal)
                nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 6: KYC & EPF (Contact + PAN + PF + Bank) ═══════ */}
        {step === 5 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>KYC &amp; EPF — Contact, PAN, PF &amp; Bank</div>

            <div style={S.g2}>
              <Fld label="Mobile Number *"><input style={S.inp(!contact.mobile)} value={contact.mobile} onChange={e => setContact(c => ({ ...c, mobile: e.target.value }))} /></Fld>
              <Fld label="Alternate Mobile"><input style={S.inp()} value={contact.alt_mobile} onChange={e => setContact(c => ({ ...c, alt_mobile: e.target.value }))} /></Fld>
              <div style={{ gridColumn: 'span 2' }}><Fld label="Personal Email *"><input type="email" style={S.inp(!contact.personal_email)} value={contact.personal_email} onChange={e => setContact(c => ({ ...c, personal_email: e.target.value }))} /></Fld></div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '12px 0 10px' }}>Permanent Address</div>
            <div style={S.g3}>
              <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1 *"><input style={S.inp(!contact.perm_line1)} value={contact.perm_line1} onChange={e => setContact(c => ({ ...c, perm_line1: e.target.value }))} /></Fld></div>
              <Fld label="Village / Area" hint="For Gratuity Form III"><input style={S.inp()} value={contact.perm_village} onChange={e => setContact(c => ({ ...c, perm_village: e.target.value }))} /></Fld>
              <Fld label="Post Office"><input style={S.inp()} value={contact.perm_po} onChange={e => setContact(c => ({ ...c, perm_po: e.target.value }))} /></Fld>
              <Fld label="Thana / Police Station"><input style={S.inp()} value={contact.perm_thana} onChange={e => setContact(c => ({ ...c, perm_thana: e.target.value }))} /></Fld>
              <Fld label="Sub-Division"><input style={S.inp()} value={contact.perm_sub_division} onChange={e => setContact(c => ({ ...c, perm_sub_division: e.target.value }))} /></Fld>
              <Fld label="District"><input style={S.inp()} value={contact.perm_district} onChange={e => setContact(c => ({ ...c, perm_district: e.target.value }))} /></Fld>
              <Fld label="City *"><input style={S.inp(!contact.perm_city)} value={contact.perm_city} onChange={e => setContact(c => ({ ...c, perm_city: e.target.value }))} /></Fld>
              <Fld label="State *">
                <select style={S.sel} value={contact.perm_state} onChange={e => setContact(c => ({ ...c, perm_state: e.target.value }))}>
                  <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Fld>
              <Fld label="PIN Code *"><input style={S.inp(!contact.perm_pin)} value={contact.perm_pin} onChange={e => setContact(c => ({ ...c, perm_pin: e.target.value }))} maxLength={6} /></Fld>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, margin: '12px 0 10px', userSelect: 'none' }}>
              <input type="checkbox" checked={contact.same_address} onChange={e => setContact(c => ({ ...c, same_address: e.target.checked }))} style={{ width: 16, height: 16 }} />
              Current address same as permanent address
            </label>

            {!contact.same_address && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>Current / Local Address</div>
                <div style={S.g3}>
                  <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line 1"><input style={S.inp()} value={contact.curr_line1} onChange={e => setContact(c => ({ ...c, curr_line1: e.target.value }))} /></Fld></div>
                  <Fld label="City"><input style={S.inp()} value={contact.curr_city} onChange={e => setContact(c => ({ ...c, curr_city: e.target.value }))} /></Fld>
                  <Fld label="State">
                    <select style={S.sel} value={contact.curr_state} onChange={e => setContact(c => ({ ...c, curr_state: e.target.value }))}>
                      <option value="">Select State</option>{STATES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </Fld>
                  <Fld label="PIN Code"><input style={S.inp()} value={contact.curr_pin} onChange={e => setContact(c => ({ ...c, curr_pin: e.target.value }))} maxLength={6} /></Fld>
                </div>
              </>
            )}

            {/* PAN — auto-filled from AI */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '18px 0 10px' }}>PAN</div>
            <div style={{ background: TK.positiveTint, border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#065F46' }}>PAN auto-filled from document AI. Please verify.
            </div>
            <div style={S.g2}>
              <Fld label="PAN Number *" hint="Auto-extracted from PAN card">
                <input style={{ ...S.inp(!statutory.pan_number), background: TK.positiveTint, border: '1px solid #A7F3D0' }} value={statutory.pan_number || aiPan} onChange={e => setStatutory(s => ({ ...s, pan_number: e.target.value.toUpperCase() }))} maxLength={10} />
              </Fld>
            </div>

            {/* PF Section */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Provident Fund (PF)</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 12, userSelect: 'none' }}>
              <input type="checkbox" checked={statutory.has_uan} onChange={e => setStatutory(s => ({ ...s, has_uan: e.target.checked }))} style={{ width: 16, height: 16 }} />
              I have an existing UAN (from previous employer)
            </label>
            {statutory.has_uan && (
              <div style={S.g2}>
                <Fld label="UAN Number" hint="12-digit Universal Account Number">
                  <input style={S.inp()} value={statutory.uan_number} onChange={e => setStatutory(s => ({ ...s, uan_number: e.target.value }))} maxLength={12} />
                </Fld>
                <Fld label="Previous PF Member ID">
                  <input style={S.inp()} value={statutory.prev_pf_id} onChange={e => setStatutory(s => ({ ...s, prev_pf_id: e.target.value }))} placeholder="e.g. MH/BN/12345" />
                </Fld>
              </div>
            )}

            {/* Bank Details */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Bank Account (for Salary)</div>
            <div style={{ background: TK.warningTint, border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: TK.warning }}>Bank details are encrypted. Only Payroll team has access.
            </div>
            <div style={S.g2}>
              <Fld label="Account Number *"><input type="password" style={S.inp(!statutory.bank_account)} value={statutory.bank_account} onChange={e => setStatutory(s => ({ ...s, bank_account: e.target.value }))} /></Fld>
              <Fld label="Confirm Account Number *"><input style={S.inp(statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account)} value={statutory.bank_confirm} onChange={e => setStatutory(s => ({ ...s, bank_confirm: e.target.value }))} /></Fld>
              <Fld label="IFSC Code *" hint="Auto-fills bank name on entry">
                <input style={S.inp(!statutory.bank_ifsc)} value={statutory.bank_ifsc} onChange={e => { const v = e.target.value.toUpperCase(); setStatutory(s => ({ ...s, bank_ifsc: v })); lookupIfsc(v) }} maxLength={11} />
              </Fld>
              <Fld label="Bank Name (auto-fill)">
                <input style={{ ...S.inp(), background: TK.positiveTint, border: '1px solid #A7F3D0' }} value={statutory.bank_name} readOnly placeholder="Auto-fills from IFSC" />
              </Fld>
              <Fld label="Branch"><input style={{ ...S.inp(), background: TK.positiveTint, border: '1px solid #A7F3D0' }} value={statutory.bank_branch} readOnly placeholder="Auto-fills from IFSC" /></Fld>
              <Fld label="Account Type">
                <select style={S.sel} value={statutory.account_type} onChange={e => setStatutory(s => ({ ...s, account_type: e.target.value }))}>
                  <option>Savings</option><option>Current</option>
                </select>
              </Fld>
              <div style={{ gridColumn: 'span 2' }}>
                <Fld label="Account Holder Name (as per bank)">
                  <input style={{ ...S.inp(), background: TK.positiveTint, border: '1px solid #A7F3D0' }} value={statutory.acc_holder} onChange={e => setStatutory(s => ({ ...s, acc_holder: e.target.value }))} placeholder="In CAPITAL LETTERS" />
                </Fld>
              </div>
            </div>
            {statutory.bank_confirm && statutory.bank_confirm !== statutory.bank_account && (
              <div style={{ color: TK.critical, fontSize: 12, marginTop: -8, marginBottom: 8 }}>Account numbers don't match</div>
            )}

            {isForeign && (
              <>
                <div style={{ background: TK.brandTint, border: '1px solid #DDD6FE', borderRadius: 8, padding: '8px 12px', margin: '18px 0 4px', fontSize: 12, color: '#534AB7' }}>Foreign employee — please complete the additional statutory details below.
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Foreign Employee — Passport</div>
                <div style={S.g3}>
                  <Fld label="Passport Number *"><input style={S.inp(!statutory.fe_passport_number)} value={statutory.fe_passport_number} onChange={e => setStatutory(s => ({ ...s, fe_passport_number: e.target.value.toUpperCase() }))} /></Fld>
                  <Fld label="Passport Issuing Country">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_passport_country} onChange={e => setStatutory(s => ({ ...s, fe_passport_country: e.target.value }))} />
                  </Fld>
                  <Fld label="Passport Expiry *"><input type="date" style={S.inp(!statutory.fe_passport_expiry)} value={statutory.fe_passport_expiry} onChange={e => setStatutory(s => ({ ...s, fe_passport_expiry: e.target.value }))} /></Fld>
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Visa &amp; Work Authorization</div>
                <div style={S.g3}>
                  <Fld label="Visa Type">
                    <select style={S.sel} value={statutory.fe_visa_type} onChange={e => setStatutory(s => ({ ...s, fe_visa_type: e.target.value }))}>
                      <option value="">Select</option><option>Employment</option><option>Business</option><option>OCI</option><option>PIO</option>
                    </select>
                  </Fld>
                  <Fld label="Visa Number *"><input style={S.inp(!statutory.fe_visa_number)} value={statutory.fe_visa_number} onChange={e => setStatutory(s => ({ ...s, fe_visa_number: e.target.value }))} /></Fld>
                  <Fld label="Visa Expiry"><input type="date" style={S.inp()} value={statutory.fe_visa_expiry} onChange={e => setStatutory(s => ({ ...s, fe_visa_expiry: e.target.value }))} /></Fld>
                  <Fld label="Work Permit Number"><input style={S.inp()} value={statutory.fe_work_permit_number} onChange={e => setStatutory(s => ({ ...s, fe_work_permit_number: e.target.value }))} /></Fld>
                  <Fld label="FRRO Registration Number" hint="if stay > 180 days"><input style={S.inp()} value={statutory.fe_frro_number} onChange={e => setStatutory(s => ({ ...s, fe_frro_number: e.target.value }))} /></Fld>
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Tax &amp; Social Security</div>
                <div style={S.g2}>
                  <Fld label="India Tax Residency Status">
                    <select style={S.sel} value={statutory.fe_tax_residency} onChange={e => setStatutory(s => ({ ...s, fe_tax_residency: e.target.value }))}>
                      <option value="">Select</option><option>Resident</option><option>Non-Resident</option><option>Not Ordinarily Resident</option>
                    </select>
                  </Fld>
                  <Fld label="Country of Tax Residency">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_tax_country} onChange={e => setStatutory(s => ({ ...s, fe_tax_country: e.target.value }))} />
                  </Fld>
                  <Fld label="Foreign Tax ID / TIN"><input style={S.inp()} value={statutory.fe_foreign_tin} onChange={e => setStatutory(s => ({ ...s, fe_foreign_tin: e.target.value }))} /></Fld>
                  <Fld label="SSA Certificate of Coverage No." hint="if home country has a Social Security Agreement with India"><input style={S.inp()} value={statutory.fe_ssa_coc} onChange={e => setStatutory(s => ({ ...s, fe_ssa_coc: e.target.value }))} /></Fld>
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Permanent Overseas Address</div>
                <div style={S.g3}>
                  <div style={{ gridColumn: 'span 3' }}><Fld label="Address Line"><input style={S.inp()} value={statutory.fe_overseas_line} onChange={e => setStatutory(s => ({ ...s, fe_overseas_line: e.target.value }))} /></Fld></div>
                  <Fld label="City"><input style={S.inp()} value={statutory.fe_overseas_city} onChange={e => setStatutory(s => ({ ...s, fe_overseas_city: e.target.value }))} /></Fld>
                  <Fld label="Country">
                    <input list="ezer-countries" style={S.inp()} value={statutory.fe_overseas_country} onChange={e => setStatutory(s => ({ ...s, fe_overseas_country: e.target.value }))} />
                  </Fld>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                const missing: string[] = []
                if (!contact.mobile?.trim()) missing.push('Mobile')
                if (!contact.personal_email?.trim()) missing.push('Email')
                if (!contact.perm_line1?.trim()) missing.push('Address Line 1')
                if (!contact.perm_city?.trim()) missing.push('City')
                if (!contact.perm_state?.trim()) missing.push('State')
                if (!contact.perm_pin?.trim()) missing.push('PIN Code')
                if (missing.length) {
                  showToast(`Please fill: ${missing.join(', ')}`, 'err'); return
                }
                if (!statutory.pan_number || !statutory.bank_account || !statutory.bank_ifsc) {
                  showToast('Please fill PAN and bank details', 'err'); return
                }
                if (statutory.bank_account !== statutory.bank_confirm) { showToast('Account numbers do not match', 'err'); return }
                await saveStep(4, contact)
                await saveStep(7, { ...statutory, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 9: EMERGENCY + EMPLOYMENT + EDUCATION ════════════ */}
        {step === 8 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Emergency Contacts & Previous Employment</div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 10 }}>Emergency Contact 1 *</div>
            <div style={S.g3}>
              <Fld label="Name *"><input style={S.inp(!emergency.emrg1_name)} value={emergency.emrg1_name} onChange={e => setEmergency(p => ({ ...p, emrg1_name: e.target.value }))} /></Fld>
              <Fld label="Relation *">
                <select style={S.sel} value={emergency.emrg1_relation} onChange={e => setEmergency(p => ({ ...p, emrg1_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile *"><input style={S.inp(!emergency.emrg1_mobile)} value={emergency.emrg1_mobile} onChange={e => setEmergency(p => ({ ...p, emrg1_mobile: e.target.value }))} /></Fld>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '10px 0 10px' }}>Emergency Contact 2 (Optional)</div>
            <div style={S.g3}>
              <Fld label="Name"><input style={S.inp()} value={emergency.emrg2_name} onChange={e => setEmergency(p => ({ ...p, emrg2_name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={emergency.emrg2_relation} onChange={e => setEmergency(p => ({ ...p, emrg2_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Sibling</option><option>Child</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Mobile"><input style={S.inp()} value={emergency.emrg2_mobile} onChange={e => setEmergency(p => ({ ...p, emrg2_mobile: e.target.value }))} /></Fld>
            </div>

            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Previous Employment</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 12, userSelect: 'none' }}>
              <input type="checkbox" checked={emergency.is_fresher} onChange={e => setEmergency(p => ({ ...p, is_fresher: e.target.checked }))} style={{ width: 16, height: 16 }} />
              I am a fresher (no previous work experience)
            </label>

            {!emergency.is_fresher && (
              <>
                {prevEmployers.map((emp, i) => (
                  <div key={i} style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: P }}>Employer {i + 1}{emp.company ? ` — ${emp.company}` : ''}</div>
                      {prevEmployers.length > 1 && (
                        <button onClick={() => setPrevEmployers(arr => arr.filter((_, idx) => idx !== i))} style={{ ...S.btnO, padding: '3px 10px', fontSize: 11, border: '1px solid #FCA5A5', color: TK.critical }}>Remove</button>
                      )}
                    </div>
                    <div style={S.g2}>
                      <Fld label="Company"><input style={S.inp()} value={emp.company} onChange={e => upEmp(i, { company: e.target.value })} /></Fld>
                      <Fld label="Designation"><input style={S.inp()} value={emp.designation} onChange={e => upEmp(i, { designation: e.target.value })} /></Fld>
                      <Fld label="From"><input type="date" style={S.inp()} value={emp.from} onChange={e => upEmp(i, { from: e.target.value })} /></Fld>
                      <Fld label="To"><input type="date" style={S.inp()} value={emp.to} onChange={e => upEmp(i, { to: e.target.value })} /></Fld>
                      <Fld label="Last CTC (Annual ₹)"><input type="number" style={S.inp()} value={emp.ctc} onChange={e => upEmp(i, { ctc: e.target.value })} /></Fld>
                      <Fld label="Reason for Leaving"><input style={S.inp()} value={emp.reason} onChange={e => upEmp(i, { reason: e.target.value })} /></Fld>
                    </div>
                    <DocUpload docCode={`EXP_${i + 1}`} docName={`Experience / Relieving Letter — Employer ${i + 1}`} required={false} token={token} status={docs[`EXP_${i + 1}`] || null}
                      onSuccess={(code, data) => { setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: 'uploaded' } })); showToast('Experience letter uploaded ✓') }} />
                  </div>
                ))}
                <button onClick={() => setPrevEmployers(arr => [...arr, { company: '', designation: '', from: '', to: '', ctc: '', reason: '' }])} style={{ ...S.btnO, marginBottom: 4 }}>+ Add another employer</button>
              </>
            )}

            {/* Education ladder */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '16px 0 10px' }}>Educational Qualifications</div>
            <div style={{ fontSize: 11, color: TK.faint, marginBottom: 10 }}>Standard ladder pre-added. Upload certificate/marksheet for each — used for background verification.</div>
            {education.map((ed, i) => (
              <div key={i} style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: P }}>{ed.qualification || `Qualification ${i + 1}`}</div>
                  {education.length > 1 && (
                    <button onClick={() => setEducation(arr => arr.filter((_, idx) => idx !== i))} style={{ ...S.btnO, padding: '3px 10px', fontSize: 11, border: '1px solid #FCA5A5', color: TK.critical }}>Remove</button>
                  )}
                </div>
                <div style={S.g3}>
                  <Fld label="Qualification"><input style={S.inp()} value={ed.qualification} onChange={e => upEdu(i, { qualification: e.target.value })} placeholder="10th / B.Tech / MBA…" /></Fld>
                  <Fld label="School / University / Board"><input style={S.inp()} value={ed.institute} onChange={e => upEdu(i, { institute: e.target.value })} /></Fld>
                  <Fld label="Year of Passing"><input style={S.inp()} value={ed.year} onChange={e => upEdu(i, { year: e.target.value })} maxLength={4} /></Fld>
                </div>
                <DocUpload docCode={`EDU_${i + 1}`} docName={`Certificate / Marksheet — ${ed.qualification || `Qualification ${i + 1}`}`} required={false} token={token} status={docs[`EDU_${i + 1}`] || null}
                  onSuccess={(code, data) => { setDocs(d => ({ ...d, [code]: { doc_code: code, ai_status: data.ai_status, ai_extracted_data: data.ai_extracted, ai_confidence: data.ai_confidence, ai_flags: data.ai_flags, file_name: 'uploaded' } })); showToast('Certificate uploaded ✓') }} />
              </div>
            ))}
            <button onClick={() => setEducation(arr => [...arr, { qualification: '', institute: '', year: '' }])} style={{ ...S.btnO }}>+ Add qualification (Diploma / PhD / Certification)</button>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                if (!emergency.emrg1_name || !emergency.emrg1_relation || !emergency.emrg1_mobile) {
                  showToast('Please fill Emergency Contact 1 details', 'err'); return
                }
                await saveStep(5, { ...emergency, prev_employers: prevEmployers, education }); nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: DOCUMENT UPLOAD ════════════════════════════ */}
        {step === 2 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Document Upload & AI Verification</div>
            <div style={{ fontSize: 12, color: TK.muted, marginBottom: 14 }}>
              Documents are automatically verified using AI (Gemini 2.5 Flash). Accepted: JPG, PNG, PDF. Max 5MB each.
            </div>

            <DocsGrid docs={docs} token={token} esicApplicable={esicApplicable} isFresher={emergency.is_fresher} isForeign={isForeign} onUploaded={onDocUploaded} />

            <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={() => { setDocsDeferred(true); showToast('Documents skipped — you must upload them before the Policies step.'); nextStep() }}
                style={{ ...S.btnO, borderColor: TK.warning, color: TK.warning }}>Skip for later →</button>
              <button onClick={async () => {
                const notUploaded = REQUIRED_DOC_CODES(esicApplicable).filter(d => !docs[d])
                if (notUploaded.length > 0) {
                  showToast(`Please upload: ${notUploaded.join(', ')}`, 'err'); return
                }
                setDocsDeferred(false)
                await saveStep(6, { docs_uploaded: Object.keys(docs) }); nextStep()
              }} style={{ ...S.btnP, flex: 1, minWidth: 140 }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: AI DOCUMENT REVIEW ═════════════════════════ */}
        {step === 3 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>AI Document Review</div>
            <div style={{ fontSize: 12, color: TK.muted, marginBottom: 14 }}>
              Our AI read your uploaded documents and extracted the details below. Please verify them — you'll confirm/correct them in the next steps.
            </div>
            <AIReviewTable docs={docs} />
            <CrossDocCheck docs={docs} onResolve={onCrossDocResolve} onMismatchChange={setCrossDocUnresolved} />
            {crossDocUnresolved > 0 && (
              <div style={{ fontSize: 12, color: TK.warning, background: TK.warningTint, border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>Resolve all mismatches to continue ({crossDocUnresolved} remaining)
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={nextStep} disabled={crossDocUnresolved > 0}
                style={{ ...S.btnP, flex: 1, background: crossDocUnresolved > 0 ? TK.faint : P, cursor: crossDocUnresolved > 0 ? 'not-allowed' : 'pointer' }}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 7: NOMINEES (PF + Gratuity) ═══════════════════ */}
        {step === 6 && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Nominees</div>
            <div style={{ fontSize: 12, color: TK.muted, marginBottom: 12 }}>PF nominee share should total 100%.</div>

            {/* PF Nominee (Form 11/Form 2) */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>PF Nominee (EPF Form 2)</div>
            <div style={S.g3}>
              <Fld label="Nominee Name *"><input style={S.inp(!statutory.nominee_name)} value={statutory.nominee_name} onChange={e => setStatutory(s => ({ ...s, nominee_name: e.target.value }))} /></Fld>
              <Fld label="Relation *">
                <select style={S.sel} value={statutory.nominee_relation} onChange={e => setStatutory(s => ({ ...s, nominee_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Date of Birth *"><input type="date" style={S.inp(!statutory.nominee_dob)} value={statutory.nominee_dob} onChange={e => setStatutory(s => ({ ...s, nominee_dob: e.target.value }))} /></Fld>
              <Fld label="Share %"><input type="number" style={S.inp()} value={statutory.nominee_share} onChange={e => setStatutory(s => ({ ...s, nominee_share: e.target.value }))} /></Fld>
              <div style={{ gridColumn: 'span 2' }}><Fld label="Nominee Address *"><input style={S.inp(!statutory.nominee_address)} value={statutory.nominee_address} onChange={e => setStatutory(s => ({ ...s, nominee_address: e.target.value }))} /></Fld></div>
            </div>

            {/* Gratuity nominee */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '14px 0 10px' }}>Gratuity Nominee (Form F)</div>
            <div style={S.g2}>
              <Fld label="Nominee Name"><input style={S.inp()} value={statutory.grat_nominee_name} onChange={e => setStatutory(s => ({ ...s, grat_nominee_name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={statutory.grat_nominee_relation} onChange={e => setStatutory(s => ({ ...s, grat_nominee_relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Father</option><option>Mother</option><option>Son</option><option>Daughter</option><option>Other</option>
                </select>
              </Fld>
            </div>

            {/* EPS Family Members (Form 2 Part B) */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '16px 0 4px' }}>EPS Family Members (Form 2 Part B)</div>
            <div style={{ fontSize: 11, color: TK.faint, marginBottom: 10 }}>Family members eligible for the Employees' Pension Scheme.</div>
            {epsFamily.map((row, i) => (
              <EpsFamilyRow key={i} row={row} index={i} canRemove={epsFamily.length > 1}
                onChange={patch => setEpsFamily(arr => arr.map((r, idx) => idx === i ? { ...r, ...patch } : r))}
                onRemove={() => setEpsFamily(arr => arr.filter((_, idx) => idx !== i))} />
            ))}
            <button onClick={() => setEpsFamily(arr => [...arr, { name: '', address: '', dob: '', relation: '' }])} style={{ ...S.btnO, marginBottom: 4 }}>+ Add family member</button>

            {/* EPS Fallback Nominee */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '16px 0 10px' }}>EPS Fallback Nominee</div>
            <div style={S.g2}>
              <Fld label="Name"><input style={S.inp()} value={epsFallback.name} onChange={e => setEpsFallback(s => ({ ...s, name: e.target.value }))} /></Fld>
              <Fld label="Relation">
                <select style={S.sel} value={epsFallback.relation} onChange={e => setEpsFallback(s => ({ ...s, relation: e.target.value }))}>
                  <option value="">Select</option><option>Spouse</option><option>Son</option><option>Daughter</option><option>Father</option><option>Mother</option><option>Other</option>
                </select>
              </Fld>
              <Fld label="Date of Birth"><input type="date" style={S.inp()} value={epsFallback.dob} onChange={e => setEpsFallback(s => ({ ...s, dob: e.target.value }))} /></Fld>
              <Fld label="Address"><input style={S.inp()} value={epsFallback.address} onChange={e => setEpsFallback(s => ({ ...s, address: e.target.value }))} /></Fld>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                if (!statutory.nominee_name || !statutory.nominee_dob || !statutory.nominee_address) {
                  showToast('Please fill all required PF nominee fields', 'err'); return
                }
                await saveStep(7, { ...statutory, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 8: ESIC & FAMILY (only when ESIC applicable) ═══ */}
        {step === 7 && esicApplicable && (
          <div style={S.card}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>ESIC &amp; Family</div>

            {/* ── Family Insurance ─────────────────────────────────── */}
            <div style={{ fontSize: 12, fontWeight: 600, color: P, margin: '18px 0 4px' }}>
              Family Insurance Details{esicApplicable && <span style={{ fontSize: 11, color: '#4338CA', fontWeight: 500 }}> · also used for ESIC Form 1</span>}
            </div>
            <div style={{ fontSize: 11, color: TK.faint, marginBottom: 10 }}>For Group Mediclaim{esicApplicable ? ' and the ESIC e-Pehchan card' : ''}. Ages auto-calculate from date of birth.</div>

            {personal.marital_status === 'Married' && (
              <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 8 }}>Spouse{insurance.spouse_dob ? ` · Age ${ageFromDob(insurance.spouse_dob)}` : ''}</div>
                <div style={S.g3}>
                  <Fld label="Spouse Name"><input style={S.inp()} value={insurance.spouse_name} onChange={e => setInsurance(s => ({ ...s, spouse_name: e.target.value }))} /></Fld>
                  <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.spouse_dob} onChange={e => setInsurance(s => ({ ...s, spouse_dob: e.target.value }))} /></Fld>
                  <Fld label="Residing with you?"><select style={S.sel} value={insurance.spouse_residing} onChange={e => setInsurance(s => ({ ...s, spouse_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
                </div>
              </div>
            )}
            <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 8 }}>Father{insurance.father_dob ? ` · Age ${ageFromDob(insurance.father_dob)}` : ''}</div>
              <div style={S.g3}>
                <Fld label="Father's Name"><input style={S.inp()} value={insurance.father_name} onChange={e => setInsurance(s => ({ ...s, father_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.father_dob} onChange={e => setInsurance(s => ({ ...s, father_dob: e.target.value }))} /></Fld>
                <Fld label="Residing with you?"><select style={S.sel} value={insurance.father_residing} onChange={e => setInsurance(s => ({ ...s, father_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
              </div>
            </div>
            <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 8 }}>Mother{insurance.mother_dob ? ` · Age ${ageFromDob(insurance.mother_dob)}` : ''}</div>
              <div style={S.g3}>
                <Fld label="Mother's Name"><input style={S.inp()} value={insurance.mother_name} onChange={e => setInsurance(s => ({ ...s, mother_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.mother_dob} onChange={e => setInsurance(s => ({ ...s, mother_dob: e.target.value }))} /></Fld>
                <Fld label="Residing with you?"><select style={S.sel} value={insurance.mother_residing} onChange={e => setInsurance(s => ({ ...s, mother_residing: e.target.value }))}><option>Yes</option><option>No</option></select></Fld>
              </div>
            </div>
            <div style={S.g2}>
              <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 8 }}>Child 1{insurance.kid1_dob ? ` · Age ${ageFromDob(insurance.kid1_dob)}` : ''}</div>
                <Fld label="Name"><input style={S.inp()} value={insurance.kid1_name} onChange={e => setInsurance(s => ({ ...s, kid1_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.kid1_dob} onChange={e => setInsurance(s => ({ ...s, kid1_dob: e.target.value }))} /></Fld>
              </div>
              <div style={{ border: '1px solid #EDE9FE', borderRadius: 10, padding: '12px 14px', marginBottom: 10, background: '#FCFBFF' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: P, marginBottom: 8 }}>Child 2{insurance.kid2_dob ? ` · Age ${ageFromDob(insurance.kid2_dob)}` : ''}</div>
                <Fld label="Name"><input style={S.inp()} value={insurance.kid2_name} onChange={e => setInsurance(s => ({ ...s, kid2_name: e.target.value }))} /></Fld>
                <Fld label="Date of Birth"><input type="date" style={S.inp()} value={insurance.kid2_dob} onChange={e => setInsurance(s => ({ ...s, kid2_dob: e.target.value }))} /></Fld>
              </div>
            </div>

            {/* ── ESIC details (only when applicable) ──────────────── */}
            {esicApplicable && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#4338CA', margin: '14px 0 4px' }}>ESIC Details (Form 1)</div>
                <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#3730A3' }}>
                  Your gross salary is within the ESIC limit (≤ ₹21,000/month), so ESIC Form 1 will be generated and your family photo attached for the e-Pehchan card.
                </div>
                <div style={S.g2}>
                  <Fld label="Previous ESIC IP Number (if any)" hint="10-digit number from a previous employer / e-Pehchan card"><input style={S.inp()} value={esic.prev_ip} onChange={e => setEsic(s => ({ ...s, prev_ip: e.target.value }))} maxLength={10} /></Fld>
                  <Fld label="Preferred ESIC Dispensary / IMP" hint="Nearest ESIC dispensary to your residence"><input style={S.inp()} value={esic.dispensary} onChange={e => setEsic(s => ({ ...s, dispensary: e.target.value }))} /></Fld>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={async () => {
                await saveStep(7, { ...statutory, gross_monthly: grossMonthly, esic_applicable: esicApplicable, esic_details: esic, insurance, eps_family: epsFamily, eps_fallback: epsFallback })
                nextStep()
              }} style={{ ...S.btnP, flex: 1 }}>Save & Continue →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 10: FORMS REVIEW & DECLARATION ════════════════ */}
        {step === 9 && (
          <div>
            {/* Phase 8 — read-only statutory form previews */}
            <StatutoryFormsPreview personal={personal} contact={contact} statutory={statutory} insurance={insurance} esic={esic} candidate={c} esicApplicable={esicApplicable} isForeign={isForeign} epsFamily={epsFamily} epsFallback={epsFallback} />
            {/* Summary */}
            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>Review & Declaration</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                {[
                  { l: 'Name', v: personal.full_name || c.full_name },
                  { l: 'DOB', v: personal.dob || '—' },
                  { l: 'Mobile', v: contact.mobile || c.mobile },
                  { l: 'Email', v: contact.personal_email || c.email },
                  { l: 'PAN', v: statutory.pan_number || '—' },
                  { l: 'Bank', v: statutory.bank_name ? `${statutory.bank_name} ...${statutory.bank_account?.slice(-4) || ''}` : '—' },
                  { l: 'PF Nominee', v: statutory.nominee_name || '—' },
                  { l: 'Documents', v: `${Object.keys(docs).length} uploaded` },
                ].map(({ l, v }) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: TK.sunken, borderRadius: 7, border: '1px solid #EDE9FE' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: TK.muted }}>{l}</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: TK.ink }}>{v}</span>
                  </div>
                ))}
              </div>

              {/* Declaration */}
              <div style={{ background: TK.brandTint, borderRadius: 10, padding: '14px 16px', marginBottom: 14, fontSize: 12, color: TK.brandDeep, lineHeight: 1.8 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Declaration</div>
                I hereby declare that all information provided by me in this form is true, correct, and complete to the best of my knowledge and belief. I understand that any false or misleading information may lead to withdrawal of the offer or termination of employment. I agree to abide by all company policies and rules. I consent to background verification of my credentials.
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, lineHeight: 1.6, userSelect: 'none' }}>
                <input type="checkbox" checked={declaration} onChange={e => setDeclaration(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, cursor: 'pointer' }} />
                <span>I have read and accept the above declaration. I confirm all details are accurate and I agree to the company's terms and conditions.</span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={prevStep} style={S.btnO}>Back</button>
              <button onClick={nextStep} disabled={!declaration}
                style={{ ...S.btnP, flex: 1, padding: 12, fontSize: 15, background: declaration ? P : TK.faint, cursor: !declaration ? 'not-allowed' : 'pointer' }}>
                Continue to Policies →
              </button>
            </div>
          </div>
        )}

        {step === 10 && (
          docsDeferred && !docsComplete ? (
            <div style={S.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Upload Pending Documents</div>
              <div style={{ fontSize: 12, color: TK.warning, background: TK.warningTint, border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>You skipped document upload earlier. Please upload all required documents before acknowledging the company policies — this step cannot be skipped.
              </div>
              <DocsGrid docs={docs} token={token} esicApplicable={esicApplicable} isFresher={emergency.is_fresher} isForeign={isForeign} onUploaded={onDocUploaded} />
              <button onClick={prevStep} style={{ ...S.btnO, marginTop: 8 }}>Back</button>
            </div>
          ) : (
            <PolicyAckPhase token={token} onBack={prevStep} onNext={nextStep} />
          )
        )}

        {step === 11 && (
          <AckPreviewPhase token={token} onBack={prevStep} onNext={nextStep} />
        )}

        {step === 12 && (
          <ESignPhase token={token} onBack={prevStep} onSubmit={handleSubmit} submitting={submitting} />
        )}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
