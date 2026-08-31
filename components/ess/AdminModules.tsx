'use client'
// components/ess/AdminModules.tsx — the admin modules, rendered inside ESS.
//
// An HR or payroll person should not have to leave their own portal to do their job.
// So ESS hosts the very same page components the dashboard routes render — not a copy,
// not an iframe: the exact default export of app/dashboard/<module>/page.tsx. Those
// pages are self-contained client components (the dashboard layout supplies no context),
// which is what makes this possible at all.
//
// Every entry is a next/dynamic import so the code splits per module. An employee who
// holds nothing downloads none of it; a payroll manager downloads Payroll and nothing
// from Recruitment. `ssr: false` because these pages read localStorage and the Supabase
// browser client on mount.
//
// Access is NOT decided here. The sidebar filters by grant before it offers a key, and
// each module's own API routes re-check with requireModule — a hidden entry is not a
// lock, and this file is not one either.
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import { C as TK } from '@/lib/ui'

const Loading = () => (
  <div style={{ padding: 40, textAlign: 'center', color: TK.muted, fontSize: 13, fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
    Loading module…
  </div>
)
const lazy = (load: () => Promise<{ default: ComponentType<Record<string, never>> }>) =>
  dynamic(load, { ssr: false, loading: Loading })

/** ESS nav key (lib/rms/nav.ts) → the dashboard page that key opens. */
export const ADMIN_MODULE_COMPONENTS: Record<string, ComponentType<Record<string, never>>> = {
  // People
  recruitment:          lazy(() => import('@/app/dashboard/recruitment/page')),
  onboarding:           lazy(() => import('@/app/dashboard/onboarding/page')),
  pms:                  lazy(() => import('@/app/dashboard/pms/page')),
  employees:            lazy(() => import('@/app/dashboard/employees/page')),
  'org-chart':          lazy(() => import('@/app/dashboard/org-chart/page')),
  'bulk-upload':        lazy(() => import('@/app/dashboard/bulk-upload/page')),
  transfer:             lazy(() => import('@/app/dashboard/transfer/page')),
  // Time & Attendance
  attendance:           lazy(() => import('@/app/dashboard/attendance/page')),
  'attendance-reports': lazy(() => import('@/app/dashboard/attendance-reports/page')),
  'leave-upload':       lazy(() => import('@/app/dashboard/leave-upload/page')),
  // Money
  payroll:              lazy(() => import('@/app/dashboard/payroll/page')),
  finance:              lazy(() => import('@/app/dashboard/finance/page')),
  'flexi-claims':       lazy(() => import('@/app/dashboard/flexi-claims/page')),
  'travel-claims':      lazy(() => import('@/app/dashboard/travel-claims/page')),
  loans:                lazy(() => import('@/app/dashboard/loans/page')),
  // Compliance & Docs
  compliance:           lazy(() => import('@/app/dashboard/compliance/page')),
  letters:              lazy(() => import('@/app/dashboard/letters/page')),
  policies:             lazy(() => import('@/app/dashboard/policies/page')),
  reports:              lazy(() => import('@/app/dashboard/reports/page')),
  // Setup
  ess:                  lazy(() => import('@/app/dashboard/ess/page')),
  admin:                lazy(() => import('@/app/dashboard/admin/page')),
  'flexi-policy':       lazy(() => import('@/app/dashboard/flexi-policy/page')),
  'company-profile':    lazy(() => import('@/app/dashboard/company-profile/page')),
  'db-export':          lazy(() => import('@/app/dashboard/db-export/page')),
  // Help
  ai:                   lazy(() => import('@/app/dashboard/ai/page')),
  support:              lazy(() => import('@/app/dashboard/support/page')),
}

export function AdminModuleHost({ moduleKey }: { moduleKey: string }) {
  const Cmp = ADMIN_MODULE_COMPONENTS[moduleKey]
  if (!Cmp) {
    return (
      <div style={{ padding: 30, fontFamily: '"DM Sans","Segoe UI",sans-serif', color: TK.muted, fontSize: 13 }}>
        This module is not available inside ESS yet — open it from the Admin dashboard.
      </div>
    )
  }
  return <Cmp />
}
