'use client'
// app/funzone-preview/page.tsx — a test harness, not a product screen.
//
// The Fun Zone sits behind ESS auth, so a functional test cannot reach the
// games through the portal. This mounts the hub directly so scripts/
// smoke-funzone.py can click through and actually PLAY each one — reading
// the source proved the deck bug was fixed but could never have proved the
// games respond to a tap.
//
// IT MOUNTS <UIKeyframes/>, AND THAT IS LOAD-BEARING.
//
// EmployeePortal mounts it; this did not, and the difference is not cosmetic.
// UIKeyframes carries `button { border-radius:10px !important }`, which every
// key and pill shape in funzone.css has to out-specify. Without it here, this
// harness was the one place those rules were never exercised — the arcade keys
// rendered at their true radius in the preview and flattened to 10px
// rectangles in the actual portal, and no amount of clicking through this page
// could have shown it. The social preview carries the same note for the same
// reason.
//
// Renders nothing outside development.
import FunZone from '@/components/ess/FunZone'
import { UIKeyframes } from '@/lib/ui'

export default function FunZonePreview() {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }} data-harness="funzone">
      <UIKeyframes />
      <FunZone employeeId="00000000-0000-0000-0000-000000000001" />
    </div>
  )
}
