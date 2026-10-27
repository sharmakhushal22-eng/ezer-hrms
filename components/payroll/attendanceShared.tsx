'use client'
// components/payroll/attendanceShared.tsx — shared primitives for the Attendance tab
// (Attendance Upload · OT Upload · Attendance Edit). Palette + searchable dropdowns +
// the bulk-paste employee-code multi-select + the "% checking" validation animation card.
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { useGrant } from '@/lib/rms/client'
import { scopedCompanies } from '@/lib/rms/resolve'
import { loadRuns, loadCompanies, MONTHS, type PayrollRun } from '@/lib/payroll/core'
// Design tokens, aliased as TK — many of these files already declare
// their own C. See lib/ui/tokens.ts.
import { C as TK, F, W, S as SP, R, E, M, numeric, IconChevronDown, IconSearch, IconClose, IconCheck, IconDownload, IconUpload, IconUser } from '@/lib/ui'
import { useDismiss } from '@/lib/ui/useDismiss'
import {
  SectionCard, InfoCallout, PButton, StatusPill, IconTile, IconInfo, IconFile,
  type Step, type StepState,
} from '@/components/payroll/kit'

export const C = {
  navy: TK.ink, purple: TK.brand, purpleD: TK.brandDeep, card: TK.surface,
  border: TK.line, muted: TK.muted, green: TK.positive, greenBg: TK.positiveTint,
  greenBd: TK.positiveEdge, red: TK.critical, redBg: TK.criticalTint, amber: TK.warning, amberBg: TK.warningTint,
  purpleBg: TK.brandTint, gray: TK.sunken,
}
export const font = '"DM Sans","Segoe UI",sans-serif'
export const num = (v: any) => { const n = Number(v); return isNaN(n) ? null : n }
// The field skin every attendance / voucher form uses: 38px tall like the kit's
// ControlSelect, hairline-strong border, surface fill. minHeight (not height) so the
// chip multi-select can grow as codes are added.
export const ddInp: React.CSSProperties = {
  width: '100%', minHeight: 38, padding: '8px 12px', border: `1px solid ${TK.lineStrong}`, borderRadius: R.md,
  fontSize: F.small, boxSizing: 'border-box', background: TK.surface, color: TK.ink, fontFamily: font, outline: 'none',
  transition: `border-color ${M.quick}, box-shadow ${M.quick}`,
}
export const lbl: React.CSSProperties = { fontSize: F.tiny, fontWeight: W.semi, color: TK.inkSoft, display: 'block', marginBottom: 5 }

// ── Presentational building blocks shared by every Attendance / Payroll Run screen ──
// Module level, never nested — see the house rules in components/payroll/kit.tsx.

/**
 * The context card at the top of each screen: solid icon tile, title, one-line purpose,
 * facts (pills) under it, controls on the right, and an optional full-width row below
 * a hairline (a ProcessStepper for the upload flows).
 */
export function ScreenIntro({ icon, title, subtitle, meta, actions, children }: {
  icon: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode
  meta?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode
}) {
  return (
    <section style={{
      background: TK.surface, border: `1px solid ${TK.line}`, borderRadius: R.lg, boxShadow: E.raised,
      padding: `${SP.lg}px ${SP.lg + 2}px`, marginBottom: SP.lg, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: SP.lg, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: SP.md, minWidth: 0, flex: '1 1 320px' }}>
          <IconTile icon={icon} size={40} t="brand" solid />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: F.title, fontWeight: W.bold, color: TK.ink, letterSpacing: '-.01em', lineHeight: 1.2 }}>{title}</h1>
            {subtitle && <div style={{ marginTop: 3, fontSize: F.small, color: TK.muted, lineHeight: 1.5 }}>{subtitle}</div>}
            {meta && <div style={{ marginTop: SP.sm, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{meta}</div>}
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: SP.md, alignItems: 'flex-end', flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {children && <div style={{ marginTop: SP.lg, paddingTop: SP.md, borderTop: `1px solid ${TK.line}` }}>{children}</div>}
    </section>
  )
}

/** Quiet explanatory footnote: sunken well, info glyph, small ink-soft text. */
export function Note({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex', gap: SP.sm + 2, alignItems: 'flex-start', background: TK.sunken, border: `1px solid ${TK.line}`,
      borderRadius: R.md, padding: `${SP.sm + 2}px ${SP.md}px`, fontSize: F.tiny, color: TK.inkSoft, lineHeight: 1.6, ...numeric, ...style,
    }}>
      <span style={{ display: 'inline-flex', color: TK.faint, marginTop: 2 }}><IconInfo size={14} /></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

/** A labelled field wrapper (div, not label — SearchSelect must not sit inside a <label>). */
export function Fld({ label, hint, children, span }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ minWidth: 0, ...(span ? { gridColumn: '1 / -1' } : null) }}>
      <span style={lbl}>{label}{hint && <span style={{ fontWeight: W.regular, color: TK.muted }}> {hint}</span>}</span>
      {children}
    </div>
  )
}

/**
 * The file chooser as a drop zone. The real <input type=file> is stretched invisibly
 * over the whole zone, so a click anywhere opens the picker and a dragged file lands
 * on the input itself — the caller's onChange is the only handler.
 */
export function FileDrop({ accept, onChange, fileName, label = 'Choose a filled sheet', hint }: {
  accept: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  fileName?: string; label?: React.ReactNode; hint?: React.ReactNode
}) {
  const has = !!fileName
  return (
    <div className="ez-press" style={{
      position: 'relative', display: 'flex', alignItems: 'center', gap: SP.md, minHeight: 64, boxSizing: 'border-box',
      padding: `${SP.md}px ${SP.lg}px`, borderRadius: R.md, cursor: 'pointer',
      border: `1.5px dashed ${has ? TK.brandEdge : TK.lineStrong}`, background: has ? TK.brandTint : TK.sunken,
    }}>
      <IconTile icon={has ? <IconFile size={17} /> : <IconUpload size={17} />} t="brand" size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: F.small, fontWeight: W.semi, color: has ? TK.brandDeep : TK.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {has ? fileName : label}
        </div>
        <div style={{ fontSize: F.tiny, color: TK.muted, marginTop: 1 }}>{hint || (has ? 'Click to choose a different file' : `Click to browse, or drop the file here · ${accept.replace(/,/g, ' / ')}`)}</div>
      </div>
      <span style={{ fontSize: F.tiny, fontWeight: W.semi, color: TK.brandDeep, background: TK.surface, border: `1px solid ${TK.lineStrong}`, borderRadius: R.sm, padding: '5px 11px', whiteSpace: 'nowrap' }}>
        {has ? 'Replace' : 'Browse'}
      </span>
      <input type="file" accept={accept} onChange={onChange} aria-label={typeof label === 'string' ? label : 'Choose file'}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
    </div>
  )
}

/**
 * Steps for an upload flow — Choose file → Validate → Review → Apply — derived purely
 * from the screen's existing state, so the rail can never disagree with what is shown.
 */
export function uploadSteps({ hasFile, fileBlocked, showVal, checking, blocked, done, validateHint }: {
  hasFile: boolean; fileBlocked?: boolean; showVal: boolean; checking: boolean; blocked: boolean; done: boolean
  validateHint?: React.ReactNode
}): Step[] {
  const choose: StepState = done || showVal || (hasFile && !fileBlocked) ? 'done' : fileBlocked ? 'blocked' : 'current'
  const validate: StepState = done ? 'done' : showVal ? (checking ? 'current' : 'done') : hasFile && !fileBlocked ? 'current' : 'todo'
  const review: StepState = done ? 'done' : showVal && !checking ? (blocked ? 'blocked' : 'current') : 'todo'
  const apply: StepState = done ? 'done' : 'todo'
  return [
    { key: 'choose', label: 'Choose file', hint: 'Filled .xlsx', state: choose },
    { key: 'validate', label: 'Validate', hint: validateHint || 'Codes & limits', state: validate },
    { key: 'review', label: 'Review', hint: blocked && review === 'blocked' ? 'Fix the sheet' : 'Matched rows', state: review },
    { key: 'apply', label: 'Apply', hint: 'Write to month', state: apply },
  ]
}
export type Opt = { value: string; label: string }
export const GROUP = '__group__'   // Company dropdown sentinel → all companies at once

// Split a pasted / typed blob of codes into clean tokens.
// Handles "OXYZO680,\nOXYZO741,\n OXYZO1013 , OXYZO1022" and the like.
export const splitCodes = (text: string): string[] =>
  text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean)

// ── Searchable single-select ────────────────────────────────────────
// The open panel keeps the kit's floating elevation; the trigger gets a brand ring
// while open so it is obvious which control the list belongs to.
const ddPanel: React.CSSProperties = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: '100%', background: TK.surface,
  border: `1px solid ${TK.lineStrong}`, borderRadius: R.md, boxShadow: E.floating, overflow: 'hidden',
}
const ddSearch: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: 'none', borderBottom: `1px solid ${TK.line}`, fontSize: F.small,
  outline: 'none', boxSizing: 'border-box', fontFamily: font, background: TK.sunken, color: TK.ink,
}
const ddOpen: React.CSSProperties = { borderColor: TK.brand, boxShadow: `0 0 0 3px ${TK.brandTint}` }

export function SearchSelect({ value, options, placeholder, onChange, disabled }: { value: string; options: Opt[]; placeholder: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const [q, setQ] = useState('')
  const sel = options.find(o => o.value === value)
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  return (
    <div ref={pop} style={{ position: 'relative' }}>
      <div onClick={() => { if (!disabled) { setOpen(o => !o); setQ('') } }}
        style={{ ...ddInp, ...(open && !disabled ? ddOpen : null), cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center', color: sel ? TK.ink : TK.faint, fontWeight: sel ? W.medium : W.regular, background: disabled ? TK.sunken : TK.surface }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel ? sel.label : placeholder}</span>
        <span style={{ color: TK.muted, display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: `transform ${M.quick}` }}><IconChevronDown size={14} /></span>
      </div>
      {open && !disabled && (
        <>
          <div style={{ ...ddPanel, minWidth: 200, zIndex: 501 }}>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={ddSearch} />
            <div className="ez-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: 4 }}>
              {filtered.length === 0 && <div style={{ padding: '9px 10px', fontSize: F.tiny, color: TK.faint }}>No matches</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => { onChange(o.value); setOpen(false) }} className="ez-row"
                  style={{ padding: '7px 10px', borderRadius: R.sm, fontSize: F.small, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: o.value === value ? TK.brandTint : TK.surface, color: o.value === value ? TK.brandDeep : TK.ink, fontWeight: o.value === value ? W.semi : W.regular }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {o.value === value && <IconCheck size={13} />}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Searchable multi-select (chips) — for employee codes.
// Accepts a pasted / typed bulk list (comma / newline / space separated),
// e.g. "OXYZO680, OXYZO741, OXYZO1013" → four chips at once.
export function MultiSelect({ values, options, placeholder, onChange }: { values: string[]; options: Opt[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  // One click, not two: a document listener lets the click through to whatever
  // is under it, so moving straight to another trigger opens that one.
  const pop = useDismiss<HTMLDivElement>(open, () => setOpen(false))
  const [q, setQ] = useState('')
  const filtered = (q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options).slice(0, 150)
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter(x => x !== v) : [...values, v])

  // Add many tokens at once, canonicalising each against the option list
  // (case-insensitive) and de-duplicating against what's already selected.
  const addTokens = (text: string) => {
    const byUpper = new Map(options.map(o => [o.value.toUpperCase(), o.value]))
    const next = [...values]
    for (const tok of splitCodes(text)) {
      const canon = byUpper.get(tok.toUpperCase()) ?? tok
      if (!next.includes(canon)) next.push(canon)
    }
    if (next.length !== values.length) onChange(next)
    setQ('')
  }
  const onQChange = (v: string) => { if (/[\s,;]/.test(v)) addTokens(v); else setQ(v) }

  return (
    <div ref={pop} style={{ position: 'relative' }}>
      <div onClick={() => { setOpen(o => !o); setQ('') }}
        style={{ ...ddInp, ...(open ? ddOpen : null), cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', padding: values.length ? '6px 10px' : ddInp.padding }}>
        {values.length === 0 && <span style={{ color: TK.faint, display: 'inline-flex', alignItems: 'center', gap: 7 }}><IconUser size={14} />{placeholder}</span>}
        {values.map(v => (
          <span key={v} onClick={e => { e.stopPropagation(); toggle(v) }} title="Remove"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: F.tiny, background: TK.brandTint, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, borderRadius: R.pill, padding: '1px 6px 1px 9px', fontWeight: W.semi, ...numeric }}>
            {v} <IconClose size={11} />
          </span>
        ))}
        <span style={{ marginLeft: 'auto', color: TK.muted, display: 'inline-flex', transform: open ? 'rotate(180deg)' : 'none', transition: `transform ${M.quick}` }}><IconChevronDown size={14} /></span>
      </div>
      {open && (
        <>
          <div style={{ ...ddPanel, minWidth: 240, zIndex: 501 }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: TK.muted, display: 'inline-flex', pointerEvents: 'none' }}><IconSearch size={14} /></span>
              <input autoFocus value={q}
                onChange={e => onQChange(e.target.value)}
                onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t)) { e.preventDefault(); addTokens(t) } }}
                onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); addTokens(q) } }}
                placeholder="Search or paste codes (comma / newline separated)…"
                style={{ ...ddSearch, paddingLeft: 32 }} />
            </div>
            <div className="ez-scroll" style={{ maxHeight: 220, overflowY: 'auto', padding: 4 }}>
              {filtered.length === 0 && <div style={{ padding: '9px 10px', fontSize: F.tiny, color: TK.faint }}>Press Enter to add “{q.trim()}”</div>}
              {filtered.map(o => (
                <div key={o.value} onClick={() => toggle(o.value)} className="ez-row"
                  style={{ padding: '7px 10px', borderRadius: R.sm, fontSize: F.small, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: values.includes(o.value) ? TK.brandTint : TK.surface, color: TK.ink }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                  {values.includes(o.value) && <span style={{ color: TK.positive, display: 'inline-flex' }}><IconCheck size={13} /></span>}
                </div>
              ))}
            </div>
            {values.length > 0 && (
              <div style={{ borderTop: `1px solid ${TK.line}`, padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: TK.sunken }}>
                <span style={{ fontSize: F.tiny, color: TK.muted, ...numeric }}>{values.length} selected</span>
                <span onClick={() => onChange([])} style={{ fontSize: F.tiny, color: TK.critical, cursor: 'pointer', fontWeight: W.semi }}>Clear all</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Month/date helpers, shared by the Attendance and OT download sheets ──
export function monthMeta(period: string) {
  const [py, pm] = String(period).slice(0, 7).split('-').map(Number)
  const start = Date.UTC(py, pm - 1, 1)
  const end = Date.UTC(py, pm, 0)                 // last day of the month
  return { py, pm, start, end, daysInMonth: new Date(end).getUTCDate() }
}
export const toMs = (d: string | null) => { if (!d) return null; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return (y && m && dd) ? Date.UTC(y, m - 1, dd) : null }

// Max Days — the maximum days salary can be paid for in the month, capped by the leaving
// date. DOL 15-Apr → 15; no leaving this month → the full month (30/31/28).
export function maxDaysLive(dol: string | null, period: string | null): number | null {
  if (!period) return null
  const { start, end, daysInMonth } = monthMeta(period)
  const dl = toMs(dol)
  if (dl != null && dl >= start && dl <= end) return new Date(dl).getUTCDate()
  return daysInMonth
}

// Dates in the sheets read as DD-MM-YY (e.g. 2018-09-24 → 24-09-18).
export function fmtDate(d: string | null): string {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  if (!y || !m || !dd) return ''
  return `${dd}-${m}-${y.slice(2)}`
}

// Calendar 1st-of-month for a run, from fy + month (same math as the server's v_period).
export function runPeriodISO(fy: string | null, month: number | null): string | null {
  if (!fy || !month) return null
  const startYr = Number(String(fy).split('-')[0])
  const cal = month <= 9 ? month + 3 : month - 9
  const yr = month <= 9 ? startYr : startYr + 1
  return `${yr}-${String(cal).padStart(2, '0')}-01`
}

export type SheetCtx = { isGroup: boolean; companyName: string; periodLabel: string; periodISO: string | null; doj: string | null; dol: string | null }

// ── Download card — the inline filter block used by BOTH the Attendance and the OT
// uploaders. Identical UI and behaviour (company / month / location / department /
// employee codes, Group Companies mode, live employee-master join, Employee-type only);
// only the sheet's columns differ, supplied by the caller's buildRow.
export function DownloadCard({ companyId, fy, heading, note, filePrefix, sheetName, buildRow }: {
  companyId: string; fy: string; heading: string; note: string; filePrefix: string; sheetName: string
  buildRow: (snapRow: any, ctx: SheetCtx) => Record<string, any>
}) {
  const { grant } = useGrant()
  const [dlBusy, setDlBusy] = useState(false)
  const [dlErr, setDlErr] = useState('')
  const [dlCompany, setDlCompany] = useState('')
  const [dlRunId, setDlRunId] = useState('')
  const [dlLoc, setDlLoc] = useState('')
  const [dlDept, setDlDept] = useState('')
  const [dlEmpCodes, setDlEmpCodes] = useState<string[]>([])
  const [companies, setCompanies] = useState<Opt[]>([])
  const [allRuns, setAllRuns] = useState<PayrollRun[]>([])
  const [locOpts, setLocOpts] = useState<Opt[]>([])
  const [deptOpts, setDeptOpts] = useState<Opt[]>([])
  const [empOpts, setEmpOpts] = useState<Opt[]>([])

  useEffect(() => {
    loadCompanies().then(cs => setCompanies(scopedCompanies(grant, cs as any[]).map((c: any) => ({ value: c.id, label: c.company_name })))).catch(() => {})
    loadRuns('', fy).then(setAllRuns).catch(() => {})
  }, [fy, grant]) // eslint-disable-line react-hooks/exhaustive-deps
  // Non-cross-company users are forced onto their own company; GROUP (all companies) is
  // never selected for them.
  useEffect(() => {
    setDlCompany(!grant.crossCompany && grant.companyId ? grant.companyId : (companyId || GROUP))
  }, [companyId, grant]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dlCompany) { setLocOpts([]); setDeptOpts([]); setEmpOpts([]); setDlRunId(''); return }
    const grp = dlCompany === GROUP
    const scope = (q: any) => grp ? q : q.eq('company_id', dlCompany)
    scope(supabase.from('locations').select('id, location_name').eq('status', 'Active').order('location_name'))
      .then(({ data }: any) => setLocOpts((data || []).map((l: any) => ({ value: l.id, label: l.location_name }))))
    scope(supabase.from('departments').select('id, dept_name').eq('status', 'Active').order('dept_name'))
      .then(({ data }: any) => setDeptOpts((data || []).map((d: any) => ({ value: d.id, label: d.dept_name }))))
    scope(supabase.from('employees').select('emp_code, full_name').neq('is_test', true).order('emp_code'))
      .then(({ data }: any) => setEmpOpts((data || []).filter((e: any) => e.emp_code).map((e: any) => ({ value: e.emp_code, label: `${e.emp_code} · ${e.full_name}` }))))
    setDlLoc(''); setDlDept(''); setDlEmpCodes([])
    if (grp) {
      const firstMonth = allRuns.map(r => r.month).sort((a, b) => (a || 0) - (b || 0))[0]
      setDlRunId(firstMonth != null ? String(firstMonth) : '')
    } else {
      const first = allRuns.find(r => r.company_id === dlCompany)
      setDlRunId(first ? first.id : '')
    }
  }, [dlCompany, allRuns])

  const isGroup = dlCompany === GROUP
  const dlRunOptions: Opt[] = isGroup
    ? Array.from(new Map(allRuns.map(r => [r.month, { value: String(r.month), label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }])).values()).sort((a, b) => Number(a.value) - Number(b.value))
    : allRuns.filter(r => r.company_id === dlCompany).map(r => ({ value: r.id, label: r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}` }))

  async function download() {
    if (!dlRunId) { setDlErr('Pick a month first.'); return }
    setDlBusy(true); setDlErr('')
    try {
      const grpRuns = isGroup ? allRuns.filter(r => String(r.month) === dlRunId) : allRuns.filter(r => r.id === dlRunId)
      const runIds = grpRuns.map(r => r.id)
      const coName: Record<string, string> = {}; const coPeriod: Record<string, string> = {}; const coPeriodISO: Record<string, string> = {}
      grpRuns.forEach(r => {
        coName[r.id] = r.company_name || ''
        coPeriod[r.id] = r.period_label || `${MONTHS[(r.month || 1) - 1]} ${String(r.fy || '').split('-')[0]}`
        coPeriodISO[r.id] = runPeriodISO(r.fy, r.month) || ''
      })
      const period = grpRuns[0]?.period_label || ''
      const { data: snap, error } = await supabase.from('payroll_employee_snapshot')
        .select('run_id, employee_id, employee_code, full_name, department, designation, days_in_month, paid_days, earned_leave, casual_leave, sick_leave, other_leave, absent_days, ot_hours')
        .in('run_id', runIds).order('employee_code')
      if (error) throw new Error(error.message)
      let list = snap || []

      // DOJ / DOL / employment_type come LIVE from the employee master (the snapshot's
      // copies can be NULL on older months). Only real "Employee" types are included.
      const ids = Array.from(new Set(list.map((r: any) => r.employee_id)))
      const master: Record<string, any> = {}
      for (let i = 0; i < ids.length; i += 300) {
        const { data: emp } = await supabase.from('employees')
          .select('id, company_doj, date_of_leaving, last_working_date, relieving_date, employment_type')
          .in('id', ids.slice(i, i + 300))
        ;(emp || []).forEach((e: any) => { master[e.id] = e })
      }
      list = list.filter((r: any) => master[r.employee_id]?.employment_type === 'Employee')

      if (dlLoc || dlDept || dlEmpCodes.length) {
        let q = supabase.from('employees').select('id')
        if (!isGroup) q = q.eq('company_id', dlCompany)
        if (dlLoc) q = q.eq('location_id', dlLoc)
        if (dlDept) q = q.eq('department_id', dlDept)
        if (dlEmpCodes.length) q = q.in('emp_code', dlEmpCodes)
        const { data: matchedEmp } = await q
        const allow = new Set((matchedEmp || []).map((e: any) => e.id))
        list = list.filter((r: any) => allow.has(r.employee_id))
      }
      if (list.length === 0) { setDlErr('No matching Employee-type employees for these filters.'); setDlBusy(false); return }

      const sheet = list.map((r: any) => {
        const m = master[r.employee_id] || {}
        return buildRow(r, {
          isGroup,
          companyName: coName[r.run_id] || '',
          periodLabel: coPeriod[r.run_id] || period,
          periodISO: coPeriodISO[r.run_id] || null,
          doj: m.company_doj || null,
          dol: m.date_of_leaving || m.last_working_date || m.relieving_date || null,
        })
      })
      const ws = XLSX.utils.json_to_sheet(sheet)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
      const safe = (s: string) => (s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      XLSX.writeFile(wb, `${filePrefix}_${safe(isGroup ? 'Group' : (grpRuns[0]?.company_name || ''))}_${safe(period)}.xlsx`.replace(/_+/g, '_'))
    } catch (e: any) { setDlErr('Download failed: ' + (e.message || e)) } finally { setDlBusy(false) }
  }

  const dlCompanyName = isGroup ? 'all companies' : (companies.find(c => c.value === dlCompany)?.label || '')
  const dlPeriod = isGroup
    ? (dlRunOptions.find(o => o.value === dlRunId)?.label || '')
    : (allRuns.find(r => r.id === dlRunId)?.period_label || '')

  const filtered = !!(dlLoc || dlDept || dlEmpCodes.length)
  return (
    <SectionCard icon={<IconDownload size={16} />} title={heading} hint={note.replace(/^·\s*/, '')}
      actions={<StatusPill t="neutral" size="sm" icon={<IconFile size={12} />}>Template</StatusPill>}
      // Visible overflow: the searchable dropdowns open below their field and must not be clipped.
      style={{ overflow: 'visible' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: SP.md, marginBottom: SP.md }}>
        <Fld label="Company"><SearchSelect value={dlCompany} options={[...(grant.crossCompany ? [{ value: GROUP, label: 'Group Companies (all)' }] : []), ...companies]} placeholder="Select company" onChange={setDlCompany} /></Fld>
        <Fld label="Month"><SearchSelect value={dlRunId} options={dlRunOptions} placeholder={dlRunOptions.length ? 'Select month' : 'No month created'} onChange={setDlRunId} /></Fld>
        <Fld label="Location"><SearchSelect value={dlLoc} options={[{ value: '', label: 'All locations' }, ...locOpts]} placeholder="All locations" onChange={setDlLoc} /></Fld>
        <Fld label="Department"><SearchSelect value={dlDept} options={[{ value: '', label: 'All departments' }, ...deptOpts]} placeholder="All departments" onChange={setDlDept} /></Fld>
      </div>
      <div style={{ marginBottom: SP.md }}>
        <Fld label="Employee codes" hint="(optional: leave empty for all; paste a comma / newline list to add many)">
          <MultiSelect values={dlEmpCodes} options={empOpts} placeholder="All employees" onChange={setDlEmpCodes} />
        </Fld>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: SP.md, flexWrap: 'wrap', paddingTop: SP.md, borderTop: `1px solid ${TK.line}` }}>
        <PButton variant="primary" icon={<IconDownload size={15} />} onClick={download} disabled={dlBusy || !dlRunId}>
          {dlBusy ? 'Preparing…' : 'Download'}
        </PButton>
        {dlRunId && (
          <span style={{ fontSize: F.tiny, color: TK.inkSoft, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            month master for <b style={{ color: TK.ink }}>{dlCompanyName}</b> for <b style={{ color: TK.ink }}>{dlPeriod}</b>
            {filtered && <StatusPill t="brand" size="sm" dot>filtered</StatusPill>}
          </span>
        )}
      </div>
      {dlErr && <InfoCallout t="critical" compact style={{ marginTop: SP.md, marginBottom: 0 }}>{dlErr}</InfoCallout>}
    </SectionCard>
  )
}

// A failed sheet rule for one employee. `rule` names the quantity that broke the
// ceiling ("Paid Days" / "Total Days"), so one card can report several rules at once.
export type Violation = { code: string; rule: string; actual: number; max: number }

// ── The staged "% checking" validation card (Process / Cancel) ──
// Mirrors the Create Month Master progress experience: a green bar that fills
// over at least ten seconds with a live percentage and a stage caption.
// Any Paid Days > Max Days violation is a hard block — Process stays disabled.
export function ValidationCard({ pct, checking, stage, total, matched, unmatched, violations, onProcess, onCancel, busy, kind, strictUnmatched }: {
  pct: number; checking: boolean; stage: string; total: number
  matched: string[]; unmatched: string[]; violations: Violation[]
  onProcess: () => void; onCancel: () => void; busy: boolean; kind: string
  // When set, a code that is not in this month's master is an extra row and is
  // treated as a hard failure rather than a skipped line.
  strictUnmatched?: boolean
}) {
  const blocked = violations.length > 0 || (!!strictUnmatched && unmatched.length > 0)
  const failed = blocked && !checking
  const offProcess = busy || blocked || matched.length === 0
  const barColor = checking ? TK.brand : failed ? TK.critical : TK.positive
  return (
    <SectionCard
      icon={checking ? <IconSearch size={16} /> : failed ? <IconClose size={16} /> : <IconCheck size={16} />}
      iconTone={checking ? 'brand' : failed ? 'critical' : 'positive'}
      title={checking ? `Checking ${kind} sheet…` : failed ? 'Validation failed' : `Ready to process · ${total} rows`}
      hint={checking ? stage : failed ? 'Nothing has been written. Fix the sheet and upload it again.' : 'Every matched row is checked. Process writes them into the month.'}
      actions={<span style={{ fontSize: F.title, fontWeight: W.bold, color: checking ? TK.brandDeep : failed ? TK.critical : TK.positive, ...numeric }}>{pct}%</span>}
      style={{ borderColor: failed ? TK.criticalEdge : TK.line }}>
      <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 8, borderRadius: R.pill, background: TK.sunken, border: `1px solid ${TK.line}`, overflow: 'hidden', marginBottom: SP.md }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: R.pill, background: barColor, transition: 'width .15s linear, background .2s' }} />
      </div>
      <div style={{ display: 'flex', gap: SP.sm, flexWrap: 'wrap', alignItems: 'center', marginBottom: checking ? 0 : SP.md }}>
        {checking && <span style={{ fontSize: F.tiny, color: TK.muted }}>{stage}</span>}
        {!checking && <>
          <StatusPill t="positive" icon={<IconCheck size={12} />}>{matched.length} matched</StatusPill>
          {unmatched.length > 0 && <StatusPill t="warning" dot>{unmatched.length} not in this month</StatusPill>}
          {blocked && <StatusPill t="critical" icon={<IconClose size={12} />}>{violations.length} over Max Days</StatusPill>}
        </>}
      </div>

      {!checking && strictUnmatched && unmatched.length > 0 && (
        <InfoCallout t="critical" compact title="Extra rows: these codes are not in this month&apos;s master. Remove them and upload again.">
          <div className="ez-scroll" style={{ maxHeight: 120, overflowY: 'auto' }}>{unmatched.slice(0, 60).join(', ')}{unmatched.length > 60 ? ` +${unmatched.length - 60} more` : ''}</div>
        </InfoCallout>
      )}

      {!checking && violations.length > 0 && (
        <InfoCallout t="critical" compact title="Nothing can exceed Max Days. Fix the sheet and upload again.">
          <div className="ez-scroll" style={{ maxHeight: 170, overflowY: 'auto' }}>
            {violations.slice(0, 60).map((v, i) => (
              <div key={`${v.code}-${v.rule}-${i}`} style={{ padding: '2px 0' }}>
                <b>{v.code}</b>: {v.rule} <b>{v.actual}</b> &gt; Max Days <b>{v.max}</b>
              </div>
            ))}
            {violations.length > 60 && <div style={{ marginTop: 4 }}>+ {violations.length - 60} more…</div>}
          </div>
        </InfoCallout>
      )}

      {!checking && !strictUnmatched && unmatched.length > 0 && (
        <InfoCallout t="warning" compact>
          Skipped (wrong code / extra person / not in this month&apos;s master): <b>{unmatched.slice(0, 40).join(', ')}</b>{unmatched.length > 40 ? ` +${unmatched.length - 40} more` : ''}
        </InfoCallout>
      )}

      {!checking && (
        <div style={{ display: 'flex', gap: SP.sm + 2, flexWrap: 'wrap', alignItems: 'center', paddingTop: SP.md, borderTop: `1px solid ${TK.line}` }}>
          <PButton variant="primary" size="lg" onClick={onProcess} disabled={offProcess}
            icon={blocked ? <IconClose size={15} /> : <IconCheck size={15} />}>
            {busy ? 'Processing…' : blocked ? 'Blocked' : `Process ${matched.length} rows`}
          </PButton>
          <PButton size="lg" onClick={onCancel} disabled={busy}>Cancel</PButton>
        </div>
      )}
    </SectionCard>
  )
}
