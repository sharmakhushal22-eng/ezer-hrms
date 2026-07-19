'use client'
// app/dashboard/payroll/flexi-approval/page.tsx
// Payroll Manager flexi-claim approval — routed under /dashboard/payroll as per spec.
// Renders the full Flexi Claims console (Approvals · Window · Limits), which is the
// canonical, Supabase-wired approval surface (superset of the spec's FlexiApproval.tsx).
import FlexiClaimsAdmin from '@/app/dashboard/flexi-claims/page'

export default function FlexiApprovalPage() {
  return <FlexiClaimsAdmin />
}
