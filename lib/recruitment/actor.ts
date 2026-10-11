// lib/recruitment/actor.ts — SERVER ONLY. "Who did this", for audit logs and verification marks.
import { rmsServiceClient as sb } from '@/lib/rms/server'

export async function actorName(user: { employeeId: string | null; email: string | null }): Promise<string> {
  if (user.employeeId) {
    const { data } = await sb.from('employees').select('full_name, emp_code').eq('id', user.employeeId).maybeSingle()
    if (data?.full_name) return `${data.full_name}${data.emp_code ? ` (${data.emp_code})` : ''}`
  }
  return user.email || 'HR'
}
