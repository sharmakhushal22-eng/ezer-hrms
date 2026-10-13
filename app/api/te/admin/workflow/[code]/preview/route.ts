// POST /api/te/admin/workflow/[code]/preview — "who would approve this?" for the
// workflow builder. Body: { levels?, sample: { employee_id, total?, scope?, postFacto?, exception?, band? } }
// levels = the builder's unsaved levels; left out = the saved workflow.
// Reads only: nothing is saved.
import { NextRequest } from 'next/server'
import { teRoute } from '@/lib/te/server'
import { TeHttpError, needOneOf, needUuid, rpcError } from '@/lib/te/errors'
import { workflowPreview, type WorkflowSample } from '@/lib/te/engine/te-service.js'
import type { TeWorkflowLevel } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return teRoute(req, async t => {
    const workflow = needOneOf(code, ['claim', 'trip'] as const, 'workflow')
    const body = await t.body<{ levels?: TeWorkflowLevel[] | null; sample?: Partial<WorkflowSample> }>()
    const sample = body.sample ?? {}
    const employeeId = needUuid(sample.employee_id, 'sample.employee_id')
    if (body.levels !== undefined && body.levels !== null && !Array.isArray(body.levels)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'levels must be a list.')
    await t.permit('Travel Claims', 'FULL')
    const company = await t.company()
    // The sample employee must be one of this company's: the chain names their managers.
    const e = await t.sb().from('employees').select('id').eq('id', employeeId).eq('company_id', company).maybeSingle()
    if (e.error) throw rpcError(e.error, 'employees')
    if (!e.data) throw new TeHttpError(400, 'TE_INVALID', 'Choose an employee of this company for the preview.', { field: 'employee_id' })
    const chain = await workflowPreview(await t.ctx(), company, workflow, body.levels ?? null, { ...sample, employee_id: employeeId })
    return { workflow, chain }
  })
}
