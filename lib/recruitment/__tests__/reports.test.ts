// lib/recruitment/__tests__/reports.test.ts — Recruitment → Reports: what each report counts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPORTS, buildReport, reportCounts, sheetName, inRange, day, daysBetween, hoursBetween, type Dataset } from '../reports.ts'

const ds = (): Dataset => ({
  mrfs: [
    { id: 'm1', mrf_number: 'MRF-1', job_title: 'Sales Manager', company_id: 'c1', department_id: 'd1', location_id: 'l1', mrf_type: 'Full MRF', no_of_openings: 2, status: 'APPROVED',
      created_at: '2026-09-01T05:00:00Z', approved_at: '2026-09-04T05:00:00Z', target_joining_date: '2026-09-30', assigned_recruiter_ids: ['p1'], requested_by: 'p2',
      approval_chain: [{ status: 'APPROVED', role: 'HR_HEAD', approver_name: 'Riya' }] },
    { id: 'm2', mrf_number: 'MRF-2', position: 'Analyst', company_id: 'c1', no_of_openings: 1, status: 'DRAFT', created_at: '2026-10-10T05:00:00Z',
      approval_chain: [{ status: 'PENDING', role: 'HOD', approver_name: 'Aman' }] },
  ],
  candidates: [
    { id: 'a', full_name: 'Asha', mrf_id: 'm1', company_id: 'c1', source: 'Naukri', stage: 'Offer Sent', offer_response: 'ACCEPTED', created_at: '2026-09-05T05:00:00Z', offer_sent_at: '2026-09-20T05:00:00Z' },
    { id: 'b', full_name: 'Bilal', mrf_id: 'm1', company_id: 'c1', source: 'Naukri', stage: 'Rejected', rejection_reason: 'Skills', rejected_at: '2026-09-10T05:00:00Z', created_at: '2026-09-06T05:00:00Z' },
    { id: 'c', full_name: 'Chitra', mrf_id: 'm1', company_id: 'c1', source: 'Referral', stage: 'Offer Sent', offer_response: 'BACKOUT', created_at: '2026-09-07T05:00:00Z' },
  ],
  invites: [
    { id: 'i1', candidate_id: 'a', mrf_id: 'm1', round: 'L1', interviewer_name: 'Ravi', interviewer_emp_code: 'E1', status: 'submitted', decision: 'SHORTLIST', scheduled_at: '2026-09-08T05:00:00Z', submitted_at: '2026-09-08T09:00:00Z', created_at: '2026-09-07T05:00:00Z' },
    { id: 'i2', candidate_id: 'b', mrf_id: 'm1', round: 'L1', interviewer_name: 'Ravi', interviewer_emp_code: 'E1', status: 'invited', scheduled_at: '2026-09-09T05:00:00Z', created_at: '2026-09-07T05:00:00Z' },
  ],
  negotiations: [{ id: 'n1', candidate_id: 'a', offered_ctc: 1200000, prev_total_ctc: 1000000, hike_pct: 20, candidate_response: 'ACCEPTED', created_at: '2026-09-15T05:00:00Z' }],
  offerRequests: [{ id: 'o1', candidate_id: 'a', mrf_id: 'm1', offered_ctc: 1200000, status: 'OFFER_SENT', submitted_at: '2026-09-16T05:00:00Z', hr_head_actioned_at: '2026-09-16T11:00:00Z', created_at: '2026-09-16T05:00:00Z' }],
  offerLetters: [{ id: 'ol1', candidate_id: 'a', annual_ctc: 1200000, status: 'SENT', sent_at: '2026-09-20T05:00:00Z', created_at: '2026-09-20T05:00:00Z' }],
  acceptances: [{ id: 'ac1', candidate_id: 'a', acceptance_type: 'UPLOAD', accepted_at: '2026-09-22T05:00:00Z' }],
  docLinks: [{ id: 'dl1', candidate_id: 'a', mrf_id: 'm1', status: 'SUBMITTED', sent_at: '2026-09-21T05:00:00Z', submitted_at: '2026-09-21T15:00:00Z', created_at: '2026-09-21T05:00:00Z' }],
  docs: [{ id: 'x1', link_id: 'dl1', candidate_id: 'a', doc_type: 'PAN', doc_label: 'PAN card', is_mandatory: true, uploaded_at: '2026-09-21T14:00:00Z' },
         { id: 'x2', link_id: 'dl1', candidate_id: 'a', doc_type: 'PHOTO', doc_label: 'Photo', is_mandatory: false, uploaded_at: '2026-09-21T14:00:00Z' }],
  onboarding: [{ id: 'ob1', candidate_id: 'a', status: 'EMPLOYEE_CREATED', employee_code: 'STC0100', date_of_joining: '2026-10-01', created_at: '2026-09-25T05:00:00Z' }],
  audit: [{ id: 'au1', candidate_id: 'a', action_type: 'OFFER_ACCEPTED', created_at: '2026-09-22T05:00:00Z' }],
  companies: { c1: 'STC' }, departments: { d1: 'Sales' }, locations: { l1: 'Gurugram' },
  people: { p1: { name: 'Neha', code: 'STC9001' }, p2: { name: 'Raj', code: 'STC9002' } },
})
const one = (key: string, d = ds()) => buildReport(key, d)[0].rows

test('fifteen reports, each with rows and a description', () => {
  assert.equal(REPORTS.length, 15)
  for (const r of REPORTS) { assert.ok(r.desc.length > 20, r.key); assert.ok(buildReport(r.key, ds()).length >= 1, `${r.key} builds a sheet`) }
  assert.deepEqual(buildReport('nope', ds()), [])
})

test('MRF register names people and counts filled from onboarding', () => {
  const [m1, m2] = one('mrf_register')
  assert.equal(m1['Position'], 'Sales Manager'); assert.equal(m2['Position'], 'Analyst')
  assert.equal(m1['Filled'], 1); assert.equal(m1['Candidates'], 3)
  assert.equal(m1['Recruiters'], 'Neha (STC9001)'); assert.equal(m1['Raised by'], 'Raj (STC9002)')
  assert.equal(m1['Department'], 'Sales'); assert.equal(m1['Approval'], 'Approved')
  assert.equal(m2['Approval'], 'Not submitted')
  const sub = ds(); sub.mrfs[1].status = 'SUBMITTED'
  assert.equal(buildReport('mrf_register', sub)[0].rows[1]['Approval'], 'With Aman (HOD)')
})

test('ageing: approval TAT and time to fill in days', () => {
  const [m1] = one('mrf_tat')
  assert.equal(m1['Approval TAT (days)'], 3)
  assert.equal(m1['Time to fill (days)'], 26)
  assert.equal(m1['Openings left'], 1)
})

test('funnel conversion', () => {
  const [m1] = one('funnel')
  assert.equal(m1['Offer Sent'], 2); assert.equal(m1['Rejected'], 1)
  assert.equal(m1['Offered'], 2); assert.equal(m1['Accepted'], 1); assert.equal(m1['Joined'], 1)
  assert.equal(m1['Acceptance %'], 50); assert.equal(m1['Join % of offers'], 50)
})

test('sources, rejections and backouts', () => {
  const src = one('sources')
  assert.equal(src[0]['Source'], 'Naukri'); assert.equal(src[0]['Candidates'], 2); assert.equal(src[0]['Joined'], 1)
  const [rej, back] = buildReport('rejections', ds())
  assert.deepEqual(rej.rows.map(r => r['Candidate']), ['Bilal']); assert.equal(rej.rows[0]['Reason'], 'Skills')
  assert.deepEqual(back.rows.map(r => r['Candidate']), ['Chitra'])
})

test('interviews and interviewer turnaround', () => {
  const iv = one('interviews')
  assert.equal(iv[0]['Status'], 'Feedback given'); assert.equal(iv[0]['Feedback TAT (hrs)'], 4)
  assert.equal(iv[1]['Status'], 'Awaiting acknowledgement')
  const [ravi] = one('interviewers')
  assert.equal(ravi['Assigned'], 2); assert.equal(ravi['Feedback given'], 1); assert.equal(ravi['Pending'], 1)
  assert.equal(ravi['Avg feedback TAT (hrs)'], 4); assert.equal(ravi['Pending over 24h after the interview'], 1)
})

test('offers: approval TAT, acceptance and documents', () => {
  assert.equal(one('offer_approvals')[0]['Approval TAT (hrs)'], 6)
  const [o] = one('offers')
  assert.equal(o['Acceptance by'], 'Signed copy uploaded'); assert.equal(o['Days sent → accepted'], 2)
  const zero = ds(); zero.offerLetters[0].annual_ctc = 0
  assert.equal(buildReport('offers', zero)[0].rows[0]['Annual CTC'], 1200000, 'falls back to the approved request')
  const [status, docs] = buildReport('documents', ds())
  assert.equal(status.rows[0]['Status'], 'Submitted'); assert.equal(status.rows[0]['Documents uploaded'], 2)
  assert.equal(status.rows[0]['Mandatory uploaded'], 1); assert.equal(status.rows[0]['Hours to submit'], 10)
  assert.equal(docs.rows.length, 2)
})

test('joining lists accepted candidates with their onboarding', () => {
  const rows = one('joining')
  assert.deepEqual(rows.map(r => r['Candidate']), ['Asha'])
  assert.equal(rows[0]['Onboarding stage'], 'Employee created'); assert.equal(rows[0]['Employee code'], 'STC0100')
})

test('recruiter performance', () => {
  const [neha] = one('recruiters')
  assert.equal(neha['Recruiter'], 'Neha (STC9001)'); assert.equal(neha['MRFs'], 1); assert.equal(neha['Joined'], 1)
})

test('the date window filters each report by its own date', () => {
  const r = { from: '2026-10-01', to: '2026-10-31' }
  assert.deepEqual(buildReport('mrf_register', ds(), r)[0].rows.map(x => x['MRF number']), ['MRF-2'])
  assert.equal(buildReport('candidates', ds(), r)[0].rows.length, 0)
  const counts = reportCounts(ds())
  assert.equal(counts.mrf_register, 2); assert.equal(counts.documents, 3)
  assert.ok(inRange('2026-10-05T10:00:00Z', r) && !inRange(null, r) && inRange(null, {}))
})

test('helpers: dates, durations and sheet names', () => {
  assert.equal(day('2026-10-05'), '05-Oct-2026'); assert.equal(day('2026-10-05T20:00:00Z'), '06-Oct-2026')
  assert.equal(daysBetween('2026-10-01', '2026-10-05'), 4); assert.equal(hoursBetween('2026-10-01T00:00:00Z', '2026-10-01T06:30:00Z'), 6.5)
  const t = new Set<string>()
  assert.equal(sheetName('Offer approvals', t), 'Offer approvals'); assert.equal(sheetName('Offer approvals', t), 'Offer approvals 2')
  assert.ok(sheetName('A very long sheet name that goes past thirty-one chars', t).length <= 31)
  assert.equal(sheetName('a/b:c', t), 'a b c')
})
