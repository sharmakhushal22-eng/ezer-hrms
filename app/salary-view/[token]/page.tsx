import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import SalaryViewClient from './client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function SalaryViewPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data, error } = await supabase
    .from('ctc_negotiations')
    .select('*')
    .eq('link_token', token)
    .single()

  if (error || !data) return notFound()

  // Mark as viewed
  if (!data.link_viewed_at) {
    await supabase
      .from('ctc_negotiations')
      .update({ link_viewed_at: new Date().toISOString() })
      .eq('link_token', token)
  }

  return <SalaryViewClient data={data} />
}
