// app/dashboard/compliance/page.tsx
//
// Placeholder. It says what the module will do rather than only that it does
// not exist yet — a bare "Coming soon" tells someone nothing about whether
// they are in the right place.

import { Page, PageHeader, Card, Empty, Badge, IconCompliance } from '@/lib/ui'

export default function CompliancePage() {
  return (
    <Page>
      <PageHeader
        title="Compliance Engine"
        context="Not built yet"
        actions={<Badge t="warning" dot>In development</Badge>}
      />
      <Card pad={0}>
        <Empty
          icon={<IconCompliance size={20} />}
          title="Compliance Engine is not available yet"
          hint="Statutory registers, filing calendars and the evidence trail behind each return."
        />
      </Card>
    </Page>
  )
}
