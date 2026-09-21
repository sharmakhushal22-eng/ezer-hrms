// The theme was wrong on screen often enough to be reported as a bug: "many
// times screen will be in dark mode even when light mode is selected and
// vice-versa". None of the logic behind it was testable — it lived in a
// template-literal boot script, a React component and an ESS preference hook.
//
// It is pure now, so every combination is checked here rather than clicked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readChoice, resolveTheme, resolveStored, attrFor,
  fromTodayTheme, toTodayTheme, DEFAULT_CHOICE, STORAGE_KEY,
  onThemeChange, notifyThemeChange, _listenerCount,
} from '../theme-resolve.ts'

const DARK_OS = true, LIGHT_OS = false

// ── The default ────────────────────────────────────────────────────────────
test('the product default is light, for admin and ESS alike', () => {
  assert.equal(DEFAULT_CHOICE, 'light')
})

test('a browser that has never chosen gets LIGHT, even on a dark OS', () => {
  // The headline requirement. Before the fix an absent key meant "follow the
  // OS", so a laptop that switched to dark at sunset made the HRMS dark.
  assert.equal(resolveStored(null, DARK_OS), 'light')
  assert.equal(resolveStored(undefined, DARK_OS), 'light')
  assert.equal(resolveStored('', DARK_OS), 'light')
})

// ── Defect 2: absence used to mean two different things ────────────────────
test('an ABSENT key and an explicit "system" are no longer the same thing', () => {
  // This is the distinction the old code could not express: 'system' was
  // stored by REMOVING the key, so these two cases were byte-identical.
  assert.equal(readChoice(null), 'light')       // never chose
  assert.equal(readChoice('system'), 'system')  // chose to follow the OS
  assert.notEqual(readChoice(null), readChoice('system'))
})

test('an explicit "system" choice still follows the OS, in both directions', () => {
  // Defaulting to light must not break the people who genuinely want system.
  assert.equal(resolveStored('system', DARK_OS), 'dark')
  assert.equal(resolveStored('system', LIGHT_OS), 'light')
})

// ── The reported bug, in both directions ───────────────────────────────────
test('LIGHT chosen on a dark-OS machine renders light', () => {
  // "screen will be in dark mode even when light mode is selected"
  assert.equal(resolveTheme('light', DARK_OS), 'light')
  assert.equal(resolveStored('light', DARK_OS), 'light')
})

test('DARK chosen on a light-OS machine renders dark', () => {
  // "...and vice-versa"
  assert.equal(resolveTheme('dark', LIGHT_OS), 'dark')
  assert.equal(resolveStored('dark', LIGHT_OS), 'dark')
})

test('an explicit choice beats the OS for every combination', () => {
  for (const os of [DARK_OS, LIGHT_OS]) {
    assert.equal(resolveTheme('light', os), 'light')
    assert.equal(resolveTheme('dark', os), 'dark')
  }
})

// ── Defect 3: what gets written to <html> ──────────────────────────────────
test('the attribute written is always a RESOLVED theme, never "auto"', () => {
  // components/ess/inbox/inbox.css has ~8 rules keyed on
  // [data-ez-theme="auto"].is-dark which nothing has ever written. They are
  // dead and must stay dead: writing 'auto' would silently switch them on.
  const written = new Set<string>()
  for (const c of ['light', 'dark', 'system'] as const)
    for (const os of [DARK_OS, LIGHT_OS]) written.add(attrFor(c, os))
  assert.deepEqual([...written].sort(), ['dark', 'light'])
  assert.ok(!written.has('auto' as never))
})

test('the attribute is never empty, so negative CSS guards cannot fire by accident', () => {
  // Every dark rule in the product is :root:not([data-ez-theme="light"]).
  // An absent attribute is therefore NOT neutral — it means "dark if the OS
  // says so". Something explicit must always be written.
  for (const raw of [null, undefined, '', 'nonsense', 'light', 'dark', 'system'])
    for (const os of [DARK_OS, LIGHT_OS]) {
      const v = attrFor(readChoice(raw), os)
      assert.ok(v === 'light' || v === 'dark', `got ${JSON.stringify(v)} for ${JSON.stringify(raw)}`)
    }
})

// ── Corrupt input must never lock somebody out ─────────────────────────────
test('an unrecognised stored value falls back to the default rather than throwing', () => {
  for (const junk of ['AUTO', 'Light', 'true', '0', '{}', ' dark ', 'undefined'])
    assert.equal(readChoice(junk), 'light', `for ${JSON.stringify(junk)}`)
})

// ── The two controls must mean the same thing ──────────────────────────────
test('Today’s vocabulary and the toggle’s map onto each other losslessly', () => {
  // Today says auto/light/dark; the toggle says system/light/dark. They are the
  // same three states and must round-trip, or the two controls disagree and one
  // clobbers the other — which is what the bug report was describing.
  for (const c of ['light', 'dark', 'system'] as const)
    assert.equal(fromTodayTheme(toTodayTheme(c)), c)
  for (const t of ['auto', 'light', 'dark'] as const)
    assert.equal(toTodayTheme(fromTodayTheme(t)), t)
})

test('Today’s "auto" is the toggle’s "system", not a fourth state', () => {
  assert.equal(fromTodayTheme('auto'), 'system')
  assert.equal(toTodayTheme('system'), 'auto')
})

// ── Defect 1: the wipe ─────────────────────────────────────────────────────
test('resolving a stored choice never depends on anything being cleared', () => {
  // The wipe worked like this: usePrefs mounted with theme:'auto', applied it
  // before the saved preference arrived, and 'auto' routed to a code path that
  // called localStorage.removeItem(). The user's explicit choice was destroyed
  // on every ESS load.
  //
  // Reading is pure and non-destructive here, so a mount-time read can no
  // longer damage what is stored. The call sites are what enforce it; this
  // pins the contract they rely on.
  const stored = 'dark'
  assert.equal(resolveStored(stored, LIGHT_OS), 'dark')
  assert.equal(resolveStored(stored, LIGHT_OS), 'dark')   // repeat: still there
  assert.equal(readChoice(stored), 'dark')
})

// ── Keeping the two controls in step ───────────────────────────────────────
// The nav toggle and Today's button render the same setting in two places.
// Before this, neither could see the other change it.
test('a subscriber is told the CHOICE, not the resolved theme', () => {
  // 'system' must arrive as 'system'. If this carried the resolved value, the
  // toggle could not tell "System on a dark OS" from "Dark" and would light up
  // the wrong one of its three buttons.
  const seen: string[] = []
  const off = onThemeChange(c => seen.push(c))
  notifyThemeChange('system')
  notifyThemeChange('dark')
  off()
  assert.deepEqual(seen, ['system', 'dark'])
})

test('unsubscribing actually stops delivery, and leaks nothing', () => {
  const before = _listenerCount()
  const seen: string[] = []
  const off = onThemeChange(c => seen.push(c))
  assert.equal(_listenerCount(), before + 1)
  off()
  assert.equal(_listenerCount(), before)
  notifyThemeChange('dark')
  assert.deepEqual(seen, [], 'a listener kept receiving after unsubscribe')
})

test('every subscriber is told, not just the first', () => {
  // Both controls are usually mounted at once in ESS.
  const a: string[] = [], b: string[] = []
  const offA = onThemeChange(c => a.push(c))
  const offB = onThemeChange(c => b.push(c))
  notifyThemeChange('light')
  offA(); offB()
  assert.deepEqual(a, ['light'])
  assert.deepEqual(b, ['light'])
})

test('a listener that unsubscribes mid-notification does not strand the rest', () => {
  // A React effect cleaning up while being notified would mutate the set being
  // iterated. The notifier walks a copy for exactly this reason.
  const seen: string[] = []
  let offSelf: () => void = () => {}
  offSelf = onThemeChange(() => offSelf())
  const off2 = onThemeChange(c => seen.push(c))
  notifyThemeChange('dark')
  off2()
  assert.deepEqual(seen, ['dark'], 'a later subscriber was skipped')
})

test('one throwing listener does not stop the others updating', () => {
  // Otherwise a single broken subscriber leaves a control stuck showing the
  // wrong mode, which is the bug this whole change is about.
  const seen: string[] = []
  const offBad = onThemeChange(() => { throw new Error('boom') })
  const offGood = onThemeChange(c => seen.push(c))
  assert.doesNotThrow(() => notifyThemeChange('light'))
  offBad(); offGood()
  assert.deepEqual(seen, ['light'])
})

test('notifying with no subscribers is harmless', () => {
  assert.doesNotThrow(() => notifyThemeChange('dark'))
})

test('the storage key is one shared constant, not three copies', () => {
  // The boot script, the toggle and the ESS preference each referenced this
  // key. Three string literals in three files is how they drifted apart.
  assert.equal(STORAGE_KEY, 'ezer_theme')
})
