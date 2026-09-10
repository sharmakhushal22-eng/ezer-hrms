// lib/pms/__tests__/next-action-routing.test.ts
//
// The cycle header shows one call to action — "Add your first KRA", "Open the
// approval queue" — and clicking it must land on the tab it names.
//
// It didn't. nextAction() names destinations in its own vocabulary ('mine',
// 'oneone', 'dept', 'fill') and the tab strips use theirs ('kras', 'oneToOne',
// 'finalise', 'deptAnalytics'). Nothing matched. Worse, the handler was
// `onGo={() => setScope('me')}` — it discarded the destination entirely and
// set the scope to the one already selected, so EVERY call to action was inert
// and the most visible casualty was the first thing a new employee is asked to
// do. Action.tab was typed `string`, so the compiler saw nothing wrong.
//
// Two vocabularies that must agree, in two files, is exactly the kind of pair
// that drifts. These tests hold them together.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cycle = readFileSync('lib/pms/cycle.ts', 'utf8');
const perfRaw = readFileSync('components/ess/Performance.tsx', 'utf8');

/** Comments stripped. The first version of this test matched the comment that
 *  QUOTES the old broken handler and reported the bug as still present — a
 *  scanner that reads prose about code instead of the code. */
const perf = perfRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
const empTabs = readFileSync('components/pms/EmployeeTabs.tsx', 'utf8');
const mgrTabs = readFileSync('components/pms/ManagerTabs.tsx', 'utf8');

/** Every destination nextAction() can return. */
function emitted(): string[] {
  return [...new Set([...cycle.matchAll(/tab: '([a-z]+)'/g)].map(m => m[1]))].sort();
}

/** The destinations Performance.tsx knows how to reach. */
function mapped(): string[] {
  const block = perf.slice(perf.indexOf('const GO_TO'), perf.indexOf('const goToAction'));
  return [...new Set([...block.matchAll(/^\s{4}([a-z]+):\s*\{/gm)].map(m => m[1]))].sort();
}

/** Tab keys that actually exist in a strip. */
function tabKeys(src: string, name: string): string[] {
  const i = src.indexOf(name);
  const seg = src.slice(i, i + 900);
  return [...seg.matchAll(/k:\s*'([A-Za-z]+)'/g)].map(m => m[1]);
}

describe('next-action routing', () => {
  test('the scanners find something (guard against passing on empty input)', () => {
    assert.ok(emitted().length >= 5, `nextAction destinations not found: ${emitted()}`);
    assert.ok(mapped().length >= 5, `GO_TO entries not found: ${mapped()}`);
    assert.ok(tabKeys(empTabs, 'EMP_TABS').length >= 4, 'EMP_TABS not found');
  });

  test('every destination nextAction emits is mapped to a tab', () => {
    const missing = emitted().filter(d => !mapped().includes(d));
    assert.deepEqual(missing, [],
      `nextAction can send people to ${missing.join(', ')}, which Performance.tsx cannot reach`);
  });

  test('no dead entries in the map', () => {
    const dead = mapped().filter(d => !emitted().includes(d));
    assert.deepEqual(dead, [], `mapped but never emitted: ${dead.join(', ')}`);
  });

  test('every mapped tab exists in the strip it belongs to', () => {
    const emp = tabKeys(empTabs, 'EMP_TABS');
    const mgr = tabKeys(mgrTabs, 'MGR_TABS');
    const hod = tabKeys(mgrTabs, 'HOD_TABS');
    const block = perf.slice(perf.indexOf('const GO_TO'), perf.indexOf('const goToAction'));
    const rows = [...block.matchAll(/([a-z]+):\s*\{\s*scope:\s*'(me|team|dept)',\s*tab:\s*'([A-Za-z]+)'/g)];
    assert.ok(rows.length >= 5, 'could not parse the destination map');
    for (const [, dest, scope, tab] of rows) {
      const strip = scope === 'me' ? emp : scope === 'team' ? mgr : hod;
      assert.ok(strip.includes(tab),
        `'${dest}' points at ${scope}/${tab}, which is not a tab there (${strip.join(', ')})`);
    }
  });

  test('the CTA handler actually uses its argument', () => {
    // The whole bug in one line: a handler that ignores where it was told to go.
    assert.ok(!/onGo=\{\(\)\s*=>/.test(perf),
      'onGo takes no argument — the destination is being discarded again');
    assert.ok(/onGo=\{goToAction\}/.test(perf), 'onGo should be wired to the destination map');
  });

  test('Action.tab is a union, so drift fails the build', () => {
    assert.ok(/tab: ActionTab/.test(cycle), 'Action.tab is back to `string`; drift will go unnoticed');
    assert.ok(/export type ActionTab/.test(cycle), 'ActionTab is not exported');
  });
});
