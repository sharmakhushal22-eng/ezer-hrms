// The built-in wording must be what each workflow sent before templates existed —
// that is the promise that applying Configuration changes nothing until somebody edits
// a template. The "old" strings below are copied from the routes as they were.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEM_TEMPLATES, systemTemplate, hrLetterDef, sampleVars, blockVarsOf, hrLetterKey, hrLetterIdOf, isHrLetterKey } from '../registry.ts'
import { renderText, validateTemplate } from '../render.ts'

const fill = (key: string, vars: Record<string, string>) => {
  const t = systemTemplate(key)!
  return { subject: renderText(t.defaults.subject, vars).text, body: renderText(t.defaults.body, vars).text }
}

describe('registry', () => {
  test('keys are unique', () => {
    const keys = SYSTEM_TEMPLATES.map(t => t.key)
    assert.equal(new Set(keys).size, keys.length)
  })

  test('every built-in template passes its own validation', () => {
    for (const t of SYSTEM_TEMPLATES) {
      const names = t.variables.map(v => v.name)
      const blocks = blockVarsOf(t)
      assert.deepEqual(validateTemplate(t.defaults.subject, names.filter(n => !blocks.includes(n)), { required: true }), [], `${t.key} subject`)
      assert.deepEqual(validateTemplate(t.defaults.body, names, { required: true, blockVars: blocks }), [], `${t.key} body`)
    }
  })

  test('sample data fills every non-block variable of every template', () => {
    for (const t of SYSTEM_TEMPLATES) {
      const r = renderText(t.defaults.body, { ...sampleVars(t), ...Object.fromEntries(blockVarsOf(t).map(b => [b, ''])) })
      assert.deepEqual(r.unknown, [], t.key)
    }
  })

  test('HR letter keys round-trip and HR letters default to their legacy content', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    assert.equal(hrLetterIdOf(hrLetterKey(id)), id)
    assert.ok(isHrLetterKey(hrLetterKey(id)))
    assert.ok(!isHrLetterKey('offer.email'))
    const d = hrLetterDef({ id, name: 'Experience Letter', content: 'Dear {{employee_name}},' }, [{ token: 'employee_name', label: 'Employee Name' }], { employee_name: 'Rajesh' })
    assert.equal(d.defaults.subject, 'Experience Letter')
    assert.equal(d.defaults.body, 'Dear {{employee_name}},')
    assert.equal(d.variables[0].sample, 'Rajesh')
  })
})

describe('built-in text = what was sent before', () => {
  test('onboarding invitation', () => {
    const link = 'https://app/onboarding/abc'
    const r = fill('onboarding.invite', { candidate_name: 'Priya', onboarding_link: link, link_validity_hours: '24', company_name: '', designation: '', joining_date: '' })
    assert.equal(r.subject, 'Welcome aboard! Complete your onboarding — Priya')
    assert.equal(r.body, `Dear Priya,

Welcome! Please complete your joining formalities by opening the secure link below:

${link}

This link is valid for 24 hours. You'll verify your mobile via OTP, then fill in your details and upload documents.

Warm regards,
HR Team`)
  })

  test('onboarding reminder', () => {
    const link = 'https://app/onboarding/abc'
    const r = fill('onboarding.reminder', { candidate_name: 'Priya', onboarding_link: link, link_validity_hours: '24', company_name: '' })
    assert.equal(r.subject, 'Reminder: complete your onboarding — Priya')
    assert.equal(r.body, `Dear Priya,

A reminder to complete your joining formalities. Please open your secure onboarding link below:

${link}

This link is valid for 24 hours.

Warm regards,
HR Team`)
  })

  test('interview invite — candidate, with and without a link', () => {
    const base = { candidate_name: 'Priya', round: 'L1', interview_time: '14 Oct 2026, 11:00 am', scheduler_name: 'Anita', company_name: '' }
    // old: `Dear ${name},\n\nYour ${round} interview${role} is scheduled for ${when}.${linkLine}\n\nPlease join on time. All the best.\n\n${schedName}`
    const withLink = fill('interview.candidate', { ...base, job_title: 'Sales Manager', meet_link: 'https://meet/x', meet_passcode: '42' })
    assert.equal(withLink.subject, 'Interview scheduled — L1')
    assert.equal(withLink.body, 'Dear Priya,\n\nYour L1 interview for the Sales Manager role is scheduled for 14 Oct 2026, 11:00 am.\nJoin link: https://meet/x\nPasscode: 42\n\nPlease join on time. All the best.\n\nAnita')
    const bare = fill('interview.candidate', { ...base, job_title: '', meet_link: '', meet_passcode: '' })
    assert.equal(bare.body, 'Dear Priya,\n\nYour L1 interview is scheduled for 14 Oct 2026, 11:00 am.\n\nPlease join on time. All the best.\n\nAnita')
  })

  test('interview invite — main interviewer and panelist', () => {
    const base = { candidate_name: 'Priya', round: 'L1', interview_time: 'T', meet_link: '', meet_passcode: '', scheduler_name: 'Anita', company_name: '' }
    const main = fill('interview.interviewer_main', { ...base, interviewer_name: 'Rahul', panel_names: 'Meera' })
    assert.equal(main.subject, 'Interview to conduct — Priya (L1)')
    assert.equal(main.body, 'Hi Rahul,\n\nPriya — L1 round, scheduled for T.\n\nYou are the MAIN interviewer (panel: Meera). Please acknowledge it from your ESS notifications (the bell) and record your feedback there after the interview.\n\nAnita')
    const panel = fill('interview.interviewer_panel', { ...base, interviewer_name: 'Meera', main_interviewer_name: 'Rahul' })
    assert.equal(panel.body, "Hi Meera,\n\nPriya — L1 round, scheduled for T.\n\nYou've been added as a PANELIST. Main interviewer: Rahul. Please acknowledge it from your ESS notifications (the bell).\n\nAnita")
  })

  test('document re-upload lists exactly the missing documents', () => {
    const r = fill('doc_collection.reupload', {
      candidate_name: 'Priya', job_title: 'Sales Manager', company_name: 'Acme', upload_link: 'L',
      link_validity_hours: '24', sender_name: 'Anita', missing_documents: '• PAN Card\n• Form 16',
    })
    assert.equal(r.subject, 'Action needed: Please re-upload a few documents')
    assert.match(r.body, /for the position of Sales Manager at Acme\./)
    assert.match(r.body, /\n\n• PAN Card\n• Form 16\n\n/)
    assert.match(r.body, /valid for 24 hours\./)
  })
})
