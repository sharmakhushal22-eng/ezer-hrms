// app/collect-docs/[token]/page.tsx — the candidate's public document-upload page.
// Thin server wrapper; the client validates the token and renders the flow.
import CollectDocsClient from './client'

export const dynamic = 'force-dynamic'

export default async function CollectDocsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <CollectDocsClient token={token} />
}
