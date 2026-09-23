import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverScale, rotatedCover, clampPan, frameInside, anchoredPan,
  exportTransform, workScale, WORK_MAX, rad,
} from '../crop-math.ts';

const BOX = 260;   // .ez-stage, measured at runtime; a plausible value here
const OUT = 768;   // exported square
const near = (p: number, q: number, tol = 1e-9) => Math.abs(p - q) < tol;

test('a cover fit makes the photo exactly fill the frame, not a sliver of it', () => {
  // The 4000px phone photo from the bug report.
  const s = coverScale(4000, 3000, BOX);
  assert.equal(s, BOX / 3000);                 // short edge governs a cover fit
  assert.ok(near(3000 * s, BOX));              // short edge lands on the box
  assert.ok(4000 * s > BOX);                   // long edge overflows, as cover implies
});

test('the old behaviour is what this is being fixed from', () => {
  // Natural-size scaling: 4000px wide at 125% inside a 184px window.
  assert.ok(184 / 1.25 < 150);
  // Under a cover fit the same stage shows the entire short edge instead.
  assert.equal(BOX / coverScale(4000, 3000, BOX), 3000);
});

test('rotation grows the fit by exactly the frame’s reach', () => {
  const flat = coverScale(3000, 2000, BOX);
  assert.ok(near(rotatedCover(3000, 2000, BOX, 0), flat));
  assert.ok(near(rotatedCover(3000, 2000, BOX, rad(90)), flat));      // square frame
  assert.ok(near(rotatedCover(3000, 2000, BOX, rad(45)), flat * Math.SQRT2));
  // A small straighten costs a little zoom, not a lot.
  assert.ok(rotatedCover(3000, 2000, BOX, rad(5)) > flat);
  assert.ok(rotatedCover(3000, 2000, BOX, rad(5)) < flat * 1.1);
});

test('at the fit scale the frame is covered, at every angle', () => {
  for (const deg of [0, 5, 17, 45, 90, 137, 180, 221, 270, 359]) {
    const r = rad(deg);
    for (const [w, h] of [[4000, 3000], [3000, 4000], [1200, 1200], [640, 480]]) {
      const eff = rotatedCover(w, h, BOX, r);
      assert.ok(frameInside({ x: 0, y: 0 }, w, h, eff, r, BOX),
        `${w}x${h} at ${deg}deg leaked a corner`);
    }
  }
});

test('clampPan keeps every corner covered however hard you drag', () => {
  for (const deg of [0, 12, 45, 90, 200]) {
    const r = rad(deg);
    const eff = rotatedCover(3000, 2000, BOX, r) * 1.4;
    for (const p of [{ x: 9999, y: 0 }, { x: -9999, y: 9999 }, { x: 0, y: -4321 }, { x: 250, y: -80 }]) {
      const c = clampPan(p, 3000, 2000, eff, r, BOX);
      assert.ok(frameInside(c, 3000, 2000, eff, r, BOX),
        `${deg}deg pan ${JSON.stringify(p)} -> ${JSON.stringify(c)} leaked`);
    }
  }
});

test('clampPan leaves a legal pan alone', () => {
  const r = rad(0), eff = coverScale(3000, 2000, BOX) * 2;
  const p = { x: 3, y: -4 };
  const c = clampPan(p, 3000, 2000, eff, r, BOX);
  assert.ok(near(c.x, p.x) && near(c.y, p.y));
});

test('at exactly the fit scale there is no slack to pan into', () => {
  const r = rad(0), eff = coverScale(3000, 3000, BOX);
  const c = clampPan({ x: 500, y: -500 }, 3000, 3000, eff, r, BOX);
  assert.ok(near(c.x, 0) && near(c.y, 0));
});

test('frameInside actually rejects a gap rather than nodding along', () => {
  // Half the scale needed: the frame pokes out on every side.
  const eff = coverScale(1000, 1000, BOX) * 0.5;
  assert.equal(frameInside({ x: 0, y: 0 }, 1000, 1000, eff, 0, BOX), false);
});

test('a pinch keeps the picture under your fingers', () => {
  const r = rad(23), eff0 = 0.4, eff1 = 0.9;
  const pan0 = { x: 12, y: -7 }, anchor = { x: 40, y: 25 };
  const pan1 = anchoredPan(pan0, anchor, eff0, eff1);
  // The image point under `anchor` must be the same before and after.
  const before = { x: (anchor.x - pan0.x) / eff0, y: (anchor.y - pan0.y) / eff0 };
  const after = { x: (anchor.x - pan1.x) / eff1, y: (anchor.y - pan1.y) / eff1 };
  assert.ok(near(before.x, after.x, 1e-9) && near(before.y, after.y, 1e-9));
  void r;
});

test('zooming about the centre is the special case, not the rule', () => {
  const pan = anchoredPan({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 3);
  assert.ok(near(pan.x, 0) && near(pan.y, 0));
});

test('the export transform carries the screen transform across unchanged', () => {
  const x = exportTransform({ x: 0, y: 0 }, 0.5, BOX, OUT);
  assert.equal(x.k, OUT / BOX);
  assert.equal(x.tx, OUT / 2);          // centred pan stays centred
  assert.equal(x.ty, OUT / 2);
  assert.equal(x.scale, 0.5 * (OUT / BOX));
  // A drag of 10 stage px moves the output by 10 * k.
  const y = exportTransform({ x: 10, y: -4 }, 0.5, BOX, OUT);
  assert.ok(near(y.tx - x.tx, 10 * x.k));
  assert.ok(near(y.ty - x.ty, -4 * x.k));
});

test('the working copy is capped, and small images are left alone', () => {
  assert.equal(workScale(8000, 6000), WORK_MAX / 8000);
  assert.equal(workScale(6000, 8000), WORK_MAX / 8000);
  assert.equal(workScale(1024, 768), 1);          // already small: untouched
  assert.equal(workScale(WORK_MAX, 100), 1);      // exactly at the cap
});

test('degenerate sizes degrade rather than producing NaN geometry', () => {
  assert.equal(coverScale(0, 0, BOX), 1);
  assert.equal(coverScale(100, 100, 0), 1);
  assert.equal(frameInside({ x: 0, y: 0 }, 100, 100, 0, 0, BOX), false);
  const c = clampPan({ x: 5, y: 5 }, 0, 0, 1, 0, BOX);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
  assert.deepEqual(anchoredPan({ x: 1, y: 2 }, { x: 0, y: 0 }, 0, 5), { x: 1, y: 2 });
});
