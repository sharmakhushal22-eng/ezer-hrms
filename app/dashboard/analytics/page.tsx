'use client'
// app/dashboard/analytics/page.tsx — People Analytics (admin, CXO, HR).
// The screen is components/analytics/OrgAnalytics; the figures come from
// /api/analytics/org, which applies the permission and company scope.
import OrgAnalytics from '@/components/analytics/OrgAnalytics'

export default function AnalyticsPage() {
  return <OrgAnalytics />
}
