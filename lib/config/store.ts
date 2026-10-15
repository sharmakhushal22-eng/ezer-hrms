// lib/config/store.ts — finding the right template text for a company / branch, server side.
//
// Every workflow asks the same question — "what is the text of <template> for this
// branch of this company?" — and gets the answer from here:
//
//   1. that branch's published version            (Configuration, branch scope)
//   2. else that company's published version      (Configuration, company scope)
//   3. else the Global published version          (Configuration, Global scope)
//   4. else the built-in wording                  (lib/config/registry.ts)
//
// Only rows that are active and have been published (version > 0) count; a draft
// never reaches a letter. Nothing is cached, so a publish is live on the very next
// send — no deploy.
//
// If the tables are missing (migration 136 not applied) or the read fails, the
// built-in wording is used and the workflow carries on. Before migration 137 adds the
// branch level, branch versions are simply not looked for. A broken Configuration must
// never stop an offer from going out.
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { MERGE_FIELDS, sampleMergeFields } from '@/lib/letters/mergeFields'
import { hrLetterDef, hrLetterIdOf, isHrLetterKey, systemTemplate, type TemplateDef } from './registry'
import { renderText, stripMarkup, toEmailHtml, type Vars } from './render'

export type TemplateSource = 'BRANCH' | 'COMPANY' | 'GLOBAL' | 'DEFAULT'

/** Where a template is being used: the record's company and, when known, its branch
 *  (locations.id). A bare string is a company id, for callers that have no branch. */
export interface Scope { companyId?: string | null; locationId?: string | null }
export type ScopeArg = string | null | undefined | Scope

export function scopeOf(arg: ScopeArg): { companyId: string | null; locationId: string | null } {
  if (arg == null || typeof arg === 'string') return { companyId: isUuid(arg) ? arg : null, locationId: null }
  return { companyId: isUuid(arg.companyId) ? arg.companyId : null, locationId: isUuid(arg.locationId) ? arg.locationId : null }
}

export interface ResolvedTemplate {
  key: string
  subject: string
  body: string
  source: TemplateSource
  /** Published version number at its level; 0 for the built-in wording. */
  version: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s)

export interface LetterTemplateRow { id: string; name: string; description: string | null; content: string | null; is_active?: boolean }

export function hrLetterDefFromRow(row: LetterTemplateRow): TemplateDef {
  return hrLetterDef(row, MERGE_FIELDS, sampleMergeFields())
}

/** All active HR letter types, as editable templates. */
export async function listHrLetterDefs(): Promise<TemplateDef[]> {
  const { data } = await sb.from('letter_templates')
    .select('id, name, description, content, is_active').eq('is_active', true).order('name')
  return ((data || []) as LetterTemplateRow[]).map(hrLetterDefFromRow)
}

/** The definition behind a key — a system template, or an HR letter type. */
export async function getDefinition(key: string): Promise<TemplateDef | null> {
  const sys = systemTemplate(key)
  if (sys) return sys
  if (!isHrLetterKey(key)) return null
  const id = hrLetterIdOf(key)
  if (!isUuid(id)) return null
  const { data } = await sb.from('letter_templates').select('id, name, description, content, is_active').eq('id', id).maybeSingle()
  return data ? hrLetterDefFromRow(data as LetterTemplateRow) : null
}

type LiveRow = { company_id: string | null; location_id?: string | null; subject: string | null; body: string | null; version: number }

/** The published text for a scope (branch → company → Global → built-in). Null only
 *  when the key itself is unknown. */
export async function resolveTemplate(key: string, scope?: ScopeArg): Promise<ResolvedTemplate | null> {
  const def = await getDefinition(key)
  if (!def) return null
  const fallback: ResolvedTemplate = { key, subject: def.defaults.subject, body: def.defaults.body, source: 'DEFAULT', version: 0 }

  const { locationId: location } = scopeOf(scope)
  let company = scopeOf(scope).companyId
  // A branch without its company (a caller that only knows the location) — look it up.
  if (location && !company) {
    const { data: loc } = await sb.from('locations').select('company_id').eq('id', location).maybeSingle()
    company = (loc as { company_id: string | null } | null)?.company_id ?? null
  }
  const base = (cols: string) => sb.from('config_templates').select(cols)
    .eq('template_key', key).eq('is_active', true).gt('version', 0)
    .or(company ? `company_id.is.null,company_id.eq.${company}` : 'company_id.is.null')
  let res = await base('company_id, location_id, subject, body, version')
  // Before migration 137 there is no location_id column: look up company and Global only.
  if (res.error && /location_id/.test(res.error.message || '')) res = await base('company_id, subject, body, version') as typeof res
  if (res.error) {
    console.warn(`config: using built-in "${key}" — ${res.error.message}`)
    return fallback
  }
  const rows = (res.data || []) as unknown as LiveRow[]
  const pick = (location && rows.find(r => r.location_id === location))
    || rows.find(r => r.company_id && r.company_id === company && !r.location_id)
    || rows.find(r => !r.company_id && !r.location_id)
  if (!pick) return fallback
  return {
    key,
    subject: pick.subject ?? '',
    body: pick.body ?? '',
    source: pick.location_id ? 'BRANCH' : pick.company_id ? 'COMPANY' : 'GLOBAL',
    version: pick.version,
  }
}

export interface RenderedEmail {
  subject: string
  /** Plain-text part (bold markers removed). */
  text: string
  /** HTML part — escaped, bold kept, line breaks as <br>. */
  html: string
  /** The body exactly as rendered, with **bold** markers — for an editable textarea. */
  raw: string
  template: { key: string; source: TemplateSource; version: number }
}

/** A data block inside an email — a facts table, a call-to-action button — that the code
 *  draws and the template only places (a block variable, on a line of its own). */
export interface EmailBlock { text: string; html: string }

const marker = (name: string) => `@@EZBLOCK_${name}@@`

/** Fill an already-resolved template — for a workflow that sends the same template to
 *  several people and should look it up once. `blocks` fill block variables: their text
 *  goes into the plain part, their HTML into the HTML part unescaped. */
export function renderResolvedEmail(t: ResolvedTemplate, vars: Vars, blocks: Record<string, EmailBlock> = {}): RenderedEmail {
  const names = Object.keys(blocks)
  const withMarkers: Vars = { ...vars, ...Object.fromEntries(names.map(n => [n, marker(n)])) }
  const subject = renderText(t.subject, vars).text.replace(/\s*\n\s*/g, ' ')
  const rendered = renderText(t.body, withMarkers).text
  let raw = rendered, text = stripMarkup(rendered), html = toEmailHtml(rendered)
  for (const n of names) {
    const m = marker(n)
    raw = raw.split(m).join(blocks[n].text)
    text = text.split(m).join(blocks[n].text)
    // A block on its own line: drop the line breaks around it, the block brings its own spacing.
    html = html.split(`<br><br>${m}<br><br>`).join(blocks[n].html).split(m).join(blocks[n].html)
  }
  return { subject, text, html, raw, template: { key: t.key, source: t.source, version: t.version } }
}

/** Resolve and fill an email template in one step. Throws only for an unknown key
 *  (a programming error, not a data one). */
export async function renderEmail(key: string, scope: ScopeArg, vars: Vars, blocks?: Record<string, EmailBlock>): Promise<RenderedEmail> {
  const t = await resolveTemplate(key, scope)
  if (!t) throw new Error(`Unknown template "${key}"`)
  return renderResolvedEmail(t, vars, blocks)
}

export interface RenderedNotification {
  title: string
  body: string
  template: { key: string; source: TemplateSource; version: number }
}

/** Fill an already-resolved in-app notification template (title = subject, plain text). */
export function renderResolvedNotification(t: ResolvedTemplate, vars: Vars): RenderedNotification {
  return {
    title: stripMarkup(renderText(t.subject, vars).text.replace(/\s*\n\s*/g, ' ')),
    body: stripMarkup(renderText(t.body, vars).text),
    template: { key: t.key, source: t.source, version: t.version },
  }
}

/** Resolve and fill an in-app notification (bell / Tasks & Approvals) in one step. */
export async function renderNotification(key: string, scope: ScopeArg, vars: Vars): Promise<RenderedNotification> {
  const t = await resolveTemplate(key, scope)
  if (!t) throw new Error(`Unknown template "${key}"`)
  return renderResolvedNotification(t, vars)
}

// ── Where a record lives — the scope its templates are looked up for ─────────
// Each returns { companyId, locationId } (either may be null) and never throws: a failed
// lookup just means the company / Global / built-in text is used.

type Sc = { companyId: string | null; locationId: string | null }
const NONE: Sc = { companyId: null, locationId: null }
const one = async (table: string, cols: string, id: string | null | undefined): Promise<any> => {
  if (!isUuid(id)) return null
  try { return (await sb.from(table).select(cols).eq('id', id).maybeSingle()).data } catch { return null }
}

/** An employee's company and branch (employees.location_id). */
export async function employeeScope(employeeId: string | null | undefined): Promise<Sc> {
  const e = await one('employees', 'company_id, location_id', employeeId)
  return e ? { companyId: e.company_id ?? null, locationId: e.location_id ?? null } : NONE
}

/** An MRF's company and the branch it hires for. */
export async function mrfScope(mrfId: string | null | undefined, companyId?: string | null): Promise<Sc> {
  const m = await one('manpower_requisitions', 'company_id, location_id', mrfId)
  return { companyId: companyId || m?.company_id || null, locationId: m?.location_id ?? null }
}

/** A candidate's company and the branch of the MRF they were hired against. */
export async function candidateScope(candidateId: string | null | undefined, companyId?: string | null): Promise<Sc> {
  const c = await one('candidates', 'company_id, mrf_id', candidateId)
  return mrfScope(c?.mrf_id, companyId || c?.company_id || null)
}

/** An onboarding record's company and branch. */
export async function onboardingScope(onboardingId: string | null | undefined): Promise<Sc> {
  const o = await one('onboarding_candidates', 'company_id, location_id', onboardingId)
  return o ? { companyId: o.company_id ?? null, locationId: o.location_id ?? null } : NONE
}
