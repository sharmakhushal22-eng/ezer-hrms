// app/offer-approve/[id]/page.tsx — the offer review-&-approve screen the HR Head lands on
// from the notification in ESS Tasks & Approvals (and the mail button). Thin server wrapper;
// the client reads the ESS session and opens that one offer for decision.
import OfferApproveClient from './client'

export const dynamic = 'force-dynamic'

export default async function OfferApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OfferApproveClient id={id} />
}
