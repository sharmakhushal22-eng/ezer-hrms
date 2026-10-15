// The offer email became six Configuration templates (one per engagement). This proves the
// built-in templates render to exactly what the Send Offers screen wrote in code before
// (lib/recruitment/__tests__/fixtures/offer-mail-legacy.ts), for every engagement, with and
// without the details that change the text, and after an edit in the offer file.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mailText } from '../../recruitment/__tests__/fixtures/offer-mail-legacy.ts'
import { offerMailVars, offerKindOf, OFFER_EMAIL_KEY } from '../offer-mail.ts'
import { systemTemplate } from '../registry.ts'
import { renderText } from '../render.ts'

const render = (r: any, f?: any) => {
  const t = systemTemplate(OFFER_EMAIL_KEY[offerKindOf(r)])!.defaults
  const v = offerMailVars(r, f)
  return { subject: renderText(t.subject, v).text, body: renderText(t.body, v).text }
}

const TYPES = ['Employee', 'Intern', 'NATS', 'NAPS', 'Contract', 'Consultant']
const rows = (type: string) => [
  { offered_ctc: 1800000, proposed_doj: '2026-11-01', candidates: { full_name: 'Priya Sharma', designation: 'Analyst' }, companies: { company_name: 'Acme Pvt Ltd' },
    manpower_requisitions: { employment_type: type, duration_months: 6 }, ctc_negotiations: { is_stipend: true, stipend_monthly: 25000, tds_applicable: true, tds_pct: 10 } },
  { offered_ctc: null, proposed_doj: null, candidates: { full_name: null }, companies: null, manpower_requisitions: { employment_type: type }, ctc_negotiations: null },
  { offered_ctc: 600000, proposed_doj: '2026-12-15', candidates: { full_name: 'Ravi', designation: 'Fitter', application_details: { requisition: { employment_type: type, duration_months: 1 } } },
    companies: { company_name: 'Acme' }, manpower_requisitions: { employment_type: 'Employee' }, ctc_negotiations: { is_stipend: false } },
]

describe('offer emails: built-in templates = the wording before Configuration', () => {
  for (const type of TYPES) {
    test(type, () => {
      for (const r of rows(type)) {
        assert.deepEqual(render(r), mailText(r), `${type} ${JSON.stringify(r.candidates)}`)
        const edit = { name: 'Priya S.', designation: 'Lead Analyst', doj: '2027-01-02' }
        assert.deepEqual(render(r, edit), mailText(r, edit))
      }
    })
  }
})
