// lib/profile/crop-math.ts — the arithmetic behind the profile photo cropper.
//
// Pulled out of the component because it is the part that was WRONG, and a
// component that needs a browser, a file picker and a pointer device cannot be
// tested. These are pure functions over numbers, so the thing that actually
// decides whether you get your face or your ear is now checkable.

/**
 * The scale at which an image just covers a square stage.
 *
 * THIS IS THE BUG THAT MADE EVERYTHING ELSE LOOK BROKEN. The cropper used to
 * treat its zoom slider as a percentage of the image's NATURAL size, and drew
 * the image at that size with no fit step. A 4000px phone photo at the default
 * 125% was therefore rendered 5000px wide inside a 184px window: you saw a
 * 147-pixel sliver of your own photograph, roughly one eyebrow, and the slider
 * would not go below 100% so you could not zoom out to find the rest of your
 * face.
 *
 * Every reported symptom follows from that one line. The crop looked wrong
 * because you were framing a sliver. The result looked unclear because a
 * ~147px region was being upscaled into a 512px JPEG. And it dragged badly
 * because the browser was compositing a 5000px bitmap on every pointer move.
 *
 * With a cover fit, slider 100% means "the photo exactly fills the frame",
 * which is what a person expects when a crop box opens, and zooming in from
 * there costs detail only when they choose to spend it.
 */
export function coverScale(natW: number, natH: number, box: number): number {
  if (!(natW > 0) || !(natH > 0) || !(box > 0)) return 1
  return Math.max(box / natW, box / natH)
}

/** Where to put the image on the output canvas, in output pixels. */
export interface Dest { dx: number; dy: number; dw: number; dh: number }

/**
 * Map the on-screen layout onto the export canvas.
 *
 * The stage is `box` CSS pixels square and the image is centred in it, then
 * moved by `pos` and scaled by `eff` about its own centre — so the same
 * translate/scale the CSS transform applies. `out` is the exported square.
 *
 * `cx`/`cy` are the measured stage centre rather than `box / 2`, because
 * UiScale puts CSS `zoom` on <html>: getBoundingClientRect() reports zoomed
 * pixels while CSS lengths do not. The caller divides the rect by that zoom
 * before it gets here; passing the centre in keeps the conversion at one
 * boundary instead of scattering it through the maths.
 */
export function cropDest(
  natW: number, natH: number, eff: number,
  pos: { x: number; y: number },
  cx: number, cy: number, box: number, out: number,
): Dest {
  const k = out / box
  const w = natW * eff, h = natH * eff
  const left = cx + pos.x - w / 2
  const top = cy + pos.y - h / 2
  return {
    dx: (left - (cx - box / 2)) * k,
    dy: (top - (cy - box / 2)) * k,
    dw: w * k,
    dh: h * k,
  }
}

/**
 * Does this destination rectangle actually cover the whole output square?
 *
 * A crop that leaves a gap shows the canvas's white fill as a hard wedge down
 * one side of somebody's avatar. Cheap to ask, and it is the single property
 * the fit is supposed to guarantee.
 */
export function coversOutput(d: Dest, out: number, tol = 0.5): boolean {
  return d.dx <= tol && d.dy <= tol
    && d.dx + d.dw >= out - tol
    && d.dy + d.dh >= out - tol
}

/**
 * Cap the working copy's longest edge.
 *
 * Nothing needs a 48-megapixel bitmap live in the DOM to pick a square out of
 * it. Downscaling once, up front, is what stops the drag juddering; it also
 * bounds how far the final export has to downsample, which is where the
 * remaining softness came from.
 */
export const WORK_MAX = 2048

export function workScale(natW: number, natH: number, max = WORK_MAX): number {
  const longest = Math.max(natW, natH)
  return longest > max ? max / longest : 1
}
