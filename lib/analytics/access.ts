// lib/analytics/access.ts — who sees which slice of People Analytics. Pure.
//
// Two ways into the organisation view:
//
//   role    holding Reports / Company Dashboard / ESS Reports. Every company the role
//           covers, every tab; pay and named lists by the narrower modules
//           (lib/analytics/server/org-request.ts). This is how it worked before 232.
//   grant   a row in analytics_access (migration 232), set from Manage access. The row
//           decides: which companies, locations, departments and employment types, which
//           tabs, and whether names, pay and downloads are on. A row may narrow a role
//           or open analytics to somebody with no reporting role at all.
//
// Super Admin is never limited. Everything here is applied on the server; the screen
// only hides what the server already left out.

import type { OrgAnalytics } from './types.ts'
import type { FactPack } from './ai/types.ts'

export const ORG_TABS = ['workforce', 'attrition', 'attendance', 'performance', 'hiring', 'cost'] as const
export type OrgTab = (typeof ORG_TABS)[number]

export const TAB_LABEL: Record<OrgTab, string> = {
  workforce: 'Workforce', attrition: 'Attrition & retention', attendance: 'Attendance & leave',
  performance: 'Performance & learning', hiring: 'Hiring', cost: 'Pay & cost',
}

/** The tab a finding / fact area belongs to. */
export const AREA_TAB: Record<string, OrgTab> = {
  workforce: 'workforce', attrition: 'attrition', attendance: 'attendance', leave: 'attendance',
  performance: 'performance', learning: 'performance', hiring: 'hiring', cost: 'cost',
}

/** The payload sections each tab draws from. */
const TAB_SECTIONS: Record<OrgTab, (keyof OrgAnalytics)[]> = {
  workforce: ['workforce'], attrition: ['attrition'], attendance: ['attendance', 'leave'],
  performance: ['performance', 'learning'], hiring: ['hiring'], cost: ['cost'],
}

/** The tab behind each Pulse headline and month-to-date line. */
const KPI_TAB: Record<string, OrgTab> = {
  headcount: 'workforce', joiners: 'attrition', exits: 'attrition', attrition: 'attrition',
  ontime: 'attendance', leave: 'attendance', open: 'hiring', applicants: 'hiring', cost: 'cost', pms: 'performance',
}

/** A data limit: null on a field means "no limit on that field". */
export interface DataLimit {
  companies: string[] | null
  departments: string[] | null
  locations: string[] | null
  types: string[] | null
}

export interface OrgAccess {
  via: 'super' | 'role' | 'grant'
  cost: boolean
  people: boolean
  export: boolean
  tabs: OrgTab[]
  /** Null for role and super access: the role's company scope is the only limit. */
  limit: DataLimit | null
  /** Last day a grant applies, when it has one. */
  until: string | null
}

/** One analytics_access row, as stored. */
export interface AccessRow {
  employee_id: string
  company_ids: string[] | null
  locations: string[] | null
  departments: string[] | null
  employment_types: string[] | null
  tabs: string[] | null
  see_names: boolean
  see_pay: boolean
  can_export: boolean
  valid_until: string | null
  note?: string | null
  is_active: boolean
  granted_by_name?: string | null
  updated_at?: string | null
}

const list = (x: unknown): string[] | null => {
  if (!Array.isArray(x)) return null
  const out = [...new Set(x.map(v => String(v ?? '').trim()).filter(Boolean))]
  return out.length ? out : null
}

/** Does a row apply today? Inactive and expired rows are as if absent. */
export function rowApplies(row: Pick<AccessRow, 'is_active' | 'valid_until'> | null | undefined, today: string): boolean {
  if (!row || !row.is_active) return false
  return !row.valid_until || String(row.valid_until).slice(0, 10) >= today
}

/** The tabs a row opens. No list = every tab; Pay & cost only ever with see_pay. */
export function rowTabs(row: Pick<AccessRow, 'tabs' | 'see_pay'>): OrgTab[] {
  const asked = list(row.tabs)
  const base = asked ? ORG_TABS.filter(t => asked.includes(t)) : [...ORG_TABS]
  return base.filter(t => t !== 'cost' || row.see_pay)
}

export function accessFromRow(row: AccessRow): OrgAccess {
  const tabs = rowTabs(row)
  return {
    via: 'grant',
    cost: tabs.includes('cost'),
    people: !!row.see_names,
    export: row.can_export !== false,
    tabs,
    limit: {
      companies: list(row.company_ids),
      departments: list(row.departments),
      locations: list(row.locations),
      types: list(row.employment_types),
    },
    until: row.valid_until ? String(row.valid_until).slice(0, 10) : null,
  }
}

export function roleAccess(opts: { cost: boolean; people: boolean; superAdmin?: boolean }): OrgAccess {
  return {
    via: opts.superAdmin ? 'super' : 'role',
    cost: opts.cost, people: opts.people, export: true,
    tabs: ORG_TABS.filter(t => t !== 'cost' || opts.cost),
    limit: null, until: null,
  }
}

/** Is a value allowed by one field of a limit? */
export const allows = (field: string[] | null | undefined, value: string | null | undefined) =>
  !field || (value != null && field.includes(value))

/** A pick from a filter dropdown, kept only when the limit allows it. */
export const allowedPick = (field: string[] | null | undefined, pick: string | null | undefined) =>
  pick && allows(field, pick) ? pick : null

/** "Pune, Mumbai · Sales · Permanent" — the limit in words, for the page and the AI. */
export function limitLabel(limit: DataLimit | null | undefined, companyName?: (id: string) => string | undefined): string {
  if (!limit) return ''
  const names = (l: string[] | null, max = 3) => (l ? (l.length > max ? `${l.slice(0, max).join(', ')} +${l.length - max}` : l.join(', ')) : '')
  return [
    limit.companies && companyName ? names(limit.companies.map(id => companyName(id) || 'Company')) : '',
    names(limit.locations), names(limit.departments), names(limit.types),
  ].filter(Boolean).join(' · ')
}

// ── Taking out what a person may not see ────────────────────────────────────

/** Same shape, no content: lists empty, figures null. Never drawn — the tab is hidden —
 *  but nothing of it reaches the browser either. */
function blank(v: unknown): any {
  if (Array.isArray(v)) return []
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)]))
  if (typeof v === 'boolean') return false
  return null
}

/** The payload with every section outside `tabs` emptied, and Pulse limited to the
 *  headlines, lines and findings of the tabs allowed. */
export function redactTabs(body: OrgAnalytics, tabs: OrgTab[]): OrgAnalytics {
  const ok = new Set(tabs)
  const out: any = { ...body, access: { ...body.access, tabs: [...tabs] } }
  for (const t of ORG_TABS) {
    if (ok.has(t)) continue
    for (const k of TAB_SECTIONS[t]) out[k] = k === 'cost' ? null : blank(body[k])
  }
  const keep = (key: string) => { const t = KPI_TAB[key]; return !t || ok.has(t) }
  out.pulse = {
    kpis: body.pulse.kpis.filter(k => keep(k.key)),
    changes: body.pulse.changes.filter(c => keep(c.key)),
    insights: body.pulse.insights.filter(i => ok.has(AREA_TAB[i.area])),
    flow: ok.has('workforce') || ok.has('attrition') ? body.pulse.flow : [],
  }
  return out as OrgAnalytics
}

/** The AI fact sheet limited to the tabs allowed — the model is never told about a
 *  tab its reader cannot open. */
export function restrictPack(pack: FactPack, tabs: OrgTab[]): FactPack {
  const ok = (area: string) => { const t = AREA_TAB[area]; return !t || tabs.includes(t) }
  return {
    ...pack,
    scopeKey: JSON.stringify({ k: pack.scopeKey, tabs: [...tabs].sort() }),
    facts: pack.facts.filter(f => ok(f.area)),
    signals: pack.signals.filter(f => ok(f.area)),
    areas: pack.areas.filter(ok),
    noteAreas: pack.noteAreas.filter(ok),
  }
}

// ── Starting points for the Manage access form ──────────────────────────────

export interface AccessPreset {
  key: string
  label: string
  hint: string
  tabs: OrgTab[]
  names: boolean
  pay: boolean
}

export const PRESETS: AccessPreset[] = [
  { key: 'chro', label: 'CHRO / HR head', hint: 'Everything, with names and pay', tabs: [...ORG_TABS], names: true, pay: true },
  { key: 'hrm', label: 'HR manager', hint: 'Everything except pay', tabs: ['workforce', 'attrition', 'attendance', 'performance', 'hiring'], names: true, pay: false },
  { key: 'site', label: 'Site / location head', hint: 'People, attendance and hiring for their site', tabs: ['workforce', 'attendance', 'hiring'], names: true, pay: false },
  { key: 'leader', label: 'Leadership, figures only', hint: 'Every tab, no names', tabs: [...ORG_TABS], names: false, pay: true },
]
