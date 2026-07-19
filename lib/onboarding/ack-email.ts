// lib/onboarding/ack-email.ts
// On final approval (employee code generation), email the new joiner their
// Acknowledgement document (auto-filled details + acknowledged policies, with text)
// via the existing Gmail / nodemailer setup. Non-fatal — never blocks code gen.
import nodemailer from 'nodemailer'
import { resolveLetterhead, letterheadHeaderHtml, letterheadFooterHtml } from '@/lib/letterheads'

const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

function buildAckHtml(d: {
  employee_name: string; father_name: string; employee_code: string; designation: string
  department: string; doj: string; company_name: string; work_location: string; aadhaar_last4: string
  acks: { policy_code: string; policy_title: string; policy_version: string }[]
  bodies: Record<string, string>
  ackById: Record<string, { policy_code: string; policy_title: string; policy_version: string }>
}): string {
  const detail = (l: string, v: any) => `<tr><td style="padding:6px 10px;color:#6B7280;font-size:13px;border-bottom:1px solid #EEE">${l}</td><td style="padding:6px 10px;color:#111;font-weight:600;font-size:13px;border-bottom:1px solid #EEE">${esc(v) || '—'}</td></tr>`
  const policyBlocks = d.acks.map(a => `
    <div style="margin:14px 0;padding:12px 14px;border:1px solid #E5E5E5;border-radius:8px">
      <div style="font-weight:700;font-size:14px;color:#111">${esc(a.policy_title)} <span style="color:#999;font-weight:400;font-size:11px">${esc(a.policy_code)} · v${esc(a.policy_version)}</span> <span style="color:#059669;font-size:11px">✓ Acknowledged</span></div>
      <div style="white-space:pre-wrap;font-size:12px;color:#374151;line-height:1.7;margin-top:8px">${esc(Object.entries(d.bodies).find(([id]) => d.ackById[id]?.policy_code === a.policy_code)?.[1] || '')}</div>
    </div>`).join('')
  const lh = resolveLetterhead(d.company_name)
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#F5F3FF;margin:0;padding:24px">
    <div style="max-width:660px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E5E5">
      ${letterheadHeaderHtml(lh)}
      <div style="padding:20px 22px">
        <div style="font-size:16px;font-weight:700;color:${lh.accent};margin-bottom:4px">Employee Policy Handbook — Acknowledgement &amp; Declaration</div>
        <p style="font-size:13px;color:#374151">Dear ${esc(d.employee_name)},</p>
        <p style="font-size:13px;color:#374151;line-height:1.6">Welcome aboard! Your joining is confirmed and your Employee ID is <b>${esc(d.employee_code)}</b>. Below is your acknowledgement document with the policies you accepted during onboarding.</p>
        <table style="width:100%;border-collapse:collapse;margin:14px 0">
          ${detail('Employee Name', d.employee_name)}
          ${detail("Father's Name", d.father_name)}
          ${detail('Employee ID', d.employee_code)}
          ${detail('Designation', d.designation)}
          ${detail('Department', d.department)}
          ${detail('Date of Joining', d.doj)}
          ${detail('Company', d.company_name)}
          ${detail('Work Location', d.work_location)}
          ${detail('Aadhaar', 'XXXX XXXX ' + (d.aadhaar_last4 || '****'))}
        </table>
        <div style="font-size:14px;font-weight:700;color:#7C3AED;margin-top:8px">Acknowledged Policies (${d.acks.length})</div>
        ${policyBlocks || '<div style="font-size:12px;color:#999">No policies were configured.</div>'}
        <div style="background:#EEEDFE;border-radius:8px;padding:12px 14px;margin-top:16px;font-size:12px;color:#3C3489;line-height:1.7">
          I hereby acknowledge that I have received, read, and understood all the above policies, and confirm the details shown are correct.
        </div>
      </div>
      ${letterheadFooterHtml(lh)}
    </div>
  </body></html>`
}

export async function sendAckEmail(supa: any, onboardingId: string, employeeCode: string): Promise<{ ok?: boolean; skipped?: string; error?: string }> {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return { skipped: 'email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)' }
  try {
    const { data: c } = await supa.from('onboarding_candidates')
      .select('id, full_name, email, designation, department, date_of_joining, company_id, location_id, form_data')
      .eq('id', onboardingId).maybeSingle()
    if (!c?.email) return { skipped: 'candidate has no email' }

    const { data: company } = await supa.from('companies').select('company_name').eq('id', c.company_id).maybeSingle()
    let work_location = '—'
    if (c.location_id) {
      const { data: loc } = await supa.from('locations').select('location_name, city').eq('id', c.location_id).maybeSingle()
      work_location = [loc?.location_name, loc?.city].filter(Boolean).join(', ') || '—'
    }
    const { data: acks } = await supa.from('onboarding_policy_acks')
      .select('policy_id, policy_code, policy_title, policy_version').eq('onboarding_id', c.id)
      .not('acknowledged_at', 'is', null).order('ack_order')
    const bodies: Record<string, string> = {}
    const ackById: Record<string, any> = {}
    const ids = (acks || []).map((a: any) => a.policy_id)
    for (const a of (acks || []) as any[]) ackById[a.policy_id] = a
    if (ids.length) {
      const { data: pol } = await supa.from('company_policies').select('id, policy_body').in('id', ids)
      for (const p of (pol || []) as any[]) bodies[p.id] = p.policy_body
    }

    const fd: any = c.form_data || {}
    const father = fd.step_3?.father_name || fd.step_5?.father_name || fd.step_7?.insurance?.father_name || '—'
    const aadhaar_last4 = fd.step_7?.aadhaar_last4 || fd.statutory?.aadhaar_last4 || '****'
    const html = buildAckHtml({
      employee_name: c.full_name, father_name: father, employee_code: employeeCode,
      designation: c.designation, department: c.department, doj: c.date_of_joining,
      company_name: company?.company_name || '', work_location, aadhaar_last4,
      acks: (acks || []) as any[], bodies, ackById,
    })

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
    await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || 'HR Team'}" <${user}>`,
      to: c.email,
      subject: `Welcome to ${company?.company_name || 'the team'} — Documents & Policy Acknowledgement (${employeeCode})`,
      html,
      attachments: [{ filename: `Acknowledgement_${employeeCode}.html`, content: Buffer.from(html, 'utf-8'), contentType: 'text/html' }],
    })
    // record that documents were emailed
    await supa.from('onboarding_esign_records').update({ hr_notified_at: new Date().toISOString() }).eq('onboarding_id', c.id)
    return { ok: true }
  } catch (e: any) {
    return { error: e?.message || 'email failed' }
  }
}
