import { notFound } from 'next/navigation'
import Preview from './preview'

// A harness, not a feature. It mounts <MrfForm> on its own so the requisition
// form can be judged light and dark, at four widths, without an ESS login.
//
// WHY THIS EXISTS. MrfForm has three call sites and NONE of them can be reached
// in a dev environment:
//
//   * app/dashboard/recruitment/page.tsx:1638 is gated on `employeeId`
//     (grant.employeeId), which is null for a legacy login — the MRF tab falls
//     through to the inline ten-step form instead.
//   * components/ess/RoleTabs.tsx:270 (edit & resubmit) needs an MRF whose
//     status is NEEDS_REVISION. There are none; the table holds only
//     SUBMITTED / APPROVED / DRAFT.
//   * components/ess/RoleTabs.tsx:501 (RaiseMrfSection) is dead: 'raise-mrf'
//     was removed from the portal's SECTIONS, so no sub-tab routes to it.
//
// Admin impersonation does not rescue any of it — it hands EmployeePortal an
// employeeId but no ESS token, so every api() call answers "unauthenticated"
// and Tasks & Approvals never finishes loading.
//
// MrfForm reads its own reference data through the anon Supabase client on
// mount and only calls api() on save, so it renders here in full.
export const dynamic = 'force-dynamic'

export default function MrfPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}
