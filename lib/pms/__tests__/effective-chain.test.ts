// Which chain a policy actually runs, and that every screen asks the same way.
//
// ── WHY THIS IS ONE FUNCTION ─────────────────────────────────────────────
//
// Before 218 a screen could read policy.approval_chain and be right. Now
// there are two columns and only one of them decides, so every reader that
// keeps reading approval_chain directly is a screen that silently shows the
// PRESET's chain to a company running a composed one. That is not a blank or
// an error — it is a different, plausible, wrong answer: the wrong rung asked
// to settle the rating, the wrong destination named on a rejection, the wrong
// track drawn on the card.
//
// So the fallback is decided in exactly one place and the wiring tests assert
// nothing else reads approval_chain for this purpose.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveChain, rungs, chainLabel, type Stage } from '../chain.ts'
import { CHAIN_LABEL } from '../hierarchy.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ── the fallback ─────────────────────────────────────────────────────────

test('no chain selected means the preset still decides', () => {
  // chain_id is nullable and this is what makes applying 218 a no-op: every
  // policy nobody has touched is appraised exactly as it was.
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1_HOD' }), 'SELF_RM1_HOD')
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1', chain_id: null }), 'SELF_RM1')
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: null }), 'SELF_RM1')
})

test('no policy at all falls back to the default chain', () => {
  // The policy read is non-fatal in Performance.tsx — a company with no
  // policy row still has to render a sensible track rather than crash.
  assert.equal(effectiveChain(null), 'SELF_RM1_RM2_HOD')
  assert.equal(effectiveChain(undefined), 'SELF_RM1_RM2_HOD')
  assert.equal(effectiveChain({}), 'SELF_RM1_RM2_HOD')
})

// ── the composed chain wins ──────────────────────────────────────────────

test('a selected chain beats the preset', () => {
  assert.deepEqual(
    effectiveChain({ approval_chain: 'SELF_RM1_RM2_HOD', chain_id: 'c1',
                     pms_chain: { rungs: ['EMPLOYEE', 'RM_L1', 'SITE_HR', 'HR'] } }),
    ['EMPLOYEE', 'RM_L1', 'SITE_HR', 'HR'])
})

test('the embed is read whether PostgREST sends an object or an array', () => {
  // A to-one embed arrives as an object or as a one-element array depending
  // on how the relationship is inferred, and the shape is not something this
  // code gets to choose. Reading only one of the two is how a composed chain
  // silently becomes the preset — on a screen, with no error anywhere.
  const rungsIn = ['EMPLOYEE', 'HOD', 'HR']
  const asObject = effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: { rungs: rungsIn } })
  const asArray = effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: [{ rungs: rungsIn }] })
  assert.deepEqual(asObject, ['EMPLOYEE', 'HOD', 'HR'])
  assert.deepEqual(asArray, asObject, 'the array form falls back to the preset')
})

test('an empty embed array is not a chain', () => {
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1_HOD', pms_chain: [] }),
    'SELF_RM1_HOD')
})

// ── a retired chain still decides ────────────────────────────────────────

test('is_active is not consulted, deliberately', () => {
  // A chain a policy points at runs whether or not it is retired. Honouring
  // is_active here would mean retiring a chain silently re-appraises everybody
  // on the preset — the exact surprise the admin route prevents by refusing to
  // retire a chain in use. The builder shows "(retired)" instead.
  const retired = { approval_chain: 'SELF_RM1_RM2_HOD', chain_id: 'c1',
                    pms_chain: { rungs: ['EMPLOYEE', 'HOD', 'HR'], is_active: false } }
  assert.deepEqual(effectiveChain(retired as never), ['EMPLOYEE', 'HOD', 'HR'])
})

// ── a malformed chain falls back rather than breaking the cycle ──────────

test('an empty rungs array falls back to the preset', () => {
  // 218's CHECK makes this unreachable through the product and reachable by
  // hand. "The chain is the preset" beats "HR approves and nobody else".
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1_HOD', pms_chain: { rungs: [] } }),
    'SELF_RM1_HOD')
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1_HOD', pms_chain: { rungs: null } }),
    'SELF_RM1_HOD')
  // Not an array at all — a JSONB column read back as a string by some SDKs.
  assert.equal(effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: { rungs: '{HOD,HR}' } }),
    'SELF_RM1')
})

test('a rung nothing recognises is dropped, not passed through', () => {
  // A stage the engine cannot resolve would reach heldBy, answer false, and
  // be skipped — so it is harmless but invisible. Dropping it here keeps the
  // track drawn from stages that actually exist.
  assert.deepEqual(
    effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: { rungs: ['EMPLOYEE', 'FINANCE', 'HOD', 'HR'] } }),
    ['EMPLOYEE', 'HOD', 'HR'])
})

test('a chain of nothing but unknown rungs falls back', () => {
  assert.equal(
    effectiveChain({ approval_chain: 'SELF_RM1_HOD', pms_chain: { rungs: ['FINANCE', 'LEGAL'] } }),
    'SELF_RM1_HOD')
})

test('case and whitespace from a hand-written row are tolerated', () => {
  assert.deepEqual(
    effectiveChain({ approval_chain: 'SELF_RM1', pms_chain: { rungs: [' employee ', 'hod', 'hr'] } }),
    ['EMPLOYEE', 'HOD', 'HR'])
})

// ── what it feeds ────────────────────────────────────────────────────────

test('what comes out walks correctly through the engine', () => {
  // The round trip that matters: effectiveChain's output is handed straight
  // to rungs(), nextRung() and the track.
  const chain = effectiveChain({
    approval_chain: 'SELF_RM1_RM2_HOD', chain_id: 'c1',
    pms_chain: { rungs: ['EMPLOYEE', 'RM_L1', 'SITE_HR', 'HOD', 'HR'] },
  })
  assert.deepEqual(rungs(chain), ['RM_L1', 'SITE_HR', 'HOD', 'HR'])
  // And a preset still walks the way it always did.
  assert.deepEqual(rungs(effectiveChain({ approval_chain: 'SELF_RM1_HOD' })),
    ['RM_L1', 'HOD', 'HR'])
})

// ── the chain can be named either way ────────────────────────────────────

test('a preset is named from the label table', () => {
  assert.equal(chainLabel('SELF_RM1_HOD', CHAIN_LABEL), CHAIN_LABEL.SELF_RM1_HOD)
  assert.equal(chainLabel(null, CHAIN_LABEL), CHAIN_LABEL.SELF_RM1_RM2_HOD)
  assert.equal(chainLabel(undefined, CHAIN_LABEL), CHAIN_LABEL.SELF_RM1_RM2_HOD)
})

test('a composed chain is named by its rungs, not left blank', () => {
  // CHAIN_LABEL has no entry for a composed chain, so CHAIN_LABEL[chain] is
  // undefined — which renders as nothing on the finalise banner whose entire
  // job is to say what the chain is before somebody finalises against it.
  const named = chainLabel(['EMPLOYEE', 'RM_L1', 'SITE_HR', 'HOD'] as Stage[], CHAIN_LABEL)
  assert.equal(named, 'Employee → RM L1 → Site HR → HOD → HR')
  assert.ok(named.length > 0)
})

test('naming a chain goes through the same engine that walks it', () => {
  // Otherwise the banner can say one thing and the queue do another: HR
  // appended, duplicates dropped, EMPLOYEE first.
  assert.equal(chainLabel(['RM_L1', 'RM_L1', 'HOD'] as Stage[], CHAIN_LABEL),
    'Employee → RM L1 → HOD → HR')
})

test('an unknown preset is named rather than rendered as nothing', () => {
  // SELF_RM1_RM2_HOD_MD exists in the schema and in no label table. Showing
  // the code beats showing an empty bold tag.
  assert.equal(chainLabel('SELF_RM1_RM2_HOD_MD' as never, CHAIN_LABEL),
    'SELF_RM1_RM2_HOD_MD')
})

// ── nothing else decides the fallback ────────────────────────────────────

test('the policy read asks for the chain it points at', () => {
  // effectiveChain can only answer from what was selected. A policy read that
  // omits the embed makes every call return the preset, correctly and
  // uselessly — the failure would look like "custom chains do nothing".
  const PERF = read('components/ess/Performance.tsx')
  assert.match(PERF, /'one_to_one_mandatory,chain_id,pms_chain\(rungs\)'/,
    'the policy is read without the chain it points at')
})

test('the Config panel shows the chain in force, not the fallback', () => {
  // This is the panel an administrator opens to CONFIRM the configuration.
  // Reading approvalChain unconditionally would have it state the preset
  // while the cycle travels somewhere else — a screen whose only job is to
  // report the truth, confidently reporting the wrong thing.
  const TABS = read('components/pms/AdminTabs.tsx')
  assert.match(TABS, /policy\?\.chainRungs\?\.length\s*\n?\s*\?/,
    'the Config panel does not check for a composed chain first')
  assert.match(TABS, /chainLabel\(policy\.chainRungs as Stage\[\], CHAIN_LABEL\)/,
    'a composed chain is not named from its rungs')
  assert.match(TABS, /chainName \?\? 'A built chain'/,
    'a chain with no name renders as nothing in the panel')
  // The preset path has to survive, since it is what an untouched policy uses.
  assert.match(TABS, /\(not supported yet\)/,
    'the unmodelled-preset fallback was dropped')
})

test('the dashboard reads the chain, in both embed shapes', () => {
  const PAGE = read('app/dashboard/pms/page.tsx')
  assert.match(PAGE, /chain_id, pms_chain\(name, rungs\)/,
    'the policy query does not fetch the chain it points at')
  assert.match(PAGE, /const row = Array\.isArray\(e\) \? e\[0\] : e/,
    'only one of the two embed shapes is read')
  for (const f of ['chainId:', 'chainName:', 'chainRungs:']) {
    assert.ok(PAGE.includes(f), `the mapped policy drops ${f}`)
  }
})

test('no PMS screen reads approval_chain for the chain any more', () => {
  // The whole point of one decision point. Any direct read is a screen that
  // shows the preset to a company on a composed chain.
  for (const f of ['components/ess/Performance.tsx', 'components/pms/ManagerTabs.tsx']) {
    const src = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/([^:])\/\/.*$/gm, '$1')
    // The interface declaration and the select string are the two legitimate
    // mentions; neither is a read that decides anything.
    const reads = [...src.matchAll(/(?:policy|p)\??\.approval_chain/g)]
    assert.deepEqual(reads.map(r => r[0]), [],
      `${f} reads approval_chain directly: ${reads.map(r => r[0])}`)
  }
})
