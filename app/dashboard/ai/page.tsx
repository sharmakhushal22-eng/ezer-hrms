// app/dashboard/ai/page.tsx
//
// Placeholder. It says what the module will do rather than only that it does
// not exist yet — a bare "Coming soon" tells someone nothing about whether
// they are in the right place.

import { Page, PageHeader, Card, Empty, Badge, IconAi } from '@/lib/ui'

export default function AiPage() {
  return (
    <Page>
      <PageHeader
        title="Ezer AI"
        context="Not built yet"
        actions={<Badge t="warning" dot>In development</Badge>}
      />
      <Card pad={0}>
        <Empty
          icon={<IconAi size={20} />}
          title="Ezer AI is not available yet"
          hint="Assistive answers over your own HR data — headcount questions, policy lookups and draft copy."
        />
      </Card>
    </Page>
  )
}
