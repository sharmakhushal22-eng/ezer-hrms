// app/mrf-approve/[id]/page.tsx — the MRF review-&-approve screen an approver lands on
// from the hyperlink in ESS Tasks & Approvals. Thin server wrapper; the client reads the
// ESS session and opens the requisition for approval.
import MrfApproveClient from './client'

export const dynamic = 'force-dynamic'

export default async function MrfApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MrfApproveClient id={id} />
}
