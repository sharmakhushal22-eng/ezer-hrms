// lib/ess/viewport.ts — the phone viewport for the employee portal and its login.
//
// maximumScale 1 is what stops iOS Safari zooming the page in whenever a field with
// text under 16px takes focus (most ESS inputs are 13–14px) and leaving it zoomed
// after the keyboard closes. iOS still allows pinch-zoom regardless of this value.
// viewportFit 'cover' lets env(safe-area-inset-bottom) reach the phone tab bar, so
// it clears the home indicator on notched iPhones.
//
// ESS and its login only: /dashboard is desktop-first and keeps the default.
import type { Viewport } from 'next'

export const essViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}
