// lib/recruitment/offer-letter-pdf.ts — SERVER ONLY.
//
// The letter the HR Manager generates on Send Offers, on the letterhead of the company the
// candidate is engaged by. WHICH letter depends on the engagement (lib/recruitment/engagement.ts):
//
//   EMPLOYMENT  Offer of Employment — CTC, probation, notice, PF/ESIC
//   INTERNSHIP  Internship Offer Letter — stipend, fixed period, mentor, certificate, not employment
//   NATS        Offer of Apprenticeship Training — Apprentices Act 1961, BOAT/BOPT, Contract of
//               Apprenticeship on nats.education.gov.in, 50% Government share by DBT, s.18 / s.22
//   NAPS        Offer of Apprenticeship — Apprentices Act 1961, MSDE, contract on
//               apprenticeshipindia.gov.in, 25% Government share by DBT, trade, basic + OJT
//   CONTRACT    Fixed-Term Contract Engagement — fees against invoice, TDS s.194J, no benefits
//   CONSULTANT  Consulting Engagement — the same, open-ended
//
// Three parts, as many pages as they need:
//   1. the letter — position, period, pay, reporting, conditions, validity
//   2. Annexure A — the pay break-up (the same statement the candidate accepted on the link)
//   3. Annexure B — terms & conditions and the acceptance block
//
// Letterhead, margins and the final stamp: lib/letterhead/pdf-letter.ts.

import PDFDocument from 'pdfkit'
import { loadLetterhead, loadSignatory, drawBuiltin, stampOnLetterhead, clean, MM, type Doc } from '@/lib/letterhead/pdf-letter'
import { jobState, monthsOf, type Dossier } from './offer-dossier'
import { specOf, isApprenticeship, stipendBandFor, engagementEnd } from './engagement'
import { letterFromTemplate, sampleFacts, OFFER_LETTER_KEY, type Facts, type LetterText } from '@/lib/config/offer-letter'
import type { StmtRow } from './ctc-statement'
import type { LetterKind } from './engagement'
import { resolveTemplate } from '@/lib/config/store'

const INK = '#1F2937', MUTED = '#6B7280', LINE = '#D1D5DB', HEAD_BG = '#F3F4F6'
const money = (n: any) => `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
// ── The words ────────────────────────────────────────────────────────────────────────────
//
// Every sentence of the six letters is a Configuration template (lib/config/offer-letter.ts,
// built-in text in lib/config/offer-templates.ts), resolved for the offer's branch → company →
// Global. The facts below fill it; the drawing code that follows is the same for all six kinds.

type Item = [string, string]

/** Build the letter for this engagement. Returns the finished PDF. */
/** A box for EZER Sign: 1-based page, fractions of the page from the top-left. */
export interface OfferSignSpot { page: number; x: number; y: number; w: number; h: number; kind: 'SIGNATURE' | 'DATE' }

/** Build the letter for this engagement. Returns the finished PDF. With `forSigning` the
 *  acceptance block leaves room above its first two lines (signature, date) and reports where
 *  they are, so the candidate can e-sign it (lib/recruitment/offer-esign.ts). */
export async function offerLetterPdf(dossier: Dossier, o: { forSigning?: boolean } = {}): Promise<{ name: string; content: Buffer; spots: OfferSignSpot[] }> {
  const { request: req, candidate: cand, company, mrf, negotiation: neg, ctx } = dossier
  const kind = dossier.kind
  const spec = specOf(kind)

  const name = String(cand.full_name || '').replace(/\s+/g, ' ').trim() || 'Candidate'
  const first = String(name).split(' ')[0]
  const role = cand.designation || mrf?.designation || mrf?.position || 'the position'
  const companyName = company?.company_name || 'the Company'
  const baseLocation = ctx.ad?.requisition?.job_location || ctx.loc?.location_name || null
  const state = jobState(ctx)
  const location = baseLocation && state && !baseLocation.toLowerCase().includes(state.toLowerCase()) ? `${baseLocation}, ${state}` : (baseLocation || state)
  const dept = ctx.dept?.dept_name || ctx.ad?.requisition?.department || null
  const reportsTo = ctx.manager?.full_name ? `${ctx.manager.full_name}${mrf?.reports_to_designation ? `, ${mrf.reports_to_designation}` : ''}` : (mrf?.reports_to_designation || null)
  const address = ctx.ad?.contact?.permanent_address || ctx.ad?.contact?.current_city || null
  const ctc = Number(req.offered_ctc || 0)
  const vPct = Number(req.offered_variable_pct ?? neg?.variable_pct ?? 0)
  const variable = kind === 'EMPLOYMENT' && vPct > 0 ? Math.round(ctc * vPct / 100) : 0
  const months = monthsOf(ctx)
  const eng = dossier.engagement
  // A stipend/fees engagement whose negotiation was saved as a CTC still gets its own letter —
  // quoting a twelfth of the annual figure, which the offer file flags as a warning.
  const monthly = eng?.monthly ?? (kind !== 'EMPLOYMENT' ? Math.round(ctc / 12) : 0)
  const tdsPct = eng?.tdsPct ?? 0
  const net = eng?.netMonthly ?? monthly
  const band = isApprenticeship(kind) ? stipendBandFor(kind, ctx.ad?.professional?.qualification) : null
  const today = new Date()
  const ref = `${company?.company_code || 'HR'}/${spec.refSeg}/${today.getFullYear()}/${String(req.id).slice(0, 6).toUpperCase()}`

  const f: Facts = {
    kind, name, first, role, companyName, companyShort: company?.company_code || companyName,
    dept, location, reportsTo, mentor: ctx.ad?.requisition?.mentor || null, workMode: mrf?.work_mode || null,
    start: req.proposed_doj, months, end: engagementEnd(req.proposed_doj, months),
    ctc, variable, vPct,
    monthly, tdsPct, net, govShare: eng?.govShare ?? 0, bandLabel: band?.label || null, bandMin: band?.amount || 0,
    probation: Number(company?.probation_days) > 0 ? Number(company.probation_days) : 180,
    notice: Number(company?.notice_period_days) > 0 ? Number(company.notice_period_days) : 30,
    noticeDays: Number(req.notice_period_days) > 0 ? Number(req.notice_period_days) : null,
    registration: ctx.ad?.requisition?.scheme_registration || null, trade: ctx.ad?.requisition?.trade || null,
    qualification: ctx.ad?.professional?.qualification || null, institute: ctx.ad?.professional?.institute || null,
    salaryExtras: dossier.salary?.extras || [],
  }
  // The wording: this engagement's template for the offer's branch (the MRF's location) and company.
  const tpl = await resolveTemplate(OFFER_LETTER_KEY[kind], { companyId: req.company_id || company?.id || null, locationId: mrf?.location_id || null })
  const T = letterFromTemplate(tpl!, f)
  return drawOfferLetter({ kind, T, company, name, first, role, companyName, address, email: cand.email || null, phone: cand.mobile || cand.phone || null, ref, today, salary: dossier.salary, forSigning: o.forSigning })
}

/**
 * The Configuration preview: this engagement's letter with the text being edited and
 * fictional facts, on the chosen company's real letterhead and signatory.
 */
export async function offerLetterPreviewPdf(kind: LetterKind, template: { subject: string; body: string }, company: any): Promise<{ name: string; content: Buffer }> {
  const s = sampleFacts(kind)
  const f: Facts = {
    ...s,
    companyName: company?.company_name || s.companyName, companyShort: company?.company_code || s.companyShort,
    probation: Number(company?.probation_days) > 0 ? Number(company.probation_days) : s.probation,
    notice: Number(company?.notice_period_days) > 0 ? Number(company.notice_period_days) : s.notice,
  }
  const T = letterFromTemplate(template, f)
  const annual = (m: number) => m * (f.months || 12)
  const salary = kind === 'EMPLOYMENT'
    ? { totalLabel: 'Annual', extras: [] as [string, number | string][], rows: [
        { kind: 'row', label: 'Basic', basis: '50% of fixed', monthly: 67500, annual: 810000 },
        { kind: 'row', label: 'House rent allowance', basis: '50% of basic', monthly: 33750, annual: 405000 },
        { kind: 'row', label: 'Special allowance', basis: 'Balance', monthly: 33750, annual: 405000 },
        { kind: 'total', label: 'Total CTC (sample figures)', monthly: 150000, annual: 1800000 },
      ] as StmtRow[] }
    : { totalLabel: 'For the period', extras: [] as [string, number | string][], rows: [
        { kind: 'row', label: f.kind === 'CONTRACT' || f.kind === 'CONSULTANT' ? 'Professional fees' : 'Stipend', basis: 'Monthly', monthly: f.monthly, annual: annual(f.monthly) },
        { kind: 'net', label: 'Net payable (sample figures)', monthly: f.net, annual: annual(f.net) },
      ] as StmtRow[] }
  return drawOfferLetter({
    kind, T, company, name: f.name, first: f.first, role: f.role, companyName: f.companyName,
    address: 'B-204, Palm Residency, Sector 49, Gurugram', email: 'priya.sharma@example.com', phone: '98XXXXXX10',
    ref: `${f.companyShort}/${specOf(kind).refSeg}/${new Date().getFullYear()}/PREVIEW`, today: new Date(), salary,
  })
}

type DrawInput = {
  kind: LetterKind; T: LetterText; company: any; name: string; first: string; role: string; companyName: string
  address: string | null; email: string | null; phone: string | null; ref: string; today: Date
  salary: Dossier['salary']
  forSigning?: boolean
}

/** Lay the letter out on the company's letterhead. */
async function drawOfferLetter(x: DrawInput): Promise<{ name: string; content: Buffer; spots: OfferSignSpot[] }> {
  const { kind, T, company, name, first, role, companyName, address, ref, today } = x
  const spots: OfferSignSpot[] = []
  const spec = specOf(kind)
  const [lh, sig] = await Promise.all([loadLetterhead(company), loadSignatory(company)])
  const M = lh.margins
  const cand = { email: x.email, mobile: x.phone, phone: null as string | null }
  const dossier = { salary: x.salary }
  const docTitle = `${spec.title} — ${name}`

  const content: Buffer = await new Promise((resolve, reject) => {
    const d = new PDFDocument({ size: lh.size, margins: M, bufferPages: true, pdfVersion: '1.7', info: { Title: docTitle, Author: companyName } })
    const chunks: Buffer[] = []
    d.on('data', (c: Buffer) => chunks.push(c)); d.on('end', () => resolve(Buffer.concat(chunks))); d.on('error', reject)
    if (lh.builtin) { drawBuiltin(d, lh.builtin, company); d.on('pageAdded', () => drawBuiltin(d, lh.builtin!, company)) }
    const W = d.page.width - M.left - M.right
    const x0 = M.left
    const bottom = () => d.page.height - M.bottom

    const para = (t: string, opts: PDFKit.Mixins.TextOptions = {}) => { d.font('Helvetica').fontSize(9.6).fillColor(INK).text(clean(t), x0, d.y, { width: W, align: 'justify', lineGap: 1.8, ...opts }); d.moveDown(0.45) }
    const heading = (t: string) => { ensure(40); d.moveDown(0.3); d.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(t, x0, d.y, { width: W }); d.moveDown(0.25) }
    const ensure = (h: number) => { if (d.y + h > bottom()) d.addPage() }
    const numbered = (items: Item[]) => items.forEach(([h, t], i) => {
      ensure(42)
      const y = d.y
      d.font('Helvetica-Bold').fontSize(9.6).fillColor(INK).text(`${i + 1}.`, x0, y, { width: 16 })
      d.font('Helvetica-Bold').text(`${clean(h)}: `, x0 + 16, y, { width: W - 16, continued: true }).font('Helvetica').text(clean(t), { align: 'justify', lineGap: 1.8 })
      d.moveDown(0.35)
    })
    const annexTitle = (t: string, sub: string) => {
      d.addPage()
      d.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(t, x0, d.y, { width: W, align: 'center' })
      d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clean(sub), { width: W, align: 'center' })
      d.moveDown(0.9)
    }
    // Label and value side by side; the row is as tall as the taller of the two, so a long
    // label ("Government share (by DBT, where admissible)") cannot run into the next row.
    const kv = (rows: [string, any][]) => rows.filter(([, v]) => v != null && v !== '').forEach(([k, v]) => {
      const kw = 190, vw = W - 195
      d.font('Helvetica').fontSize(9.5)
      const hk = d.heightOfString(clean(k), { width: kw })
      d.font('Helvetica-Bold')
      const hv = d.heightOfString(clean(v), { width: vw })
      const h = Math.max(15, hk, hv) + 3
      ensure(h); const y = d.y
      d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clean(k), x0, y, { width: kw })
      d.font('Helvetica-Bold').fillColor(INK).text(clean(v), x0 + 195, y, { width: vw })
      d.y = y + h
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
    d.font('Helvetica-Bold').fontSize(10.5).text(clean(`Subject: ${T.subject}`), x0, d.y, { width: W, underline: true })
    d.moveDown(0.6)
    para(`Dear ${first},`)
    para(T.opening)
    numbered(T.items)
    ensure(118)   // the closing line stays with the signature (2 lines + "For …" + signature + name)
    para(T.closing)
    d.moveDown(0.2)
    d.font('Helvetica').fontSize(10).fillColor(INK).text(`For ${clean(companyName)}`, x0, d.y)
    d.moveDown(0.3)
    if (sig.image) { try { d.image(sig.image, x0, d.y, { fit: [120, 44] }); d.y += 48 } catch { d.moveDown(2.2) } } else d.moveDown(2.2)
    d.font('Helvetica-Bold').fontSize(10).text(clean(sig.name), x0, d.y)
    d.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(clean(sig.designation))

    // ── 2. Annexure A — the break-up ──
    annexTitle(T.annexA.title, `${name} · ${role} · ${companyName}`)
    kv(T.annexA.kv)
    d.moveDown(0.6)
    const sal = dossier.salary
    if (sal) {
      const cols = [W * 0.34, W * 0.32, W * 0.17, W * 0.17]
      // A row grows to fit its longest cell (a basis such as "10% under s.194J of the
      // Income-tax Act, 1961" wraps), so rows never print over each other.
      const row = (cells: string[], o: { bold?: boolean; fill?: string } = {}) => {
        d.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8)
        const h = Math.max(18, ...cells.map((c, i) => d.heightOfString(clean(c) || ' ', { width: cols[i] - 10 }) + 9))
        ensure(h + 1); const y = d.y
        if (o.fill) d.rect(x0, y, W, h).fill(o.fill)
        let x = x0
        cells.forEach((c, i) => {
          d.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8).fillColor(INK)
            .text(clean(c), x + 5, y + 5, { width: cols[i] - 10, align: i >= 2 ? 'right' : 'left' })
          x += cols[i]
        })
        d.moveTo(x0, y + h).lineTo(x0 + W, y + h).lineWidth(0.4).strokeColor(LINE).stroke()
        d.y = y + h
      }
      row(['Component', 'Basis', 'Monthly', sal.totalLabel || 'Annual'], { bold: true, fill: HEAD_BG })
      for (const r of sal.rows) {
        if (r.kind === 'head') { row([r.label, '', '', ''], { bold: true, fill: HEAD_BG }); continue }
        const strong = ['sum', 'total', 'net'].includes(r.kind)
        row([r.label, r.basis || '', r.monthly != null ? money(r.monthly) : '', r.annual != null ? money(r.annual) : ''], { bold: strong })
      }
      d.moveDown(0.6)
    }
    if (sal?.extras.length) { heading('One-time payments & benefits'); kv(sal.extras.map(([k, v]) => [k, typeof v === 'number' ? money(v) : v])); d.moveDown(0.4) }
    heading('Notes')
    T.annexA.notes.forEach(t => { ensure(16); d.font('Helvetica').fontSize(9).fillColor(INK).text(`•  ${clean(t)}`, x0, d.y, { width: W, lineGap: 2 }); d.moveDown(0.25) })

    // ── 3. Annexure B — terms & acceptance ──
    annexTitle(T.annexB.title, T.annexB.sub)
    numbered(T.annexB.items)
    ensure(170)
    d.moveDown(0.6)
    d.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('ACCEPTANCE', x0, d.y, { width: W, align: 'center' })
    d.moveDown(0.5)
    para(T.acceptance)
    d.moveDown(x.forSigning ? 4.6 : 1.6)
    const yS = d.y, col = W / T.signLines.length
    if (x.forSigning) {
      const page = d.bufferedPageRange().start + d.bufferedPageRange().count, pw = d.page.width, ph = d.page.height
      spots.push({ page, kind: 'SIGNATURE', x: x0 / pw, y: (yS - 50) / ph, w: (col - 18) / pw, h: 48 / ph })
      if (T.signLines.length > 1) spots.push({ page, kind: 'DATE', x: (x0 + col) / pw, y: (yS - 16) / ph, w: (col - 18) / pw, h: 14 / ph })
    }
    T.signLines.forEach((l, i) => {
      d.moveTo(x0 + i * col, yS).lineTo(x0 + i * col + col - 18, yS).lineWidth(0.6).strokeColor(INK).stroke()
      d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(l), x0 + i * col, yS + 4, { width: col - 18 })
    })

    d.end()
  })

  const fileName = `${spec.fileStem}-${String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Candidate'}.pdf`

  // Final pass with pdf-lib: every content page onto the uploaded letterhead (when there is
  // one), and "Page x of y" just under the content area.
  return { name: fileName, content: await stampOnLetterhead(content, lh, { title: docTitle, author: companyName, label: (i, n) => `${name} - ${spec.title} | Page ${i + 1} of ${n}` }), spots }
}
