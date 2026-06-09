import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import JoiningClient from './client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function JoiningPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const { data: tok, error } = await supabase
    .from('joining_formalities_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !tok) return notFound()

  // Mark the link as opened (first visit only).
  if (!tok.opened_at) {
    await supabase
      .from('joining_formalities_tokens')
      .update({ opened_at: new Date().toISOString(), status: 'OPENED' })
      .eq('id', tok.id)
  }

  const { data: candidate } = await supabase
    .from('candidates')
    .select('*')
    .eq('id', tok.candidate_id)
    .single()

  const { data: company } = tok.company_id
    ? await supabase.from('companies').select('*').eq('id', tok.company_id).single()
    : { data: null }

  return <JoiningClient tokenId={tok.id} token={token} candidate={candidate} company={company} />
}
