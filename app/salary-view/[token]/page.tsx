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

  // Company · branch · department for the header — resolved from the offer's company and
  // the candidate's requisition (location = branch, department from the MRF).
  const meta: { company_name?: string; branch?: string; department?: string; designation?: string } = {}
  if (data.company_id) {
    const { data: co } = await supabase.from('companies').select('company_name, company_code').eq('id', data.company_id).maybeSingle()
    meta.company_name = co?.company_name || co?.company_code || undefined
  }
  if (data.candidate_id) {
    const { data: cand } = await supabase.from('candidates').select('mrf_id, designation').eq('id', data.candidate_id).maybeSingle()
    if (cand?.designation) meta.designation = cand.designation
    if (cand?.mrf_id) {
      const { data: mrf } = await supabase.from('manpower_requisitions')
        .select('designation, position, departments:department_id(dept_name), locations:location_id(location_name)').eq('id', cand.mrf_id).maybeSingle()
      meta.department = (mrf as any)?.departments?.dept_name || undefined
      meta.branch = (mrf as any)?.locations?.location_name || undefined
      meta.designation = meta.designation || (mrf as any)?.designation || (mrf as any)?.position || undefined
    }
  }

  // Mark as viewed
  if (!data.link_viewed_at) {
    await supabase
      .from('ctc_negotiations')
      .update({ link_viewed_at: new Date().toISOString() })
      .eq('link_token', token)
  }

  return <SalaryViewClient data={data} meta={meta} />
}
