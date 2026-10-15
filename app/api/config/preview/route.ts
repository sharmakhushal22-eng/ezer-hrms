// app/api/config/preview/route.ts — preview a template with SAMPLE data.
//
//   POST { key, company_id, location_id, subject, body }
//     email / notification → { subject, text, html, unknown }
//     letter               → the PDF:
//                            • an offer letter (six engagements) exactly as offer-letter-pdf.ts
//                              draws it — on the chosen company's real letterhead and signatory
//                            • an HR letter or other letter on a plain page
//
// Uses the text in the request — the editor's unsaved text — and fictional sample values, so
// no real candidate or employee data is read and a preview can be shown to anyone who may view
// the template.
import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { canViewScope, configActor } from '@/lib/config/access'
import { getDefinition, isUuid, renderResolvedEmail } from '@/lib/config/store'
import { sampleVars } from '@/lib/config/registry'
import { renderText, stripMarkup } from '@/lib/config/render'
import { OFFER_LETTER_KEY } from '@/lib/config/offer-letter'
import { offerLetterPreviewPdf } from '@/lib/recruitment/offer-letter-pdf'
import { renderLetterPreviewPdf } from '@/lib/letters/previewPdf'
import type { LetterKind } from '@/lib/recruitment/engagement'

export const runtime = 'nodejs'

const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })
const KIND_BY_KEY = Object.fromEntries(Object.entries(OFFER_LETTER_KEY).map(([k, v]) => [v, k])) as Record<string, LetterKind>

export async function POST(req: NextRequest) {
  const gate = await configActor(req, 'VIEW')
  if (gate.error) return gate.error

  const b = await req.json().catch(() => null) as { key?: string; company_id?: string | null; location_id?: string | null; subject?: unknown; body?: unknown } | null
  if (!b?.key) return bad('key is required')
  let company: string | null = b.company_id ? (isUuid(b.company_id) ? b.company_id : 'x') : null
  if (company === 'x') return bad('Invalid company')
  if (b.location_id && isUuid(b.location_id)) {
    const { data: loc } = await sb.from('locations').select('company_id').eq('id', b.location_id).maybeSingle()
    company = (loc as { company_id: string | null } | null)?.company_id || company
  }
  if (!canViewScope(gate.actor, company)) return bad('That company is outside your access.', 403)

  const def = await getDefinition(String(b.key))
  if (!def) return bad('Unknown template', 404)
  const subject = String(b.subject ?? def.defaults.subject).slice(0, 300)
  const body = String(b.body ?? def.defaults.body).slice(0, 40000)

  // The company being previewed names itself in the sample, so its letterhead shows.
  const { data: co } = company ? await sb.from('companies').select('*').eq('id', company).maybeSingle() : { data: null }
  const vars: Record<string, string> = sampleVars(def)
  if ((co as any)?.company_name && 'company_name' in vars) vars.company_name = (co as any).company_name

  // Block variables (a facts table, a list of steps) preview as their sample text.
  const blockSamples = Object.fromEntries(def.variables.filter(x => x.block).map(x => [x.name, x.sample]))
  const known = { ...vars, ...blockSamples }

  if (def.channel === 'EMAIL' || def.channel === 'NOTIFICATION') {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const blocks = Object.fromEntries(Object.entries(blockSamples).map(([k, s]) => [k, { text: s, html: `<div>${esc(s).replace(/\n/g, '<br>')}</div>` }]))
    const r = renderResolvedEmail({ key: def.key, subject, body, source: 'DEFAULT', version: 0 }, vars, blocks)
    const unknown = [...new Set([...renderText(subject, known).unknown, ...renderText(body, known).unknown])]
    return NextResponse.json({ subject: r.subject, text: r.text, html: r.html, unknown })
  }

  let pdf: Uint8Array | Buffer
  try {
    if (def.letterLayout === 'offer' && KIND_BY_KEY[def.key]) {
      // The real letter: letterhead, Annexure A table, salary break-up, signatory — sample facts.
      pdf = (await offerLetterPreviewPdf(KIND_BY_KEY[def.key], { subject, body }, co)).content
    } else {
      pdf = await renderLetterPreviewPdf(renderText(subject, known).text, stripMarkup(renderText(body, known).text))
    }
  } catch (e: any) {
    return bad(`Could not build the preview: ${e?.message || 'failed'}`, 500)
  }
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
}
