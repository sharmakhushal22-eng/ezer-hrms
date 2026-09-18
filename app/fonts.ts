// app/fonts.ts — the two faces the ESS Today tab is drawn in.
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
import { Fraunces, DM_Sans } from 'next/font/google'

export const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz', 'SOFT'],   // today.css sets font-variation-settings:"SOFT" 50
  display: 'swap',
  variable: '--ezt-serif',
})

// DM Sans — the body face of the Today design, and of 71 other files in this
// repo that ask for "DM Sans" by name. It was never loaded, so every one of
// those declarations fell through to Segoe UI / system-ui, and the tab rendered
// in the wrong typeface: different letterforms, different widths, labels like
// the punch button's sitting differently from the design.
//
// Exposed as a variable and applied ONLY under .ezt, for the reason the comment
// in app/dashboard/layout.tsx gives: pointing the whole app at a newly loaded
// face restyles 71 files' worth of screens, and that is a decision to take
// deliberately rather than as a side effect of fixing one tab.
//
// Same rule as above — no `weight` alongside `axes`, or the build fails and
// every route 500s, because layout.tsx imports this file.
export const dmSans = DM_Sans({
  subsets: ['latin'],
  axes: ['opsz'],           // the design loads DM+Sans:opsz,wght@9..40
  display: 'swap',
  variable: '--ezt-sans',
})
