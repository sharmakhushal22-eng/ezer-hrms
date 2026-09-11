// Shown by Next while a dashboard section resolves.
//
// Shaped like the page it stands in for — heading, tile row, table — so the
// layout does not jump when the real content lands. A centred spinner would be
// less work and would tell the reader nothing about what is arriving.
import { PageSkeleton } from '@/lib/ui/PageTransition'

export default function Loading() {
  return <PageSkeleton />
}
