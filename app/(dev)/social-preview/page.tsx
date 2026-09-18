import { notFound } from 'next/navigation'
import Preview from './preview'

// A harness, not a feature. It renders the Social section against mock data
// with no network and no Supabase, so the design can be reviewed without an ESS
// login and without the four sub-sections having any backend yet. It does not
// exist in a production build.
export const dynamic = 'force-dynamic'

export default function SocialPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <Preview />
}
