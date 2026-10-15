// app/api/config/templates/route.ts — Configuration → letter, email & notification templates.
//
//   GET  ?company_id=…&location_id=…        list every template with its status for that scope
//                                           (no company = Global; company + location = a branch)
//   GET  ?key=…&company_id=…&location_id=…  one template: definition, this scope's row, what it
//                                           inherits, history
//   GET  ?activity=1&company_id=…&location_id=…   recent publishes / restores / resets
//   POST { action, key, company_id, location_id, … }
//                                           save_draft | discard_draft | publish | restore |
//                                           reset | create_letter
//
// Three levels, most specific wins: branch → company → Global → built-in (lib/config/store.ts).
// Server only, service-role key. Permission: lib/config/access.ts — Super Admin edits Global
// and every company and branch; a 'Configuration' grant edits the holder's own company and its
// branches. Publishing goes through config_publish_template() so the live text and its history
// row are written in one transaction (migrations 136, 137).
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { canEditScope, canViewScope, configActor, type ConfigActor } from '@/lib/config/access'
import { getDefinition, isUuid, listHrLetterDefs, resolveTemplate } from '@/lib/config/store'
import { blockVarsOf, hrLetterIdOf, hrLetterKey, isHrLetterKey, SYSTEM_TEMPLATES, type TemplateDef } from '@/lib/config/registry'
import { validateTemplate } from '@/lib/config/render'
import { validateLetterStructure } from '@/lib/config/offer-letter'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const MAX_SUBJECT = 300
const MAX_BODY = 40000

type Scope = { company: string | null; location: string | null }
type DbError = { code?: string; message?: string } | null | undefined

/** True when migration 136 has not been applied (table/function unknown to PostgREST). */
const tableMissing = (e: DbError) => !!e && (e.code === '42P01' || e.code === 'PGRST205' ||
  (/config_template/.test(String(e.message || '')) && /does not exist|schema cache|could not find/i.test(String(e.message || ''))))
/** True when migration 137 (branch level) has not been applied. */
const branchMissing = (e: DbError) => !!e && (/location_id/.test(String(e.message || '')) || e.code === 'PGRST202')
const MIGRATION_HINT = 'Configuration tables are not set up yet — apply supabase/migrations/136_config_templates.sql in the Supabase SQL Editor.'
const BRANCH_HINT = 'Branch-level templates need supabase/migrations/137_config_branch_scope.sql — apply it in the Supabase SQL Editor.'

interface Row {
  id?: string; template_key: string; company_id: string | null; location_id?: string | null; version: number; is_active: boolean
  subject?: string | null; body?: string | null
  draft_body: string | null; draft_subject: string | null; published_at: string | null; published_by_name: string | null
}
interface PostBody {
  action?: string; key?: string; company_id?: string | null; location_id?: string | null; subject?: unknown; body?: unknown
  change_note?: unknown; version_id?: unknown; name?: unknown; description?: unknown
}

/** company_id / location_id from the request → a scope, or an error message. A branch must
 *  belong to the company (it is inferred when only the branch is given). */
async function scopeFrom(companyId: unknown, locationId: unknown): Promise<Scope | string> {
  const c = companyId == null || companyId === '' || companyId === 'GLOBAL' ? null : companyId
  const l = locationId == null || locationId === '' ? null : locationId
  if (c !== null && !isUuid(c)) return 'Invalid company'
  if (l !== null && !isUuid(l)) return 'Invalid branch'
  if (!l) return { company: c as string | null, location: null }
  const { data } = await sb.from('locations').select('company_id').eq('id', l).maybeSingle()
  const owner = (data as { company_id: string | null } | null)?.company_id ?? null
  if (!owner) return 'Branch not found'
  if (c && owner !== c) return 'That branch belongs to another company'
  return { company: owner, location: l as string }
}

/** Filter a config_templates query to exactly this scope's row. */
function exact<Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q, s: Scope, withLocation = true): Q {
  q = s.company ? q.eq('company_id', s.company) : q.is('company_id', null)
  if (withLocation) q = s.location ? q.eq('location_id', s.location) : q.is('location_id', null)
  return q
}

async function allDefinitions(): Promise<TemplateDef[]> {
  return [...SYSTEM_TEMPLATES, ...(await listHrLetterDefs())]
}

function publicDef(d: TemplateDef) {
  return {
    key: d.key, channel: d.channel, module: d.module, label: d.label, description: d.description,
    usedIn: d.usedIn, recipient: d.recipient, subjectLabel: d.subjectLabel, variables: d.variables,
    hrLetter: isHrLetterKey(d.key), letterLayout: d.letterLayout || null,
  }
}

async function companiesFor(actor: ConfigActor) {
  const { data } = await sb.from('companies').select('id, company_name, company_code').order('company_name')
  const all = (data || []) as { id: string; company_name: string; company_code: string | null }[]
  return actor.isSuper ? all : all.filter(c => c.id === actor.companyId)
}

async function branchesOf(companyId: string | null) {
  if (!companyId) return []
  const { data } = await sb.from('locations').select('id, location_name, location_code, city, status').eq('company_id', companyId).order('location_name')
  return ((data || []) as { id: string; location_name: string; location_code: string | null; city: string | null; status: string | null }[])
    .filter(l => !l.status || /active/i.test(l.status))
}

/** Rows that can apply to a scope: Global and the company's own (company + its branches). */
async function rowsFor(s: Scope, select: string): Promise<{ rows: Row[]; error: DbError; branchReady: boolean }> {
  const q = (cols: string) => sb.from('config_templates').select(cols).or(s.company ? `company_id.is.null,company_id.eq.${s.company}` : 'company_id.is.null')
  let res = await q(select + ', location_id')
  if (res.error && branchMissing(res.error)) {
    res = await q(select) as typeof res
    return { rows: (res.data || []) as unknown as Row[], error: res.error, branchReady: false }
  }
  return { rows: (res.data || []) as unknown as Row[], error: res.error, branchReady: true }
}

const live = (r?: Row | null): r is Row => !!r && r.is_active && r.version > 0
const hasDraft = (r?: Row | null) => !!r && (r.draft_body != null || r.draft_subject != null)
const ownRow = (rows: Row[], key: string, s: Scope) => rows.find(r => r.template_key === key
  && (r.company_id || null) === s.company && (r.location_id || null) === s.location)

export async function GET(req: NextRequest) {
  const gate = await configActor(req, 'VIEW')
  if (gate.error) return gate.error
  const actor = gate.actor

  const sp = req.nextUrl.searchParams
  const parsed = await scopeFrom(sp.get('company_id'), sp.get('location_id'))
  if (typeof parsed === 'string') return bad(parsed)
  const scope = parsed
  if (!canViewScope(actor, scope.company)) return bad('That company is outside your access.', 403)

  const access = {
    isSuper: actor.isSuper, level: actor.level, companyId: actor.companyId,
    canEditGlobal: canEditScope(actor, null),
    canEditScope: canEditScope(actor, scope.company),
  }

  // ── Activity ────────────────────────────────────────────────────────────
  if (sp.get('activity')) {
    const base = (cols: string) => sb.from('config_template_versions').select(cols).order('created_at', { ascending: false }).limit(100)
    const filter = <Q extends { eq: (c: string, v: string) => Q; is: (c: string, v: null) => Q }>(q: Q) =>
      scope.location ? q.eq('location_id', scope.location) : scope.company ? q.eq('company_id', scope.company) : (actor.isSuper ? q : q.is('company_id', null))
    let res = await filter(base('id, template_key, company_id, location_id, version, action, change_note, actor_name, created_at'))
    if (res.error && branchMissing(res.error) && !scope.location) res = await filter(base('id, template_key, company_id, version, action, change_note, actor_name, created_at')) as typeof res
    if (res.error) return tableMissing(res.error) ? NextResponse.json({ activity: [], setupNeeded: MIGRATION_HINT }) : bad(res.error.message, 500)
    const defs = await allDefinitions()
    const label = new Map(defs.map(d => [d.key, d.label]))
    const companies = await companiesFor(actor)
    const cname = new Map(companies.map(c => [c.id, c.company_name]))
    const locIds = [...new Set(((res.data || []) as any[]).map(r => r.location_id).filter(Boolean))]
    const { data: locs } = locIds.length ? await sb.from('locations').select('id, location_name').in('id', locIds) : { data: [] as any[] }
    const lname = new Map(((locs || []) as any[]).map(l => [l.id, l.location_name]))
    return NextResponse.json({
      activity: ((res.data || []) as any[]).map(r => ({
        ...r,
        template_label: label.get(r.template_key) || r.template_key,
        company_name: r.company_id ? `${cname.get(r.company_id) || 'Company'}${r.location_id ? ` › ${lname.get(r.location_id) || 'Branch'}` : ''}` : 'Global',
      })),
    })
  }

  // ── One template ────────────────────────────────────────────────────────
  const key = sp.get('key')
  if (key) {
    const def = await getDefinition(key)
    if (!def) return bad('Unknown template', 404)

    const { rows, error, branchReady } = await rowsFor(scope, 'id, template_key, company_id, version, is_active, subject, body, draft_subject, draft_body, draft_updated_at, draft_updated_by_name, published_at, published_by_name')
    const setupNeeded = error && tableMissing(error) ? MIGRATION_HINT : (scope.location && !branchReady ? BRANCH_HINT : null)
    if (error && !tableMissing(error)) return bad(error.message || 'Failed', 500)
    const mine = rows.filter(r => r.template_key === key)
    const row = ownRow(mine, key, scope) || null

    // What this scope falls back to when it has nothing published of its own.
    const companyRow = mine.find(r => r.company_id === scope.company && !r.location_id)
    const globalRow = mine.find(r => !r.company_id && !r.location_id)
    const fall = (r: Row | undefined, source: string) => live(r) ? { subject: r.subject || '', body: r.body || '', source, version: r.version } : null
    const inherited = (scope.location && fall(companyRow, 'COMPANY')) || (scope.company && fall(globalRow, 'GLOBAL'))
      || { subject: def.defaults.subject, body: def.defaults.body, source: 'DEFAULT', version: 0 }
    const current = await resolveTemplate(key, { companyId: scope.company, locationId: scope.location })

    let history: unknown[] = []
    if (row?.id) {
      const { data: h } = await sb.from('config_template_versions')
        .select('id, version, action, subject, body, change_note, actor_name, created_at')
        .eq('template_id', row.id).order('created_at', { ascending: false }).limit(50)
      history = h || []
    }

    return NextResponse.json({
      access, setupNeeded,
      definition: { ...publicDef(def), blockVars: blockVarsOf(def), defaults: def.defaults },
      row, inherited, current, history,
    })
  }

  // ── List ────────────────────────────────────────────────────────────────
  const defs = await allDefinitions()
  const { rows, error, branchReady } = await rowsFor(scope, 'template_key, company_id, version, is_active, draft_body, draft_subject, published_at, published_by_name')
  const setupNeeded = error && tableMissing(error) ? MIGRATION_HINT : (!branchReady ? BRANCH_HINT : null)
  if (error && !tableMissing(error)) return bad(error.message || 'Failed', 500)

  return NextResponse.json({
    access, setupNeeded, branchReady,
    companies: await companiesFor(actor),
    branches: await branchesOf(scope.company),
    templates: defs.map(d => {
      const mine = rows.filter(r => r.template_key === d.key)
      const own = ownRow(mine, d.key, scope)
      const branch = scope.location ? mine.find(r => r.location_id === scope.location) : undefined
      const company = scope.company ? mine.find(r => r.company_id === scope.company && !r.location_id) : undefined
      const global = mine.find(r => !r.company_id && !r.location_id)
      const effective = live(branch) ? 'BRANCH' : live(company) ? 'COMPANY' : live(global) ? 'GLOBAL' : 'DEFAULT'
      return {
        ...publicDef(d),
        effective,
        customisedHere: live(own),
        version: live(own) ? own.version : 0,
        draft: hasDraft(own),
        publishedAt: live(own) ? own.published_at : null,
        publishedBy: live(own) ? own.published_by_name : null,
      }
    }),
  })
}

export async function POST(req: NextRequest) {
  const gate = await configActor(req, 'EDIT')
  if (gate.error) return gate.error
  const actor = gate.actor

  const body = await req.json().catch(() => null) as PostBody | null
  if (!body?.action) return bad('Bad request')

  // A new HR letter type — Global only, like the HR Letters designer it replaces.
  if (body.action === 'create_letter') {
    if (!canEditScope(actor, null)) return bad('Only a Super Admin can add a letter type.', 403)
    const name = String(body.name || '').trim()
    if (!name || name.length > 120) return bad('Give the letter a name (up to 120 characters).')
    const { data, error } = await sb.from('letter_templates')
      .insert({ name, description: String(body.description || '').trim() || null }).select('id').single()
    if (error) return bad(error.message, 500)
    return NextResponse.json({ ok: true, key: hrLetterKey(data.id) })
  }

  const key = String(body.key || '')
  const def = await getDefinition(key)
  if (!def) return bad('Unknown template', 404)
  const parsed = await scopeFrom(body.company_id, body.location_id)
  if (typeof parsed === 'string') return bad(parsed)
  const scope = parsed
  if (!canEditScope(actor, scope.company)) {
    return bad(scope.company ? 'You can edit templates for your own company (and its branches) only.' : 'Only a Super Admin can change the Global default.', 403)
  }

  const note = String(body.change_note || '').trim().slice(0, 500) || null
  const who = { p_actor_id: actor.employeeId, p_actor_name: actor.name }
  const rowQuery = () => exact(sb.from('config_templates').select('*').eq('template_key', key), scope, !!scope.location)
  const fail = (e: DbError) => tableMissing(e) ? bad(MIGRATION_HINT, 503) : (branchMissing(e) && scope.location) ? bad(BRANCH_HINT, 503) : bad(e?.message || 'Failed', 500)

  const checkText = (subject: unknown, text: unknown): string[] | NextResponse => {
    const s = String(subject ?? ''), b = String(text ?? '')
    if (s.length > MAX_SUBJECT) return bad(`${def.subjectLabel} is too long (max ${MAX_SUBJECT} characters).`)
    if (b.length > MAX_BODY) return bad(`The text is too long (max ${MAX_BODY} characters).`)
    const allowed = def.variables.map(v => v.name)
    return [
      ...validateTemplate(s, allowed.filter(n => !blockVarsOf(def).includes(n)), { required: true, label: def.subjectLabel }),
      ...validateTemplate(b, allowed, { required: true, blockVars: blockVarsOf(def), label: 'Body' }),
      ...(def.letterLayout === 'offer' ? validateLetterStructure(b) : []),
    ]
  }

  /** Run a publish/reset function, falling back to the pre-137 signature for company/Global. */
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    let res = await sb.rpc(fn, { ...args, p_location_id: scope.location })
    if (res.error && branchMissing(res.error) && !scope.location) res = await sb.rpc(fn, args)
    return res
  }

  if (body.action === 'save_draft') {
    const s = String(body.subject ?? ''), b = String(body.body ?? '')
    if (s.length > MAX_SUBJECT || b.length > MAX_BODY) return bad('Text is too long.')
    let read = await rowQuery().maybeSingle()
    if (read.error && branchMissing(read.error) && !scope.location) read = await exact(sb.from('config_templates').select('*').eq('template_key', key), scope, false).maybeSingle()
    if (read.error) return fail(read.error)
    const row = read.data as Row | null
    const draft = {
      draft_subject: s, draft_body: b, draft_updated_at: new Date().toISOString(),
      draft_updated_by: actor.employeeId, draft_updated_by_name: actor.name, updated_at: new Date().toISOString(),
    }
    const res = row?.id
      ? await sb.from('config_templates').update(draft).eq('id', row.id)
      : await sb.from('config_templates').insert({ template_key: key, company_id: scope.company, ...(scope.location ? { location_id: scope.location } : {}), ...draft })
    if (res.error) return fail(res.error)
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'discard_draft') {
    let read = await rowQuery().maybeSingle()
    if (read.error && branchMissing(read.error) && !scope.location) read = await exact(sb.from('config_templates').select('*').eq('template_key', key), scope, false).maybeSingle()
    if (read.error) return fail(read.error)
    const row = read.data as Row | null
    if (row?.id) {
      const { error } = await sb.from('config_templates').update({
        draft_subject: null, draft_body: null, draft_updated_at: null, draft_updated_by: null, draft_updated_by_name: null,
      }).eq('id', row.id)
      if (error) return fail(error)
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'publish' || body.action === 'restore') {
    let subject = body.subject, text = body.body, action = 'PUBLISHED'
    if (body.action === 'restore') {
      if (!isUuid(body.version_id)) return bad('version_id is required')
      let v = await sb.from('config_template_versions').select('template_key, company_id, location_id, action, subject, body, version').eq('id', body.version_id).maybeSingle()
      if (v.error && branchMissing(v.error)) v = await sb.from('config_template_versions').select('template_key, company_id, action, subject, body, version').eq('id', body.version_id).maybeSingle() as typeof v
      if (v.error) return fail(v.error)
      const ver = v.data as { template_key: string; company_id: string | null; location_id?: string | null; action: string; subject: string; body: string } | null
      if (!ver || ver.template_key !== key || (ver.company_id || null) !== scope.company || (ver.location_id || null) !== scope.location || ver.action === 'RESET') {
        return bad('That version cannot be restored here.')
      }
      subject = ver.subject; text = ver.body; action = 'RESTORED'
    }
    const problems = checkText(subject, text)
    if (problems instanceof NextResponse) return problems
    if (problems.length) return NextResponse.json({ error: 'Fix these before publishing.', problems }, { status: 422 })

    const { data: t, error } = await rpc('config_publish_template', {
      p_template_key: key, p_company_id: scope.company, p_subject: String(subject), p_body: String(text),
      p_change_note: note || (action === 'RESTORED' ? 'Restored an earlier version' : null), ...who, p_action: action,
    })
    if (error) return fail(error)

    // HR letters keep their legacy content column in step with the Global text, so any
    // reader of letter_templates.content still sees what is live.
    if (isHrLetterKey(key) && !scope.company) {
      await sb.from('letter_templates').update({ content: String(text) }).eq('id', hrLetterIdOf(key))
    }
    return NextResponse.json({ ok: true, version: (t as { version?: number } | null)?.version ?? null })
  }

  if (body.action === 'reset') {
    // An HR letter's Global text IS its baseline (letter_templates.content is kept in
    // step on publish), so there is nothing below it to reset to.
    if (isHrLetterKey(key) && !scope.company) return bad('An HR letter\'s Global text has no built-in version to reset to — edit and publish it instead.')
    const { error } = await rpc('config_reset_template', {
      p_template_key: key, p_company_id: scope.company, p_change_note: note, ...who,
    })
    if (error) return fail(error)
    return NextResponse.json({ ok: true })
  }

  return bad('Unknown action')
}
