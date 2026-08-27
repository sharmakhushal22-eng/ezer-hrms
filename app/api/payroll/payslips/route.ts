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
}

async function loadRun(runId: string): Promise<RunCtx | { error: string; status: number }> {
  const { data: run } = await sb.from('payroll_runs').select('*').eq('id', runId).maybeSingle()
  if (!run) return { error: 'Payroll run not found.', status: 404 }
  const [{ data: company }, { data: cfg }] = await Promise.all([
    sb.from('companies').select('id, company_name, short_name, cin, reg_office, corp_office').eq('id', run.company_id).maybeSingle(),
    sb.from('v_tax_config_version').select('config_version').maybeSingle(),
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
  return { run, company, snapshots, lines, configVersion: cfg?.config_version ?? null }
}

/** C4 — why this run cannot be issued as it stands, or null if it can. */
function staleReason(ctx: RunCtx): string | null {
  if (SETTLED.has(String(ctx.run.status))) return null
  if (!ctx.lines.size) return 'Payroll has not been run for this month yet.'
  // payroll_lines is UPSERTED, so created_at is the first-ever calculation and never
  // moves on a re-run. The engine stamps deductions_json.calculated_at on every write;
  // lines from before that stamp fall back to payroll_runs.updated_at, which the
  // engine bumps at the end of every calculation.
  const runCalc = ctx.run.updated_at ? new Date(ctx.run.updated_at) : null
  let older = 0, olderCfg = 0, noCfg = 0
  for (const s of ctx.snapshots) {
    const l = ctx.lines.get(s.employee_id)
    if (!l) continue
    const stamp = l.deductions_json?.calculated_at ? new Date(l.deductions_json.calculated_at) : runCalc
    if (s.synced_at && stamp && stamp < new Date(s.synced_at)) older++
    if (!s.tds_config_version) noCfg++
    else if (ctx.configVersion && new Date(s.tds_config_version) < new Date(ctx.configVersion)) olderCfg++
  }
  const n = (k: number) => `${k} employee${k === 1 ? '' : 's'}`
  if (older) return `${n(older)} had their Month Master synced after the last calculation — re-run payroll so the payslip matches the engine.`
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

async function assembleFor(ctx: RunCtx, s: any): Promise<PayslipData> {
  const l = ctx.lines.get(s.employee_id)
  const fy = ctx.run.fy as string
  const [{ data: decl }, { data: declLines }, { data: vouchers }, { data: prior }] = await Promise.all([
    sb.from('tds_declarations').select('*').eq('employee_id', s.employee_id).eq('fy', fy).maybeSingle(),
    sb.from('investment_declaration_lines').select('section_code, declared_amount').eq('employee_id', s.employee_id).eq('fy', fy),
    sb.from('manual_voucher_entries').select('head_name, head_type, amount').eq('run_id', ctx.run.id).eq('employee_id', s.employee_id),
    sb.from('payroll_employee_snapshot')
      .select('tds_monthly, tds_additional, payroll_runs!inner(fy, month, status)')
      .eq('employee_id', s.employee_id).eq('payroll_runs.fy', fy).lt('payroll_runs.month', ctx.run.month).neq('payroll_runs.status', 'CANCELLED'),
  ])
  return assemblePayslip({
    run: { fy, month: ctx.run.month, period_label: ctx.run.period_label },
    company: ctx.company || {},
    snapshot: s, line: l,
    declaration: decl || null,
    declarationLines: declLines || [],
    vouchers: vouchers || [],
    priorMonths: (prior || []).map((p: any) => ({ month: p.payroll_runs?.month, tds_monthly: p.tds_monthly, tds_additional: p.tds_additional })),
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
  for (const s of ctx.snapshots) {
    if (!ctx.lines.has(s.employee_id)) continue
    const p = await assembleFor(ctx, s)
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
  for (const s of ctx.snapshots) {
    if (!want.has(String(s.employee_code))) continue
    if (!ctx.lines.has(s.employee_id)) { refused.push({ code: s.employee_code, reasons: ['No payroll line — not paid in this run.'] }); continue }
    const p = await assembleFor(ctx, s)
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
