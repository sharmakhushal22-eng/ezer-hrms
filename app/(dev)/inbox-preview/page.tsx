import { notFound } from 'next/navigation'
import Preview from './preview'

// A harness, not a feature. It renders every inbox component against mock data
// with no network and no Supabase, so the design can be walked state by state —
// light and dark, 1400px and 390px — without an ESS login. It does not exist in
// a production build.
export const dynamic = 'force-dynamic'

export default function InboxPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}
