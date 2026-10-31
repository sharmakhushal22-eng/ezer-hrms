'use client'
// components/letters/LettersStudio.tsx — People → Letters.
//
//   Pending letters   joiners whose employee code is generated and whose Letter of Appointment
//                     has not gone out: Send opens the auto-filled appointment letter
//                     (components/onboarding/AppointmentLetterModal).
//   Send letters      any of the twenty letters (lib/letters/catalog.ts) to any employee: pick
//                     the letter, find the employee by code or name, the form fills in from their
//                     record (lib/letters/facts.ts) and asks for what the record lacks; Preview
//                     draws the PDF, Download saves it, Send stores it, mails it to the
//                     employee's registered address and — for the letters the spec shows in ESS —
//                     puts it in their ESS. Every route is app/api/letters/studio.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C, W, E, Z } from '@/lib/ui'
import { LETTERS, LETTER_BY_CODE, STAGE_ORDER, missingFields, type LetterDef, type LetterField, type Values } from '@/lib/letters/catalog'
import AppointmentLetterModal from '@/components/onboarding/AppointmentLetterModal'

type Emp = { id: string; emp_code: string | null; full_name: string; designation: string | null; status?: string | null; company?: string | null; email?: string | null }
type Pending = { id: string; full_name: string; employee_code: string | null; designation: string | null; date_of_joining: string | null; email: string | null }
type Recent = { id: string; letter_name: string | null; letter_type?: string | null; doc_id?: string | null; letter_date: string; generated_at: string; emailed_at: string | null; published_to_ess_at: string | null; sent_to?: string | null; generated_by_name?: string | null; employees?: { full_name: string; emp_code: string | null } | null }

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) }, cache: 'no-store' })
  return r
}
const day = (d?: string | null) => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')

// ── shared looks ────────────────────────────────────────────────────────────
const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, boxShadow: E.raised }
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: W.semi, color: C.muted, marginBottom: 5 }
const input: React.CSSProperties = { width: '100%', height: 40, padding: '0 12px', borderRadius: 11, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }
const btn = (kind: 'primary' | 'ghost' | 'soft' = 'ghost'): React.CSSProperties => ({
  height: 40, padding: '0 16px', borderRadius: 11, cursor: 'pointer', fontSize: 13, fontWeight: W.semi, fontFamily: 'inherit', whiteSpace: 'nowrap',
  display: 'inline-flex', alignItems: 'center', gap: 7,
  border: `1px solid ${kind === 'primary' ? C.brandDeep : kind === 'soft' ? C.brandEdge : C.lineStrong}`,
  background: kind === 'primary' ? `linear-gradient(180deg, ${C.brand}, ${C.brandDeep})` : kind === 'soft' ? C.brandTint : C.surface,
  color: kind === 'primary' ? C.onAccent : kind === 'soft' ? C.brand : C.ink, boxShadow: kind === 'primary' ? E.brand : E.flat,
})
const STAGE_TONE: Record<string, string> = { 'Pre-joining': C.info, Onboarding: C.brand, Employment: C.positive, Compensation: C.positive, Disciplinary: C.critical, Exit: C.warning }

function Step({ n, title, done, children, right }: { n: number; title: string; done?: boolean; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ width: 26, height: 26, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: W.bold, flexShrink: 0,
          background: done ? C.positive : C.brandTint, color: done ? C.onAccent : C.brand, border: `1px solid ${done ? C.positive : C.brandEdge}` }}>{done ? '✓' : n}</span>
        <span style={{ fontSize: 14.5, fontWeight: W.bold, color: C.ink, flex: 1 }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

/** The letter picker: a search box over the twenty letters, grouped by stage. */
function LetterPicker({ value, onPick }: { value: LetterDef | null; onPick: (d: LetterDef) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [])
  const hits = LETTERS.filter(l => !q.trim() || `${l.name} ${l.code} ${l.stage} ${l.about}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input style={{ ...input, height: 44, paddingLeft: 38 }} placeholder={value ? `${value.name} · change…` : 'Search a letter: appointment, increment, relieving…'} value={q}
        onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }} aria-label="Letter type" />
      <span aria-hidden style={{ position: 'absolute', left: 13, top: 12, color: C.faint, fontSize: 15 }}>⌕</span>
      {open && (
        <div style={{ position: 'absolute', top: 48, left: 0, right: 0, maxHeight: 380, overflowY: 'auto', ...card, boxShadow: E.overlay, padding: 6, zIndex: Z.sticky }}>
          {hits.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.muted }}>No letter matches “{q}”.</div>}
          {STAGE_ORDER.map(stage => {
            const list = hits.filter(h => h.stage === stage)
            if (!list.length) return null
            return (
              <div key={stage}>
                <div style={{ padding: '8px 10px 4px', fontSize: 10.5, fontWeight: W.bold, letterSpacing: '.1em', textTransform: 'uppercase', color: STAGE_TONE[stage] }}>{stage}</div>
                {list.map(l => (
                  <button key={l.code} type="button" onClick={() => { onPick(l); setQ(''); setOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      background: value?.code === l.code ? C.brandTint : 'transparent' }}>
                    <span style={{ fontSize: 10.5, fontWeight: W.bold, color: C.brand, background: C.brandTint, border: `1px solid ${C.brandEdge}`, borderRadius: 7, padding: '3px 6px', minWidth: 34, textAlign: 'center' }}>{l.code}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: W.semi, color: C.ink }}>{l.name}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.about}</span>
                    </span>
                    {!l.ess && <span style={{ fontSize: 10.5, fontWeight: W.semi, color: C.warning, background: C.warningTint, borderRadius: 99, padding: '2px 8px', whiteSpace: 'nowrap' }}>Not in ESS</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Find an employee by code or name. */
function EmployeePicker({ value, onPick }: { value: Emp | null; onPick: (e: Emp) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Emp[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [])
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      const r = await api(`/api/letters/studio?search=${encodeURIComponent(q.trim())}`)
      const j = await r.json().catch(() => ({}))
      setHits(j.employees || []); setOpen(true)
    }, 220)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input style={{ ...input, height: 44, paddingLeft: 38 }} placeholder={value ? `${value.emp_code} · ${value.full_name} · change…` : 'Employee code or name'} value={q}
        onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} aria-label="Employee" />
      <span aria-hidden style={{ position: 'absolute', left: 13, top: 12, color: C.faint, fontSize: 15 }}>⌕</span>
      {open && hits.length > 0 && (
        <div style={{ position: 'absolute', top: 48, left: 0, right: 0, maxHeight: 320, overflowY: 'auto', ...card, boxShadow: E.overlay, padding: 6, zIndex: Z.sticky }}>
          {hits.map(h => (
            <button key={h.id} type="button" onClick={() => { onPick(h); setQ(''); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'transparent', fontFamily: 'inherit' }}>
              <span style={{ width: 32, height: 32, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: W.bold, background: C.brandTint, color: C.brand, flexShrink: 0 }}>{initials(h.full_name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: W.semi, color: C.ink }}>{h.full_name} <span style={{ color: C.muted, fontWeight: W.medium }}>· {h.emp_code}</span></span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{[h.designation, h.company].filter(Boolean).join(' · ') || '-'}</span>
              </span>
              {h.status && h.status !== 'Active' && <span style={{ fontSize: 10.5, fontWeight: W.semi, color: C.muted, background: C.sunken, borderRadius: 99, padding: '2px 8px' }}>{h.status}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldInput({ f, value, fromRecord, onChange }: { f: LetterField; value: string; fromRecord: boolean; onChange: (v: string) => void }) {
  const missing = f.required && !value.trim()
  const style: React.CSSProperties = { ...input, ...(f.type === 'textarea' ? { height: 'auto', minHeight: 80, padding: '9px 12px', lineHeight: 1.5, resize: 'vertical' } : {}),
    ...(missing ? { borderColor: C.critical, background: C.criticalTint } : {}) }
  return (
    <div style={{ gridColumn: f.wide ? '1 / -1' : undefined }}>
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{f.label}{f.required ? ' *' : ''}</span>
        {fromRecord && <span style={{ fontSize: 10, fontWeight: W.semi, color: C.positive, background: C.positiveTint, borderRadius: 99, padding: '1px 7px' }}>from record</span>}
      </label>
      {f.type === 'textarea' ? <textarea style={style} value={value} placeholder={f.hint} onChange={e => onChange(e.target.value)} />
        : f.type === 'select' ? <select style={style} value={value} onChange={e => onChange(e.target.value)}><option value="">Select…</option>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>
        : <input style={style} type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'money' || f.type === 'number' ? 'numeric' : undefined} value={value} placeholder={f.hint} onChange={e => onChange(e.target.value)} />}
      {f.hint && f.type !== 'textarea' && f.type !== 'text' && <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{f.hint}</div>}
    </div>
  )
}

export default function LettersStudio() {
  const [tab, setTab] = useState<'pending' | 'send'>('pending')
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const [apptFor, setApptFor] = useState<{ id: string; name: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null)

  // Send letters state
  const [def, setDef] = useState<LetterDef | null>(null)
  const [emp, setEmp] = useState<Emp | null>(null)
  const [record, setRecord] = useState<Values>({})
  const [vals, setVals] = useState<Values>({})
  const [onboardingId, setOnboardingId] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [loadingEmp, setLoadingEmp] = useState(false)
  const [busy, setBusy] = useState<'' | 'preview' | 'send'>('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfName, setPdfName] = useState('')
  const [err, setErr] = useState('')
  const urlRef = useRef('')

  const loadLists = useCallback(async () => {
    const [p, r] = await Promise.all([api('/api/letters/studio?pending=1'), api('/api/letters/studio?recent=1')])
    const pj = await p.json().catch(() => ({})), rj = await r.json().catch(() => ({}))
    setPending(p.ok ? (pj.items || []) : []); setRecent(r.ok ? (rj.items || []) : [])
    if (!p.ok) setErr(pj.error || 'Could not load the letters.')
  }, [])
  useEffect(() => { void loadLists() }, [loadLists])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  // The employee's details whenever the employee changes.
  useEffect(() => {
    if (!emp) return
    let alive = true
    setLoadingEmp(true); setErr('')
    ;(async () => {
      const r = await api(`/api/letters/studio?employee_id=${encodeURIComponent(emp.id)}`)
      const j = await r.json().catch(() => ({}))
      if (!alive) return
      if (!r.ok) { setErr(j.error || 'Could not load the employee.'); setLoadingEmp(false); return }
      setRecord(j.values || {}); setVals(j.values || {}); setTo(j.employee?.email || ''); setOnboardingId(j.onboarding_id || null); setLoadingEmp(false)
    })()
    return () => { alive = false }
  }, [emp])
  // A new letter or employee invalidates the preview.
  useEffect(() => { setPdfUrl(''); setPdfName('') }, [def, emp])

  const missing = useMemo(() => def ? missingFields(def, vals) : [], [def, vals])
  const ready = !!def && !!emp && !loadingEmp && missing.length === 0

  const notify = (msg: string, tone: 'ok' | 'err' = 'ok') => { setToast({ msg, tone }); setTimeout(() => setToast(null), 5000) }

  const preview = async () => {
    if (!def || !emp) return
    setBusy('preview'); setErr('')
    try {
      const r = await api('/api/letters/studio', { method: 'POST', body: JSON.stringify({ action: 'preview', type: def.code, employee_id: emp.id, values: vals }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not draw the letter.')
      const name = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')?.[1] || `${def.code}.pdf`
      const url = URL.createObjectURL(await r.blob())
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url; setPdfUrl(url); setPdfName(name)
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }
  const download = () => {
    if (!pdfUrl) return
    const a = document.createElement('a'); a.href = pdfUrl; a.download = pdfName || 'letter.pdf'; document.body.appendChild(a); a.click(); a.remove()
  }
  const send = async () => {
    if (!def || !emp) return
    if (!window.confirm(`Send the ${def.name} to ${emp.full_name} at ${to || 'their registered email'}?${def.ess ? ' It will also appear in their ESS.' : ''}`)) return
    setBusy('send'); setErr('')
    try {
      const r = await api('/api/letters/studio', { method: 'POST', body: JSON.stringify({ action: 'send', type: def.code, employee_id: emp.id, values: vals, to }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Could not send the letter.')
      notify(j.emailed ? `${def.name} (${j.doc_id}) sent to ${j.sent_to}${j.ess ? ' and saved in their ESS' : ''}.` : `${def.name} (${j.doc_id}) saved${j.ess ? ' to their ESS' : ''}, but the email did not go: ${j.mail_error}.`, j.emailed ? 'ok' : 'err')
      void loadLists()
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }

  const sentThisMonth = recent.filter(r => String(r.generated_at || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length

  return (
    <div style={{ background: C.canvas, minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: C.ink }}>
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '22px 22px 64px', boxSizing: 'border-box' }}>
        {/* Hero */}
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: '22px 24px', marginBottom: 18,
          background: `radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, ${C.brand} 20%, transparent) 0%, transparent 55%), linear-gradient(135deg, color-mix(in srgb, ${C.brand} 9%, ${C.surface}), ${C.surface})`,
          border: `1px solid color-mix(in srgb, ${C.brand} 22%, ${C.line})`, boxShadow: E.raised }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span aria-hidden style={{ width: 54, height: 54, borderRadius: 17, display: 'grid', placeItems: 'center', fontSize: 24, color: C.onAccent, background: `linear-gradient(140deg, ${C.brand}, ${C.brandDeep})`, boxShadow: E.brand }}>✉</span>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: W.bold, letterSpacing: '.14em', textTransform: 'uppercase', color: C.brand }}>People</div>
              <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-.02em', lineHeight: 1.15 }}>Letters</div>
              <div style={{ fontSize: 13.5, color: C.inkSoft, marginTop: 2 }}>Issue any of the {LETTERS.length} HR letters on the company letterhead: filled from the employee record, mailed to them and saved in their ESS.</div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[[String(pending?.length ?? '…'), 'appointment letters pending', C.warning], [String(sentThisMonth), 'letters sent this month', C.positive]].map(([n, l, tone]) => (
                <div key={l} style={{ ...card, boxShadow: E.flat, padding: '10px 16px', minWidth: 130 }}>
                  <div style={{ fontSize: 22, fontWeight: W.bold, color: tone }}>{n}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div role="tablist" style={{ display: 'flex', gap: 4, marginTop: 18, padding: 5, borderRadius: 14, background: `color-mix(in srgb, ${C.sunken} 80%, transparent)`, border: `1px solid ${C.line}`, width: 'max-content', maxWidth: '100%' }}>
            {([['pending', 'Pending letters', pending?.length || 0], ['send', 'Send letters', 0]] as const).map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                style={{ height: 38, padding: '0 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: W.semi, display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: tab === k ? C.surface : 'transparent', color: tab === k ? C.ink : C.muted, boxShadow: tab === k ? E.raised : 'none' }}>
                {l}{n > 0 && <span style={{ fontSize: 11, fontWeight: W.bold, padding: '2px 7px', borderRadius: 99, background: C.warning, color: C.onAccent }}>{n}</span>}
              </button>
            ))}
          </div>
        </div>

        {toast && <div role="status" style={{ marginBottom: 14, padding: '11px 14px', borderRadius: 12, fontSize: 13, background: toast.tone === 'ok' ? C.positiveTint : C.criticalTint, border: `1px solid ${toast.tone === 'ok' ? C.positiveEdge : C.criticalEdge}`, color: C.ink }}>{toast.msg}</div>}

        {tab === 'pending' && (
          <div style={{ ...card, padding: '18px 20px' }}>
            <div style={{ fontSize: 15.5, fontWeight: W.bold }}>Appointment letters to send</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, marginBottom: 14 }}>Joiners whose employee code is generated. The letter opens filled in from their record, the MRF and the offer; edit anything, then send it to their email and ESS.</div>
            {pending === null ? <div style={{ color: C.faint, fontSize: 13 }}>Loading…</div>
              : pending.length === 0 ? <div style={{ textAlign: 'center', padding: '34px 10px', color: C.muted, fontSize: 13 }}><div style={{ fontSize: 28 }}>✓</div>Nobody is waiting: every coded joiner has their appointment letter.</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(330px, 100%), 1fr))', gap: 12 }}>
                {pending.map(p => (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px', borderRadius: 16, border: `1px solid ${C.line}`, borderTop: `3px solid ${C.warning}`, background: `linear-gradient(180deg, color-mix(in srgb, ${C.warning} 5%, ${C.surface}), ${C.surface} 50%)` }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ width: 42, height: 42, borderRadius: 99, display: 'grid', placeItems: 'center', fontWeight: W.bold, background: C.brandTint, color: C.brand }}>{initials(p.full_name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: W.bold }}>{p.full_name} <span style={{ color: C.muted, fontWeight: W.medium }}>· {p.employee_code}</span></div>
                        <div style={{ fontSize: 12, color: C.muted }}>{p.designation || 'No designation'} · {p.date_of_joining ? `Joins ${day(p.date_of_joining)}` : 'No joining date'}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: C.inkSoft }}>{p.email || 'No email on record'}</div>
                    <button style={{ ...btn('primary'), justifyContent: 'center' }} onClick={() => setApptFor({ id: p.id, name: p.full_name })}>✉ Send appointment letter</button>
                  </div>
                ))}
              </div>}
          </div>
        )}

        {tab === 'send' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(460px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 14 }}>
              <Step n={1} title="Letter" done={!!def} right={def && <span style={{ fontSize: 11, fontWeight: W.semi, color: def.ess ? C.positive : C.warning, background: def.ess ? C.positiveTint : C.warningTint, borderRadius: 99, padding: '3px 9px' }}>{def.ess ? 'Goes to ESS' : 'Not in ESS'}</span>}>
                <LetterPicker value={def} onPick={d => setDef(d)} />
                {def && <div style={{ marginTop: 10, fontSize: 12.5, color: C.inkSoft }}><b style={{ color: C.ink }}>{def.name}</b> · {def.about}</div>}
              </Step>
              <Step n={2} title="Employee" done={!!emp}>
                <EmployeePicker value={emp} onPick={e => setEmp(e)} />
                {emp && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '10px 12px', borderRadius: 12, background: C.sunken, border: `1px solid ${C.line}` }}>
                  <span style={{ width: 34, height: 34, borderRadius: 99, display: 'grid', placeItems: 'center', fontWeight: W.bold, fontSize: 12, background: C.brandTint, color: C.brand }}>{initials(emp.full_name)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontWeight: W.semi, fontSize: 13 }}>{emp.full_name} · {emp.emp_code}</div><div style={{ fontSize: 11.5, color: C.muted }}>{[emp.designation, emp.company].filter(Boolean).join(' · ')}</div></div>
                </div>}
              </Step>
              <Step n={3} title="Details" done={ready} right={def && emp && !loadingEmp && <span style={{ fontSize: 11.5, color: missing.length ? C.critical : C.positive, fontWeight: W.semi }}>{missing.length ? `${missing.length} to fill` : 'All filled'}</span>}>
                {!def || !emp ? <div style={{ fontSize: 12.5, color: C.faint }}>Pick the letter and the employee: everything their record holds fills in here.</div>
                  : loadingEmp ? <div style={{ fontSize: 12.5, color: C.faint }}>Reading {emp.full_name}’s record…</div>
                  : <>
                    {def.code === 'APT' && onboardingId && (
                      <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 12, background: C.brandTint, border: `1px solid ${C.brandEdge}`, fontSize: 12.5, color: C.ink, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ flex: 1, minWidth: 200 }}>{emp.full_name} joined through onboarding: the full appointment letter (with the CTC annexure from their offer) is available.</span>
                        <button style={btn('soft')} onClick={() => setApptFor({ id: onboardingId, name: emp.full_name })}>Open the full letter</button>
                      </div>
                    )}
                    {missing.length > 0 && <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 12, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, fontSize: 12.5 }}><b>Not on record:</b> {missing.join(', ')}. Fill {missing.length === 1 ? 'it' : 'them'} in (outlined in red).</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(210px, 100%), 1fr))', gap: 12 }}>
                      {def.fields.map(f => <FieldInput key={f.key} f={f} value={vals[f.key] || ''} fromRecord={!!record[f.key] && vals[f.key] === record[f.key]} onChange={v => setVals(s => ({ ...s, [f.key]: v }))} />)}
                    </div>
                    <div style={{ marginTop: 14 }}>
                      <label style={label}>Send to (registered email)</label>
                      <input style={{ ...input, ...(to.trim() ? {} : { borderColor: C.critical, background: C.criticalTint }) }} value={to} onChange={e => setTo(e.target.value)} placeholder="employee@company.com" />
                    </div>
                  </>}
              </Step>
              {err && <div style={{ padding: '10px 12px', borderRadius: 12, background: C.criticalTint, border: `1px solid ${C.criticalEdge}`, fontSize: 13 }}>{err}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button style={{ ...btn('soft'), opacity: ready && !busy ? 1 : .55 }} disabled={!ready || !!busy} onClick={preview}>{busy === 'preview' ? 'Drawing…' : '👁 Preview'}</button>
                <button style={{ ...btn(), opacity: pdfUrl && !busy ? 1 : .55 }} disabled={!pdfUrl || !!busy} onClick={download}>⬇ Download</button>
                <button style={{ ...btn('primary'), opacity: ready && to.trim() && !busy ? 1 : .55, marginLeft: 'auto' }} disabled={!ready || !to.trim() || !!busy} onClick={send}>{busy === 'send' ? 'Sending…' : '✉ Send letter'}</button>
              </div>
            </div>

            <div style={{ ...card, padding: 12, position: 'sticky', top: 12, minHeight: 520, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 10px' }}>
                <span style={{ fontSize: 14, fontWeight: W.bold, flex: 1 }}>Preview</span>
                {pdfName && <span style={{ fontSize: 11.5, color: C.muted }}>{pdfName.replace(/\.pdf$/, '')}</span>}
              </div>
              {pdfUrl ? <iframe title="Letter preview" src={pdfUrl} style={{ flex: 1, width: '100%', minHeight: 640, border: `1px solid ${C.line}`, borderRadius: 12, background: C.sunken }} />
                : <div style={{ flex: 1, display: 'grid', placeItems: 'center', borderRadius: 12, border: `1px dashed ${C.lineStrong}`, background: C.sunken, color: C.muted, textAlign: 'center', padding: 24 }}>
                  <div><div style={{ fontSize: 34, opacity: .5 }}>📄</div><div style={{ fontSize: 13.5, fontWeight: W.semi, color: C.inkSoft, marginTop: 6 }}>The letter appears here</div><div style={{ fontSize: 12, marginTop: 3 }}>Pick a letter and an employee, then press Preview.</div></div>
                </div>}
            </div>

            <div style={{ ...card, padding: '16px 18px', gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 15, fontWeight: W.bold, marginBottom: 10 }}>Recently issued</div>
              {recent.length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>No letters issued yet.</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr>{['Document', 'Letter', 'Employee', 'Issued', 'ESS', 'Mailed to', 'By'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: C.muted, fontWeight: W.semi, borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                    <tbody>{recent.map(r => (
                      <tr key={r.id}>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}`, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, whiteSpace: 'nowrap' }}>{r.doc_id || '-'}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}`, fontWeight: W.semi }}>{r.letter_name || (r.letter_type ? LETTER_BY_CODE[r.letter_type]?.name : 'Letter')}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}` }}>{r.employees ? `${r.employees.full_name} · ${r.employees.emp_code || ''}` : '-'}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}`, whiteSpace: 'nowrap' }}>{day(r.letter_date || r.generated_at)}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}` }}>{r.published_to_ess_at ? <span style={{ color: C.positive, fontWeight: W.semi }}>Yes</span> : <span style={{ color: C.muted }}>No</span>}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}`, color: r.emailed_at ? C.ink : C.critical }}>{r.emailed_at ? (r.sent_to || 'Sent') : 'Not mailed'}</td>
                        <td style={{ padding: '9px 10px', borderBottom: `1px solid ${C.line}`, color: C.muted }}>{r.generated_by_name || '-'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {apptFor && <AppointmentLetterModal onboardingId={apptFor.id} name={apptFor.name} onClose={() => setApptFor(null)}
        onDone={(m, t) => { notify(m, t === 'err' ? 'err' : 'ok'); setApptFor(null); void loadLists() }} />}
    </div>
  )
}
