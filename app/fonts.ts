// app/fonts.ts — Fraunces, for the ESS Today greeting and brief line only.
//
// today.css reads it as --ezt-serif with a Georgia fallback, so the tab renders
// correctly before the font arrives and if it never does.
//
// NO `weight` HERE, ON PURPOSE. next/font refuses `axes` unless the font is
// loaded as variable:
//
//   Axes can only be defined for variable fonts when the weight property is
//   nonexistent or set to `variable`.
//
// A drop for the Wall of Fame shipped weight: ['400','500'] alongside
// axes: ['opsz'] and, because layout.tsx imports this file, that failed the
// build and 500'd every route in the app — not just the one tab. Omitting
// weight loads the whole variable range, which is what the optical-size and
// softness axes need anyway.
import { Fraunces } from 'next/font/google'

export const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],   // today.css sets font-variation-settings:"SOFT" 50
  display: 'swap',
  variable: '--ezt-serif',
})
