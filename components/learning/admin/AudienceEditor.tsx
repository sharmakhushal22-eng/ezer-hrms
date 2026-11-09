'use client'
// components/learning/admin/AudienceEditor.tsx — choosing people. Used by the assign form, the
// automation rules and a restricted course. The logic is the database's (lms_match_employees):
// same type means any of them, different types must all match, a person named directly is
// always in, and anyone left out stays out.
import { useEffect, useRef, useState } from 'react'
import { lmsApi } from '@/lib/lms/client'
import { C, F, R, S, W, numeric } from '@/lib/ui'
import { Chip, Hint, PickList, Toggle, plural, row, stack, type PickOption, type Target } from './shared'

export interface Lookups {
  employees: { id: string; emp_code: string; full_name: string; designation: string | null }[]
  departments: { id: string; dept_name: string }[]
  locations: { id: string; location_name: string }[]
  designations: string[]; grades: string[]; employment_types: string[]; employee_categories: string[]; teams: string[]; confirmation_statuses: string[]
  skills: string[]
}

export const KIND_LABEL: Record<string, string> = {
  EMPLOYEE: 'People', DEPARTMENT: 'Department', DESIGNATION: 'Designation', LOCATION: 'Location', TEAM: 'Team', GRADE: 'Grade',
  EMPLOYMENT_TYPE: 'Employment type', EMPLOYEE_CATEGORY: 'Employee category', CONFIRMATION_STATUS: 'Confirmation status', MANAGER: 'Reports of a manager',
}
export const ASSIGN_KINDS = ['EMPLOYEE', 'DEPARTMENT', 'DESIGNATION', 'LOCATION', 'TEAM', 'GRADE', 'EMPLOYMENT_TYPE', 'EMPLOYEE_CATEGORY', 'CONFIRMATION_STATUS', 'MANAGER']

const plain = (list?: string[]): PickOption[] => (list || []).map(v => ({ value: v, label: v }))

function optionsFor(kind: string, l: Lookups | null): PickOption[] {
  if (!l) return []
  switch (kind) {
    case 'EMPLOYEE':
    case 'MANAGER':
      return l.employees.map(e => ({ value: e.id, label: e.full_name, meta: [e.emp_code, e.designation].filter(Boolean).join(' · ') }))
    case 'DEPARTMENT': return l.departments.map(d => ({ value: d.id, label: d.dept_name }))
    case 'LOCATION': return l.locations.map(d => ({ value: d.id, label: d.location_name }))
    case 'DESIGNATION': return plain(l.designations)
    case 'TEAM': return plain(l.teams)
    case 'GRADE': return plain(l.grades)
    case 'EMPLOYMENT_TYPE': return plain(l.employment_types)
    case 'EMPLOYEE_CATEGORY': return plain(l.employee_categories)
    case 'CONFIRMATION_STATUS': return plain(l.confirmation_statuses)
    default: return []
  }
}

function KindPicker({ kinds, value, counts, onChange }: { kinds: string[]; value: string; counts: Record<string, number>; onChange: (k: string) => void }) {
  return (
    <div style={row(6)}>
      {kinds.map(k => {
        const on = k === value
        return (
          <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={on}
            style={{ padding: '5px 10px', borderRadius: R.pill, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brandTint : C.surface, color: on ? C.brandDeep : C.inkSoft, fontFamily: 'inherit', fontSize: F.tiny, fontWeight: on ? W.semi : W.medium, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {KIND_LABEL[k]}{counts[k] ? ` (${counts[k]})` : ''}
          </button>
        )
      })}
    </div>
  )
}

function Rows({ rows, onRemove, joiner }: { rows: Target[]; onRemove: (t: Target) => void; joiner: boolean }) {
  const kinds = [...new Set(rows.map(r => r.kind))]
  if (!kinds.length) return null
  return (
    <div style={stack(6)}>
      {kinds.map((k, i) => (
        <div key={k} style={{ display: 'flex', gap: S.sm, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: F.tiny, color: C.muted, fontWeight: W.semi, minWidth: 130 }}>{joiner && i > 0 && k !== 'EMPLOYEE' ? 'and ' : ''}{KIND_LABEL[k]}</span>
          <span style={{ ...row(6), flex: 1 }}>{rows.filter(r => r.kind === k).map(r => <Chip key={r.value} onRemove={() => onRemove(r)}>{r.label || r.value}</Chip>)}</span>
        </div>
      ))}
    </div>
  )
}

function TargetPicker({ kinds, lookups, rows, exclude, onToggle, onRemove }: {
  kinds: string[]; lookups: Lookups | null; rows: Target[]; exclude: boolean
  onToggle: (kind: string, o: PickOption) => void; onRemove: (t: Target) => void
}) {
  const [kind, setKind] = useState(kinds[0])
  const here = kinds.includes(kind) ? kind : kinds[0]
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1
  return (
    <div style={stack(S.sm)}>
      <KindPicker kinds={kinds} value={here} counts={counts} onChange={setKind} />
      <PickList key={here} options={optionsFor(here, lookups)} selected={rows.filter(r => r.kind === here).map(r => r.value)}
        onToggle={o => onToggle(here, o)} placeholder={`Search ${KIND_LABEL[here].toLowerCase()}`} maxHeight={200} emptyText={lookups ? `Nobody has a ${KIND_LABEL[here].toLowerCase()} set yet.` : 'Loading…'} />
      <Rows rows={rows} onRemove={onRemove} joiner={!exclude} />
    </div>
  )
}

export function AudienceEditor({ value, onChange, lookups, kinds = ASSIGN_KINDS, allowCompany, exclusions = true, logicHint = true, everyone }: {
  value: Target[]; onChange: (t: Target[]) => void; lookups: Lookups | null
  kinds?: string[]; allowCompany?: boolean; exclusions?: boolean; logicHint?: boolean
  /** Who "everyone" means here: a rule for joiners or candidates does not reach all staff. */
  everyone?: { label: string; hint: string }
}) {
  const included = value.filter(t => !t.exclude)
  const excluded = value.filter(t => t.exclude)
  const company = included.some(t => t.kind === 'COMPANY')

  const toggle = (exclude: boolean) => (kind: string, o: PickOption) => {
    const same = (t: Target) => t.kind === kind && t.value === o.value && !!t.exclude === exclude
    onChange(value.some(same) ? value.filter(t => !same(t)) : [...value, { kind, value: o.value, label: o.label, exclude }])
  }
  const remove = (t: Target) => onChange(value.filter(x => x !== t))
  const setCompany = (on: boolean) => onChange(on ? [{ kind: 'COMPANY', value: '', label: 'Everyone', exclude: false }, ...excluded] : excluded)

  return (
    <div style={stack()}>
      {logicHint && <Hint>Pick from the same type and anyone matching one of them is included. Pick from different types and people must match all of them. People you name directly are always included.</Hint>}
      {allowCompany && <Toggle label={everyone?.label || 'Everyone in the company'} hint={everyone?.hint || 'Every active employee. You can still leave some out below.'} checked={company} onChange={setCompany} />}
      {!company && <TargetPicker kinds={kinds} lookups={lookups} rows={included} exclude={false} onToggle={toggle(false)} onRemove={remove} />}
      {exclusions && (
        <div style={{ ...stack(S.sm), paddingTop: S.sm, borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>Leave out</div>
          <Hint>Anyone matching one of these stays out, even if named above.</Hint>
          <TargetPicker kinds={kinds} lookups={lookups} rows={excluded} exclude onToggle={toggle(true)} onRemove={remove} />
        </div>
      )}
    </div>
  )
}

/** The live count. Debounced, because each change would otherwise ask the database again. */
export function AudiencePreview({ company, targets, trigger, joinWindowDays }: { company: string; targets: Target[]; trigger: string; joinWindowDays?: number | null }) {
  const [state, setState] = useState<{ key: string; error: string; count: number | null; sample: any[] }>({ key: '', error: '', count: null, sample: [] })
  const seq = useRef(0)
  const hasAudience = targets.some(t => !t.exclude)
  const key = JSON.stringify([company, targets, trigger, joinWindowDays])
  const loading = state.key !== key

  useEffect(() => {
    const n = ++seq.current
    if (!hasAudience) return
    const timer = setTimeout(async () => {
      try {
        const r = await lmsApi('/api/lms/admin/assignments', { mode: 'preview', targets, trigger_type: trigger, company_id: company, join_window_days: joinWindowDays ?? undefined })
        if (n === seq.current) setState({ key, error: '', count: r.count ?? 0, sample: r.sample || [] })
      } catch (e: any) {
        if (n === seq.current) setState({ key, error: e?.message || 'Could not count the audience.', count: null, sample: [] })
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasAudience) return <Hint>Choose who this is for to see how many people match.</Hint>
  if (state.error && !loading) return <div style={{ fontSize: F.small, color: C.critical }}>{state.error}</div>
  const word = trigger === 'PREBOARD' ? plural(state.count ?? 0, 'candidate') : plural(state.count ?? 0, 'person', 'people')
  return (
    <div style={stack(S.xs)}>
      <div style={{ fontSize: F.title, fontWeight: W.bold, color: C.ink, opacity: loading ? .5 : 1, ...numeric }}>{state.count == null ? '…' : word}</div>
      <Hint>{trigger === 'ON_JOIN' ? 'match today, among people who joined inside the window.' : trigger === 'PREBOARD' ? 'already invited match. Candidates invited later are picked up too.' : 'match today.'}</Hint>
      {state.sample.length > 0 && (
        <div style={{ ...stack(2), marginTop: S.xs }}>
          {state.sample.map((p: any) => <div key={p.emp_code} style={{ fontSize: F.tiny, color: C.inkSoft }}>{p.full_name}<span style={{ color: C.muted }}> · {p.emp_code}</span></div>)}
          {(state.count ?? 0) > state.sample.length && <Hint>and {(state.count! - state.sample.length).toLocaleString('en-IN')} more</Hint>}
        </div>
      )}
    </div>
  )
}
