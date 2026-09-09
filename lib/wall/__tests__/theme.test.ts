// lib/wall/__tests__/theme.test.ts — the wall's colour tokens.
//
// The failure this guards against is specific and has bitten this codebase: a
// token defined for one theme and not the other. The page then renders one
// theme's text on the other theme's ground, which reads as "the CSS is broken"
// rather than as a missing constant. Key parity between LIGHT and DARK is the
// cheapest way to catch it, and it cannot be caught by looking at either one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT, DARK, GRADE, SHADOW, RADIUS, TYPE } from '../theme.ts';

const HEX = /^#[0-9a-fA-F]{3,8}$/;

describe('LIGHT and DARK', () => {
  test('define exactly the same tokens', () => {
    const l = Object.keys(LIGHT).sort();
    const d = Object.keys(DARK).sort();
    const missingInDark = l.filter(k => !d.includes(k));
    const missingInLight = d.filter(k => !l.includes(k));
    assert.deepEqual(missingInDark, [], `defined for light only: ${missingInDark.join(', ')}`);
    assert.deepEqual(missingInLight, [], `defined for dark only: ${missingInLight.join(', ')}`);
  });

  test('neither theme is empty', () => {
    assert.ok(Object.keys(LIGHT).length >= 5, 'LIGHT looks empty');
    assert.ok(Object.keys(DARK).length >= 5, 'DARK looks empty');
  });

  test('every value is a usable CSS colour', () => {
    for (const [theme, set] of [['LIGHT', LIGHT], ['DARK', DARK]] as const) {
      for (const [k, v] of Object.entries(set)) {
        const s = String(v);
        const ok = HEX.test(s) || s.startsWith('rgb') || s.startsWith('hsl')
                || s.startsWith('var(') || s.startsWith('color-mix')
                || s.startsWith('linear-gradient');
        assert.ok(ok, `${theme}.${k} is not a colour: ${s}`);
      }
    }
  });

  test('the two themes actually differ', () => {
    // Identical palettes would mean dark mode was never implemented, which is
    // easy to ship and hard to notice in a light-mode screenshot.
    const same = Object.keys(LIGHT).filter(
      k => String((LIGHT as Record<string, unknown>)[k]) === String((DARK as Record<string, unknown>)[k]));
    assert.ok(same.length < Object.keys(LIGHT).length,
      'LIGHT and DARK are identical — dark mode would render as light');
  });
});

describe('scales', () => {
  test('GRADE tokens each carry a colour', () => {
    assert.ok(Object.keys(GRADE).length > 0);
    for (const [k, v] of Object.entries(GRADE)) {
      assert.ok(v !== undefined && v !== null && String(v).length > 0, `GRADE.${k} is empty`);
    }
  });

  test('RADIUS is ordered and pill is the largest', () => {
    assert.ok(RADIUS.md < RADIUS.lg, 'md should be tighter than lg');
    assert.ok(RADIUS.lg < RADIUS.xl, 'lg should be tighter than xl');
    assert.ok(RADIUS.pill > RADIUS.xl, 'pill should be the fully-rounded one');
  });

  test('SHADOW and TYPE are populated', () => {
    assert.ok(Object.keys(SHADOW).length > 0, 'SHADOW is empty');
    assert.ok(Object.keys(TYPE).length > 0, 'TYPE is empty');
  });
});
