'use client'
// app/funzone-preview/page.tsx — a test harness, not a product screen.
//
// The Fun Zone sits behind ESS auth, so a functional test cannot reach the
// games through the portal. This mounts the hub directly so scripts/
// smoke-funzone.py can click through and actually PLAY each one — reading
// the source proved the deck bug was fixed but could never have proved the
// games respond to a tap.
//
// Renders nothing outside development.
import FunZone from '@/components/ess/FunZone'

export default function FunZonePreview() {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }} data-harness="funzone">
      <FunZone employeeId="00000000-0000-0000-0000-000000000001" />
    </div>
  )
}
