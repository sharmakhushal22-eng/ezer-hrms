// GET /api/te/admin/workflow/[code]   the saved approval levels of one workflow (code = claim | trip)
// PUT /api/te/admin/workflow/[code]   save the builder's levels. Body: { levels: [ { kind, label, who, person, when } ] }
//
// te_workflow_save checks everything first (finance levels last, at least one
// finance level on a claim, no dead ends) and writes nothing when a rule says
// no; the refusal comes back as TE_WORKFLOW with the sentence to show.
// It does not check who is calling, so the role (Travel Claims, full) is checked here.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf } from '@/lib/te/errors'
import { config, workflowSave } from '@/lib/te/engine/te-service.js'
import type { TeWorkflowLevel } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CODES = ['claim', 'trip'] as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return teRoute(req, async t => {
    const workflow = needOneOf(code, CODES, 'workflow')
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    const cfg = await config({ db: t.db(), actor: (await t.actor()).employeeId ?? '' }, company)
    return { company_id: company, workflow, levels: cfg.flows[workflow].levels, fallback: cfg.fallback, finance_team: cfg.teams.finance }
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return teRoute(req, async t => {
    const workflow = needOneOf(code, CODES, 'workflow')
    const body = await t.body<{ levels?: TeWorkflowLevel[] }>()
    if (!Array.isArray(body.levels)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'levels must be a list.')
    await t.permit('Travel Claims', 'FULL')
    return workflowSave(await t.ctx(), await t.company(), workflow, body.levels)
  })
}
