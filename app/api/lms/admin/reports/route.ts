// app/api/lms/admin/reports/route.ts — report rows, assessment analytics and Excel export.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, readCompanies } from '@/lib/lms/access'
import { exportXlsx, reportPage, type ReportFilter } from '@/lib/lms/reports'
import { errorResponse, LmsError, must, sb } from '@/lib/lms/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Assigning people need the enrolment list to act on it. Reports and exports are not theirs.
  const { actor, error } = await lmsAdmin(req, ['reports', 'assign'])
  if (error) return error
  try {
    const sp = req.nextUrl.searchParams
    if (!actor.caps.reports && (sp.get('format') === 'xlsx' || sp.get('kind') === 'quizzes')) throw new LmsError('Reports are not part of your access.', 403)
    const f: ReportFilter = {
      companies: await readCompanies(actor, sp.get('company')), location: sp.get('location'), department: sp.get('department'), course: sp.get('course'),
      status: sp.get('status'), mandatory: sp.get('mandatory') === 'true' ? true : sp.get('mandatory') === 'false' ? false : null,
      from: sp.get('from'), to: sp.get('to'), search: sp.get('q'),
    }
    const kind = sp.get('kind') || 'enrollments'
    if (sp.get('format') === 'xlsx') {
      const bytes = await exportXlsx(actor, f, kind)
      return new NextResponse(Buffer.from(bytes), { headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="learning-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      } })
    }
    if (kind === 'quizzes') return NextResponse.json({ rows: must(await sb.rpc('lms_quiz_stats', { p_companies: f.companies, p_course: f.course || null })) })
    return NextResponse.json(await reportPage(actor, f, Number(sp.get('page') || 0)))
  } catch (e) { return errorResponse(e) }
}
