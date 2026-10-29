'use client'
// components/recruitment/MrfPicker.tsx — pick ONE requisition (MRF) from a long list.
//
// Why this exists: the native <select> showed only "Intern (1 openings)", and with
// ~40 approved MRFs — many with the same designation — the recruiter could not tell
// them apart. Each row here carries the unique MRF number plus department, location,
// company (when there is more than one), openings and the raised date, and the list
// can be searched and narrowed by department / location / company.
//
// Contract is the same as the <select> it replaces: `value` is the MRF id ('' for
// none) and `onChange(id)` is called with the chosen id. Which MRFs are offered is
// entirely the caller's decision — this component never filters by status.
//
// The panel is portalled to <body> with position:fixed, because the Add-candidate
// modal clips its scrolling body (overflow:hidden / overflow-y:auto). It sits one
// step above Z.modal so it draws over the dialog it belongs to, below toasts.
//
// Module-level component (never defined inside a parent) so typing never loses focus.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C, F, W, R, E, Z, M, inputStyle } from '@/lib/ui'
import { isConfidentialMrf } from '@/lib/recruitment/confidential'

type Named = { id: string; [k: string]: any }

export interface MrfPickerProps {
  /** The MRFs that may be picked. Shown in the order given. */
  mrfs: any[]
  /** Selected MRF id, '' for none. */
  value: string
  onChange: (id: string) => void
  /** Lookups already loaded by the page — used to name department / location / company. */
  departments?: Named[]
  locations?: Named[]
  companies?: Named[]
  placeholder?: string
  /** Applied to the trigger button, e.g. "rx-input" so it matches the fields around it. */
  className?: string
  /** Merged onto the trigger, e.g. the form's error style. */
  style?: React.CSSProperties
  invalid?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

/** "1 opening" / "3 openings". */
export function openingsLabel(n: number | string | null | undefined): string {
  const k = Number(n) || 0
  return `${k} opening${k === 1 ? '' : 's'}`
}

/** Short text label for a plain <option>: "Intern · MRF-2026-0012". */
export function mrfOptionLabel(m: any): string {
  const name = m?.job_title || m?.designation || m?.position || 'Untitled'
  return m?.mrf_number ? `${name} · ${m.mrf_number}` : name
}

const fmtDate = (s?: string | null) => {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(+d) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Row {
  id: string
  title: string
  number: string
  dept: string
  loc: string
  company: string
  companyId: string
  openings: number
  raised: string
  /** yyyy-mm-dd of created_at, local time — compared with the From / To date filters. */
  day: string
  confidential: boolean
  hay: string
}

function Chip({ text, strong }: { text: string; strong?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', flexShrink: 0, padding: '1px 7px', borderRadius: R.pill,
      fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.02em', whiteSpace: 'nowrap',
      background: strong ? C.brandTint : C.sunken, color: strong ? C.brandDeep : C.muted,
      border: `1px solid ${strong ? C.brandEdge : C.line}`,
    }}>{text}</span>
  )
}

/** Local calendar day of a timestamp as yyyy-mm-dd ('' when absent), so "raised on 25 Oct" matches a 25 Oct filter in IST. */
function dayKey(v: any): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function DateFilter({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (v: string) => void }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 4px 0 9px', borderRadius: R.sm, flex: '1 1 150px', minWidth: 0, maxWidth: 190,
      border: `1px solid ${value ? C.brand : C.lineStrong}`, background: value ? C.brandTint : C.surface,
    }}>
      <span style={{ fontSize: F.micro, fontWeight: W.semi, color: value ? C.brandDeep : C.muted, whiteSpace: 'nowrap' }}>{label}</span>
      <input type="date" aria-label={`Raised ${label.toLowerCase()} date`} value={value} min={min || undefined} max={max || undefined} onChange={e => onChange(e.target.value)}
        style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: F.tiny, fontFamily: 'inherit', color: value ? C.brandDeep : C.inkSoft, minWidth: 0, flex: 1, cursor: 'pointer' }} />
    </label>
  )
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select aria-label={`Filter by ${label.toLowerCase()}`} value={value} onChange={e => onChange(e.target.value)}
      style={{
        height: 30, padding: '0 8px', borderRadius: R.sm, fontSize: F.tiny, fontFamily: 'inherit', cursor: 'pointer',
        border: `1px solid ${value ? C.brand : C.lineStrong}`, background: value ? C.brandTint : C.surface,
        color: value ? C.brandDeep : C.inkSoft, fontWeight: value ? W.semi : W.regular, maxWidth: 180, minWidth: 0, flex: '1 1 120px',
      }}>
      <option value="">All {label.toLowerCase()}s</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

export default function MrfPicker({
  mrfs, value, onChange, departments, locations, companies,
  placeholder = 'Select an opening', className, style, invalid, disabled, id, 'aria-label': ariaLabel,
}: MrfPickerProps) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [fDept, setFDept] = useState('')
  const [fLoc, setFLoc] = useState('')
  const [fCo, setFCo] = useState('')
  // Raised between these days, inclusive (yyyy-mm-dd). Either end may be open.
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null)
  const trigRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const uid = useRef(`mrfp-${Math.random().toString(36).slice(2, 9)}`).current

  // Reshape once per list — names resolved from the lookups the page already holds.
  const rows: Row[] = useMemo(() => {
    const byId = (list: Named[] | undefined) => {
      const m = new Map<string, any>()
      for (const x of list || []) m.set(x.id, x)
      return (id: any) => (id ? m.get(id) : undefined)
    }
    const dept = byId(departments), loc = byId(locations), co = byId(companies)
    return (mrfs || []).map((m: any) => {
      const d = dept(m.department_id), l = loc(m.location_id), c = co(m.company_id)
      const r: Row = {
        id: m.id,
        title: m.job_title || m.designation || m.position || 'Untitled',
        number: m.mrf_number || '',
        dept: d?.dept_name || m.dept_name || m.departments?.dept_name || m.department || '',
        loc: l?.location_name || m.location_name || m.locations?.location_name || '',
        company: c?.company_name || c?.company_code || m.companies?.company_name || '',
        companyId: m.company_id || '',
        openings: Number(m.no_of_openings || m.openings || 0),
        raised: fmtDate(m.created_at),
        day: dayKey(m.created_at),
        confidential: isConfidentialMrf(m),
        hay: '',
      }
      r.hay = [r.title, m.designation, m.position, r.number, r.dept, r.loc, r.company,
        m.assigned_recruiter, m.hiring_manager, m.hiring_manager_name, m.raised_by_name, m.reporting_manager_name]
        .filter(Boolean).join(' ').toLowerCase()
      return r
    })
  }, [mrfs, departments, locations, companies])

  const multiCompany = useMemo(() => new Set(rows.map(r => r.companyId).filter(Boolean)).size > 1, [rows])
  const distinct = (k: 'dept' | 'loc' | 'company') => Array.from(new Set(rows.map(r => r[k]).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  const deptOpts = useMemo(() => distinct('dept'), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const locOpts = useMemo(() => distinct('loc'), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const coOpts = useMemo(() => distinct('company'), [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const ql = q.trim().toLowerCase()
  const hits = rows.filter(r =>
    (!fDept || r.dept === fDept) && (!fLoc || r.loc === fLoc) && (!fCo || r.company === fCo) &&
    (!fFrom || (!!r.day && r.day >= fFrom)) && (!fTo || (!!r.day && r.day <= fTo)) &&
    (!ql || ql.split(/\s+/).every(t => r.hay.includes(t))))
  const filtersOn = !!(fDept || fLoc || fCo || fFrom || fTo || ql)
  const selected = rows.find(r => r.id === value) || null

  const place = () => {
    const el = trigRef.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const width = Math.min(Math.max(b.width, 360), vw - 16)
    const left = Math.max(8, Math.min(b.left, vw - width - 8))
    const below = vh - b.bottom - 12, above = b.top - 12
    // Open downward unless there is clearly more room above.
    if (below >= 300 || below >= above) setPos({ left, top: b.bottom + 4, width, maxH: Math.max(200, Math.min(460, below)) })
    else setPos({ left, bottom: vh - b.top + 4, width, maxH: Math.max(200, Math.min(460, above)) })
  }

  const openPanel = () => {
    if (disabled) return
    place()
    const i = hits.findIndex(r => r.id === value)
    setActive(i >= 0 ? i : 0)
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) trigRef.current?.focus()
  }
  const pick = (r: Row) => {
    onChange(r.id)
    close()
  }

  useLayoutEffect(() => { if (open) place() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) searchRef.current?.focus() }, [open])
  // Keep the panel attached to its trigger while the modal body or the window scrolls.
  useEffect(() => {
    if (!open) return
    const onMove = () => place()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (trigRef.current?.contains(t) || panelRef.current?.contains(t)) return
      close(false)
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // The active row stays in range as the list narrows, and in view as it moves.
  useEffect(() => { if (active >= hits.length) setActive(Math.max(0, hits.length - 1)) }, [hits.length, active])
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onTrigKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel() }
  }
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
    else if ((e.target as HTMLElement).tagName === 'SELECT') return
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(hits.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Home' && (e.target as HTMLElement) !== searchRef.current) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && (e.target as HTMLElement) !== searchRef.current) { e.preventDefault(); setActive(hits.length - 1) }
    else if (e.key === 'Enter') { e.preventDefault(); const r = hits[active]; if (r) pick(r) }
  }
  const clearFilters = () => { setQ(''); setFDept(''); setFLoc(''); setFCo(''); setFFrom(''); setFTo(''); setActive(0); searchRef.current?.focus() }

  const trigBase: React.CSSProperties = className ? {} : inputStyle(invalid)
  const listId = `${uid}-list`

  const meta = (r: Row) => [r.dept, r.loc, multiCompany ? r.company : '', openingsLabel(r.openings), r.raised ? `raised ${r.raised}` : '']
    .filter(Boolean).join(' · ')

  return (
    <>
      <button ref={trigRef} type="button" id={id} className={className} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={ariaLabel}
        onClick={() => (open ? close() : openPanel())} onKeyDown={onTrigKey}
        title={selected ? `${selected.title}${selected.number ? ` · ${selected.number}` : ''} — ${meta(selected)}` : undefined}
        style={{
          ...trigBase, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', minWidth: 0, ...(invalid && className ? { borderColor: C.critical } : {}), ...style,
        }}>
        {selected ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            {selected.confidential && <span aria-label="Confidential" title="Confidential search">🔒</span>}
            <span style={{ fontWeight: W.semi, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.title}</span>
            {selected.number && <Chip text={selected.number} strong />}
            <span style={{ fontSize: F.tiny, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {[selected.loc, openingsLabel(selected.openings)].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : (
          <span style={{ flex: 1, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{placeholder}</span>
        )}
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" style={{ flexShrink: 0, color: C.muted, transform: open ? 'rotate(180deg)' : undefined, transition: `transform ${M.quick}` }}>
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} onKeyDown={onPanelKey}
          style={{
            position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH,
            zIndex: Z.modal + 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: C.surface, color: C.ink, border: `1px solid ${C.lineStrong}`, borderRadius: R.md, boxShadow: E.floating,
            fontFamily: F.family, fontSize: F.small,
          }}>
          {/* search + filters */}
          <div style={{ padding: 10, borderBottom: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <input ref={searchRef} type="text" value={q} onChange={e => { setQ(e.target.value); setActive(0) }}
              role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={hits[active] ? `${uid}-o-${hits[active].id}` : undefined}
              aria-label="Search openings"
              placeholder="Search designation, MRF number, department, location, hiring manager…"
              style={{ ...inputStyle(false), height: 34 }} />
            {/* Always shown: the date range narrows by when the MRF was raised, even with one department. */}
            {(
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {deptOpts.length > 1 && <FilterSelect label="Department" value={fDept} options={deptOpts} onChange={v => { setFDept(v); setActive(0) }} />}
                {locOpts.length > 1 && <FilterSelect label="Location" value={fLoc} options={locOpts} onChange={v => { setFLoc(v); setActive(0) }} />}
                {multiCompany && coOpts.length > 1 && <FilterSelect label="Company" value={fCo} options={coOpts} onChange={v => { setFCo(v); setActive(0) }} />}
                <DateFilter label="From" value={fFrom} max={fTo} onChange={v => { setFFrom(v); setActive(0) }} />
                <DateFilter label="To" value={fTo} min={fFrom} onChange={v => { setFTo(v); setActive(0) }} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: F.micro, color: C.muted }}>
              <span>{hits.length === rows.length ? `${rows.length} opening${rows.length === 1 ? '' : 's'}` : `${hits.length} of ${rows.length} openings`}</span>
              {filtersOn && (
                <button type="button" onClick={clearFilters}
                  style={{ border: 'none', background: 'transparent', color: C.brand, fontSize: F.micro, fontWeight: W.semi, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                  Clear search &amp; filters
                </button>
              )}
            </div>
          </div>

          {/* options */}
          <div ref={listRef} id={listId} role="listbox" aria-label="Openings" style={{ overflowY: 'auto', padding: 4, flex: 1, minHeight: 0 }}>
            {hits.length === 0 && (
              <div style={{ padding: '18px 12px', textAlign: 'center', color: C.faint, fontSize: F.tiny }}>
                {rows.length === 0 ? 'No openings to choose from.' : 'No opening matches the search or filters.'}
              </div>
            )}
            {hits.map((r, i) => {
              const isSel = r.id === value, isAct = i === active
              return (
                <div key={r.id} id={`${uid}-o-${r.id}`} data-idx={i} role="option" aria-selected={isSel}
                  onMouseMove={() => { if (!isAct) setActive(i) }}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(r)}
                  style={{
                    padding: '8px 10px', borderRadius: R.sm, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start',
                    background: isAct ? C.brandTint : 'transparent',
                    boxShadow: isSel ? `inset 3px 0 0 ${C.brand}` : undefined,
                  }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      {r.confidential && <span aria-label="Confidential" title="Confidential search">🔒</span>}
                      <span style={{ fontWeight: W.bold, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{r.title}</span>
                      {r.number ? <Chip text={r.number} strong /> : <Chip text="No MRF number" />}
                    </div>
                    <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta(r)}</div>
                  </div>
                  {isSel && <span aria-hidden="true" style={{ color: C.brand, fontWeight: W.bold, flexShrink: 0 }}>✓</span>}
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
