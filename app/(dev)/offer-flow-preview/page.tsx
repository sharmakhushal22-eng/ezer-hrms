import { notFound } from 'next/navigation'
import Preview from './preview'

// A harness, not a feature. It mounts the two offer-flow panes on their own so
// their fields can be judged light and dark, because neither is reachable in
// this environment:
//
//   * CreateOfferApproval renders under OfferApprovalTab only after selecting a
//     candidate who has ACCEPTED a salary link from Negotiation. That queue is
//     empty (0 cards, 0 rows) — the same empty queue that made AuditTrailViewer
//     inspection-only in 19ed121.
//   * HRManagerSendOffer renders on Send Offers, which currently shows five
//     fields, all of them already rx-input, so none of its own eight sites are
//     on screen.
//
// Between them those are 29 of the 32 field sites in offer-flow-components.tsx.
// Converting them without ever seeing them would have been the only unverified
// unit in the whole convergence, so this exists instead.
//
// Same pattern as mrf-preview: real Supabase reads through the anon client, no
// mocks, and <UIKeyframes/> so the preview cannot flatter the design.
export const dynamic = 'force-dynamic'

export default function OfferFlowPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}
