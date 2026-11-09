// lib/recruitment/reports.ts — Recruitment → Reports. Pure: every report is built from one
// dataset the route loads (app/api/recruitment/reports, already scoped to what the viewer may
// see), so the catalogue's counts and the downloaded workbooks can never disagree.
//
// A report is one or more sheets of flat rows; the column order is the key order of the rows.
// Dates go out as "12-Oct-2026" text and money as plain numbers, so Excel sums them.

export type Row = Record<string, string | number | null>
export interface Sheet { name: string; rows: Row[] }
export interface ReportDef { key: string; title: string; group: 'Requisitions' | 'Candidates' | 'Interviews' | 'Offers' | 'Joining' | 'Team'; desc: string }
export interface Dataset {
  mrfs: any[]; candidates: any[]; invites: any[]; negotiations: any[]; offerRequests: any[]; offerLetters: any[]
  acceptances: any[]; docLinks: any[]; docs: any[]; onboarding: any[]; audit: any[]
  companies: Record<string, string>; departments: Record<string, string>; locations: Record<string, string>
  people: Record<string, { name: string; code: string | null }>
}
export interface Range { from?: string | null; to?: string | null }

export const REPORTS: ReportDef[] = [
  { key: 'mrf_register', group: 'Requisitions', title: 'MRF register', desc: 'Every requisition: position, department, openings, budget, status, who raised and approved it, recruiters and dates.' },
  { key: 'mrf_tat', group: 'Requisitions', title: 'MRF ageing & turnaround', desc: 'Approval turnaround, days open, target joining date and whether the requisition is overdue.' },
  { key: 'funnel', group: 'Requisitions', title: 'Hiring funnel by MRF', desc: 'Candidates at each pipeline stage for every requisition, with offer, acceptance and join conversion.' },
  { key: 'candidates', group: 'Candidates', title: 'Candidate pipeline', desc: 'Every candidate with source, experience, current and expected CTC, notice, stage, AI score and age in the pipeline.' },
  { key: 'sources', group: 'Candidates', title: 'Source effectiveness', desc: 'Candidates, interviews, offers, acceptances and joins by sourcing channel.' },
  { key: 'rejections', group: 'Candidates', title: 'Rejections & backouts', desc: 'Candidates rejected (stage, reason, remark, when) and offers the candidate backed out of.' },
  { key: 'interviews', group: 'Interviews', title: 'Interviews', desc: 'Every interview scheduled: round, interviewer, time, acknowledgement, feedback and decision.' },
  { key: 'interviewers', group: 'Interviews', title: 'Interviewer turnaround', desc: 'Per interviewer: interviews assigned, acknowledged, feedback given, pending and average feedback time.' },
  { key: 'negotiations', group: 'Offers', title: 'Negotiations', desc: 'Current vs offered CTC, hike, variable, joining / retention bonus, ESOP, salary-link activity and the candidate’s response.' },
  { key: 'offer_approvals', group: 'Offers', title: 'Offer approvals', desc: 'Every offer approval request: offered package, HR Head decision and turnaround, revisions and when the offer went out.' },
  { key: 'offers', group: 'Offers', title: 'Offers & acceptance', desc: 'Offer letters sent, CTC, joining date and the candidate’s acceptance.' },
  { key: 'documents', group: 'Joining', title: 'Document submission', desc: 'Document-collection links (sent, opened, submitted) per candidate, and every document uploaded.' },
  { key: 'joining', group: 'Joining', title: 'Joining & pre-onboarding', desc: 'Accepted candidates through onboarding: joining date, onboarding stage and employee code.' },
  { key: 'recruiters', group: 'Team', title: 'Recruiter performance', desc: 'Per assigned recruiter: requisitions, openings, candidates, interviews, offers, acceptances and joins.' },
  { key: 'audit', group: 'Team', title: 'Recruitment audit trail', desc: 'Every recorded recruitment action: what happened, to which candidate or MRF, by whom and when.' },
]

// ── helpers ─────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "12-Oct-2026" (IST for timestamps, as written for a date). */
export function day(v: any): string | null {
  if (!v) return null
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-'); return `${d}-${MON[Number(m) - 1]}-${y}` }
  const t = new Date(s); if (isNaN(t.getTime())) return s
  const ist = new Date(t.getTime() + 330 * 60000)
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${MON[ist.getUTCMonth()]}-${ist.getUTCFullYear()}`
}
export function dayTime(v: any): string | null {
  if (!v) return null
  const t = new Date(String(v)); if (isNaN(t.getTime())) return String(v)
  const ist = new Date(t.getTime() + 330 * 60000)
  return `${day(v)} ${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`
}
const num = (v: any): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100)
const ms = (v: any) => (v ? new Date(String(v).length === 10 ? `${v}T00:00:00Z` : String(v)).getTime() : NaN)
/** Whole days between two instants (b defaults to now); null when either is missing. */
export function daysBetween(a: any, b?: any): number | null {
  const x = ms(a), y = b === undefined ? Date.now() : ms(b)
  return isNaN(x) || isNaN(y) ? null : Math.floor((y - x) / 86400000)
}
export function hoursBetween(a: any, b: any): number | null {
  const x = ms(a), y = ms(b)
  return isNaN(x) || isNaN(y) ? null : Math.round(((y - x) / 3600000) * 10) / 10
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
/** Inside the chosen window (by the record's own date); no window → everything. */
export function inRange(v: any, r: Range): boolean {
  if (!r.from && !r.to) return true
  const s = v ? String(v).slice(0, 10) : ''
  if (!s) return false
  return (!r.from || s >= r.from) && (!r.to || s <= r.to)
}
const yes = (b: any) => (b ? 'Yes' : 'No')

export const isJoined = (ds: Dataset, c: any) =>
  c.stage === 'Joined' || ds.onboarding.some(o => o.candidate_id === c.id && (o.status === 'EMPLOYEE_CREATED' || o.employee_code))
export const isOffered = (ds: Dataset, c: any) =>
  ['Offer Sent', 'Joined'].includes(c.stage) || !!c.offer_sent_at || ds.offerLetters.some(o => o.candidate_id === c.id)
export const isAccepted = (c: any) => c.offer_response === 'ACCEPTED' || c.offer_accepted === true
export const isBackout = (c: any) => c.offer_response === 'BACKOUT' || c.offer_response === 'DECLINED'
const interviewed = (ds: Dataset, c: any) => ds.invites.some(i => i.candidate_id === c.id)

export const STAGE_ORDER = ['Applied', 'AI Screened', 'Telephonic', 'L1', 'L2', 'Optional Round', 'Hold', 'Shortlisted', 'Offer Sent', 'Joined', 'Rejected']

function ctx(ds: Dataset) {
  const mrf = new Map(ds.mrfs.map(m => [m.id, m]))
  const cand = new Map(ds.candidates.map(c => [c.id, c]))
  const who = (id: any) => (id && ds.people[id] ? `${ds.people[id].name}${ds.people[id].code ? ` (${ds.people[id].code})` : ''}` : null)
  const title = (m: any) => m?.job_title || m?.position || m?.designation || null
  const mrfLabel = (id: any) => { const m = id ? mrf.get(id) : null; return m ? `${m.mrf_number || ''}${title(m) ? ` · ${title(m)}` : ''}`.trim() : null }
  const recruiters = (m: any) => (Array.isArray(m?.assigned_recruiter_ids) && m.assigned_recruiter_ids.length
    ? m.assigned_recruiter_ids.map(who).filter(Boolean).join(', ') : m?.assigned_recruiter || null)
  return { mrf, cand, who, title, mrfLabel, recruiters }
}

/** Where an MRF's approval stands. A decided MRF says so — its status is the record; a
 *  chain row left PENDING after an admin approval must not read "With <name>". */
function chainState(m: any): string | null {
  if (m.status === 'APPROVED' || m.status === 'CLOSED') return 'Approved'
  if (m.status === 'REJECTED') return 'Rejected'
  if (m.status === 'DRAFT') return 'Not submitted'
  const ch = Array.isArray(m.approval_chain) ? m.approval_chain : []
  if (!ch.length) return null
  const pending = ch.find((s: any) => s.status === 'PENDING')
  if (pending) return `With ${pending.approver_name || pending.role || 'approver'}${pending.role ? ` (${String(pending.role).replace(/_/g, ' ')})` : ''}`
  const rej = ch.find((s: any) => s.status === 'REJECTED')
  if (rej) return `Rejected by ${rej.approver_name || rej.role}`
  return ch.every((s: any) => s.status === 'APPROVED' || s.status === 'SKIPPED') ? 'Fully approved' : null
}

// ── the reports ─────────────────────────────────────────────────────────────
export function buildReport(key: string, ds: Dataset, r: Range = {}): Sheet[] {
  const c = ctx(ds)
  const mrfs = ds.mrfs.filter(m => inRange(m.created_at, r))
  const cands = ds.candidates.filter(x => inRange(x.applied_date || x.created_at, r))
  const candOf = (m: any) => ds.candidates.filter(x => x.mrf_id === m.id)

  switch (key) {
    case 'mrf_register': return [{ name: 'MRF register', rows: mrfs.map(m => {
      const cs = candOf(m)
      return {
        'MRF number': m.mrf_number, 'Position': c.title(m), 'Company': ds.companies[m.company_id] || null,
        'Department': ds.departments[m.department_id] || null, 'Location': ds.locations[m.location_id] || null,
        'Lane': m.mrf_type || null, 'Hiring type': m.hiring_type || null, 'Employment type': m.employment_type || null,
        'Reason': m.reason_for_hire || m.reason || null, 'Grade': m.grade || null,
        'Openings': num(m.no_of_openings ?? m.openings), 'Filled': cs.filter(x => isJoined(ds, x)).length, 'Candidates': cs.length,
        'Budget min': num(m.budget_min), 'Budget max': num(m.budget_max), 'Pay period': m.pay_period || null,
        'Urgency': m.urgency || null, 'Status': m.status, 'Approval': chainState(m),
        'Raised by': c.who(m.requested_by) || m.raised_by_name || null, 'Raised on': day(m.created_at), 'Approved on': day(m.approved_at),
        'Target joining': day(m.target_joining_date), 'Valid till': day(m.validity_date), 'Recruiters': c.recruiters(m),
        'Confidential': yes(m.is_confidential),
      }
    }) }]

    case 'mrf_tat': return [{ name: 'MRF ageing', rows: mrfs.map(m => {
      const cs = candOf(m)
      const joins = ds.onboarding.filter(o => cs.some(x => x.id === o.candidate_id) && (o.status === 'EMPLOYEE_CREATED' || o.employee_code))
      const firstJoin = joins.map(o => o.date_of_joining || o.updated_at).filter(Boolean).sort()[0] || null
      const open = (m.no_of_openings ?? m.openings ?? 0) - cs.filter(x => isJoined(ds, x)).length
      const target = m.target_joining_date
      const overdue = m.status === 'APPROVED' && target && open > 0 && (daysBetween(target) ?? 0) > 0
      return {
        'MRF number': m.mrf_number, 'Position': c.title(m), 'Department': ds.departments[m.department_id] || null, 'Status': m.status,
        'Raised on': day(m.created_at), 'Approved on': day(m.approved_at), 'Approval TAT (days)': m.approved_at ? daysBetween(m.created_at, m.approved_at) : null,
        'Days open': m.status === 'CLOSED' ? null : daysBetween(m.created_at), 'First joining': day(firstJoin),
        'Time to fill (days)': firstJoin && m.approved_at ? daysBetween(m.approved_at, firstJoin) : null,
        'Openings left': Math.max(0, open), 'Target joining': day(target), 'Overdue': overdue ? 'Yes' : 'No',
        'Days past target': overdue ? daysBetween(target) : null,
      }
    }) }]

    case 'funnel': return [{ name: 'Hiring funnel', rows: mrfs.map(m => {
      const cs = candOf(m)
      const row: Row = { 'MRF number': m.mrf_number, 'Position': c.title(m), 'Status': m.status, 'Openings': num(m.no_of_openings ?? m.openings), 'Candidates': cs.length }
      for (const s of STAGE_ORDER) row[s] = cs.filter(x => x.stage === s).length
      const offered = cs.filter(x => isOffered(ds, x)).length, accepted = cs.filter(isAccepted).length, joined = cs.filter(x => isJoined(ds, x)).length
      return { ...row, 'Interviewed': cs.filter(x => interviewed(ds, x)).length, 'Offered': offered, 'Accepted': accepted, 'Joined': joined,
        'Offer % of candidates': pct(offered, cs.length), 'Acceptance %': pct(accepted, offered), 'Join % of offers': pct(joined, offered) }
    }) }]

    case 'candidates': return [{ name: 'Candidates', rows: cands.map(x => ({
      'Candidate': x.full_name, 'Email': x.email || null, 'Mobile': x.mobile || x.phone || null, 'MRF': c.mrfLabel(x.mrf_id),
      'Company': ds.companies[x.company_id] || null, 'Source': x.source || null, 'Current company': x.current_company || null,
      'Experience (yrs)': num(x.experience_years), 'Current CTC': num(x.current_ctc), 'Expected CTC': num(x.expected_ctc),
      'Notice (days)': num(x.notice_period_days ?? x.notice_period), 'Stage': x.stage || null, 'AI score': num(x.ai_score), 'AI tag': x.ai_tag || x.ai_match_tag || null,
      'Interviews': ds.invites.filter(i => i.candidate_id === x.id).length, 'Offer response': x.offer_response || null,
      'Applied on': day(x.applied_date || x.created_at), 'Days in pipeline': daysBetween(x.applied_date || x.created_at),
      'Blacklisted': yes(x.blacklisted),
    })) }]

    case 'sources': {
      const by = new Map<string, any[]>()
      for (const x of cands) { const k = x.source || 'Not recorded'; by.set(k, [...(by.get(k) || []), x]) }
      return [{ name: 'Sources', rows: [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([src, xs]) => {
        const offered = xs.filter(x => isOffered(ds, x)).length, joined = xs.filter(x => isJoined(ds, x)).length
        return { 'Source': src, 'Candidates': xs.length, 'Interviewed': xs.filter(x => interviewed(ds, x)).length,
          'Shortlisted': xs.filter(x => ['Shortlisted', 'Offer Sent', 'Joined'].includes(x.stage)).length, 'Offered': offered,
          'Accepted': xs.filter(isAccepted).length, 'Joined': joined, 'Rejected': xs.filter(x => x.stage === 'Rejected').length,
          'Offer %': pct(offered, xs.length), 'Join % of candidates': pct(joined, xs.length) }
      }) }]
    }

    case 'rejections': return [
      { name: 'Rejected', rows: cands.filter(x => x.stage === 'Rejected' || x.rejected_at).map(x => ({
        'Candidate': x.full_name, 'MRF': c.mrfLabel(x.mrf_id), 'Source': x.source || null, 'Reason': x.rejection_reason || null,
        'Remark': x.rejection_remark || null, 'Rejected by': c.who(x.rejected_by) || x.rejected_by || null, 'Rejected on': day(x.rejected_at),
        'Interviews held': ds.invites.filter(i => i.candidate_id === x.id && i.status === 'submitted').length })) },
      { name: 'Backouts', rows: cands.filter(isBackout).map(x => ({
        'Candidate': x.full_name, 'MRF': c.mrfLabel(x.mrf_id), 'Offer sent': day(x.offer_sent_at), 'Response': x.offer_response,
        'Planned DOJ': day(x.doj), 'Note': x.offer_revision_note || null })) },
    ]

    case 'interviews': return [{ name: 'Interviews', rows: ds.invites.filter(i => inRange(i.scheduled_at || i.created_at, r)).map(i => ({
      'Candidate': i.candidate_name || c.cand.get(i.candidate_id)?.full_name || null, 'MRF': c.mrfLabel(i.mrf_id), 'Round': i.round || null,
      'Interviewer': i.interviewer_name || null, 'Interviewer code': i.interviewer_emp_code || null, 'Interviewer role': i.role || null,
      'Scheduled for': dayTime(i.scheduled_at), 'Scheduled by': i.scheduled_by_name || c.who(i.scheduled_by), 'Scheduled on': dayTime(i.created_at),
      'Status': i.status === 'submitted' ? 'Feedback given' : i.status === 'acknowledged' ? 'Acknowledged' : i.status === 'invited' ? 'Awaiting acknowledgement' : i.status,
      'Acknowledged at': dayTime(i.acknowledged_at), 'Feedback at': dayTime(i.submitted_at),
      'Feedback TAT (hrs)': i.submitted_at && i.scheduled_at ? Math.max(0, hoursBetween(i.scheduled_at, i.submitted_at) ?? 0) : null,
      'Decision': i.decision || null, 'Decision remark': i.decision_remark || null,
      'Feedback': typeof i.feedback === 'string' ? i.feedback : i.feedback ? JSON.stringify(i.feedback).slice(0, 2000) : null,
    })) }]

    case 'interviewers': {
      const by = new Map<string, any[]>()
      for (const i of ds.invites.filter(i => inRange(i.scheduled_at || i.created_at, r))) {
        const k = `${i.interviewer_name || 'Unknown'}|${i.interviewer_emp_code || ''}`; by.set(k, [...(by.get(k) || []), i])
      }
      return [{ name: 'Interviewers', rows: [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => {
        const [name, code] = k.split('|')
        const done = xs.filter(i => i.status === 'submitted')
        const tats = done.map(i => hoursBetween(i.scheduled_at, i.submitted_at)).filter((h): h is number => h != null && h >= 0)
        const overdue = xs.filter(i => i.status !== 'submitted' && i.scheduled_at && ms(i.scheduled_at) < Date.now() - 86400000)
        return { 'Interviewer': name, 'Employee code': code || null, 'Assigned': xs.length, 'Acknowledged': xs.filter(i => i.acknowledged_at || i.status !== 'invited').length,
          'Feedback given': done.length, 'Pending': xs.length - done.length, 'Pending over 24h after the interview': overdue.length,
          'Shortlisted': xs.filter(i => i.decision === 'SHORTLIST').length, 'Rejected': xs.filter(i => i.decision === 'REJECT').length,
          'Avg feedback TAT (hrs)': tats.length ? Math.round((tats.reduce((a, b) => a + b, 0) / tats.length) * 10) / 10 : null }
      }) }]
    }

    case 'negotiations': return [{ name: 'Negotiations', rows: ds.negotiations.filter(n => inRange(n.created_at, r)).map(n => {
      const x = c.cand.get(n.candidate_id)
      return { 'Candidate': n.candidate_name || x?.full_name || null, 'Position': n.position_title || null, 'MRF': c.mrfLabel(x?.mrf_id), 'Company': n.company_name || ds.companies[n.company_id] || null,
        'Previous company': n.prev_company_name || n.previous_company || null, 'Current CTC': num(n.prev_total_ctc ?? n.current_ctc), 'Offered CTC': num(n.offered_ctc),
        'Hike %': num(n.hike_pct), 'Variable %': num(n.variable_pct), 'Stipend / month': n.is_stipend ? num(n.stipend_monthly) : null,
        'Joining bonus': num(n.joining_bonus), 'Joining bonus paid': n.joining_bonus_freq || null, 'Retention bonus': num(n.retention_bonus), 'ESOP value': num(n.esop_value),
        'Net / month': num(n.net_monthly), 'Proposed DOJ': day(n.proposed_doj), 'Notice (days)': num(n.notice_period_days),
        'Salary link sent': dayTime(n.link_sent_at), 'Link viewed': dayTime(n.link_viewed_at), 'Candidate response': n.candidate_response || null,
        'Responded at': dayTime(n.response_at || n.candidate_responded_at), 'Candidate note': n.response_note || n.candidate_comment || null, 'Created on': day(n.created_at) }
    }) }]

    case 'offer_approvals': return [{ name: 'Offer approvals', rows: ds.offerRequests.filter(o => inRange(o.submitted_at || o.created_at, r)).map(o => ({
      'Candidate': c.cand.get(o.candidate_id)?.full_name || null, 'MRF': c.mrfLabel(o.mrf_id), 'Company': ds.companies[o.company_id] || null,
      'Previous CTC': num(o.prev_total_ctc), 'Offered CTC': num(o.offered_ctc), 'Fixed': num(o.offered_fixed), 'Variable': num(o.offered_variable),
      'Hike %': num(o.hike_pct), 'Monthly in-hand': num(o.monthly_inhand), 'Joining bonus': num(o.joining_bonus), 'Retention bonus': num(o.retention_bonus), 'ESOP value': num(o.esop_value),
      'Notice buyout': num(o.notice_buyout_amount), 'Proposed DOJ': day(o.proposed_doj), 'BGV': o.bgv_status || null,
      'Status': o.status ? String(o.status).replace(/_/g, ' ') : null, 'Submitted by': o.submitted_by || null, 'Submitted on': dayTime(o.submitted_at || o.created_at),
      'HR Head decision': o.hr_head_action || null, 'HR Head comment': o.hr_head_comments || null, 'Decided at': dayTime(o.hr_head_actioned_at),
      'Approval TAT (hrs)': o.hr_head_actioned_at ? hoursBetween(o.submitted_at || o.created_at, o.hr_head_actioned_at) : null,
      'Revisions': num(o.revision_count) ?? 0, 'Offer sent': dayTime(o.offer_sent_at),
    })) }]

    case 'offers': return [{ name: 'Offers', rows: ds.offerLetters.filter(o => inRange(o.sent_at || o.generated_at || o.created_at, r)).map(o => {
      const x = c.cand.get(o.candidate_id)
      // The letter row does not always carry the figures; the approved request does.
      const req = ds.offerRequests.find(q => q.id === o.offer_request_id) || ds.offerRequests.filter(q => q.candidate_id === o.candidate_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
      const pos = (v: any) => (Number(v) > 0 ? num(v) : null)
      const acc = ds.acceptances.filter(a => a.candidate_id === o.candidate_id).sort((a, b) => String(b.accepted_at).localeCompare(String(a.accepted_at)))[0]
      return { 'Offer number': o.offer_number || null, 'Candidate': o.candidate_name || x?.full_name || null, 'Designation': o.designation || null, 'Department': o.department || null,
        'Location': o.location || null, 'MRF': c.mrfLabel(x?.mrf_id), 'Annual CTC': pos(o.annual_ctc) ?? pos(req?.offered_ctc), 'Monthly fixed': pos(o.fixed_ctc_monthly) ?? (pos(req?.offered_fixed) != null ? Math.round(Number(req.offered_fixed) / 12) : null),
        'Joining bonus': pos(o.joining_bonus) ?? pos(req?.joining_bonus), 'Date of joining': day(o.date_of_joining || req?.proposed_doj || x?.doj), 'Status': o.status || null, 'Sent on': dayTime(o.sent_at), 'Candidate response': x?.offer_response || o.candidate_response || null,
        'Accepted on': dayTime(acc?.accepted_at), 'Acceptance by': acc ? (acc.acceptance_type === 'UPLOAD' ? 'Signed copy uploaded' : acc.acceptance_type) : null,
        'Days sent → accepted': acc?.accepted_at && o.sent_at ? daysBetween(o.sent_at, acc.accepted_at) : null }
    }) }]

    case 'documents': {
      const links = ds.docLinks.filter(l => inRange(l.sent_at || l.created_at, r))
      return [
        { name: 'Submission status', rows: links.map(l => {
          const ds_ = ds.docs.filter(d => d.link_id === l.id || (!d.link_id && d.candidate_id === l.candidate_id))
          return { 'Candidate': c.cand.get(l.candidate_id)?.full_name || null, 'Email': l.candidate_email || null, 'MRF': c.mrfLabel(l.mrf_id),
            'Link sent': dayTime(l.sent_at || l.created_at), 'Opened': dayTime(l.opened_at), 'Submitted': dayTime(l.submitted_at), 'Expires': dayTime(l.expires_at),
            'Status': l.status === 'SUBMITTED' ? 'Submitted' : l.expires_at && ms(l.expires_at) < Date.now() ? 'Expired' : l.opened_at ? 'Opened, not submitted' : 'Not opened',
            'Hours to submit': l.submitted_at ? hoursBetween(l.sent_at || l.created_at, l.submitted_at) : null,
            'Documents uploaded': ds_.length, 'Mandatory uploaded': ds_.filter(d => d.is_mandatory).length,
            'Documents': [...new Set(ds_.map(d => d.doc_label || d.doc_type))].join(', ') || null }
        }) },
        { name: 'All documents', rows: ds.docs.filter(d => links.some(l => l.id === d.link_id) || (!r.from && !r.to)).map(d => ({
          'Candidate': c.cand.get(d.candidate_id)?.full_name || null, 'Document': d.doc_label || d.doc_type, 'Type': d.doc_type || null,
          'Mandatory': yes(d.is_mandatory), 'File': d.file_name || null, 'Size (KB)': d.file_size ? Math.round(Number(d.file_size) / 1024) : null, 'Uploaded at': dayTime(d.uploaded_at) })) },
      ]
    }

    case 'joining': {
      const STAGE: Record<string, string> = { NOT_INVITED: 'Not invited', INVITED: 'Link sent', IN_PROGRESS: 'Filling the form', SUBMITTED: 'HR to review', HR_REVIEW: 'With the teams', APPROVED: 'Ready for code', EMPLOYEE_CREATED: 'Employee created' }
      const accepted = cands.filter(x => isAccepted(x) || ds.onboarding.some(o => o.candidate_id === x.id))
      return [{ name: 'Joining', rows: accepted.map(x => {
        const o = ds.onboarding.filter(y => y.candidate_id === x.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
        const doj = o?.date_of_joining || x.doj || ds.offerRequests.find(q => q.candidate_id === x.id)?.proposed_doj
        return { 'Candidate': x.full_name, 'MRF': c.mrfLabel(x.mrf_id), 'Designation': o?.designation || x.designation || c.title(c.mrf.get(x.mrf_id)) || null, 'Offer response': x.offer_response || null,
          'Date of joining': day(doj), 'Days until joining (negative = already past)': doj ? -(daysBetween(doj) ?? 0) : null,
          'Onboarding stage': o ? STAGE[o.status] || o.status : 'Not in onboarding yet', 'Form submitted': dayTime(o?.submitted_at),
          'Employee code': o?.employee_code || null, 'Joined': yes(isJoined(ds, x)) }
      }) }]
    }

    case 'recruiters': {
      const by = new Map<string, { mrfs: any[] }>()
      for (const m of mrfs) {
        const ids: string[] = Array.isArray(m.assigned_recruiter_ids) && m.assigned_recruiter_ids.length ? m.assigned_recruiter_ids : []
        const keys = ids.length ? ids : [m.assigned_recruiter ? `txt:${m.assigned_recruiter}` : 'none']
        for (const k of keys) by.set(k, { mrfs: [...(by.get(k)?.mrfs || []), m] })
      }
      return [{ name: 'Recruiters', rows: [...by.entries()].map(([k, v]) => {
        const cs = v.mrfs.flatMap(candOf)
        const offered = cs.filter(x => isOffered(ds, x)).length, joined = cs.filter(x => isJoined(ds, x)).length
        return { 'Recruiter': k === 'none' ? 'Not assigned' : k.startsWith('txt:') ? k.slice(4) : c.who(k) || k, 'MRFs': v.mrfs.length,
          'Open MRFs': v.mrfs.filter(m => m.status === 'APPROVED').length, 'Openings': v.mrfs.reduce((a, m) => a + (Number(m.no_of_openings ?? m.openings) || 0), 0),
          'Candidates': cs.length, 'Interviews': ds.invites.filter(i => cs.some(x => x.id === i.candidate_id)).length, 'Offered': offered,
          'Accepted': cs.filter(isAccepted).length, 'Joined': joined, 'Join % of offers': pct(joined, offered) }
      }).sort((a, b) => Number(b['MRFs']) - Number(a['MRFs'])) }]
    }

    case 'audit': return [{ name: 'Audit trail', rows: ds.audit.filter(a => inRange(a.created_at, r)).map(a => ({
      'When': dayTime(a.created_at), 'Action': String(a.action_type || '').replace(/_/g, ' ').toLowerCase().replace(/^./, s => s.toUpperCase()),
      'Candidate': c.cand.get(a.candidate_id)?.full_name || null, 'MRF': c.mrfLabel(a.mrf_id), 'By': a.actor_email || null, 'Role': a.actor_role || null,
      'Details': a.details == null ? null : typeof a.details === 'string' ? a.details : JSON.stringify(a.details).slice(0, 1500),
    })) }]
  }
  return []
}

/** Rows per report, for the catalogue's counts. */
export function reportCounts(ds: Dataset, r: Range = {}): Record<string, number> {
  return Object.fromEntries(REPORTS.map(d => [d.key, buildReport(d.key, ds, r).reduce((a, s) => a + s.rows.length, 0)]))
}

/** A sheet name Excel accepts: 31 characters, none of []:*?/\ , unique in the workbook. */
export function sheetName(name: string, taken: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet'
  let n = base, i = 2
  while (taken.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${i++}`
  taken.add(n.toLowerCase())
  return n
}
