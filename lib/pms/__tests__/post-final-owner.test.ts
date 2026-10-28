// lib/pms/__tests__/post-final-owner.test.ts
//
// Requested: once the HOD finalises, the result moves to HR, and every step
// after the rating — the feedback the employee reads, the recognition awards,
// and the publish — is HR's. The HOD's part ends at the number.
//
// THIS DIVERGES FROM THE DOCX, which is why it is a policy column and not a
// hardcoded split. Stage 6: "The designated finaliser ... submits: (a) Final
// Rating, (b) Appreciation Remark, (c) Improvement Feedback ... and
// (d) Recognition Awards." The spec gives all four to the finaliser; the
// instruction moves (b), (c) and (d) to HR. Default 'HR', because that is
// what was asked for; 'FINALISER' restores Stage 6.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLES, type Role } from '../hierarchy.ts'
import { mayWritePostFinal, mayPublish, postFinalNote, isHrRole,
         showFinaliserFeedbackTab, POST_FINAL_OWNERS } from '../postFinal.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

test('under HR (the default) the line roles write nothing', () => {
  for (const r of ['RM_L1', 'RM_L2', 'HOD'] as Role[]) {
    assert.equal(mayWritePostFinal('HR', r), false, `${r} should not write`)
    assert.equal(mayPublish('HR', r), false, `${r} should not publish`)
  }
})

test('under HR, all three HR roles may act — not HR Head alone', () => {
  // §2's matrix gives HR_MGR and HR_HEAD identical rights on every action but
  // configure_policy, and give_feedback / upload_benefit are yes for both. An
  // HR_HEAD-only rule would mean inventing a distinction the matrix does not
  // make and editing the roles module to enforce it.
  for (const r of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as Role[]) {
    assert.equal(mayWritePostFinal('HR', r), true, `${r} should write`)
    assert.equal(mayPublish('HR', r), true, `${r} should publish`)
    assert.equal(isHrRole(r), true)
  }
})

test('under FINALISER the line roles get it back, and HR keeps it too', () => {
  // docx Stage 6 restored. HR stays allowed because §2 grants them
  // give_feedback and upload_benefit regardless, and HR fixing a remark on a
  // stuck record is the same escalation path everything else gives them.
  for (const r of ['RM_L1', 'RM_L2', 'HOD'] as Role[]) {
    assert.equal(mayWritePostFinal('FINALISER', r), true, `${r} should write`)
  }
  for (const r of ['HR_MGR', 'HR_HEAD', 'ADMIN'] as Role[]) {
    assert.equal(mayWritePostFinal('FINALISER', r), true, `${r} should still write`)
  }
})

test('the employee never writes post-final content, under either setting', () => {
  for (const owner of POST_FINAL_OWNERS) {
    assert.equal(mayWritePostFinal(owner, 'EMPLOYEE'), false)
    assert.equal(mayPublish(owner, 'EMPLOYEE'), false)
  }
})

test('every role gets a definite answer', () => {
  // A role added to ROLES later must not fall through to undefined.
  for (const owner of POST_FINAL_OWNERS) {
    for (const r of ROLES) {
      assert.equal(typeof mayWritePostFinal(owner, r), 'boolean', `${owner}/${r}`)
    }
  }
})

test('somebody who cannot act is told where it went, not just refused', () => {
  const note = postFinalNote('HR', 'HOD')
  assert.ok(note && /HR writes the feedback/.test(note),
    'the HOD is not told who owns it now')
  assert.ok(note && /Published Results/.test(note),
    'the HOD is not told where to see what went out')
  // And nobody who CAN act gets a note at all.
  assert.equal(postFinalNote('HR', 'HR_MGR'), null)
  assert.equal(postFinalNote('FINALISER', 'HOD'), null)
})

test('the finaliser tab shows only under FINALISER', () => {
  assert.equal(showFinaliserFeedbackTab('FINALISER'), true)
  assert.equal(showFinaliserFeedbackTab('HR'), false)
})

// ── the wiring ───────────────────────────────────────────────────────────

test('the policy column exists, defaults to HR, and is writable by the admin API', () => {
  const sql = read('supabase/migrations/202_pms_post_final_controls_owner.sql')
  assert.match(sql, /post_final_owner text NOT NULL DEFAULT 'HR'/)
  assert.match(sql, /CHECK \(post_final_owner IN \('HR', 'FINALISER'\)\)/)
  // THE ALLOWLIST. A policy column is inert until the admin route names it —
  // the exact shape of the "my configuration changes do not take effect" bug
  // already reported against this module.
  const route = read('app/api/pms/admin/route.ts')
  const cols = route.slice(route.indexOf('const POLICY_COLS'),
                           route.indexOf('] as const', route.indexOf('const POLICY_COLS')))
  assert.match(cols, /'post_final_owner'/,
    'post_final_owner is not allowlisted, so the admin control saves into nothing')
  // And the editor must offer it.
  assert.match(read('components/pms/AdminEditor.tsx'),
    /set\('post_final_owner', e\.target\.value\)/,
    'the admin screen has no control for it')
})

test('HR\'s publish workspace writes the words but never the rating', () => {
  const admin = read('components/pms/AdminTabs.tsx')
  const tab = admin.slice(admin.indexOf('export function PublishTab'),
                          admin.indexOf('// ── the whole company, on one screen'))
  assert.ok(tab.length > 1000, 'could not isolate the publish workspace')
  assert.match(tab, /onSaveFeedback/, 'HR cannot write the feedback')
  assert.match(tab, /Add recognition/, 'HR cannot award recognition')
  // THE RATING IS NOT HR'S. No numeric input, no rating select.
  assert.ok(!/type="number"/.test(tab), 'the publish workspace offers a rating input')
  assert.ok(!/onPublish\?\.\(.*rating/.test(tab), 'a rating is passed to publish')
  // And the sign-off is SHOWN rather than discovered: 200's trigger refuses an
  // unsigned publish, and a raw P0001 on a button press is what it replaced.
  assert.match(tab, /signedOff === false/,
    'the workspace does not surface the final-review sign-off')
})

test('the HOD is told the step moved, rather than finding a dead form', () => {
  const perf = read('components/ess/Performance.tsx')
  assert.match(perf, /showFinaliserFeedbackTab\(/,
    'the HOD surface does not consult the policy')
  assert.match(perf, /HR writes this now/,
    'the HOD gets no explanation of where feedback went')
  // The column has to be SELECTED or the default silently wins everywhere.
  assert.match(perf, /carry_forward_kras,post_final_owner/,
    'post_final_owner is never read from the policy')
})

test('the summary covers everyone, not just the settled', () => {
  const page = read('app/dashboard/pms/page.tsx')
  // One query feeds both tabs; filtering it to FINALISED would have left the
  // summary unable to show anybody still in the chain.
  assert.ok(!/\.in\('workflow_status', \['FINALISED', 'PUBLISHED', 'ACKNOWLEDGED'\]\)/.test(page),
    'the loader still filters to settled rows, so the summary cannot show the chain')
  assert.match(page, /<SummaryTab rows=\{pubRows\}/, 'the summary is never rendered')
  assert.match(page, /summary: 'pms\.fill'/,
    'the summary tab has no seeded screen key and will be invisible')
})
