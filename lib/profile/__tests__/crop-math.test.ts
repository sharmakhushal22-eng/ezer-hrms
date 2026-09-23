import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverScale, cropDest, coversOutput, workScale, WORK_MAX } from '../crop-math.ts';

const BOX = 184;   // .ez-stage is 184px square
const OUT = 768;   // exported square

/** The stage centre, unzoomed, as the component measures it. */
const C = BOX / 2;

test('a cover fit makes the photo exactly fill the frame, not a sliver of it', () => {
  // The 4000px phone photo from the bug report.
  const s = coverScale(4000, 3000, BOX);
  assert.equal(s, BOX / 3000);                 // short edge governs a cover fit
  assert.ok(3000 * s === BOX);                 // short edge lands exactly on the box
  assert.ok(4000 * s > BOX);                   // long edge overflows, as cover implies
});

test('at 100% the crop covers the whole output — no white wedge', () => {
  for (const [w, h] of [[4000, 3000], [3000, 4000], [1200, 1200], [640, 480]]) {
    const eff = coverScale(w, h, BOX);
    const d = cropDest(w, h, eff, { x: 0, y: 0 }, C, C, BOX, OUT);
    assert.ok(coversOutput(d, OUT), `${w}x${h} left a gap: ${JSON.stringify(d)}`);
  }
});

test('the old behaviour is what it is being fixed from', () => {
  // Natural-size scaling: 4000px wide at 125% inside a 184px window.
  const old = 1.25;
  const visibleSourcePx = BOX / old;
  assert.ok(visibleSourcePx < 150);
  // Under a cover fit the same stage shows the entire short edge instead.
  const fixed = coverScale(4000, 3000, BOX);
  assert.equal(BOX / fixed, 3000);
});

test('zooming in scales about the centre and still covers', () => {
  const w = 3000, h = 2000;
  for (const pct of [100, 150, 220, 400]) {
    const eff = coverScale(w, h, BOX) * (pct / 100);
    const d = cropDest(w, h, eff, { x: 0, y: 0 }, C, C, BOX, OUT);
    assert.ok(coversOutput(d, OUT), `${pct}% left a gap`);
  }
});

test('dragging moves the image, and the output follows by the same amount', () => {
  const w = 3000, h = 2000;
  const eff = coverScale(w, h, BOX);
  const a = cropDest(w, h, eff, { x: 0, y: 0 }, C, C, BOX, OUT);
  const b = cropDest(w, h, eff, { x: 10, y: -4 }, C, C, BOX, OUT);
  const k = OUT / BOX;
  // Tolerance, not equality. dx is a difference of two large floats, so the
  // last bit drifts — 41.73913043478262 against 41.73913043478261. That is
  // IEEE-754 being itself, not the crop moving by the wrong amount, and
  // asserting exact equality here tests the FPU rather than the geometry.
  const near = (p: number, q: number) => Math.abs(p - q) < 1e-9;
  assert.ok(near(b.dx - a.dx, 10 * k), `${b.dx - a.dx} vs ${10 * k}`);
  assert.ok(near(b.dy - a.dy, -4 * k), `${b.dy - a.dy} vs ${-4 * k}`);
  assert.equal(a.dw, b.dw);   // a drag must not resize anything
});

test('a square image at 100% lands exactly on the output, no scaling slop', () => {
  const eff = coverScale(900, 900, BOX);
  const d = cropDest(900, 900, eff, { x: 0, y: 0 }, C, C, BOX, OUT);
  assert.equal(Math.round(d.dx), 0);
  assert.equal(Math.round(d.dy), 0);
  assert.equal(Math.round(d.dw), OUT);
  assert.equal(Math.round(d.dh), OUT);
});

test('coversOutput actually rejects a gap rather than nodding along', () => {
  // Deliberately too small: half the box, centred, leaves a border all round.
  const d = cropDest(184, 184, 0.5, { x: 0, y: 0 }, C, C, BOX, OUT);
  assert.equal(coversOutput(d, OUT), false);
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
  const d = cropDest(0, 0, 1, { x: 0, y: 0 }, C, C, BOX, OUT);
  assert.ok(Number.isFinite(d.dx) && Number.isFinite(d.dw));
});
