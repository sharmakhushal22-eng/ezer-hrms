'use client'
// components/learning/admin/shared.tsx — the pieces every Learning admin screen shares.
//
// Plain helpers first, then small controls. Two of them carry a real rule:
//
//   EditText / EditNumber keep what is being typed in local state and save on blur. A tree
//   refetch can land while someone is mid-sentence in another field, and it must not
//   overwrite them, so a field only takes the server's value while it is neither focused
//   nor holding an unsaved edit. A failed save keeps the typing.
//
//   TextInput carries data-no-titlecase. components/AutoTitleCase rewrites any plain input
//   that looks like a name on blur, which would turn a quiz option "all of the above" into
//   "All Of The Above".
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LmsCaps } from '@/lib/lms/caps'
import {
  Badge, Button, C, Card, F, IconCheck, IconSearch, Input, Notice, R, S, Select, W, inputStyle, numeric, tone, type Tone,
} from '@/lib/ui'

// ── The person and where they are working ───────────────────────────────────
export interface Company { id: string; company_name: string; company_code: string | null }
export interface Ctx {
  caps: LmsCaps
  companies: Company[]
  /** The company in view. Null while someone with several is looking at all of them. */
  company: string | null
  branchOnly: boolean
  me: string | null
}

/** A read, narrowed to the company in view when there is one. */
export const withCompany = (ctx: Pick<Ctx, 'company'>, path: string) =>
  ctx.company ? `${path}${path.includes('?') ? '&' : '?'}company=${ctx.company}` : path

export const companyName = (ctx: Ctx, id: string | null | undefined) => {
  const c = ctx.companies.find(x => x.id === id)
  return c?.company_code || c?.company_name || ''
}

// ── Dates ───────────────────────────────────────────────────────────────────
const IST = 'Asia/Kolkata'
export const day = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }) : '-'
export const when = (s?: string | null) =>
  s ? new Date(s).toLocaleString('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'
/** yyyy-mm-dd of a stored instant, for a date input. */
export const dateValue = (s?: string | null) => {
  if (!s) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s))
  return p.slice(0, 10)
}
export const today = () => dateValue(new Date().toISOString())
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

// ── What the states are called ──────────────────────────────────────────────
type Label = { label: string; t: Tone }
export const COURSE_STATUS: Record<string, Label> = {
  DRAFT: { label: 'Draft', t: 'neutral' }, PUBLISHED: { label: 'Published', t: 'positive' }, ARCHIVED: { label: 'Archived', t: 'warning' },
}
export const VERSION_STATUS: Record<string, Label> = {
  DRAFT: { label: 'Draft', t: 'neutral' }, IN_REVIEW: { label: 'In review', t: 'warning' }, PUBLISHED: { label: 'Live', t: 'positive' }, SUPERSEDED: { label: 'Replaced', t: 'neutral' },
}
export const ENROL_STATUS: Record<string, Label> = {
  NOT_STARTED: { label: 'Not started', t: 'neutral' }, IN_PROGRESS: { label: 'In progress', t: 'info' }, OVERDUE: { label: 'Overdue', t: 'critical' },
  COMPLETED: { label: 'Completed', t: 'positive' }, FAILED: { label: 'Failed', t: 'critical' }, EXPIRED: { label: 'Expired', t: 'warning' },
  WAIVED: { label: 'Waived', t: 'neutral' }, CANCELLED: { label: 'Cancelled', t: 'neutral' }, PENDING_APPROVAL: { label: 'Awaiting approval', t: 'warning' }, REJECTED: { label: 'Rejected', t: 'neutral' },
}
export const ASSIGN_STATUS: Record<string, Label> = {
  SCHEDULED: { label: 'Scheduled', t: 'info' }, ACTIVE: { label: 'Active', t: 'positive' }, PAUSED: { label: 'Paused', t: 'warning' }, CANCELLED: { label: 'Cancelled', t: 'neutral' },
}
export const TRIGGER: Record<string, string> = { ONCE: 'One time', DYNAMIC: 'Keeps applying', ON_JOIN: 'New joiners', PREBOARD: 'Pre-joining' }
export const LESSON_KIND: Record<string, string> = {
  VIDEO: 'Video', AUDIO: 'Audio', DOCUMENT: 'Document', SLIDES: 'Slides', ARTICLE: 'Article', LINK: 'Link', ASSESSMENT: 'Assessment',
  SCORM: 'SCORM package', LIVE: 'Live session',
}

export function StatusBadge({ map, value }: { map: Record<string, Label>; value: string }) {
  const s = map[value] || { label: value, t: 'neutral' as Tone }
  return <Badge t={s.t} size="sm">{s.label}</Badge>
}

export function dueText(a: { due_mode?: string; due_date?: string | null; due_days?: number | null }) {
  const n = a.due_days ?? 0
  switch (a.due_mode) {
    case 'FIXED': return day(a.due_date)
    case 'AFTER_ASSIGN': return `${plural(n, 'day')} after assigned`
    case 'AFTER_JOIN': return `${plural(n, 'day')} after joining`
    case 'BEFORE_JOIN': return `${plural(n, 'day')} before joining`
    default: return 'No due date'
  }
}

// ── Audience, in words ──────────────────────────────────────────────────────
export interface Target { kind: string; value: string; label?: string | null; exclude?: boolean }
const KIND_WORD: Record<string, string> = {
  DEPARTMENT: 'Department', DESIGNATION: 'Designation', LOCATION: 'Location', TEAM: 'Team', GRADE: 'Grade',
  EMPLOYMENT_TYPE: 'Employment type', EMPLOYEE_CATEGORY: 'Employee category', CONFIRMATION_STATUS: 'Confirmation status', MANAGER: 'Reports of',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i
/** A row can arrive with no label (the manager route sends ids only), and a raw id means
 *  nothing to anyone: `names` resolves it, and a count stands in when that fails. */
function targetWords(rows: Target[], names?: Map<string, string>): string[] {
  const named = (list: Target[]) => {
    const known = list.map(t => t.label || names?.get(t.value) || (UUID.test(t.value) ? '' : t.value)).filter(Boolean)
    return { known, unknown: list.length - known.length }
  }
  const out: string[] = []
  if (rows.some(t => t.kind === 'COMPANY')) out.push('Everyone in the company')
  const people = rows.filter(t => t.kind === 'EMPLOYEE')
  if (people.length) {
    const { known, unknown } = named(people)
    out.push(people.length > 3 || !known.length ? plural(people.length, 'person', 'people') : [...known, ...(unknown ? [`${unknown} more`] : [])].join(', '))
  }
  for (const kind of Object.keys(KIND_WORD)) {
    const of = rows.filter(t => t.kind === kind)
    if (!of.length) continue
    const { known, unknown } = named(of)
    out.push(`${KIND_WORD[kind]}: ${[...known, ...(unknown ? [known.length ? `${unknown} more` : plural(unknown, 'entry', 'entries')] : [])].join(', ')}`)
  }
  return out
}
export const audienceWords = (targets: Target[], names?: Map<string, string>) => ({
  include: targetWords(targets.filter(t => !t.exclude), names),
  exclude: targetWords(targets.filter(t => t.exclude), names),
})

// ── Loading ─────────────────────────────────────────────────────────────────
/** `deps` are what the request depends on. Simple values only: they are compared as JSON. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState(false)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const latest = useRef(load)
  const key = JSON.stringify(deps)
  useEffect(() => { latest.current = load })
  // Only the newest request may land: a slow first load must not replace a later one.
  const reload = useCallback(async () => {
    const n = ++seq.current
    setLoading(true)
    try {
      const d = await latest.current()
      if (n === seq.current) { setData(d); setError(''); setSetup(false) }
    } catch (e: any) {
      if (n === seq.current) { setError(e?.message || 'Could not load this.'); setSetup(!!e?.setup) }
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [])
  useEffect(() => { reload() }, [key, reload])
  return { data, error, setup, loading, reload }
}

export function LoadError({ error, setup }: { error: string; setup?: boolean }) {
  if (!error) return null
  if (setup) return <Notice t="warning" title="Learning needs a one-time setup">{error}</Notice>
  return <Notice>{error}</Notice>
}

/** Busy flag, plus what the last action said. Errors from the API are shown as they are. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [note, setNote] = useState('')
  const clear = useCallback(() => { setError(''); setProblems([]); setNote('') }, [])
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true); setError(''); setProblems([]); setNote('')
    try {
      const r = await fn()
      if (ok) setNote(typeof ok === 'function' ? ok(r) : ok)
      return r
    } catch (e: any) {
      setError(e?.message || 'That did not work.')
      setProblems(e?.problems || [])
      return undefined
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, problems, note, run, clear }
}

export function ActionNotes({ a }: { a: { error: string; problems: string[]; note: string } }) {
  return (
    <>
      {a.error && (
        <Notice title={a.problems.length ? a.error : undefined}>
          {a.problems.length
            ? <ul style={{ margin: 0, paddingLeft: 18 }}>{a.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            : a.error}
        </Notice>
      )}
      {a.note && <Notice t="positive">{a.note}</Notice>}
    </>
  )
}

export function NeedCompany({ doing }: { doing: string }) {
  return <Notice t="info" title="Choose a company first">Pick a company at the top of this page to {doing}.</Notice>
}

// ── Layout ──────────────────────────────────────────────────────────────────
export const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: S.md })
export const stack = (gap: number = S.md): React.CSSProperties => ({ display: 'grid', gap, minWidth: 0 })
export const row = (gap: number = S.sm): React.CSSProperties => ({ display: 'flex', gap, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 })

export function Panel({ title, hint, actions, children, style }: {
  title?: string; hint?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties
}) {
  return (
    <Card elevation="flat" style={{ marginBottom: S.lg, ...style }}>
      {(title || actions) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: S.md, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: children ? S.md : 0 }}>
          <div style={{ minWidth: 0 }}>
            {title && <div style={{ fontSize: F.lead, fontWeight: W.semi, color: C.ink }}>{title}</div>}
            {hint && <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Card>
  )
}

export function Hint({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: F.tiny, color: C.muted, lineHeight: 1.5, ...style }}>{children}</div>
}

/** A completion bar drawn with two divs. */
export function Bar({ pct, t = 'brand', width = 120 }: { pct: number; t?: Tone; width?: number | string }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  return (
    <div role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}
      style={{ width, maxWidth: '100%', height: 6, borderRadius: R.pill, background: C.sunken, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${v}%`, height: '100%', borderRadius: R.pill, background: t === 'brand' ? C.brand : tone(t).fg }} />
    </div>
  )
}

export function PctBar({ value, total, t }: { value: number; total: number; t?: Tone }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: S.sm, minWidth: 150 }}>
      <Bar pct={pct} t={t} width={100} />
      <span style={{ fontSize: F.tiny, color: C.inkSoft, ...numeric }}>{Math.round(pct)}%</span>
    </div>
  )
}

export function Pager({ page, size, total, shown, onPage }: { page: number; size: number; total?: number; shown: number; onPage: (p: number) => void }) {
  const last = total != null ? (page + 1) * size >= total : shown < size
  if (page === 0 && last) return total != null && total > 0 ? <Hint style={{ marginTop: S.sm }}>{plural(total, 'row')}</Hint> : null
  return (
    <div style={{ ...row(), marginTop: S.md, justifyContent: 'space-between' }}>
      <Hint>{total != null ? `${(page * size + 1).toLocaleString('en-IN')} to ${Math.min((page + 1) * size, total).toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}` : `Page ${page + 1}`}</Hint>
      <div style={row()}>
        <Button size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" disabled={last} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────
/** A read-only control has to look it: on a live version every field is disabled. */
const lockedStyle = (disabled?: boolean): React.CSSProperties | undefined =>
  disabled ? { background: C.sunken, color: C.inkSoft, borderColor: C.line, cursor: 'not-allowed' } : undefined

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const { style, ...rest } = props
  return <Input data-no-titlecase="" {...(rest as any)} style={{ ...lockedStyle(props.disabled), ...style }} />
}

const textareaStyle = (): React.CSSProperties => ({ ...inputStyle(), height: 'auto', padding: '9px 12px', lineHeight: 1.55, resize: 'vertical', display: 'block' })
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, ...rest } = props
  return <textarea rows={3} {...rest} style={{ ...textareaStyle(), ...lockedStyle(props.disabled), ...style }} />
}

/** Saves when focus leaves. onSave resolving to false means it failed: the typing stays. */
export function EditText({ value, onSave, multiline, rows, placeholder, disabled, type = 'text', autoFocus, label }: {
  value: string | null | undefined; onSave: (v: string) => Promise<unknown> | void
  multiline?: boolean; rows?: number; placeholder?: string; disabled?: boolean; type?: string; autoFocus?: boolean; label?: string
}) {
  const incoming = value ?? ''
  const [draft, setDraft] = useState(incoming)
  const focused = useRef(false)
  const unsaved = useRef(false)
  const saved = useRef(incoming)
  useEffect(() => {
    saved.current = incoming
    if (!focused.current && !unsaved.current) setDraft(incoming)
  }, [incoming])
  const commit = async () => {
    focused.current = false
    if (draft === saved.current) { unsaved.current = false; return }
    unsaved.current = true
    const sent = draft
    const r = await onSave(sent)
    if (r !== false) { saved.current = sent; unsaved.current = false }
  }
  const common = {
    value: draft, placeholder, disabled, 'aria-label': label,
    onFocus: () => { focused.current = true },
    onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { setDraft(e.target.value); unsaved.current = true },
  }
  if (multiline) return <TextArea {...common} rows={rows || 4} autoFocus={autoFocus} />
  return <TextInput {...common} type={type} autoFocus={autoFocus} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}

/** A number where blank means "none". onSave receives null for blank. */
export function EditNumber({ value, onSave, placeholder, disabled, min, max, label }: {
  value: number | string | null | undefined; onSave: (v: number | null) => Promise<unknown> | void
  placeholder?: string; disabled?: boolean; min?: number; max?: number; label?: string
}) {
  const text = value == null ? '' : String(value)
  return (
    <EditNumberInner key={text} text={text} onSave={onSave} placeholder={placeholder} disabled={disabled} min={min} max={max} label={label} />
  )
}

function EditNumberInner({ text, onSave, placeholder, disabled, min, max, label }: {
  text: string; onSave: (v: number | null) => Promise<unknown> | void
  placeholder?: string; disabled?: boolean; min?: number; max?: number; label?: string
}) {
  const [draft, setDraft] = useState(text)
  const [err, setErr] = useState('')
  const commit = async () => {
    if (draft === text) { setErr(''); return }
    const n = draft.trim() === '' ? null : Number(draft)
    if (n != null && (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max))) {
      setErr(min != null && max != null ? `Enter ${min} to ${max}.` : min != null ? `Enter ${min} or more.` : 'Enter a number.')
      return
    }
    setErr('')
    await onSave(n)
  }
  return (
    <>
      <TextInput type="number" inputMode="numeric" value={draft} placeholder={placeholder} disabled={disabled} min={min} max={max} aria-label={label}
        invalid={!!err} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      {err && <div style={{ marginTop: 4, fontSize: F.tiny, color: C.critical }}>{err}</div>}
    </>
  )
}

/** Shows the new value while a save is running. A control bound to server data would
 *  otherwise sit unchanged until the refetch lands, and read as if the click was ignored.
 *  When the save settles the prop takes over, so a failed save falls back by itself. */
function useHeld<T>(value: T) {
  const [held, setHeld] = useState<{ v: T } | null>(null)
  const hold = (v: T, saving: unknown) => {
    setHeld({ v })
    Promise.resolve(saving).finally(() => setHeld(null))
  }
  return [held ? held.v : value, hold] as const
}

export function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => unknown; label: string; hint?: React.ReactNode; disabled?: boolean
}) {
  const [shown, hold] = useHeld(checked)
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .6 : 1, padding: '3px 0', minWidth: 0 }}>
      <input type="checkbox" checked={shown} disabled={disabled} onChange={e => hold(e.target.checked, onChange(e.target.checked))}
        style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: C.brand }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: F.small, fontWeight: W.medium, color: C.ink, lineHeight: 1.4 }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 1, lineHeight: 1.45 }}>{hint}</span>}
      </span>
    </label>
  )
}

export function RadioList<T extends string>({ name, value, options, onChange, disabled }: {
  name: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => unknown; disabled?: boolean
}) {
  const [shown, hold] = useHeld(value)
  return (
    <div role="radiogroup" style={stack(S.xs)}>
      {options.map(o => (
        <label key={o.value} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .6 : 1, padding: '3px 0' }}>
          <input type="radio" name={name} checked={shown === o.value} disabled={disabled} onChange={() => hold(o.value, onChange(o.value))}
            style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: C.brand }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: F.small, fontWeight: W.medium, color: C.ink, lineHeight: 1.4 }}>{o.label}</span>
            {o.hint && <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, marginTop: 1, lineHeight: 1.45 }}>{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}

/** A select that saves as soon as it changes. */
export function SaveSelect({ value, onSave, children, disabled, label }: {
  value: string; onSave: (v: string) => unknown; children: React.ReactNode; disabled?: boolean; label?: string
}) {
  const [shown, hold] = useHeld(value)
  return <Select value={shown} disabled={disabled} aria-label={label} style={lockedStyle(disabled)} onChange={e => hold(e.target.value, onSave(e.target.value))}>{children}</Select>
}

/** Asks once, in place, before a step that cannot be taken back. */
export function ConfirmButton({ label, confirm = 'Yes, do it', question = 'Are you sure?', onConfirm, variant = 'danger', size = 'sm', disabled, icon }: {
  label: string; confirm?: string; question?: string; onConfirm: () => void; variant?: 'danger' | 'secondary' | 'ghost' | 'primary'
  size?: 'sm' | 'md'; disabled?: boolean; icon?: React.ReactNode
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <Button size={size} variant={variant} disabled={disabled} icon={icon} onClick={e => { e.stopPropagation(); setAsking(true) }}>{label}</Button>
  return (
    <span style={row(6)} onClick={e => e.stopPropagation()}>
      <span style={{ fontSize: F.tiny, color: C.inkSoft }}>{question}</span>
      <Button size={size} variant="danger" onClick={() => { setAsking(false); onConfirm() }}>{confirm}</Button>
      <Button size={size} variant="ghost" onClick={() => setAsking(false)}>No</Button>
    </span>
  )
}

export function Chip({ children, onRemove, t = 'neutral' }: { children: React.ReactNode; onRemove?: () => void; t?: Tone }) {
  const k = tone(t)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: R.pill, background: k.bg, border: `1px solid ${k.edge}`, color: C.inkSoft, fontSize: F.tiny, maxWidth: '100%' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove"
          style={{ border: 'none', background: 'transparent', color: C.muted, padding: 0, width: 16, height: 16, lineHeight: 1, fontSize: F.body, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }}>×</button>
      )}
    </span>
  )
}

export function SearchBox({ value, onChange, placeholder, width = 260 }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number | string }) {
  return (
    <div style={{ position: 'relative', width, maxWidth: '100%' }}>
      <span style={{ position: 'absolute', left: 10, top: 12, color: C.faint, display: 'flex' }}><IconSearch size={14} /></span>
      <TextInput value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} style={{ paddingLeft: 30 }} />
    </div>
  )
}

export interface PickOption { value: string; label: string; meta?: string }

/** A searchable list you tick things in. The list stops at `limit`; the search finds the rest. */
export function PickList({ options, selected, onToggle, placeholder = 'Search', maxHeight = 220, limit = 80, emptyText = 'Nothing to pick from.' }: {
  options: PickOption[]; selected: string[]; onToggle: (o: PickOption) => void
  placeholder?: string; maxHeight?: number; limit?: number; emptyText?: string
}) {
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const hits = t ? options.filter(o => `${o.label} ${o.meta || ''}`.toLowerCase().includes(t)) : options
  const shown = hits.slice(0, limit)
  const search = options.length > 8
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R.md, overflow: 'hidden', background: C.surface }}>
      {search && (
        <div style={{ padding: S.sm, borderBottom: `1px solid ${C.line}` }}>
          <SearchBox value={q} onChange={setQ} placeholder={placeholder} width="100%" />
        </div>
      )}
      <div className="ez-scroll" style={{ maxHeight, overflowY: 'auto' }}>
        {shown.map(o => {
          const on = selected.includes(o.value)
          return (
            <button key={o.value} type="button" onClick={() => onToggle(o)} className="ez-row"
              style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: '7px 10px', border: 'none', borderBottom: `1px solid ${C.line}`, background: on ? C.brandTint : 'transparent', color: C.ink, fontFamily: 'inherit', fontSize: F.small, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center', border: `1px solid ${on ? C.brand : C.lineStrong}`, background: on ? C.brand : C.surface, color: C.onAccent }}>
                {on && <IconCheck size={11} />}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {o.meta && <span style={{ display: 'block', fontSize: F.tiny, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.meta}</span>}
              </span>
            </button>
          )
        })}
        {!shown.length && <Hint style={{ padding: S.md }}>{t ? 'Nothing matches that search.' : emptyText}</Hint>}
      </div>
      {hits.length > shown.length && <Hint style={{ padding: '6px 10px', borderTop: `1px solid ${C.line}` }}>Showing the first {limit} of {hits.length.toLocaleString('en-IN')}. Search to narrow it down.</Hint>}
    </div>
  )
}

/** A visible button that opens a file dialog. */
export function FilePick({ accept, label, onFile, disabled, variant = 'secondary', size = 'sm' }: {
  accept: string; label: string; onFile: (f: File) => void; disabled?: boolean; variant?: 'secondary' | 'primary'; size?: 'sm' | 'md'
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={input} type="file" accept={accept} style={{ display: 'none' }} aria-label={label}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
      <Button size={size} variant={variant} disabled={disabled} onClick={() => input.current?.click()}>{label}</Button>
    </>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800) } catch { /* the text is on screen to select */ }
    }}>{done ? 'Copied' : label}</Button>
  )
}

// ── Spreadsheets, in the browser ────────────────────────────────────────────
/** A cell starting with these runs as a formula when opened in Excel. */
export const safeCell = (v: unknown) => { const s = v == null ? '' : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s }

export async function downloadSheets(filename: string, sheets: { name: string; rows: unknown[][] }[]) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name)
  XLSX.writeFile(wb, filename)
}

/** The first sheet as rows of trimmed text, keyed by lower-case heading. Blank rows in the
 *  middle stay, so an error's row number is the row the person sees in Excel. */
export async function readSheet(file: File): Promise<Record<string, string>[]> {
  const XLSX = await import('xlsx')
  let wb
  try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }) }
  catch { throw new Error('That file could not be read. Use the Excel template.') }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error('That file has no sheets.')
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', blankrows: true, raw: true })
  const rows = raw.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    const key = k.trim().toLowerCase().replace(/\s+/g, '_')
    // A date cell can land a few seconds before midnight: noon stays on the right day.
    if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3_600_000); return [key, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] }
    return [key, String(v ?? '').trim()]
  })))
  while (rows.length && Object.values(rows[rows.length - 1]).every(v => !v)) rows.pop()
  return rows
}
