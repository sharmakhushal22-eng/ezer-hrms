// Two bugs in the bulk publish, found by reading the feature as SRS9047
// (Kiran Reddy, HR Head).
//
// Both have the same shape: a screen that says a result is ready to go out
// when something else will refuse it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { publishFaults } from '../publishGate.ts'
import { split as bulkSplit, type BulkRow } from '../bulkPublish.ts'

const read = (p: string) => readFileSync(p, 'utf8')

// ── 1. the preview applied four of the five gate rules ───────────────────
//
// BulkPublish built every BulkRow with `improvementRequired: false`, under a
// comment claiming "the band's own rule travels with the row". It does not:
// PublishRow carries no such field. So somebody on a band that mandates
// improvement feedback, with none written, was listed under "Ready to
// publish" and counted on the confirm button — and publishMany, which
// computes the rule properly from bandList, then refused them. The outcome
// banner reported that refusal among the SERVER's, which it was not.

const row = (o: Partial<BulkRow>): BulkRow => ({
  employeeId: 'e1', code: 'SRS0001', name: 'A Person',
  finalRating: 2, appreciation: 'well done', improvement: '',
  // The real HrFinalRow column names — 211 reads these off pms_overall_rating.
  signedOff: true,
  hrFinal: { hr_final_confirmed_at: '2026-11-04T00:00:00Z', hr_management_discussed: true },
  ...o,
} as BulkRow)

test('the gate blocks a mandatory-improvement row with nothing written', () => {
  // The rule itself, so the rest of this file is about whether the screen
  // asks it rather than whether it works.
  assert.deepEqual(publishFaults({ ...row({}), improvementRequired: false }), [])
  const faults = publishFaults({ ...row({}), improvementRequired: true })
  assert.equal(faults.length, 1)
  assert.match(faults[0], /Improvement feedback is mandatory/)
})

test('a row needing improvement feedback is blocked, not listed as ready', () => {
  const s = bulkSplit([row({ improvementRequired: true } as Partial<BulkRow>)])
  assert.equal(s.ready.length, 0, 'the preview counts it as ready to publish')
  assert.equal(s.blocked.length, 1)
  assert.match(s.blocked[0].faults[0], /Improvement feedback is mandatory/)
})

test('the bulk preview computes the band rule instead of hardcoding false', () => {
  const ui = read('components/pms/AdminTabs.tsx')
  const at = ui.indexOf('function BulkPublish')
  const body = ui.slice(at, at + 3000)
  assert.ok(!/improvementRequired: false/.test(body),
    'BulkPublish still hardcodes improvementRequired, so its preview applies '
    + 'four of the five gate rules and over-reports readiness')
  assert.match(body,
    /improvementRequired: !!bands\.find\(b => b\.value === r\.finalRating\)\?\.improvementMandatory/,
    'the band rule is not computed the way the single card computes it')
  // The band list has to actually reach the component.
  assert.match(body, /bands\?: \{ value: number; label: string; improvementMandatory\?: boolean \}\[\]/)
  assert.match(ui, /<BulkPublish[\s\S]{0,220}bands=\{bands\}/,
    'PublishTab renders BulkPublish without passing bands')
})

test('the card and bulk now ask the band the same question', () => {
  // The whole reason publishGate.ts exists is that the two paths must not
  // drift. This pins the one input that had drifted.
  const ui = read('components/pms/AdminTabs.tsx')
  const card = /const improvementRequired = !!band\?\.improvementMandatory/.test(ui)
  assert.ok(card, 'the single card no longer derives the rule from the band')
  const at = ui.indexOf('function BulkPublish')
  assert.match(ui.slice(at, at + 3000), /\?\.improvementMandatory/)
})

// ── 2. the publish that refuses on a column nobody typed ─────────────────
//
// 193 narrowed the read-only lock so a finalised result could still be
// delivered, and its header says: '"read-only" on a screen that was only
// trying to publish sends somebody looking in the wrong place for an hour.'
//
// It allowed four columns. Both publish paths write THREE, and the third is
// chain_stage: 'DONE'. So for an employee whose record is read-only —
// pms_finalise sets is_readonly = (flag = 'EXITED') — publishing is refused
// with "Cannot change: chain_stage". Their rating can never be released.

const DIR = 'supabase/migrations'
const M225 = read(`${DIR}/225_pms_readonly_lets_the_result_out_properly.sql`)
const M193 = read(`${DIR}/193_pms_readonly_lets_the_result_out.sql`)

function fnOf(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(i >= 0, `${name} not found`)
  return sql.slice(i, sql.indexOf('END $$;', i) + 'END $$;'.length)
}
const codeOnly = (sql: string) =>
  sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

test('every column the publish writes is one the read-only lock allows', () => {
  // THE CHECK THAT WOULD HAVE CAUGHT IT. Derived from the write rather than
  // listed by hand, so adding a fourth column to the publish without adding
  // it to the allowlist fails here instead of in production.
  const page = read('app/dashboard/pms/page.tsx')
  const upd = page.slice(page.indexOf("workflow_status: 'PUBLISHED'"))
  const written = [...upd.slice(0, 220).matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1])
  assert.ok(written.includes('workflow_status') && written.includes('chain_stage'),
    `could not read the publish write: ${written.join(', ')}`)

  const guard = codeOnly(fnOf(M225, 'pms_block_readonly'))
  const allow = guard.slice(guard.indexOf('v_allowed'), guard.indexOf('v_old jsonb'))
  for (const col of written) {
    assert.ok(allow.includes(`'${col}'`),
      `publishing writes ${col}, which the read-only lock does not allow — an `
      + 'exited employee with a settled rating can never have it released')
  }
})

test('chain_stage may move onward to DONE and nowhere else', () => {
  // Allowing the column outright would let a frozen record be walked back to
  // RM_L1 — reopening an appraisal for somebody who has left, not delivering
  // one. Same discipline 193 already applies to workflow_status.
  const guard = codeOnly(fnOf(M225, 'pms_block_readonly'))
  assert.match(guard, /NEW\.chain_stage IS DISTINCT FROM OLD\.chain_stage/)
  assert.match(guard, /COALESCE\(NEW\.chain_stage, ''\) <> 'DONE'/)
  assert.match(guard, /The chain stage can only move on to DONE/)
  // And the equivalent rule for workflow_status is still there.
  assert.match(guard, /NEW\.workflow_status NOT IN \('PUBLISHED','ACKNOWLEDGED'\)/)
})

test('225 is the newest definition of the read-only guard', () => {
  const latest = readdirSync(DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .filter(f => read(`${DIR}/${f}`).includes('CREATE OR REPLACE FUNCTION pms_block_readonly()'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .pop()
  assert.equal(latest, '225_pms_readonly_lets_the_result_out_properly.sql')
})

test('225 has a verify script, and it isolates the guard', () => {
  // I shipped 225 saying it could not be verified, because the guard only
  // bites on a read-only row and making one means marking somebody exited.
  // That was wrong: every other script in supabase/verify manufactures its
  // own state inside BEGIN … ROLLBACK.
  //
  // The isolation matters. Four triggers watch this table and fire in name
  // order, so trg_pms_publish_needs_hr_final speaks before trg_pms_readonly —
  // a full publish on an unsettled row is refused by the HR Head rule and
  // never reaches the rule under test. Both publish triggers return early
  // unless workflow_status TRANSITIONS, so the script updates chain_stage
  // alone and nothing else runs.
  const v = read('supabase/verify/225_pms_readonly_publish_verify.sql')
  assert.match(v, /^BEGIN;/m, 'the verify script is not transactional')
  assert.match(v, /^ROLLBACK;/m, 'the verify script does not roll back')
  assert.match(v, /SET chain_stage = 'DONE'/, 'it never exercises the guard')
  assert.match(v, /SET chain_stage = 'RM_L1'/,
    'nothing checks that the column is allowed ONWARD only — a guard that '
    + 'allowed chain_stage unconditionally would pass the first check')
  assert.match(v, /SET final_rating = 1/,
    'nothing checks the lock still locks everything else')
  // And it must NOT transition workflow_status, or the publish triggers fire
  // first and the reading is about them instead.
  const fn = v.slice(v.indexOf('verify_readonly_publish'), v.indexOf('$fn$;'))
  assert.ok(!/SET workflow_status = 'PUBLISHED'/.test(fn),
    'the script transitions workflow_status, so an earlier trigger answers '
    + 'and the read-only guard is never reached')
})

test('225 reproduces 193 exactly, apart from chain_stage', () => {
  const strip = (t: string) => t.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('--')).map(l => l.trim())
  const old = strip(fnOf(M193, 'pms_block_readonly'))
  const now = strip(fnOf(M225, 'pms_block_readonly'))
  const removed = old.filter(l => !now.includes(l))
  assert.ok(removed.every(l => /employee_ack','employee_ack_at','updated_at'\];/.test(l)),
    '225 dropped something other than the allowlist line it extends:\n  ' + removed.join('\n  '))
  const added = now.filter(l => !old.includes(l))
  assert.ok(added.length <= 8,
    `225 added ${added.length} lines, more than the column needs:\n  ` + added.join('\n  '))
  // The lock still actually locks.
  assert.match(codeOnly(fnOf(M225, 'pms_block_readonly')),
    /IF NOT OLD\.is_readonly THEN\s*\n\s*RETURN NEW;/)
  assert.match(codeOnly(fnOf(M225, 'pms_block_readonly')), /RAISE EXCEPTION/)
})
