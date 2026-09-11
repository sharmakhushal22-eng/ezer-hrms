// app/dashboard/support/page.tsx
//
// Placeholder. It says what the module will do rather than only that it does
// not exist yet — a bare "Coming soon" tells someone nothing about whether
// they are in the right place.

import { Page, PageHeader, Card, Empty, Badge, IconSupport } from '@/lib/ui'

export default function SupportPage() {
  return (
    <Page>
      <PageHeader
        title="Support"
        context="Not built yet"
        actions={<Badge t="warning" dot>In development</Badge>}
      />
      <Card pad={0}>
        <Empty
          icon={<IconSupport size={20} />}
          title="Support is not available yet"
          hint="Raise a ticket, track what you have already asked, and reach the team that owns it."
        />
      </Card>
    </Page>
  )
}
