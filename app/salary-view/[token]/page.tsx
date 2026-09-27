import { notFound } from 'next/navigation'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import SalaryViewClient from './client'

// The salary link opens on a login step: the candidate's registered email (masked) →
// Send OTP → verify. Only then does the client fetch the offer from /api/salary-view/data.
// So this server page hands over nothing but the token and what the login card needs.
export default async function SalaryViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { data } = await sb.from('ctc_negotiations')
    .select('id, candidate_id, candidate_name, company_name, company_id, is_stipend').eq('link_token', token).maybeSingle()
  if (!data) return notFound()

  let email: string | null = null
  if (data.candidate_id) {
    const { data: cand } = await sb.from('candidates').select('email').eq('id', data.candidate_id).maybeSingle()
    email = (cand?.email || '').trim() || null
  }
  let companyName = data.company_name || ''
  if (!companyName && data.company_id) {
    const { data: co } = await sb.from('companies').select('company_name').eq('id', data.company_id).maybeSingle()
    companyName = co?.company_name || ''
  }
  const mask = (e: string) => { const [u, d] = e.split('@'); if (!d) return e; const head = u.length <= 2 ? u[0] : u.slice(0, 2); return `${head}${'*'.repeat(Math.max(2, u.length - 2))}@${d}` }

  return <SalaryViewClient token={token} gate={{ candidateName: data.candidate_name || '', companyName, maskedEmail: email ? mask(email) : null, isStipend: !!data.is_stipend }} />
}
