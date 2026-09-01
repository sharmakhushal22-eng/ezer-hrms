// app/api/payroll/payslips/route.ts — payslips for a payroll run.
//
//   GET  ?run_id=…            preflight: who can have one, who cannot and why, data-
//                             quality gaps, and whether the run is stale (C4/C5/A3)
//   POST { run_id, codes }    render up to PAYSLIP_BATCH employees → one PDF each,
//                             base64, plus the combined figures the client needs
//
// The render happens here, with the service key, for two reasons: payroll_lines and
// the snapshot are RLS-locked to payroll staff, and a payslip is the single most
// sensitive bulk export in the product (A2) — so the door is requireModule('Payroll'),
// and every generation writes a payroll_audit_log row saying who took whose.
//
// It is chunked (PAYSLIP_BATCH per call) rather than one request for the whole run:
// 300 multi-section documents in one serverless invocation hits memory or the
// timeout, and finding that out at month-end is the wrong time (A2).
import { NextRequest, NextResponse } from 'next/server'
import { requireModule } from '@/lib/api-auth'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { assemblePayslip, payslipFileName, type PayslipData } from '@/lib/payroll/payslip'
import { renderPayslipPdf } from '@/lib/payroll/payslip-pdf'
import { computeReadiness } from '@/lib/payroll/readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const PAYSLIP_BATCH = 25

// A run at or past DISBURSED is history: what was paid is the truth, and re-running it
// against today's engine would rewrite a settled month (C4). Anything earlier must
// match the engine that is live now.
const SETTLED = new Set(['DISBURSED', 'LOCKED'])

interface RunCtx {
  run: any
  company: any
  snapshots: any[]
  lines: Map<string, any>            // employee_id → payroll_lines row
  configVersion: string | null
  /** Newest first — what happened to this run, and when. */
  audit: { action: string; created_at: string }[]
}

async function loadRun(runId: string): Promise<RunCtx | { error: string; status: number }> {
  const { data: run } = await sb.from('payroll_runs').select('*').eq('id', runId).maybeSingle()
  if (!run) return { error: 'Payroll run not found.', status: 404 }
  const [{ data: company }, { data: cfg }, { data: audit }] = await Promise.all([
    sb.from('companies').select('id, company_name, short_name, cin, reg_office, corp_office').eq('id', run.company_id).maybeSingle(),
    sb.from('v_tax_config_version').select('config_version').maybeSingle(),
    sb.from('payroll_audit_log').select('action, created_at').eq('run_id', runId).order('created_at', { ascending: false }).limit(60),
  ])
  const snapshots: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('payroll_employee_snapshot').select('*').eq('run_id', runId).order('employee_code').range(from, from + 999)
    if (error) return { error: error.message, status: 500 }
    snapshots.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  const lines = new Map<string, any>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('payroll_lines').select('*').eq('run_id', runId).range(from, from + 999)
    if (error) return { error: error.message, status: 500 }
    ;(data || []).forEach((l: any) => lines.set(l.employee_id, l))
    if ((data || []).length < 1000) break
  }
  return { run, company, snapshots, lines, configVersion: cfg?.config_version ?? null, audit: (audit || []) as any }
}

/** C4 — why this run cannot be issued as it stands, or null if it can.
 *
 *  Staleness is judged from the audit log, not from row timestamps. The first version
 *  compared each snapshot's synced_at against its line's calculated_at, and reported
 *  every employee as stale after a perfectly good run: sync_month_tds stamps
 *  synced_at = now() and runs INSIDE Run Payroll, so those two timestamps land
 *  milliseconds apart in an order nothing guarantees. Sub-second ordering between two
 *  writers in the same operation is noise, not evidence.
 *
 *  payroll_audit_log records each step with its own timestamp, which is the real
 *  question: did a sync happen AFTER the last calculation? */
function staleReason(ctx: RunCtx): string | null {
  if (SETTLED.has(String(ctx.run.status))) return null
  if (!ctx.lines.size) return 'Payroll has not been run for this month yet.'

  const lastCalc = ctx.audit.find(a => a.action === 'PAYROLL_CALCULATED')?.created_at
  const lastSync = ctx.audit.find(a => String(a.action).startsWith('SYNC_'))?.created_at
  if (lastCalc && lastSync && new Date(lastSync) > new Date(lastCalc)) {
    return 'The Month Master was synced after the last payroll calculation — re-run payroll so the payslips match the engine.'
  }

  let olderCfg = 0, noCfg = 0
  for (const s of ctx.snapshots) {
    if (!ctx.lines.has(s.employee_id)) continue
    if (!s.tds_config_version) noCfg++
    else if (ctx.configVersion && new Date(s.tds_config_version) < new Date(ctx.configVersion)) olderCfg++
  }
  const n = (k: number) => `${k} employee${k === 1 ? '' : 's'}`
  if (noCfg) return `${n(noCfg)} have no TDS engine result stored (the TDS sync did not complete on the last run) — re-run payroll and check that the TDS step succeeds.`
  if (olderCfg) return `${n(olderCfg)} were calculated under an older tax configuration — re-run payroll first.`
  return null
}

/** A3 — everyone in the month, split into "has a payslip" and "does not, because…". */
function eligibility(ctx: RunCtx) {
  const rd = computeReadiness(ctx.snapshots.map(s => ({ ...s, __company: ctx.company?.company_name || '' })))
  const reasonByCode = new Map<string, string>()
  for (const c of rd.checks) for (const r of c.rows) if (c.blocking && !reasonByCode.has(r.code)) reasonByCode.set(r.code, `${c.label}: ${r.impact}`)
  const eligible: { code: string; name: string }[] = []
  const missing: { code: string; name: string; reason: string }[] = []
  for (const s of ctx.snapshots) {
    if (ctx.lines.has(s.employee_id)) eligible.push({ code: s.employee_code, name: s.full_name })
    else missing.push({ code: s.employee_code, name: s.full_name, reason: reasonByCode.get(s.employee_code) || 'Not included in the last run (filtered out, or left out by a blocking check that has since been fixed).' })
  }
  return { eligible, missing }
}

// Everything the assembler needs beyond the snapshot and the line, loaded ONCE for
// the whole run in a handful of batched queries. The first version fetched these
// per employee — four round-trips × 300 employees × 3 companies was a 504 before
// a single payslip existed.
interface Aux {
  decl: Map<string, any>
  declLines: Map<string, { section_code: string; declared_amount: number }[]>
  vouchers: Map<string, { head_name: string; head_type: string; amount: number }[]>
  prior: Map<string, { month: number; tds_monthly: number; tds_additional: number }[]>
  /** Annual perquisite valuations on record (employee_perquisites × perquisite_types), by employee. */
  perq: Map<string, { car: number; driver: number }>
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

async function loadAux(ctx: RunCtx, employeeIds: string[]): Promise<Aux> {
  const fy = ctx.run.fy as string
  const aux: Aux = { decl: new Map(), declLines: new Map(), vouchers: new Map(), prior: new Map(), perq: new Map() }
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }

  const { data: vouchers } = await sb.from('manual_voucher_entries').select('employee_id, head_name, head_type, amount').eq('run_id', ctx.run.id)
  ;(vouchers || []).forEach((v: any) => push(aux.vouchers, v.employee_id, v))

  // Prior months of this FY for the same company — one query per chunk of ids,
  // filtered through the run join rather than per employee.
  for (const ids of chunk(employeeIds, 150)) {
    const [{ data: decls }, { data: lines }, { data: prior }] = await Promise.all([
      sb.from('tds_declarations').select('*').eq('fy', fy).in('employee_id', ids),
      sb.from('investment_declaration_lines').select('employee_id, section_code, declared_amount').eq('fy', fy).in('employee_id', ids),
      sb.from('payroll_employee_snapshot')
        .select('employee_id, tds_monthly, tds_additional, payroll_runs!inner(fy, month, status)')
        .in('employee_id', ids).eq('payroll_runs.fy', fy).lt('payroll_runs.month', ctx.run.month).neq('payroll_runs.status', 'CANCELLED'),
    ])
    ;(decls || []).forEach((d: any) => aux.decl.set(d.employee_id, d))
    ;(lines || []).forEach((l: any) => push(aux.declLines, l.employee_id, l))
    ;(prior || []).forEach((p: any) => push(aux.prior, p.employee_id, { month: p.payroll_runs?.month, tds_monthly: p.tds_monthly, tds_additional: p.tds_additional }))
    // Perquisite valuations entered against the employee (Rule 3 car, driver). The
    // table is optional — when it is empty the payslip falls back to the flexi heads.
    const { data: pq } = await sb.from('employee_perquisites').select('employee_id, amount, perquisite_types(code, name)').eq('fy', fy).in('employee_id', ids)
    ;(pq || []).forEach((p: any) => {
      const code = String(p.perquisite_types?.code || '').toUpperCase(), name = String(p.perquisite_types?.name || '').toUpperCase()
      const cur = aux.perq.get(p.employee_id) || { car: 0, driver: 0 }
      if (code === 'CAR' || name.includes('CAR')) cur.car += Number(p.amount || 0)
      else if (code.includes('DRIVER') || name.includes('DRIVER')) cur.driver += Number(p.amount || 0)
      aux.perq.set(p.employee_id, cur)
    })
  }
  return aux
}

function assembleFor(ctx: RunCtx, aux: Aux, s: any): PayslipData {
  return assemblePayslip({
    run: { fy: ctx.run.fy, month: ctx.run.month, period_label: ctx.run.period_label },
    company: ctx.company || {},
    snapshot: s, line: ctx.lines.get(s.employee_id),
    declaration: aux.decl.get(s.employee_id) || null,
    declarationLines: aux.declLines.get(s.employee_id) || [],
    vouchers: aux.vouchers.get(s.employee_id) || [],
    priorMonths: aux.prior.get(s.employee_id) || [],
    perquisites: aux.perq.get(s.employee_id) || null,
  })
}

export async function GET(req: NextRequest) {
  const auth = await requireModule(req, 'Payroll', 'VIEW')
  if (auth.error) return auth.error
  const runId = req.nextUrl.searchParams.get('run_id') || ''
  if (!runId) return NextResponse.json({ error: 'run_id is required' }, { status: 400 })

  const ctx = await loadRun(runId)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const { eligible, missing } = eligibility(ctx)
  const stale = staleReason(ctx)

  // C5 — the data-quality sweep, one screen before the download rather than 300
  // payslips with holes. Assembling is cheap; rendering is what costs.
  const issues: { code: string; name: string; text: string; blocking: boolean }[] = []
  const paid = ctx.snapshots.filter(s => ctx.lines.has(s.employee_id))
  const aux = await loadAux(ctx, paid.map(s => s.employee_id))
  for (const s of paid) {
    const p = assembleFor(ctx, aux, s)
    p.issues.forEach(i => issues.push({ code: s.employee_code, name: s.full_name, ...i }))
  }
  return NextResponse.json({
    run: { id: ctx.run.id, fy: ctx.run.fy, month: ctx.run.month, status: ctx.run.status, period_label: ctx.run.period_label },
    company: { name: ctx.company?.company_name, short_name: ctx.company?.short_name },
    total: ctx.snapshots.length, eligible, missing, stale, issues, batch: PAYSLIP_BATCH,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireModule(req, 'Payroll', 'VIEW')
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const runId = String(body.run_id || '')
  const codes: string[] = Array.isArray(body.codes) ? body.codes.map(String) : []
  if (!runId || !codes.length) return NextResponse.json({ error: 'run_id and codes are required' }, { status: 400 })
  if (codes.length > PAYSLIP_BATCH) return NextResponse.json({ error: `At most ${PAYSLIP_BATCH} employees per request.` }, { status: 400 })

  const ctx = await loadRun(runId)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const stale = staleReason(ctx)
  if (stale && !body.force_settled) return NextResponse.json({ error: stale }, { status: 409 })

  const want = new Set(codes)
  const files: { code: string; name: string; file: string; pdf: string }[] = []
  const refused: { code: string; reasons: string[] }[] = []
  const targets = ctx.snapshots.filter(s => want.has(String(s.employee_code)))
  const aux = await loadAux(ctx, targets.map(s => s.employee_id))
  for (const s of targets) {
    if (!ctx.lines.has(s.employee_id)) { refused.push({ code: s.employee_code, reasons: ['No payroll line — not paid in this run.'] }); continue }
    const p = assembleFor(ctx, aux, s)
    const blocking = p.issues.filter(i => i.blocking)
    if (blocking.length) { refused.push({ code: s.employee_code, reasons: blocking.map(i => i.text) }); continue }
    const bytes = await renderPayslipPdf(p)
    files.push({ code: s.employee_code, name: s.full_name, file: payslipFileName(s.employee_code, ctx.run.fy, ctx.run.month), pdf: Buffer.from(bytes).toString('base64') })
  }

  // Who took whose payslips, when — the audit row the answers ask for (A2).
  await sb.from('payroll_audit_log').insert({
    run_id: ctx.run.id, company_id: ctx.run.company_id, action: 'PAYSLIPS_GENERATED',
    detail: { codes: files.map(f => f.code), count: files.length, refused: refused.map(r => r.code), by_employee_id: auth.user.employeeId, kind: auth.user.kind },
    performed_by: auth.user.email || auth.user.employeeId || 'HR',
  })

  return NextResponse.json({ files, refused })
}
