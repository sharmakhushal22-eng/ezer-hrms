// app/api/transfer/generate-letter/route.ts
// POST → marks the transfer letter generated + sets letter_url (a viewable HTML letter).
// GET ?id=<transfer_id> → renders the transfer letter as HTML (opened from ESS / email).
//
// The words come from Configuration → Employee lifecycle → "Transfer letter", for the company /
// branch the employee moves to; the letterhead, date, reference and the list of what changes
// ({{transfer_details}}) are drawn here. GET stays open: the employee opens the link from the
// email, where no sign-in header can be sent — the transfer id in it is the key.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTransferEditor } from '@/lib/employees/transfer-auth'
import { resolveTemplate } from '@/lib/config/store'
import { renderLetterParagraphs, paragraphsToHtml } from '@/lib/config/render'

export const runtime = 'nodejs'

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
const fmt = (d: any) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'

async function buildLetterHtml(transferId: string): Promise<string | null> {
  const { data: tr } = await supa.from('employee_transfer').select('*').eq('id', transferId).maybeSingle()
  if (!tr) return null
  const [{ data: emp }, { data: toCo }, { data: fromCo }, { data: toBr }, { data: fromBr }, { data: mgr }, { data: dept }] = await Promise.all([
    supa.from('employees').select('full_name, emp_code').eq('id', tr.employee_id).maybeSingle(),
    tr.to_company_id ? supa.from('companies').select('company_name').eq('id', tr.to_company_id).maybeSingle() : Promise.resolve({ data: null } as any),
    tr.from_company_id ? supa.from('companies').select('company_name').eq('id', tr.from_company_id).maybeSingle() : Promise.resolve({ data: null } as any),
    tr.to_branch_id ? supa.from('locations').select('location_name').eq('id', tr.to_branch_id).maybeSingle() : Promise.resolve({ data: null } as any),
    tr.from_branch_id ? supa.from('locations').select('location_name').eq('id', tr.from_branch_id).maybeSingle() : Promise.resolve({ data: null } as any),
    tr.new_reporting_manager_id ? supa.from('employees').select('full_name').eq('id', tr.new_reporting_manager_id).maybeSingle() : Promise.resolve({ data: null } as any),
    tr.new_department_id ? supa.from('departments').select('dept_name').eq('id', tr.new_department_id).maybeSingle() : Promise.resolve({ data: null } as any),
  ])
  const isInter = tr.transfer_type === 'INTER_COMPANY'
  const ref = `TRF/${tr.from_emp_code || tr.employee_id.slice(0, 6)}/${new Date().getFullYear()}`
  const benefitLabel: Record<string, string> = { NONE: 'As per current terms', RELOCATION: 'Relocation assistance', ONE_TIME_BONUS: 'One-time transfer bonus', AS_PER_NEW_POLICY: 'As per new company policy' }
  const details: [string, string][] = [['New Location', toBr?.location_name || '—']]
  if (mgr?.full_name) details.push(['New Reporting Manager', mgr.full_name])
  if (tr.new_designation) details.push(['New Designation', tr.new_designation])
  if (dept?.dept_name) details.push(['New Department', dept.dept_name])
  details.push(['Transfer Benefit', benefitLabel[tr.benefit_type] || tr.benefit_type])
  const rows = details.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`)

  const coName = (toCo?.company_name || fromCo?.company_name || '')
  const s = coName.toLowerCase()
  // Pick the Sharma Group letterhead branding for this company.
  const LH = /retail|\bsrs\b/.test(s) ? { name: 'Sharma Retail Solutions', badge: 'SRS', eyebrow: 'A Sharma Group Company', bg: 'linear-gradient(118deg,#0F766E,#0E7490 55%,#1D4ED8)', accent: '#0E7490', addr: 'Tower B, DLF Cyber City, Gurugram, Haryana — 122 002', cin: 'U52100DL2018PTC330456', gstin: '07AAKSR1234B1ZP' }
    : /trading|\bstc\b|nariman/.test(s) ? { name: 'Sharma Trading Corporation', badge: 'STC', eyebrow: 'A Sharma Group Company · Mumbai', bg: '#6B0F1A', accent: '#B8860B', addr: 'Office 301, Nariman Point, Mumbai, Maharashtra — 400 021', cin: 'U51909MH2005PTC291234', gstin: '27AAHST3456D1ZS' }
    : { name: 'Sharma Sons Manufacturing', badge: 'SSM', eyebrow: 'A Sharma Group Company · Since 2010', bg: '#1B2A4A', accent: '#E85D04', addr: 'Plot 12, Sector 5, Dwarka, New Delhi — 110 075', cin: 'U29100HR2010PTC040123', gstin: '06AAHSS2345C1ZR' }
  const tpl = await resolveTemplate('transfer.letter', { companyId: tr.to_company_id || tr.from_company_id || null, locationId: tr.to_branch_id || null })
  const { paragraphs } = renderLetterParagraphs(tpl!.body, {
    employee_name: emp?.full_name || 'Employee',
    emp_code: emp?.emp_code || '',
    from_posting: fromBr?.location_name || fromCo?.company_name || 'current posting',
    to_posting: toBr?.location_name || toCo?.company_name || 'new posting',
    effective_date: fmt(tr.effective_date),
    new_company: isInter ? (toCo?.company_name || '—') : '',
    group_doj: isInter ? fmt(tr.group_doj_preserved) : '',
    old_company_last_day: isInter && tr.last_working_date_old ? fmt(tr.last_working_date_old) : '',
    company_name: LH.name,
  }, ['transfer_details'])
  const title = tpl!.subject || 'TRANSFER LETTER'
  return `<!doctype html><html><head><meta charset="utf-8"><title>Transfer Letter — ${esc(LH.name)}</title>
<style>body{font-family:'DM Sans','Segoe UI',sans-serif;color:#1E1B4B;max-width:760px;margin:0 auto 32px;padding:0;line-height:1.7}
.wrap{padding:0 40px}
.lh-head{background:${LH.bg};color:#fff;padding:22px 40px;display:flex;justify-content:space-between;align-items:flex-start}
.lh-badge{width:56px;height:56px;border-radius:12px;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;margin-right:14px}
.lh-l{display:flex;align-items:center} .lh-ey{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.lh-nm{font-size:22px;font-weight:700} .lh-r{text-align:right;font-size:11px;color:rgba(255,255,255,.8);line-height:1.8}
.lh-accent{height:5px;background:${LH.accent}}
h1{font-size:19px;letter-spacing:.05em;border-bottom:2px solid ${LH.accent};padding-bottom:8px;margin-top:24px}
.meta{display:flex;justify-content:space-between;font-size:12px;color:#6B7280;margin:14px 0}
ul{background:#F7F7FB;border-radius:8px;padding:14px 28px}li{margin:4px 0;font-size:14px}
.note{background:#EAF3DE;border-radius:8px;padding:10px 14px;font-size:13px;color:#065F46;margin:14px 0}
.sig{margin-top:36px;font-size:13px}
.lh-foot{margin-top:40px;background:${LH.bg};color:rgba(255,255,255,.85);padding:14px 40px;font-size:11px}
@media print{body{margin:0}}</style></head><body>
<div class="lh-head"><div class="lh-l"><div class="lh-badge">${esc(LH.badge)}</div><div><div class="lh-ey">${esc(LH.eyebrow)}</div><div class="lh-nm">${esc(LH.name)}</div></div></div><div class="lh-r">${esc(LH.addr)}<br>CIN: ${esc(LH.cin)} · GSTIN: ${esc(LH.gstin)}</div></div>
<div class="lh-accent"></div>
<div class="wrap">
<h1>${esc(title)}</h1>
<div class="meta"><span>Date: ${fmt(new Date().toISOString().slice(0, 10))}</span><span>Ref: ${esc(ref)}</span></div>
${paragraphsToHtml(paragraphs, { transfer_details: `<ul>${rows.join('')}</ul>` })}
</div>
<div class="lh-foot">Registered Office: ${esc(LH.addr)}, India · CIN: ${esc(LH.cin)} · GSTIN: ${esc(LH.gstin)} · ${esc(LH.eyebrow)}<br>This correspondence is confidential and intended solely for the named addressee.</div>
</body></html>`
}

export async function POST(req: NextRequest) {
  const denied = await requireTransferEditor(req)
  if (denied) return denied
  try {
    const { transfer_id } = await req.json()
    if (!transfer_id) return NextResponse.json({ error: 'transfer_id required' }, { status: 400 })
    const { data: tr } = await supa.from('employee_transfer').select('id').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const letterUrl = `/api/transfer/generate-letter?id=${transfer_id}`
    await supa.from('employee_transfer').update({ letter_url: letterUrl, letter_generated_at: new Date().toISOString() }).eq('id', transfer_id)
    return NextResponse.json({ ok: true, letter_url: letterUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const html = await buildLetterHtml(id)
  if (!html) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
