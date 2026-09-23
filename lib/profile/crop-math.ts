// lib/profile/crop-math.ts — the arithmetic behind the profile photo cropper.
//
// Pulled out of the component because it is the part that was WRONG, and a
// component that needs a browser, a file picker and a pointer device cannot be
// tested. These are pure functions over numbers, so the thing that actually
// decides whether you get your face or your ear is now checkable.
//
// THE MODEL, once, so the rest reads:
//
//   A source point q, measured from the image's CENTRE in image pixels, lands
//   on screen at   s = pan + R(θ) · (eff · q)   measured from the STAGE centre
//   in CSS pixels. eff is the scale, θ the rotation, pan the drag offset. That
//   is exactly the CSS transform `translate(pan) rotate(θ) scale(eff)` on an
//   element centred in the stage, so what you drag is what gets exported.
//
// Everything below is that one equation, solved for something.

export interface Pt { x: number; y: number }

/** Rotate a vector. Not exported: callers work in screen or image space and
 *  should never need to think about the frame in between. */
function rot(x: number, y: number, rad: number): Pt {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

/**
 * The scale at which an unrotated image just covers a square stage.
 *
 * THIS IS THE BUG THAT MADE EVERYTHING ELSE LOOK BROKEN. The cropper used to
 * treat its zoom slider as a percentage of the image's NATURAL size, and drew
 * the image at that size with no fit step. A 4000px phone photo at the default
 * 125% was therefore rendered 5000px wide inside a 184px window: you saw a
 * 147-pixel sliver of your own photograph, roughly one eyebrow, and the slider
 * would not go below 100% so you could not zoom out to find the rest of your
 * face.
 *
 * Every reported symptom followed from that one line. The crop looked wrong
 * because you were framing a sliver. The result looked unclear because a
 * ~147px region was being upscaled into a 512px JPEG. And it dragged badly
 * because the browser was compositing a 5000px bitmap on every pointer move.
 */
export function coverScale(natW: number, natH: number, box: number): number {
  if (!(natW > 0) || !(natH > 0) || !(box > 0)) return 1;
  return Math.max(box / natW, box / natH);
}

/**
 * The same, once the picture is turned.
 *
 * Rotate a square frame inside a picture and the picture has to grow to keep
 * the corners covered — at 45° the frame's reach along each image axis is
 * (|cos| + |sin|) = √2 times its half-width, so the fit grows by exactly that
 * factor. Without this, rotating by a few degrees to straighten a horizon
 * would pull empty canvas into the corners of somebody's avatar.
 *
 * This is why rotating nudges the zoom up: it is the minimum that still fills
 * the frame, which is the same promise 100% makes when nothing is rotated.
 */
export function rotatedCover(natW: number, natH: number, box: number, rad: number): number {
  const reach = Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
  return coverScale(natW, natH, box) * reach;
}

/**
 * Keep the picture over the hole.
 *
 * Dragging used to be free to pull the image off the stage, and the export
 * then drew the canvas's white fill as a hard wedge down one side of an
 * avatar. Solving |q| ≤ half the image for all four frame corners gives a
 * symmetric limit per axis — in the IMAGE's frame, which is why the pan is
 * rotated in, clamped, and rotated back out.
 */
export function clampPan(pan: Pt, natW: number, natH: number, eff: number, rad: number, box: number): Pt {
  const reach = (box / 2) * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad)));
  const limX = Math.max(0, (natW * eff) / 2 - reach);
  const limY = Math.max(0, (natH * eff) / 2 - reach);
  const v = rot(pan.x, pan.y, -rad);
  return rot(
    Math.min(limX, Math.max(-limX, v.x)),
    Math.min(limY, Math.max(-limY, v.y)),
    rad,
  );
}

/**
 * Is every corner of the frame still inside the picture?
 *
 * The property clampPan is supposed to guarantee, asked independently so the
 * tests are not just clampPan agreeing with itself.
 */
export function frameInside(
  pan: Pt, natW: number, natH: number, eff: number, rad: number, box: number, tol = 1e-6,
): boolean {
  if (!(eff > 0)) return false;
  const h = box / 2;
  for (const [sx, sy] of [[-h, -h], [h, -h], [h, h], [-h, h]] as const) {
    const d = rot(sx - pan.x, sy - pan.y, -rad);
    if (Math.abs(d.x / eff) > natW / 2 + tol) return false;
    if (Math.abs(d.y / eff) > natH / 2 + tol) return false;
  }
  return true;
}

/**
 * Zoom about a point instead of about the centre.
 *
 * What makes a pinch feel right: the bit of picture under your fingers stays
 * under your fingers. Centre-anchored zoom is the thing that makes a cropper
 * feel like it is fighting you, because the detail you are aiming at slides
 * away as you zoom toward it. Rotation-independent — it moves the pan along
 * the line from the anchor, and R cancels.
 */
export function anchoredPan(pan: Pt, anchor: Pt, effFrom: number, effTo: number): Pt {
  if (!(effFrom > 0)) return pan;
  const k = effTo / effFrom;
  return { x: anchor.x - k * (anchor.x - pan.x), y: anchor.y - k * (anchor.y - pan.y) };
}

/** What to hand the export canvas: the same transform the screen is using,
 *  carried across to output pixels. k maps stage CSS px to output px. */
export interface Xform { k: number; tx: number; ty: number; scale: number }

export function exportTransform(pan: Pt, eff: number, box: number, out: number): Xform {
  const k = out / box;
  return { k, tx: out / 2 + pan.x * k, ty: out / 2 + pan.y * k, scale: eff * k };
}

/**
 * Cap the working copy's longest edge.
 *
 * Nothing needs a 48-megapixel bitmap live in the DOM to pick a square out of
 * it. Downscaling once, up front, is what stops the drag juddering; it also
 * bounds how far the final export has to downsample, which is where the
 * remaining softness came from.
 */
export const WORK_MAX = 2048;

export function workScale(natW: number, natH: number, max = WORK_MAX): number {
  const longest = Math.max(natW, natH);
  return longest > max ? max / longest : 1;
}

/** Degrees to radians, in one place, because getting this wrong is silent. */
export const rad = (deg: number): number => (deg * Math.PI) / 180;
