'use client'
// components/esign/Composer.tsx — HR's "Send for signature" flow, four steps:
//
//   1 Document   upload the PDF, title it, pick a category, write the note signers see
//   2 Signers    specific people in order (employees from the directory or anyone by
//                e-mail), each with how they must prove identity — or a BULK send: one
//                copy per recipient (a policy everyone signs), with optional fixed co-signers
//   3 Place      click on a page to drop a box for the chosen signer: Signature, Initials,
//                Date or Name; drag to move, drag the corner to resize; "initials on every
//                page" in one click
//   4 Review     summary, CC, expiry → Send. Where a mail could not go out, the signing
//                links are shown to copy (they still need the signer's e-mail OTP).
//
// `prefill` lets another module open the composer with a PDF already attached (HR Letters).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { authHeaders } from '@/lib/auth-headers'
import { C, F, W, R, E, Z, IconClose, IconUpload, IconSearch, IconCheck, IconAlert, IconUser, IconMail } from '@/lib/ui'
import PdfPages, { loadPdf, useFitWidth } from './PdfPages'
import { Btn, Pill, font, numeric, IconPen } from './ui'
import { CATEGORIES } from '@/lib/esign/core'

type Kind = 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'
type Auth = 'EMAIL_OTP' | 'EMAIL_AADHAAR_OTP'
export interface SignerRow { key: string; name: string; email: string; employee_id?: string | null; designation?: string | null; role_label: string; auth_method: Auth; placeholder?: boolean }
interface FieldRow { key: string; signer: string; page: number; x: number; y: number; w: number; h: number; kind: Kind }
interface Emp { id: string; full_name: string; emp_code: string; designation: string | null; office_email: string | null; personal_email: string | null; dept?: string | null; loc?: string | null }

// Signer colours on the page. Fixed hues are needed to tell signers apart; they come from
// the token families so they repaint in dark mode.
const HUES = [
  { fg: C.brand, bg: C.brandTint }, { fg: C.positive, bg: C.positiveTint }, { fg: C.warning, bg: C.warningTint },
  { fg: C.critical, bg: C.criticalTint }, { fg: C.info, bg: C.infoTint },
]
const hue = (i: number) => HUES[i % HUES.length]
const SIZE: Record<Kind, { w: number; h: number }> = { SIGNATURE: { w: 0.3, h: 0.095 }, INITIALS: { w: 0.11, h: 0.055 }, DATE: { w: 0.17, h: 0.03 }, NAME: { w: 0.24, h: 0.03 } }
const KIND_LABEL: Record<Kind, string> = { SIGNATURE: 'Signature', INITIALS: 'Initials', DATE: 'Date signed', NAME: 'Full name' }
const uid = () => Math.random().toString(36).slice(2, 10)
const emailOf = (e: Emp) => e.office_email || e.personal_email || ''
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const lbl: React.CSSProperties = { display: 'block', fontSize: F.tiny, fontWeight: W.bold, color: C.muted, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: R.md, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.ink, fontSize: F.body, fontFamily: font, outline: 'none' }

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...(init?.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

function StepHead({ steps, step, onPick }: { steps: string[]; step: number; onPick: (i: number) => void }) {
  return (
    <ol style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const done = i < step, on = i === step
        return (
          <li key={s}>
            <button type="button" onClick={() => i < step && onPick(i)} disabled={i > step}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px 7px 8px', borderRadius: R.pill, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brandTint : C.surface, color: on ? C.brandDeep : done ? C.ink : C.faint, fontFamily: font, fontSize: F.small, fontWeight: W.semi, cursor: i < step ? 'pointer' : 'default' }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: done ? C.positive : on ? C.brand : C.sunken, color: done || on ? C.onAccent : C.muted, fontSize: F.tiny, fontWeight: W.bold }}>{done ? <IconCheck size={12} /> : i + 1}</span>{s}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function EmployeeSearch({ onPick, placeholder = 'Search employees by name, code or e-mail', exclude = [] }: { onPick: (e: Emp) => void; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Emp[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setHits([]); return }
    const h = setTimeout(async () => {
      const like = `%${t.replace(/[%_,()]/g, ' ')}%`
      const { data } = await supabase.from('employees')
        .select('id, full_name, emp_code, designation, office_email, personal_email, departments!employees_department_id_fkey(dept_name), locations!location_id(location_name)')
        .or(`full_name.ilike.${like},emp_code.ilike.${like},office_email.ilike.${like},personal_email.ilike.${like}`)
        .eq('employment_status', 'Active').limit(8)
      setHits((data || []).map((e: any) => ({ ...e, dept: e.departments?.dept_name, loc: e.locations?.location_name })))
      setOpen(true)
    }, 220)
    return () => clearTimeout(h)
  }, [q])
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 11, top: 11, color: C.faint }}><IconSearch size={15} /></span>
      <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} data-no-titlecase style={{ ...inp, paddingLeft: 34 }} />
      {open && hits.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: Z.navMenu, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, boxShadow: E.floating, maxHeight: 300, overflowY: 'auto' }}>
          {hits.map(e => {
            const taken = exclude.includes(e.id), mail = emailOf(e)
            return (
              <button key={e.id} type="button" disabled={taken || !mail} onMouseDown={ev => ev.preventDefault()} onClick={() => { onPick(e); setQ(''); setOpen(false) }}
                style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: '9px 12px', border: 'none', borderBottom: `1px solid ${C.line}`, background: 'transparent', cursor: taken || !mail ? 'not-allowed' : 'pointer', textAlign: 'left', fontFamily: font, opacity: taken || !mail ? 0.5 : 1 }}>
                <span style={{ width: 30, height: 30, borderRadius: 99, background: C.brandTint, color: C.brandDeep, display: 'grid', placeItems: 'center', fontSize: F.tiny, fontWeight: W.bold, flexShrink: 0 }}>{e.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: F.body, fontWeight: W.semi, color: C.ink }}>{e.full_name} <span style={{ color: C.faint, fontWeight: W.regular, ...numeric }}>{e.emp_code}</span></span>
                  <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[e.designation, e.dept, e.loc].filter(Boolean).join(' · ')}{mail ? ` · ${mail}` : ' · no e-mail on record'}</span>
                </span>
                {taken && <span style={{ fontSize: F.tiny, color: C.muted }}>added</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SignerCard({ s, i, total, sequential, onChange, onRemove, onMove }: {
  s: SignerRow; i: number; total: number; sequential: boolean
  onChange: (p: Partial<SignerRow>) => void; onRemove: () => void; onMove: (d: -1 | 1) => void
}) {
  const h = hue(i)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', gap: 12, alignItems: 'start', padding: 14, borderRadius: R.lg, border: `1px solid ${C.line}`, background: C.surface, borderLeft: `3px solid ${h.fg}` }}>
      <span style={{ width: 30, height: 30, borderRadius: 99, background: h.bg, color: h.fg, display: 'grid', placeItems: 'center', fontWeight: W.bold, fontSize: F.small, ...numeric }}>{sequential ? i + 1 : <IconUser size={14} />}</span>
      <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
        {s.placeholder ? (
          <div><div style={{ fontWeight: W.bold, color: C.ink }}>Each recipient</div><div style={{ fontSize: F.small, color: C.muted }}>Filled in with every person in the recipient list — one separate document each.</div></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <input value={s.name} onChange={e => onChange({ name: e.target.value })} placeholder="Full name" style={inp} />
            <input value={s.email} onChange={e => onChange({ email: e.target.value.trim() })} placeholder="E-mail" data-no-titlecase style={{ ...inp, borderColor: s.email && !emailRe.test(s.email) ? C.critical : C.lineStrong }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={s.role_label} onChange={e => onChange({ role_label: e.target.value })} placeholder="Role, e.g. Employee / HR Head" style={{ ...inp, width: 220, padding: '7px 10px', fontSize: F.small }} />
          <select value={s.auth_method} onChange={e => onChange({ auth_method: e.target.value as Auth })} style={{ ...inp, width: 'auto', padding: '7px 10px', fontSize: F.small }}>
            <option value="EMAIL_OTP">Verify by e-mail OTP</option>
            <option value="EMAIL_AADHAAR_OTP">E-mail OTP + Aadhaar OTP (demo)</option>
          </select>
          {s.employee_id && <Pill t="brand">Employee{s.designation ? ` · ${s.designation}` : ''}</Pill>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {sequential && <>
          <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => onMove(-1)} style={iconBtn(i === 0)}>↑</button>
          <button type="button" aria-label="Move down" disabled={i === total - 1} onClick={() => onMove(1)} style={iconBtn(i === total - 1)}>↓</button>
        </>}
        <button type="button" aria-label="Remove signer" onClick={onRemove} style={iconBtn(false)}><IconClose size={14} /></button>
      </div>
    </div>
  )
}
const iconBtn = (dis: boolean): React.CSSProperties => ({ width: 30, height: 30, borderRadius: R.sm, border: `1px solid ${C.line}`, background: C.surface, color: dis ? C.faint : C.inkSoft, cursor: dis ? 'default' : 'pointer', display: 'grid', placeItems: 'center', fontFamily: font })

/** A placed box on the page: drag body to move, drag the corner to resize, × to remove. */
function PlacedBox({ f, size, color, label, selected, onSelect, onChange, onRemove }: {
  f: FieldRow; size: { w: number; h: number }; color: { fg: string; bg: string }; label: string; selected: boolean
  onSelect: () => void; onChange: (p: Partial<FieldRow>) => void; onRemove: () => void
}) {
  const drag = useRef<{ mode: 'move' | 'size'; sx: number; sy: number; f: FieldRow } | null>(null)
  const start = (mode: 'move' | 'size') => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); onSelect()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, sx: e.clientX, sy: e.clientY, f }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const dx = (e.clientX - d.sx) / size.w, dy = (e.clientY - d.sy) / size.h
    if (d.mode === 'move') onChange({ x: Math.min(1 - d.f.w, Math.max(0, d.f.x + dx)), y: Math.min(1 - d.f.h, Math.max(0, d.f.y + dy)) })
    else onChange({ w: Math.min(1 - d.f.x, Math.max(0.05, d.f.w + dx)), h: Math.min(1 - d.f.y, Math.max(0.02, d.f.h + dy)) })
  }
  const end = () => { drag.current = null }
  return (
    <div onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onClick={e => e.stopPropagation()}
      style={{ position: 'absolute', left: f.x * size.w, top: f.y * size.h, width: f.w * size.w, height: f.h * size.h, background: color.bg, border: `1.5px solid ${color.fg}`, borderRadius: 4, cursor: 'move', boxShadow: selected ? `0 0 0 3px ${C.surface}, 0 0 0 4.5px ${color.fg}` : 'none', touchAction: 'none', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', overflow: 'hidden', fontFamily: font, opacity: 0.94 }}>
      {f.kind === 'SIGNATURE' && <IconPen size={12} color={color.fg} />}
      <span style={{ fontSize: Math.max(9, Math.min(12, f.h * size.h * 0.3)), fontWeight: W.bold, color: color.fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {selected && <button type="button" aria-label="Remove box" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove() }} style={{ position: 'absolute', top: -1, right: -1, width: 18, height: 18, border: 'none', borderRadius: '0 3px 0 4px', background: color.fg, color: C.onAccent, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}><IconClose size={11} /></button>}
      <span onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, cursor: 'nwse-resize', background: color.fg, borderRadius: '3px 0 3px 0' }} />
    </div>
  )
}

function Recipients({ list, setList }: { list: SignerRow[]; setList: (l: SignerRow[]) => void }) {
  const [paste, setPaste] = useState('')
  const [dept, setDept] = useState('')
  const [depts, setDepts] = useState<{ id: string; dept_name: string }[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => { supabase.from('departments').select('id, dept_name').order('dept_name').then(({ data }) => setDepts((data || []) as any)) }, [])
  const add = (rows: SignerRow[]) => {
    const seen = new Set(list.map(r => r.email.toLowerCase()))
    setList([...list, ...rows.filter(r => r.email && !seen.has(r.email.toLowerCase()) && (seen.add(r.email.toLowerCase()), true))])
  }
  const addDept = async () => {
    setLoading(true)
    let q = supabase.from('employees').select('id, full_name, designation, office_email, personal_email').eq('employment_status', 'Active').limit(1000)
    if (dept) q = q.eq('department_id', dept)
    const { data } = await q
    add((data || []).map((e: any) => ({ key: uid(), name: e.full_name, email: (e.office_email || e.personal_email || '').toLowerCase(), employee_id: e.id, designation: e.designation, role_label: 'Employee', auth_method: 'EMAIL_OTP' as Auth })))
    setLoading(false)
  }
  const addPaste = () => {
    const rows = paste.split(/\n+/).map(l => l.split(/[,\t;]/).map(x => x.trim())).filter(p => p.length >= 2 && emailRe.test(p[1]))
    add(rows.map(p => ({ key: uid(), name: p[0], email: p[1].toLowerCase(), role_label: 'Recipient', auth_method: 'EMAIL_OTP' as Auth })))
    setPaste('')
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div><label style={lbl}>Add one employee</label><EmployeeSearch exclude={list.map(r => r.employee_id || '')} onPick={e => add([{ key: uid(), name: e.full_name, email: emailOf(e).toLowerCase(), employee_id: e.id, designation: e.designation, role_label: 'Employee', auth_method: 'EMAIL_OTP' }])} /></div>
        <div><label style={lbl}>Add a whole department</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={dept} onChange={e => setDept(e.target.value)} style={{ ...inp, flex: 1 }}><option value="">All active employees</option>{depts.map(d => <option key={d.id} value={d.id}>{d.dept_name}</option>)}</select>
            <Btn kind="secondary" onClick={addDept} disabled={loading}>{loading ? 'Adding…' : 'Add'}</Btn>
          </div>
        </div>
      </div>
      <div><label style={lbl}>Or paste “name, e-mail” — one per line</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} placeholder={'Priya Sharma, priya@example.com\nRahul Verma, rahul@example.com'} data-no-titlecase style={{ ...inp, resize: 'vertical', flex: 1 }} />
          <Btn kind="secondary" onClick={addPaste} disabled={!paste.trim()}>Add</Btn>
        </div>
      </div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R.lg, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', background: C.sunken, fontSize: F.small, fontWeight: W.semi }}>
          <span style={numeric}>{list.length} recipient{list.length === 1 ? '' : 's'}</span>
          {list.length > 0 && <button type="button" onClick={() => setList([])} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: C.critical, cursor: 'pointer', fontFamily: font, fontSize: F.small, fontWeight: W.semi }}>Clear all</button>}
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {list.map(r => (
            <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 14px', borderTop: `1px solid ${C.line}`, fontSize: F.small }}>
              <span style={{ fontWeight: W.semi, color: C.ink }}>{r.name}</span><span style={{ color: C.muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.email}</span>
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setList(list.filter(x => x.key !== r.key))} style={{ ...iconBtn(false), width: 24, height: 24 }}><IconClose size={12} /></button>
            </div>
          ))}
          {!list.length && <div style={{ padding: 18, textAlign: 'center', color: C.faint, fontSize: F.small }}>Nobody yet. Each recipient gets their own copy to sign.</div>}
        </div>
      </div>
    </div>
  )
}

export interface ComposerPrefill { file?: File; title?: string; category?: string; signers?: Omit<SignerRow, 'key'>[]; source?: string; sourceRef?: string }

export default function Composer({ onClose, onSent, prefill }: { onClose: () => void; onSent: () => void; prefill?: ComposerPrefill }) {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [doc, setDoc] = useState<any>(null)
  const [title, setTitle] = useState(prefill?.title || '')
  const [category, setCategory] = useState(prefill?.category || 'GENERAL')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<'people' | 'bulk'>('people')
  const [order, setOrder] = useState<'SEQUENTIAL' | 'PARALLEL'>('SEQUENTIAL')
  const [signers, setSigners] = useState<SignerRow[]>((prefill?.signers || []).map(s => ({ ...s, key: uid() })))
  const [recipients, setRecipients] = useState<SignerRow[]>([])
  const [fields, setFields] = useState<FieldRow[]>([])
  const [active, setActive] = useState<string>('')
  const [tool, setTool] = useState<Kind>('SIGNATURE')
  const [sel, setSel] = useState<string | null>(null)
  const [expires, setExpires] = useState(14)
  const [cc, setCc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<any>(null)
  const { ref: viewRef, width } = useFitWidth(780, 8)

  const openFile = useCallback(async (f: File | undefined) => {
    setErr('')
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { setErr('Choose a PDF file.'); return }
    if (f.size > 25 * 1024 * 1024) { setErr('The PDF is larger than 25 MB.'); return }
    try {
      const d = await loadPdf(await f.arrayBuffer())
      setFile(f); setDoc(d); setFields([])
      if (!title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim())
    } catch (e: any) { setErr(/password/i.test(String(e?.message)) ? 'This PDF is password-protected. Remove the password and upload it again.' : 'This file could not be read as a PDF.') }
  }, [title])
  useEffect(() => { if (prefill?.file) openFile(prefill.file) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The signer list the fields are placed for (bulk: "each recipient" + fixed co-signers).
  const slots = useMemo(() => mode === 'bulk'
    ? [{ key: 'each', name: 'Each recipient', email: '', role_label: 'Recipient', auth_method: 'EMAIL_OTP' as Auth, placeholder: true }, ...signers.filter(s => !s.placeholder)]
    : signers.filter(s => !s.placeholder), [mode, signers])
  useEffect(() => { if (!slots.some(s => s.key === active)) setActive(slots[0]?.key || '') }, [slots, active])
  const [bulkMeta, setBulkMeta] = useState<{ role_label: string; auth_method: Auth }>({ role_label: 'Employee', auth_method: 'EMAIL_OTP' })

  const slotIndex = (k: string) => slots.findIndex(s => s.key === k)
  const addSigner = (p: Partial<SignerRow> = {}) => setSigners(l => [...l, { key: uid(), name: '', email: '', role_label: l.length ? 'Signatory' : 'Employee', auth_method: 'EMAIL_OTP', ...p }])
  const fixedSigners = signers.filter(s => !s.placeholder)

  const placeAt = (page: number, size: { w: number; h: number }, e: React.MouseEvent<HTMLDivElement>) => {
    if (!active) return
    const r = e.currentTarget.getBoundingClientRect()
    const s = SIZE[tool]
    const x = Math.min(1 - s.w, Math.max(0, (e.clientX - r.left) / size.w - s.w / 2))
    const y = Math.min(1 - s.h, Math.max(0, (e.clientY - r.top) / size.h - s.h / 2))
    const f = { key: uid(), signer: active, page, x, y, ...s, kind: tool }
    setFields(l => [...l, f]); setSel(f.key)
  }
  const everyPage = () => {
    if (!doc || !active) return
    const s = SIZE.INITIALS
    setFields(l => [...l, ...Array.from({ length: doc.numPages }, (_, i) => ({ key: uid(), signer: active, page: i + 1, x: 0.85, y: 0.92, ...s, kind: 'INITIALS' as Kind }))])
  }

  const overlay = (page: number, size: { w: number; h: number }) => (
    <div onClick={e => placeAt(page, size, e)} style={{ position: 'absolute', inset: 0, cursor: active ? 'copy' : 'default' }}>
      {fields.filter(f => f.page === page).map(f => {
        const i = slotIndex(f.signer), s = slots[i]
        return <PlacedBox key={f.key} f={f} size={size} color={hue(Math.max(0, i))} selected={sel === f.key} onSelect={() => setSel(f.key)}
          label={`${KIND_LABEL[f.kind]} · ${s?.placeholder ? 'Recipient' : (s?.name || `Signer ${i + 1}`).split(' ')[0]}`}
          onChange={p => setFields(l => l.map(x => x.key === f.key ? { ...x, ...p } : x))} onRemove={() => setFields(l => l.filter(x => x.key !== f.key))} />
      })}
    </div>
  )

  // Validation per step, so the Next button says exactly what is missing.
  const stepError = (i: number): string | null => {
    if (i === 0) { if (!file) return 'Upload the PDF.'; if (!title.trim()) return 'Give it a title.' }
    if (i === 1) {
      if (mode === 'people' && !fixedSigners.length) return 'Add at least one signer.'
      if (mode === 'bulk' && !recipients.length) return 'Add the recipients.'
      for (const s of fixedSigners) { if (!s.name.trim()) return 'Every signer needs a name.'; if (!emailRe.test(s.email)) return `${s.name || 'A signer'} needs a valid e-mail.` }
      const em = fixedSigners.map(s => s.email.toLowerCase())
      if (new Set(em).size !== em.length) return 'The same e-mail is on two signers.'
    }
    if (i === 2) for (const s of slots) if (!fields.some(f => f.signer === s.key && (f.kind === 'SIGNATURE' || f.kind === 'INITIALS'))) return `Place a signature box for ${s.placeholder ? 'the recipient' : s.name || 'every signer'}.`
    return null
  }
  const blocker = stepError(step)

  const send = async () => {
    setBusy(true); setErr('')
    try {
      const up = await api('/api/esign/upload-url', { method: 'POST' })
      const { error } = await supabase.storage.from('esign').uploadToSignedUrl(up.path, up.token, file!, { contentType: 'application/pdf' })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      const slotRows = slots.map(s => s.placeholder ? { placeholder: true, name: 'Recipient', email: 'recipient@placeholder.invalid', role_label: bulkMeta.role_label, auth_method: bulkMeta.auth_method } : { name: s.name.trim(), email: s.email.trim(), employee_id: s.employee_id || null, designation: s.designation || null, role_label: s.role_label, auth_method: s.auth_method })
      const j = await api('/api/esign/envelopes', { method: 'POST', body: JSON.stringify({
        uploadPath: up.path, originalName: file!.name, title: title.trim(), message: message.trim() || null, category,
        signingOrder: mode === 'bulk' ? 'SEQUENTIAL' : order, expiresDays: expires, ccEmails: cc.split(/[,\s]+/).filter(Boolean),
        signers: slotRows, fields: fields.map(f => ({ signer: slotIndex(f.signer), page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, kind: f.kind })),
        recipients: mode === 'bulk' ? recipients.map(r => ({ name: r.name, email: r.email, employee_id: r.employee_id || null, designation: r.designation || null, role_label: bulkMeta.role_label, auth_method: bulkMeta.auth_method })) : undefined,
        source: prefill?.source, sourceRef: prefill?.sourceRef,
      }) })
      setResult(j); onSent()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const STEPS = ['Document', 'Signers', 'Place fields', 'Review & send']
  const links = result ? result.envelopes.flatMap((e: any) => e.links || []) : []

  const ui = (
    <div role="dialog" aria-modal="true" aria-label="Send a document for signature" style={{ position: 'fixed', inset: 0, zIndex: Z.modal, background: C.canvas, display: 'flex', flexDirection: 'column', fontFamily: font, color: C.ink }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: `1px solid ${C.line}`, background: C.surface, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: R.md, background: C.brand, color: C.onAccent, display: 'grid', placeItems: 'center' }}><IconPen size={16} /></span>
          <div><div style={{ fontWeight: W.bold, fontSize: 15 }}>Send for signature</div><div style={{ fontSize: F.tiny, color: C.muted }}>{title || 'New document'}</div></div>
        </div>
        {!result && <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}><StepHead steps={STEPS} step={step} onPick={setStep} /></div>}
        <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', ...iconBtn(false), width: 34, height: 34 }}><IconClose size={16} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {result ? (
          <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }} className="ez-rise">
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.xl, boxShadow: E.raised, padding: 30, textAlign: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: 99, background: C.positiveTint, color: C.positive, display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><IconCheck size={28} /></div>
              <div style={{ fontSize: 21, fontWeight: W.bold }}>{result.envelopes.length > 1 ? `${result.envelopes.length} documents sent` : 'Sent for signature'}</div>
              <div style={{ color: C.muted, marginTop: 6, fontSize: F.body }}>{result.envelopes.length > 1 ? 'Each recipient has their own copy and link.' : `Envelope ${result.envelopes[0]?.envelope_no}`} You’ll see progress in E-Sign, and everyone gets the signed PDF when it completes.</div>
              {links.length > 0 && (
                <div style={{ marginTop: 20, textAlign: 'left', padding: 14, borderRadius: R.md, background: C.warningTint, border: `1px solid ${C.warningEdge}` }}>
                  <div style={{ fontWeight: W.bold, color: C.warning, fontSize: F.small, display: 'flex', gap: 6, alignItems: 'center' }}><IconAlert size={14} /> {links.length} invite e-mail{links.length === 1 ? '' : 's'} could not be sent — share these links instead</div>
                  <div style={{ fontSize: F.tiny, color: C.inkSoft, margin: '4px 0 10px' }}>Each still asks for an OTP to the signer’s e-mail, so passing it on does not let anyone else sign.</div>
                  {links.slice(0, 20).map((l: any) => (
                    <div key={l.link} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${C.warningEdge}`, fontSize: F.small }}>
                      <span style={{ fontWeight: W.semi, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name} · {l.email}</span>
                      <Btn kind="secondary" style={{ padding: '5px 10px', fontSize: F.tiny }} onClick={() => navigator.clipboard?.writeText(l.link)}>Copy link</Btn>
                      <a href={l.link} target="_blank" rel="noreferrer" style={{ color: C.brand, fontWeight: W.semi, fontSize: F.tiny }}>Open</a>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 22 }}><Btn onClick={onClose}>Done</Btn></div>
            </div>
          </div>
        ) : step === 0 ? (
          <div style={{ maxWidth: 880, margin: '28px auto', padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }} className="ez-rise">
            <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); openFile(e.dataTransfer.files[0]) }}
              style={{ display: 'grid', placeItems: 'center', minHeight: 300, borderRadius: R.xl, border: `1.5px dashed ${file ? C.positiveEdge : C.lineStrong}`, background: file ? C.positiveTint : C.surface, cursor: 'pointer', textAlign: 'center', padding: 20 }}>
              <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => openFile(e.target.files?.[0])} />
              {file ? <div><div style={{ color: C.positive, display: 'grid', placeItems: 'center', marginBottom: 10 }}><IconCheck size={30} /></div><div style={{ fontWeight: W.bold }}>{file.name}</div><div style={{ color: C.muted, fontSize: F.small, marginTop: 4, ...numeric }}>{doc?.numPages} page{doc?.numPages === 1 ? '' : 's'} · {(file.size / 1024 / 1024).toFixed(2)} MB</div><div style={{ color: C.brand, fontSize: F.small, fontWeight: W.semi, marginTop: 12 }}>Choose a different file</div></div>
                : <div><div style={{ width: 52, height: 52, borderRadius: R.lg, background: C.brandTint, color: C.brand, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><IconUpload size={24} /></div><div style={{ fontWeight: W.bold, fontSize: 16 }}>Drop the PDF here</div><div style={{ color: C.muted, fontSize: F.small, marginTop: 4 }}>or click to choose · up to 25 MB · not password-protected</div></div>}
            </label>
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <div><label style={lbl}>Title signers will see</label><input value={title} onChange={e => setTitle(e.target.value.slice(0, 160))} placeholder="e.g. Appointment letter — Priya Sharma" style={inp} /></div>
              <div><label style={lbl}>Category</label><select value={category} onChange={e => setCategory(e.target.value)} style={inp}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
              <div><label style={lbl}>Message to signers (optional)</label><textarea value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} rows={4} placeholder="Please review and sign your appointment letter by Friday." style={{ ...inp, resize: 'vertical' }} /></div>
            </div>
          </div>
        ) : step === 1 ? (
          <div style={{ maxWidth: 880, margin: '28px auto', padding: '0 16px', display: 'grid', gap: 18 }} className="ez-rise">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {([['people', 'Specific people', 'One document signed by the people you list, in order or in any order.'], ['bulk', 'Bulk send', 'One copy per person — e.g. a policy everyone must sign. Each signs their own.']] as const).map(([id, t, d]) => (
                <button key={id} type="button" onClick={() => setMode(id)} className="ez-lift" style={{ textAlign: 'left', padding: 16, borderRadius: R.lg, cursor: 'pointer', fontFamily: font, background: mode === id ? C.brandTint : C.surface, border: `1.5px solid ${mode === id ? C.brand : C.line}` }}>
                  <div style={{ fontWeight: W.bold, color: mode === id ? C.brandDeep : C.ink, fontSize: 15 }}>{t}</div><div style={{ fontSize: F.small, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{d}</div>
                </button>
              ))}
            </div>
            {mode === 'bulk' && (
              <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 18 }}>
                <div style={{ fontWeight: W.bold, marginBottom: 12 }}>Recipients</div>
                <Recipients list={recipients} setList={setRecipients} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                  <input value={bulkMeta.role_label} onChange={e => setBulkMeta(m => ({ ...m, role_label: e.target.value }))} placeholder="Role" style={{ ...inp, width: 200 }} />
                  <select value={bulkMeta.auth_method} onChange={e => setBulkMeta(m => ({ ...m, auth_method: e.target.value as Auth }))} style={{ ...inp, width: 'auto' }}><option value="EMAIL_OTP">Verify by e-mail OTP</option><option value="EMAIL_AADHAAR_OTP">E-mail OTP + Aadhaar OTP (demo)</option></select>
                </div>
              </div>
            )}
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <div style={{ fontWeight: W.bold }}>{mode === 'bulk' ? 'Co-signers on every copy (optional)' : 'Signers'}</div>
                {mode === 'people' && fixedSigners.length > 1 && (
                  <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: F.small, color: C.inkSoft, cursor: 'pointer' }}>
                    <input type="checkbox" checked={order === 'SEQUENTIAL'} onChange={e => setOrder(e.target.checked ? 'SEQUENTIAL' : 'PARALLEL')} /> Sign in this order
                  </label>
                )}
              </div>
              {mode === 'bulk' && <div style={{ fontSize: F.small, color: C.muted, marginTop: -6, marginBottom: 12 }}>Each recipient signs first; these people countersign every copy after them (e.g. the HR Head).</div>}
              <div style={{ display: 'grid', gap: 10 }}>
                {fixedSigners.map((s, i) => (
                  <SignerCard key={s.key} s={s} i={mode === 'bulk' ? i + 1 : i} total={fixedSigners.length} sequential={mode === 'bulk' || order === 'SEQUENTIAL'}
                    onChange={p => setSigners(l => l.map(x => x.key === s.key ? { ...x, ...p } : x))}
                    onRemove={() => { setSigners(l => l.filter(x => x.key !== s.key)); setFields(l => l.filter(f => f.signer !== s.key)) }}
                    onMove={d => setSigners(l => { const a = [...l]; const j = a.findIndex(x => x.key === s.key); const k = j + d; if (k < 0 || k >= a.length) return a; [a[j], a[k]] = [a[k], a[j]]; return a })} />
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, marginTop: 14, alignItems: 'center' }}>
                <EmployeeSearch exclude={fixedSigners.map(s => s.employee_id || '')} placeholder="Add an employee as signer…" onPick={e => addSigner({ name: e.full_name, email: emailOf(e).toLowerCase(), employee_id: e.id, designation: e.designation })} />
                <Btn kind="secondary" onClick={() => addSigner()}><IconMail size={15} /> Someone outside</Btn>
              </div>
            </div>
          </div>
        ) : step === 2 ? (
          <div style={{ display: 'grid', gridTemplateColumns: '290px minmax(0,1fr)', minHeight: '100%' }} className="ez-place-grid">
            <style>{`@media (max-width: 860px) { .ez-place-grid { grid-template-columns: 1fr !important; } .ez-place-side { position: static !important; height: auto !important; } }`}</style>
            <aside className="ez-place-side" style={{ borderRight: `1px solid ${C.line}`, background: C.surface, padding: 18, position: 'sticky', top: 0, height: 'calc(100vh - 140px)', overflowY: 'auto', display: 'grid', gap: 18, alignContent: 'start' }}>
              <div>
                <div style={lbl}>1 · Placing for</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {slots.map((s, i) => {
                    const h = hue(i), n = fields.filter(f => f.signer === s.key).length
                    return (
                      <button key={s.key} type="button" onClick={() => setActive(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: R.md, cursor: 'pointer', fontFamily: font, textAlign: 'left', border: `1.5px solid ${active === s.key ? h.fg : C.line}`, background: active === s.key ? h.bg : C.surface }}>
                        <span style={{ width: 10, height: 10, borderRadius: 99, background: h.fg, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontWeight: W.semi, fontSize: F.small, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.placeholder ? 'Each recipient' : s.name || `Signer ${i + 1}`}</span><span style={{ fontSize: F.tiny, color: C.muted }}>{s.role_label}</span></span>
                        <span style={{ fontSize: F.tiny, fontWeight: W.bold, color: n ? h.fg : C.faint, ...numeric }}>{n}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <div style={lbl}>2 · Box type</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
                    <button key={k} type="button" onClick={() => setTool(k)} style={{ padding: '9px 8px', borderRadius: R.md, cursor: 'pointer', fontFamily: font, fontSize: F.small, fontWeight: W.semi, border: `1.5px solid ${tool === k ? C.brand : C.line}`, background: tool === k ? C.brandTint : C.surface, color: tool === k ? C.brandDeep : C.inkSoft }}>{KIND_LABEL[k]}</button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.55, padding: 12, borderRadius: R.md, background: C.sunken }}>
                <b style={{ color: C.inkSoft }}>3 · Click on the page</b> where it goes. Drag a box to move it, drag its corner to resize, select it and press × to remove.
              </div>
              <Btn kind="secondary" onClick={everyPage} disabled={!doc}>Initials on every page</Btn>
              {fields.length > 0 && <Btn kind="ghost" onClick={() => { setFields([]); setSel(null) }} style={{ color: C.critical }}>Remove all boxes</Btn>}
            </aside>
            <div ref={viewRef} style={{ padding: '22px 8px 60px', background: C.sunken, minWidth: 0 }}>
              <PdfPages doc={doc} width={width} overlay={overlay} />
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 880, margin: '28px auto', padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start' }} className="ez-rise">
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 20 }}>
              <div style={{ fontWeight: W.bold, fontSize: 16 }}>{title}</div>
              <div style={{ fontSize: F.small, color: C.muted, marginTop: 4 }}>{file?.name} · {doc?.numPages} pages · {CATEGORIES.find(c => c.id === category)?.label}</div>
              {message && <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: R.md, background: C.brandTint, fontSize: F.small, color: C.inkSoft, whiteSpace: 'pre-wrap' }}>{message}</div>}
              <div style={{ ...lbl, marginTop: 18 }}>{mode === 'bulk' ? `Goes to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}` : order === 'SEQUENTIAL' ? 'Signs in this order' : 'Signs in any order'}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {slots.map((s, i) => (
                  <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: F.small }}>
                    <span style={{ width: 22, height: 22, borderRadius: 99, background: hue(i).bg, color: hue(i).fg, display: 'grid', placeItems: 'center', fontWeight: W.bold, fontSize: F.tiny }}>{i + 1}</span>
                    <span style={{ fontWeight: W.semi }}>{s.placeholder ? `Each of ${recipients.length} recipients` : s.name}</span>
                    <span style={{ color: C.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.placeholder ? '' : s.email}</span>
                    <span style={{ marginLeft: 'auto', color: C.muted, fontSize: F.tiny, whiteSpace: 'nowrap' }}>{fields.filter(f => f.signer === s.key).length} box{fields.filter(f => f.signer === s.key).length === 1 ? '' : 'es'} · {(s.placeholder ? bulkMeta.auth_method : s.auth_method) === 'EMAIL_AADHAAR_OTP' ? 'Email + Aadhaar' : 'Email OTP'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 20, display: 'grid', gap: 16 }}>
              <div><label style={lbl}>Link valid for</label>
                <select value={expires} onChange={e => setExpires(Number(e.target.value))} style={inp}>{[3, 7, 14, 30, 60].map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
              <div><label style={lbl}>CC on the completed copy (optional)</label><input value={cc} onChange={e => setCc(e.target.value)} placeholder="hr@company.com, manager@company.com" data-no-titlecase style={inp} /></div>
              <div style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.55 }}>Every signer verifies with a one-time code to their e-mail before the document opens. Each signature is stamped with name, time (IST), verification method and a reference; a Certificate of Completion with the full audit trail and a verification QR is added when the last person signs.</div>
            </div>
          </div>
        )}
      </div>

      {!result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 84px 12px 20px', borderTop: `1px solid ${C.line}`, background: C.surface, flexWrap: 'wrap' }}>
          {(err || blocker) && <span style={{ fontSize: F.small, color: err ? C.critical : C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>{err && <IconAlert size={14} />}{err || blocker}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {step > 0 && <Btn kind="secondary" onClick={() => setStep(s => s - 1)} disabled={busy}>Back</Btn>}
            {step < 3 ? <Btn onClick={() => setStep(s => s + 1)} disabled={!!blocker}>Continue</Btn>
              : <Btn onClick={send} disabled={busy || !!stepError(0) || !!stepError(1) || !!stepError(2)}>{busy ? 'Sending…' : <><IconPen size={15} /> {mode === 'bulk' ? `Send ${recipients.length} copies` : 'Send for signature'}</>}</Btn>}
          </div>
        </div>
      )}
    </div>
  )
  // Portalled: a fixed overlay inside an animated (transformed) ancestor would be trapped in it.
  return typeof document === 'undefined' ? null : createPortal(ui, document.body)
}
