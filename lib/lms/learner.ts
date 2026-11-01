// lib/lms/learner.ts — the person behind a /api/lms/me request. Server only.
//
// One door for two kinds of learner. An employee arrives with an ESS token, a candidate
// with a candidate token, and everything past here deals in lms_learners rows, so the
// player, quizzes and certificates have a single implementation.
//
// A candidate token is only ever accepted here. Nothing else in the app knows the format,
// which is what keeps a candidate out of ESS and away from employee data.
import { NextRequest, NextResponse } from 'next/server'
import { essCaller } from '@/lib/ess/session'
import type { AudienceFacts } from './core'
import { isCandidateToken, verifyCandidateToken } from './candidate-session'
import { must, sb, settingsFor } from './server'

export interface Learner {
  id: string
  companyId: string
  kind: 'EMPLOYEE' | 'CANDIDATE'
  employeeId: string | null
  name: string
  /** Every learner row of this person, including earlier companies in the group. */
  allIds: string[]
  facts: AudienceFacts | null
  /** Somebody else is viewing this portal. They may look, and may not act as the learner. */
  readOnly: boolean
}

const EMPTY: AudienceFacts = { department_id: null, designation: null, location_id: null, grade: null, employment_type: null, employee_category: null, team_name: null }

function bearer(req: NextRequest): string {
  const h = req.headers.get('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

async function candidateLearner(token: string): Promise<Learner | null> {
  const s = verifyCandidateToken(token)
  if (!s) return null
  const [{ data: l }, { data: acc }] = await Promise.all([
    sb.from('lms_learners').select('id, company_id, kind, full_name, status, department_id, designation').eq('id', s.learnerId).maybeSingle(),
    sb.from('lms_candidate_access').select('session_version, revoked_at').eq('learner_id', s.learnerId).maybeSingle(),
  ])
  if (!l || !acc || l.kind !== 'CANDIDATE' || l.status !== 'ACTIVE') return null
  if (acc.revoked_at || acc.session_version !== s.version) return null
  return {
    id: l.id, companyId: l.company_id, kind: 'CANDIDATE', employeeId: null, name: l.full_name, allIds: [l.id],
    facts: { ...EMPTY, department_id: l.department_id, designation: l.designation }, readOnly: false,
  }
}

async function employeeLearner(employeeId: string, readOnly: boolean): Promise<Learner | null> {
  const { data: e } = await sb.from('employees')
    .select('id, company_id, full_name, department_id, designation, location_id, grade, employment_type, employee_category, team_name')
    .eq('id', employeeId).maybeSingle()
  if (!e?.company_id) return null

  let { data: rows } = await sb.from('lms_learners').select('id, company_id').eq('employee_id', employeeId)
  let mine = (rows || []).find((r: any) => r.company_id === e.company_id)
  if (!mine) {
    must(await sb.rpc('lms_ensure_learners', { p_company: e.company_id, p_employees: [employeeId] }))
    ;({ data: rows } = await sb.from('lms_learners').select('id, company_id').eq('employee_id', employeeId))
    mine = (rows || []).find((r: any) => r.company_id === e.company_id)
  }
  if (!mine) return null
  return {
    id: mine.id, companyId: e.company_id, kind: 'EMPLOYEE', employeeId, name: e.full_name,
    allIds: (rows || []).map((r: any) => r.id),
    facts: {
      department_id: e.department_id, designation: e.designation, location_id: e.location_id, grade: e.grade,
      employment_type: e.employment_type, employee_category: e.employee_category, team_name: e.team_name,
    },
    readOnly,
  }
}

/** The learner making this request, or the response that refuses them. */
export async function lmsLearner(req: NextRequest): Promise<{ learner: Learner; error: null } | { learner: null; error: NextResponse }> {
  const token = bearer(req)
  if (isCandidateToken(token)) {
    const l = await candidateLearner(token)
    if (!l) return { learner: null, error: NextResponse.json({ error: 'This session has ended. Open your link again.' }, { status: 401 }) }
    const s = await settingsFor(l.companyId)
    if (!s.enabled || !s.preboarding_enabled) return { learner: null, error: NextResponse.json({ error: 'Pre-joining learning is switched off.' }, { status: 403 }) }
    return { learner: l, error: null }
  }
  const c = await essCaller(req)
  if (c.error) return { learner: null, error: c.error }
  const l = await employeeLearner(c.caller.employeeId, c.caller.viewAs)
  if (!l) return { learner: null, error: NextResponse.json({ error: 'No learning record for this login.' }, { status: 404 }) }
  return { learner: l, error: null }
}

/** For anything that changes the learner's record. A manager or admin looking at someone's
 *  portal must not be able to watch their video or sit their assessment. */
export function refuseReadOnly(l: Learner): NextResponse | null {
  return l.readOnly ? NextResponse.json({ error: 'You are viewing someone else\'s portal. Only they can do this.' }, { status: 403 }) : null
}
