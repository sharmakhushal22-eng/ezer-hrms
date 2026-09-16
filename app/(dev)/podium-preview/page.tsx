import { notFound } from 'next/navigation'
import Preview from './preview'

// A harness, not a feature. It mounts the Wall of Fame leaderboard on its own,
// at four different row counts, so the podium can be judged without an ESS
// login and without waiting for the live board to grow a third name.
//
// The row counts are the point. The live leaderboard has two people on it, and
// the podium was gated at three — so the thing being reviewed was never the
// thing being rendered. Here 5 / 3 / 2 / 1 are all on screen at once.
export const dynamic = 'force-dynamic'

export default function PodiumPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}
