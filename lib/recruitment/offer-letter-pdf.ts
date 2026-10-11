// lib/recruitment/offer-letter-pdf.ts — SERVER ONLY.
//
// The offer letter the HR Manager generates on Send Offers, on the letterhead of the company
// the candidate is hired into. Three parts, as many pages as they need:
//   1. the offer letter — position, joining, compensation, probation, notice, conditions, validity
//   2. Annexure A — the salary break-up (the same statement the candidate accepted on the link)
//   3. Annexure B — terms & conditions and the candidate's acceptance block
//
// Letterhead: the uploaded one (Letters → Letterhead) at COMPANY scope, else GROUP scope —
// every page is drawn on top of it. With none uploaded, the company's built-in design from
// lib/letterheads.tsx is drawn instead. The content is laid out with pdfkit inside safe
// margins, then stamped onto the letterhead with pdf-lib.
//
// Helvetica: "Rs." instead of the rupee glyph, which the core fonts lack.

import PDFDocument from 'pdfkit'
import { PDFDocument as LibDoc, StandardFonts, rgb } from 'pdf-lib'
import { rmsServiceClient as sb } from '@/lib/rms/server'
import { resolveLetterhead } from '@/lib/letterheads'
import { jobState, type Dossier } from './offer-dossier'

type Doc = PDFKit.PDFDocument
const MM = 2.834645669
const A4: [number, number] = [595.28, 841.89]
// The configured margins on the uploaded letterheads do not match their artwork (one says
// 0 mm at the top over a 50 mm header), so these floors keep text off the header and footer.
const MIN_TOP_MM = 55, MIN_BOTTOM_MM = 35, MIN_SIDE_MM = 20

const INK = '#1F2937', MUTED = '#6B7280', LINE = '#D1D5DB', HEAD_BG = '#F3F4F6'
const money = (n: any) => `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
// The core fonts only carry WinAnsi; anything else (a name in Devanagari, say) would print as
// garbage and break line widths, so it becomes "?" instead.
const clean = (s: any) => String(s ?? '').replace(/₹\s?/g, 'Rs. ').replace(/[−–—]/g, '-')
  .replace(/[^\x20-\x7E\xA0-\xFF\u2018\u2019\u201C\u201D\u2022\u2026\n]/g, '?').trim()

type Letterhead = { pdf: Uint8Array | null; size: [number, number]; margins: { top: number; bottom: number; left: number; right: number }; builtin: ReturnType<typeof resolveLetterhead> | null }
type Signatory = { name: string; designation: string; image: Buffer | null }

async function resolveScope(table: 'letterhead_files' | 'letterhead_signatories', companyId: string | null, groupId: string | null) {
  for (const [scope, key] of [['COMPANY', companyId], ['GROUP', groupId]] as const) {
    if (!key) continue
    const { data } = await sb.from(table).select('*').eq('scope_type', scope).eq('scope_key', key).eq('is_active', true).maybeSingle()
    if (data) return data as any
  }
  return null
}

async function loadLetterhead(company: any): Promise<Letterhead> {
  const row = await resolveScope('letterhead_files', company?.id || null, company?.group_id || null)
  if (row?.file_url) {
    const { data: blob } = await sb.storage.from('letterhead-files').download(row.file_url)
    if (blob) {
      const pdf = new Uint8Array(await blob.arrayBuffer())
      const p0 = (await LibDoc.load(pdf)).getPage(0)
      const mm = (v: any, floor: number) => Math.max(Number(v) || 0, floor) * MM
      return {
        pdf, size: [p0.getWidth(), p0.getHeight()], builtin: null,
        margins: { top: mm(row.content_top_mm, MIN_TOP_MM), bottom: mm(row.content_bottom_mm, MIN_BOTTOM_MM), left: mm(row.content_left_mm, MIN_SIDE_MM), right: mm(row.content_right_mm, MIN_SIDE_MM) },
      }
    }
  }
  // No upload: draw the company's built-in letterhead ourselves.
  return { pdf: null, size: A4, builtin: resolveLetterhead(company?.company_code || company?.company_name), margins: { top: 46 * MM, bottom: 30 * MM, left: MIN_SIDE_MM * MM, right: MIN_SIDE_MM * MM } }
}

async function loadSignatory(company: any): Promise<Signatory> {
  const row = await resolveScope('letterhead_signatories', company?.id || null, company?.group_id || null)
  let image: Buffer | null = null
  if (row?.signature_url) {
    const { data: blob } = await sb.storage.from('letterhead-signatures').download(row.signature_url)
    if (blob) {
      const b = Buffer.from(await blob.arrayBuffer())
      // pdfkit takes PNG and JPEG only
      if (b.subarray(0, 4).toString('hex') === '89504e47' || b.subarray(0, 2).toString('hex') === 'ffd8') image = b
    }
  }
  return { name: row?.signatory_name || 'Authorised Signatory', designation: row?.signatory_designation || 'Human Resources', image }
}

/** The built-in letterhead (no upload): coloured band with name/address, footer with registered office. */
function drawBuiltin(d: Doc, lh: NonNullable<Letterhead['builtin']>, company: any) {
  const [w, h] = [d.page.width, d.page.height]
  // Drawing in the margins must not trigger pdfkit's auto page-break, and the cursor must be
  // back at the top margin afterwards for the content that follows.
  // pdfkit's save()/restore() do not restore its own font/size/colour state, and a paragraph
  // that wraps onto this new page carries on with whatever is current — so put them back too.
  const st = d as any
  const { x: cx, y: cy } = d, mb = d.page.margins.bottom
  const font0 = st._font, size0 = st._fontSize, fill0 = st._fillColor
  d.page.margins.bottom = 0
  d.save()
  d.rect(0, 0, w, 34 * MM).fill(lh.headerBg)
  d.fillColor(lh.headerText).font('Helvetica-Bold').fontSize(18).text(company?.company_name || lh.name, 20 * MM, 11 * MM, { width: w * 0.55, lineBreak: false })
  d.font('Helvetica').fontSize(8).fillColor('#E5E7EB').text(lh.eyebrow, 20 * MM, 20 * MM, { width: w * 0.55, lineBreak: false })
  d.fontSize(7.5).fillColor('#E5E7EB')
  lh.addr.forEach((line, i) => d.text(clean(line), w - 20 * MM - 200, 8 * MM + i * 10, { width: 200, align: 'right', lineBreak: false }))
  d.fontSize(7).fillColor(MUTED).text(`CIN: ${company?.cin || lh.cin}    GSTIN: ${company?.gstin || lh.gstin}    PAN: ${company?.pan || lh.pan}`, 20 * MM, 38 * MM, { width: w - 40 * MM, lineBreak: false })
  d.moveTo(20 * MM, 42 * MM).lineTo(w - 20 * MM, 42 * MM).lineWidth(0.6).strokeColor(lh.accent).stroke()
  d.rect(0, h - 18 * MM, w, 18 * MM).fill(lh.headerBg)
  d.fontSize(7).fillColor('#E5E7EB').text(clean(company?.reg_office ? `Registered Office: ${company.reg_office}` : lh.footerRegistered), 20 * MM, h - 12 * MM, { width: w - 40 * MM, align: 'center', lineBreak: false })
  d.fontSize(6.5).fillColor(MUTED).text(clean(lh.confidential), 20 * MM, h - 22 * MM, { width: w - 40 * MM, align: 'center', lineBreak: false })
  d.restore()
  d.page.margins.bottom = mb; d.x = cx; d.y = cy
  st._font = font0; if (font0) st.font(font0.name); if (size0) d.fontSize(size0); if (fill0) d.fillColor(...(fill0 as [any, any]))
}

/** Build the offer letter. Returns the finished PDF. */
export async function offerLetterPdf(dossier: Dossier): Promise<{ name: string; content: Buffer }> {
  const { request: req, candidate: cand, company, mrf, negotiation: neg, ctx } = dossier
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const M = lh.margins

  const name = String(cand.full_name || '').replace(/\s+/g, ' ').trim() || 'Candidate'
  const first = String(name).split(' ')[0]
  const role = cand.designation || mrf?.designation || mrf?.position || 'the position'
  const companyName = company?.company_name || 'the Company'
  const baseLocation = ctx.ad?.requisition?.job_location || ctx.loc?.location_name || null
  const state = jobState(ctx)
  const location = baseLocation && state && !baseLocation.toLowerCase().includes(state.toLowerCase()) ? `${baseLocation}, ${state}` : (baseLocation || state)
  const dept = ctx.dept?.dept_name || null
  const reportsTo = ctx.manager?.full_name ? `${ctx.manager.full_name}${mrf?.reports_to_designation ? `, ${mrf.reports_to_designation}` : ''}` : (mrf?.reports_to_designation || null)
  const address = ctx.ad?.contact?.permanent_address || ctx.ad?.contact?.current_city || null
  const isStipend = !!neg?.is_stipend
  const ctc = Number(req.offered_ctc || 0)
  const vPct = Number(req.offered_variable_pct ?? neg?.variable_pct ?? 0)
  const variable = !isStipend && vPct > 0 ? Math.round(ctc * vPct / 100) : 0
  const probation = Number(company?.probation_days) > 0 ? Number(company.probation_days) : 180
  const notice = Number(company?.notice_period_days) > 0 ? Number(company.notice_period_days) : 30
  const today = new Date()
  const ref = `${company?.company_code || 'HR'}/OFFER/${today.getFullYear()}/${String(req.id).slice(0, 6).toUpperCase()}`

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: `Offer of Employment — ${name}`, Author: companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right
    const x0 = M.left
    const bottom = () => d.page.height - M.bottom

    const para = (t: string, opts: PDFKit.Mixins.TextOptions = {}) => { d.font('Helvetica').fontSize(9.6).fillColor(INK).text(clean(t), x0, d.y, { width: W, align: 'justify', lineGap: 1.8, ...opts }); d.moveDown(0.45) }
    const heading = (t: string) => { ensure(40); d.moveDown(0.3); d.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t, x0, d.y, { width: W }); d.moveDown(0.25) }
    const ensure = (h: number) => { if (d.y + h > bottom()) d.addPage() }
    const numbered = (items: [string, string][]) => items.forEach(([h, t], i) => {
      ensure(42)
      const y = d.y
      d.font('Helvetica-Bold').fontSize(9.6).fillColor(INK).text(`${i + 1}.`, x0, y, { width: 16 })
      d.font('Helvetica-Bold').text(`${h}: `, x0 + 16, y, { width: W - 16, continued: true }).font('Helvetica').text(clean(t), { align: 'justify', lineGap: 1.8 })
      d.moveDown(0.35)
    })
    const annexTitle = (t: string, sub: string) => {
      d.addPage()
      d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(t, x0, d.y, { width: W, align: 'center' })
      d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clean(sub), { width: W, align: 'center' })
      d.moveDown(0.9)
    }
    const kv = (rows: [string, any][]) => rows.filter(([, v]) => v != null && v !== '').forEach(([k, v]) => {
      ensure(18); const y = d.y
      d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(k, x0, y, { width: 170 })
      d.font('Helvetica-Bold').fillColor(INK).text(clean(v), x0 + 175, y, { width: W - 175 })
      d.y = Math.max(d.y, y + 15)
    })

    // ── 1. the letter ──
    d.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    const yTop = d.y
    d.text(`Ref: ${ref}`, x0, yTop, { width: W / 2 })
    d.text(`Date: ${day(today)}`, x0 + W / 2, yTop, { width: W / 2, align: 'right' })
    d.moveDown(0.8)
    d.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(clean(name), x0, d.y, { width: W })
    d.font('Helvetica').fontSize(9.5).fillColor(INK)
    if (address) d.text(clean(address), { width: W * 0.6 })
    if (cand.email) d.text(clean(cand.email))
    if (cand.mobile || cand.phone) d.text(clean(cand.mobile || cand.phone))
    d.moveDown(0.7)
    d.font('Helvetica-Bold').fontSize(10.5).text(clean(`Subject: Offer of Employment — ${role}`), x0, d.y, { width: W, underline: true })
    d.moveDown(0.6)
    para(`Dear ${first},`)
    para(`With reference to your application and the subsequent discussions and interviews you had with us, we are pleased to offer you the position of ${role} at ${companyName} (the "Company")${dept ? `, in the ${dept} department` : ''}${location ? `, based at ${location}` : ''}, on the terms and conditions set out in this letter and its annexures.`)
    numbered([
      ['Date of joining', `You are requested to join on or before ${day(req.proposed_doj)}. If you are unable to join on this date, please inform us in advance; the Company may revise or withdraw this offer if you do not join on the agreed date.`],
      ['Compensation', isStipend
        ? `You will be paid a stipend of ${money(neg?.stipend_monthly)} per month, subject to deduction of tax at source as applicable. Details are given in Annexure A.`
        : `Your total annual Cost to Company (CTC) will be ${money(ctc)}${variable ? `, comprising a fixed component of ${money(ctc - variable)} and a variable component of ${money(variable)} (${vPct}% of CTC) payable as per the Company's performance policy` : ''}. The detailed salary break-up is given in Annexure A. Your compensation is confidential and must not be disclosed.`],
      ...(reportsTo ? [['Reporting', `You will report to ${reportsTo}, or to such other person as the Company may designate from time to time.`] as [string, string]] : []),
      ['Probation', `You will be on probation for a period of ${probation} days from your date of joining. On satisfactory completion, your employment will be confirmed in writing. The Company may extend the probation period at its discretion.`],
      ['Notice period', `After confirmation, either party may terminate the employment by giving ${notice} days' written notice or salary in lieu thereof. During probation, the notice period will be as per Company policy.`],
      ['Conditions of offer', `This offer is subject to satisfactory background and reference verification, submission of the original documents listed by the Company on or before your date of joining, and the accuracy of the information you have provided. If any information is found to be incorrect, the Company may withdraw this offer or terminate your employment.`],
      ['Validity', `This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail.`],
    ])
    ensure(118)   // the closing line stays with the signature (2 lines + "For …" + signature + name)
    para(`We look forward to welcoming you to ${companyName} and wish you a long and rewarding career with us.`)
    d.moveDown(0.2)
    d.font('Helvetica').fontSize(10).fillColor(INK).text(`For ${clean(companyName)}`, x0, d.y)
    d.moveDown(0.3)
    if (sig.image) { try { d.image(sig.image, x0, d.y, { fit: [120, 44] }); d.y += 48 } catch { d.moveDown(2.2) } } else d.moveDown(2.2)
    d.font('Helvetica-Bold').fontSize(10).text(clean(sig.name), x0, d.y)
    d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clean(sig.designation))

    // ── 2. Annexure A — salary break-up ──
    annexTitle('ANNEXURE A — COMPENSATION DETAILS', `${name} · ${role} · ${companyName}`)
    kv([
      ['Name', name], ['Position', role], ['Department', dept], ['Location', location],
      ['Date of joining', day(req.proposed_doj)],
      ...(isStipend
        ? [['Monthly stipend', money(neg?.stipend_monthly)], ['Annual stipend', money(Number(neg?.stipend_monthly || 0) * 12)], ['TDS', neg?.tds_applicable ? `${neg.tds_pct}%` : 'Not applicable'], ['Net monthly', money(neg?.net_monthly)]] as [string, any][]
        : [['Total annual CTC', money(ctc)], ['Fixed CTC (annual)', money(ctc - variable)], ...(variable ? [['Variable (annual)', `${money(variable)} (${vPct}%)`]] : [])] as [string, any][]),
    ])
    d.moveDown(0.6)
    const sal = dossier.salary
    if (sal) {
      const cols = [W * 0.36, W * 0.30, W * 0.17, W * 0.17]
      const row = (cells: string[], o: { bold?: boolean; fill?: string } = {}) => {
        ensure(19); const y = d.y
        if (o.fill) d.rect(x0, y, W, 18).fill(o.fill)
        let x = x0
        cells.forEach((c, i) => {
          d.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8).fillColor(INK)
            .text(clean(c), x + 5, y + 5, { width: cols[i] - 10, align: i >= 2 ? 'right' : 'left', lineBreak: false, ellipsis: true })
          x += cols[i]
        })
        d.moveTo(x0, y + 18).lineTo(x0 + W, y + 18).lineWidth(0.4).strokeColor(LINE).stroke()
        d.y = y + 18
      }
      row(['Component', 'Basis', 'Monthly', 'Annual'], { bold: true, fill: HEAD_BG })
      for (const r of sal.rows) {
        if (r.kind === 'head') { row([r.label, '', '', ''], { bold: true, fill: HEAD_BG }); continue }
        const strong = ['sum', 'total', 'net'].includes(r.kind)
        row([r.label, r.basis || '', r.monthly != null ? money(r.monthly) : '', r.annual != null ? money(r.annual) : ''], { bold: strong })
      }
      d.moveDown(0.6)
    }
    if (sal?.extras.length) { heading('One-time payments & benefits'); kv(sal.extras.map(([k, v]) => [k, typeof v === 'number' ? money(v) : v])) ; d.moveDown(0.4) }
    heading('Notes')
    ;[
      'Income tax will be deducted at source as per the Income Tax Act, 1961 and the regime you opt for.',
      'Statutory contributions (PF / ESIC) are made as per the applicable laws; the employer contribution forms part of your CTC.',
      variable ? 'The variable component is linked to individual and Company performance and is paid as per the Company\'s policy.' : '',
      'The Company may restructure the components of your salary from time to time without reducing your total CTC.',
    ].filter(Boolean).forEach(t => { ensure(16); d.font('Helvetica').fontSize(9).fillColor(INK).text(`•  ${clean(t)}`, x0, d.y, { width: W, lineGap: 2 }); d.moveDown(0.25) })

    // ── 3. Annexure B — terms & acceptance ──
    annexTitle('ANNEXURE B — TERMS & CONDITIONS', 'These terms form part of your offer of employment')
    numbered([
      ['Working hours', `Your working hours, weekly off and attendance will be as per the Company's policy applicable to your location and function${mrf?.work_mode ? ` (work mode: ${mrf.work_mode})` : ''}.`],
      ['Leave', 'You will be entitled to leave as per the Company\'s leave policy, as amended from time to time.'],
      ['Transfer', 'Your services may be transferred to any department, location, group company or associate company of the Company, as business requires.'],
      ['Confidentiality', 'You will keep confidential all information about the Company, its customers, employees and business, during and after your employment, and will not use it for any purpose other than your work.'],
      ['Exclusive service', 'You will devote your full time to the Company and will not take up any other employment, business or engagement, paid or unpaid, without the Company\'s written consent.'],
      ['Company property', 'All property, documents, data and equipment given to you remain the Company\'s property and must be returned on separation.'],
      ['Code of conduct', 'You will abide by the Company\'s code of conduct, policies and rules in force from time to time.'],
      ['Termination', 'The Company may terminate your employment without notice for misconduct, breach of these terms, or if any information provided by you is found to be false.'],
      ['Governing law', 'This offer and your employment are governed by the laws of India.'],
    ])
    ensure(170)
    d.moveDown(0.6)
    d.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('ACCEPTANCE', x0, d.y, { width: W, align: 'center' })
    d.moveDown(0.5)
    para(`I, ${name}, have read and understood this offer letter and its annexures, and I accept the offer of employment as ${role} at ${companyName} on the terms and conditions stated. I confirm that I will join on ${day(req.proposed_doj)}.`)
    d.moveDown(1.6)
    const yS = d.y, col = W / 3
    ;['Signature', 'Date', 'Place'].forEach((l, i) => {
      d.moveTo(x0 + i * col, yS).lineTo(x0 + i * col + col - 18, yS).lineWidth(0.6).strokeColor(INK).stroke()
      d.font('Helvetica').fontSize(9).fillColor(MUTED).text(l, x0 + i * col, yS + 4, { width: col - 18 })
    })

    d.end()
  })

  const fileName = `Offer-Letter-${String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Candidate'}.pdf`

  // Final pass with pdf-lib: every content page onto the uploaded letterhead (when there is
  // one), and "Page x of y" just under the content area.
  const out = await LibDoc.create()
  const fgDoc = await LibDoc.load(content)
  const fgs = await out.embedPdf(fgDoc, fgDoc.getPageIndices())
  const bg = lh.pdf ? (await out.embedPdf(await LibDoc.load(lh.pdf), [0]))[0] : null
  const font = await out.embedFont(StandardFonts.Helvetica)
  // pdf-lib's standard fonts throw on characters outside WinAnsi (e.g. a name in Devanagari).
  const winAnsi = (t: string) => t.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
  const label = (i: number) => winAnsi(clean(`${name} - Offer of Employment | Page ${i + 1} of ${fgs.length}`))
  fgs.forEach((fg, i) => {
    const p = out.addPage(lh.size)
    if (bg) p.drawPage(bg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    p.drawPage(fg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    const t = label(i), size = 7.5
    p.drawText(t, { x: (lh.size[0] - font.widthOfTextAtSize(t, size)) / 2, y: M.bottom - 14, size, font, color: rgb(0.42, 0.45, 0.5) })
  })
  out.setTitle(`Offer of Employment — ${name}`); out.setAuthor(companyName)
  return { name: fileName, content: Buffer.from(await out.save()) }
}
