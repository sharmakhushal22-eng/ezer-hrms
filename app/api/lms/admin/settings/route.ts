// app/api/lms/admin/settings/route.ts — a company's learning settings.
import { NextRequest, NextResponse } from 'next/server'
import { lmsAdmin, writeCompany } from '@/lib/lms/access'
import { audit, errorResponse, LmsError, must, sb, settingsFor } from '@/lib/lms/server'

export const runtime = 'nodejs'

const FIELDS = ['enabled', 'default_pass_pct', 'default_media_pct', 'default_max_attempts', 'default_due_days', 'publish_requires_review', 'managers_can_assign', 'managers_see_scores', 'reminder_days_before', 'overdue_every_days', 'escalate_after_days', 'email_enabled', 'certificates_enabled', 'cert_title', 'cert_signatory_name', 'cert_signatory_title', 'preboarding_enabled', 'preboarding_link_days']

export async function GET(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req)
  if (error) return error
  try { return NextResponse.json({ settings: await settingsFor(writeCompany(actor, req.nextUrl.searchParams.get('company'), 'publish')) }) }
  catch (e) { return errorResponse(e) }
}

export async function PUT(req: NextRequest) {
  const { actor, error } = await lmsAdmin(req, 'publish')
  if (error) return error
  try {
    const b = await req.json()
    const company = writeCompany(actor, b.company_id, 'publish')
    const patch: Record<string, unknown> = Object.fromEntries(FIELDS.filter(k => b[k] !== undefined).map(k => [k, b[k]]))
    if (Array.isArray(patch.reminder_days_before)) patch.reminder_days_before = [...new Set((patch.reminder_days_before as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0))]
    else if (patch.reminder_days_before !== undefined) throw new LmsError('Reminder days must be a list.')
    await settingsFor(company)
    const saved = must(await sb.from('lms_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: actor.label }).eq('company_id', company).select('*').single())
    await audit({ companyId: company, actorId: actor.employeeId, actorLabel: actor.label, action: 'SETTINGS_UPDATED', entity: 'settings', entityId: company, detail: { fields: Object.keys(patch) }, req })
    return NextResponse.json({ settings: saved })
  } catch (e) { return errorResponse(e) }
}
