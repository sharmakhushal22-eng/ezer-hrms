'use client'
// app/dashboard/tds-calculator/page.tsx — Help → TDS Calculator, for the hiring and HR roles
// (lib/rms/nav.ts TDS_CALCULATOR_ROLES). Rendered in the dashboard and inside ESS (AdminModules).
//
// The Automated CTC Calculator from Recruitment → Negotiation (components/recruitment/
// CtcBreakupCalculator): an annual CTC and variable in, the whole salary breakdown out. Only a
// calculator — no employee is looked up, nothing is saved, nothing is sent.
import dynamic from 'next/dynamic'
import { useGrant } from '@/lib/rms/client'
import { roleEntryOpen, TDS_CALCULATOR_ROLES } from '@/lib/rms/nav'
import { Page, PageHeader, Card, C as TK } from '@/lib/ui'

const CtcBreakupCalculator = dynamic(() => import('@/components/recruitment/CtcBreakupCalculator'), { ssr: false })

export default function TdsCalculatorPage() {
  const { grant, loading } = useGrant()
  const allowed = roleEntryOpen({ roles: TDS_CALCULATOR_ROLES }, grant.roles.map(r => r.role_code), grant.isSuperAdmin || grant.legacy)

  if (loading) return <Page><div style={{ padding: 24, color: TK.muted, fontSize: 13 }}>Loading…</div></Page>
  if (!allowed) {
    return (
      <Page>
        <PageHeader title="TDS Calculator" context="Help" />
        <Card><div style={{ fontSize: 13, color: TK.muted }}>The TDS Calculator is for Hiring Managers and the HR team (HR Executive, Branch HR, HR Manager, HR Head, CHRO). Your own tax declaration is in Flexi &amp; TDS on your portal.</div></Card>
      </Page>
    )
  }
  return (
    <Page>
      <PageHeader title="TDS Calculator" context="Help · salary breakup · nothing here is saved" />
      <CtcBreakupCalculator />
    </Page>
  )
}
