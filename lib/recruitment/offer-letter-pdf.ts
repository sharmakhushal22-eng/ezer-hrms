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
import { jobState, monthsOf, type Dossier } from './offer-dossier'
import { specOf, isApprenticeship, isFeesKind, SCHEMES, APPRENTICE_MIN_STIPEND, stipendBandFor, engagementEnd, type LetterKind } from './engagement'

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
  .replace(/[^\x20-\x7E\xA0-\xFF‘’“”•…\n]/g, '?').trim()

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

// ── The words ────────────────────────────────────────────────────────────────────────────
//
// Everything a letter says, as data, so the drawing code below is the same for all six kinds.

type Item = [string, string]
type Text = {
  subject: string
  opening: string
  items: Item[]
  closing: string
  /** Annexure A: the labelled facts above the break-up table, then the notes under it */
  annexA: { title: string; kv: [string, any][]; notes: string[] }
  annexB: { title: string; sub: string; items: Item[] }
  acceptance: string
  /** signature lines in the acceptance block */
  signLines: string[]
}

type Facts = {
  kind: LetterKind; name: string; first: string; role: string; companyName: string; companyShort: string
  dept: string | null; location: string | null; reportsTo: string | null; mentor: string | null; workMode: string | null
  start: any; months: number | null; end: string | null
  ctc: number; variable: number; vPct: number
  monthly: number; tdsPct: number; net: number; govShare: number; bandLabel: string | null; bandMin: number
  probation: number; notice: number; noticeDays: number | null
  registration: string | null; trade: string | null; qualification: string | null; institute: string | null
  salaryExtras: [string, number | string][]
}

const period = (f: Facts) => f.months ? `${f.months} month${f.months === 1 ? '' : 's'}` : 'the period communicated to you'
const spanText = (f: Facts) => f.months && f.end ? `commencing on ${day(f.start)} and ending on ${day(f.end)} (${period(f)})` : `commencing on ${day(f.start)} for ${period(f)}`
const tdsText = (f: Facts, noun: string) => f.tdsPct > 0 ? `, subject to deduction of tax at source at ${f.tdsPct}%${isFeesKind(f.kind) ? ' under section 194J of the Income-tax Act, 1961' : ' as applicable'}` : `; tax, where applicable, will be deducted at source on the ${noun}`
const where = (f: Facts) => `${f.dept ? `, in the ${f.dept} department` : ''}${f.location ? `, at ${f.location}` : ''}`
const guide = (f: Facts) => f.mentor || f.reportsTo

function words(f: Facts): Text {
  const C = f.companyName
  const common = {
    conditions: `This offer is subject to satisfactory verification of your background, references and the documents you have provided, submission of the original documents listed by the Company on or before the commencement date, and the accuracy of the information you have given. If any information is found to be incorrect or incomplete, the Company may withdraw this offer or end the engagement.`,
    validity: `This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail.`,
    confidentiality: `You will keep confidential all information about the Company, its group companies, customers, suppliers, employees and business that you receive or create during the engagement, and will not use or disclose it, during or after the engagement, for any purpose other than the work assigned to you.`,
    ip: `All work product, inventions, designs, code, documents, data and other material you create in the course of the engagement, and all intellectual property in them, belong to the Company absolutely from the moment of creation; you assign to the Company any rights that may vest in you and will sign what is needed to give effect to this.`,
    property: `All property, documents, data, access credentials and equipment given to you remain the Company's property and must be returned on the last day of the engagement or earlier on request.`,
    conduct: `You will abide by the Company's code of conduct, policies on prevention of sexual harassment, information security and data protection, and its rules in force from time to time at the place where you are engaged.`,
    law: `This letter is governed by the laws of India. Courts at ${f.location || 'the Company\'s registered office'} have jurisdiction.`,
  }

  switch (f.kind) {
    case 'INTERNSHIP': return {
      subject: `Internship Offer — ${f.role}`,
      opening: `With reference to your application and the discussions you had with us, we are pleased to offer you an internship with ${C} (the "Company") as ${f.role}${where(f)}, on the terms set out in this letter and its annexures. This internship is a structured learning engagement; it does not create an employer-employee relationship between you and the Company.`,
      items: [
        ['Internship period', `Your internship is ${spanText(f)}. It may be extended only by written agreement, and may end earlier under clause 6 below.`],
        ['Stipend', `You will receive a consolidated stipend of ${money(f.monthly)} per month${tdsText(f, 'stipend')}, paid monthly in arrears for the period you are engaged. The stipend is a training allowance, not a salary: no provident fund, ESIC, gratuity, bonus or other statutory benefit of employment applies. The stipend details are in Annexure A.`],
        ['Mentor & work', `You will work under the guidance of ${guide(f) || 'the mentor assigned to you'}, who will set your learning objectives, assign your project work and review your progress. Your work may be reassigned as business and learning needs require.`],
        ['Hours & conduct', `You will observe the Company's working hours, weekly offs and holidays applicable at your location${f.workMode ? ` (work mode: ${f.workMode})` : ''}, and its code of conduct. Leave during the internship is as per the Company's internship policy and at the discretion of your mentor.`],
        ['Completion', `On satisfactory completion of the full internship period you will receive an internship certificate from the Company. This offer does not promise or imply employment with the Company on completion; any such offer, if made, will be separate and at the Company's sole discretion.`],
        ['Early termination', `Either party may end the internship by giving ${f.noticeDays ?? 7} days' written notice. The Company may end it immediately for misconduct, breach of these terms, unsatisfactory attendance or performance, or if any information you provided is found to be false. The stipend is payable up to the last day of the internship.`],
        ['Conditions of offer', common.conditions],
        ['Validity', common.validity],
      ],
      closing: `We look forward to having you learn and contribute at ${C}, and wish you a rewarding internship.`,
      annexA: {
        title: 'ANNEXURE A — STIPEND DETAILS',
        kv: [['Name', f.name], ['Internship role', f.role], ['Department', f.dept], ['Location', f.location], ['Mentor', guide(f)], ['Commences on', day(f.start)], ['Ends on', f.end ? day(f.end) : null], ['Period', f.months ? period(f) : null],
          ['Monthly stipend', money(f.monthly)], ['TDS', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Not applicable'], ['Net monthly payable', money(f.net)], ['Total stipend for the period', f.months ? money(f.monthly * f.months) : null]],
        notes: [
          'The stipend is a fixed training allowance paid for the period of the internship. It is not wages or salary, and no PF, ESIC, gratuity, bonus, leave encashment or other statutory benefit of employment applies.',
          'Income tax, where applicable, is deducted at source. The tax treatment of a stipend depends on your own facts; please consult your tax advisor.',
          'The stipend is paid monthly in arrears, by bank transfer to the account you register with the Company, for the days you are engaged.',
        ],
      },
      annexB: { title: 'ANNEXURE B — TERMS OF THE INTERNSHIP', sub: 'These terms form part of your internship offer', items: [
        ['Nature of engagement', 'You are engaged as an intern for training and learning. Nothing in this letter makes you an employee of the Company, and you will not claim employment, wages, or any benefit available to employees, during or after the internship.'],
        ['Confidentiality', common.confidentiality],
        ['Intellectual property', common.ip],
        ['Attendance & conduct', `You will attend regularly for the agreed hours, keep your mentor informed of your work, and follow the Company's policies and instructions. ${common.conduct}`],
        ['Other engagements', 'You may continue your studies. You will not take up any engagement with a competitor of the Company, or any work that conflicts with your internship, during its period.'],
        ['Company property & systems', `${common.property} You will use the Company's systems only for your assigned work and in line with its information security policy.`],
        ['Certificate', 'An internship certificate is issued only on satisfactory completion of the full period and return of all Company property. No certificate is issued for an internship ended early for cause.'],
        ['Governing law', common.law],
      ] },
      acceptance: `I, ${f.name}, have read and understood this internship offer and its annexures, and I accept the internship as ${f.role} at ${C} on the terms stated. I understand that this is an internship and not an offer of employment, and that I will commence on ${day(f.start)}.`,
      signLines: ['Signature', 'Date', 'Place'],
    }

    case 'NATS': case 'NAPS': {
      const S = SCHEMES[f.kind]
      const nats = f.kind === 'NATS'
      const cat = nats ? (f.bandLabel && /diploma/i.test(f.bandLabel) ? 'Technician (Diploma) Apprentice' : 'Graduate Apprentice') : `Trade Apprentice${f.trade ? ` — ${f.trade}` : ''}`
      return {
        subject: nats ? `Offer of Apprenticeship Training under the National Apprenticeship Training Scheme — ${f.role}` : `Offer of Apprenticeship under the National Apprenticeship Promotion Scheme — ${f.trade || f.role}`,
        opening: nats
          ? `Pursuant to your application on the NATS portal and the selection process, ${C} (the "Company") is pleased to offer you a place as a ${cat} in ${f.role}${where(f)}, under the ${S.act} and the ${S.name} administered by the ${S.authority}. This is an offer of apprenticeship training under the Act; it is not an offer of employment.`
          : `Pursuant to your application on the apprenticeship portal and the selection process, ${C} (the "Company") is pleased to engage you as a ${cat}${f.role && f.role !== f.trade ? ` (${f.role})` : ''}${where(f)}, under the ${S.act} and the ${S.name} of the ${S.authority}. This is an offer of apprenticeship training under the Act; it is not an offer of employment.`,
        items: [
          ['Contract of Apprenticeship', `Your training is governed by a Contract of Apprenticeship to be executed between you${f.kind === 'NAPS' ? ' (and your guardian, if you are a minor)' : ''} and the Company and registered on the ${S.short} portal (${S.portal})${nats ? '' : ' within 30 days of its execution'}${f.registration ? `. Registration / enrolment no.: ${f.registration}` : ''}. Your Aadhaar, a bank account seeded to it and the e-KYC on the portal are required before training begins, as the Government's share of the stipend is paid to you directly.`],
          ['Period of training', `Your apprenticeship is ${spanText(f)}${nats ? ', as per the training schedule approved for your discipline' : ', comprising basic training and on-the-job training as per the curriculum for the trade'}. Where your attendance falls short of what the Rules require, the period is extended to make up the shortfall, as provided in the Act.`],
          ['Stipend', `You will be paid a stipend of ${money(f.monthly)} per month${f.bandMin && f.monthly >= f.bandMin ? `, which is not below the minimum of ${money(f.bandMin)} prescribed for a ${(f.bandLabel || '').toLowerCase()} under Rule 11 of the ${S.rules}` : ''}${tdsText(f, 'stipend')}. Under the ${S.short}, ${S.govShare}; where admissible this share is credited directly to your Aadhaar-seeded bank account by Direct Benefit Transfer, and the Company pays the balance, so that you receive the stipend in full. The stipend is not wages: no provident fund, ESIC, gratuity or bonus applies. Details are in Annexure A.`],
          ['Training & supervision', `You will be trained under ${guide(f) || 'the training supervisor assigned to you'} as per the ${nats ? 'approved training programme' : 'curriculum for the trade'}, and your progress will be assessed periodically. Your hours of training follow the working hours of the establishment as permitted by the ${S.rules}; you will not be required to train overtime except with the approval of the Apprenticeship Adviser. Attendance records will be maintained and reported on the portal.`],
          ['Leave & holidays', `You are entitled to leave and holidays as provided under the ${S.rules} and the Company's practice for apprentices, as recorded in your Contract of Apprenticeship.`],
          ['Status, completion & certificate', `Under section 18 of the ${S.act} you are an apprentice and not a worker or employee of the Company, and the labour laws (other than the health and safety provisions of the Factories Act, 1948) do not apply to you. Under section 22, the Company is under no obligation to offer you employment on completion, nor are you bound to accept any such offer, unless otherwise agreed in the Contract. On successful completion and the prescribed final assessment you will receive the ${S.certificate}.`],
          ['Termination of the contract', `The Contract of Apprenticeship may be terminated as provided in section 7 of the Act: by mutual consent through the Apprenticeship Adviser, or on application by either party for failure to carry out the terms of the contract, with such consequences as the Act and Rules provide.`],
          ['Conditions of offer', `${common.conditions} The documents include your educational certificates, Aadhaar, PAN${nats ? ', NATS enrolment ID' : ', apprenticeship registration ID'}, bank details and a certificate of medical fitness.`],
          ['Validity', `This offer is valid for 7 days from the date of this letter. Please confirm your acceptance by signing the acceptance in Annexure B and returning a copy to us, or by replying to the offer e-mail; the Contract of Apprenticeship will then be executed and registered.`],
        ],
        closing: `We look forward to training you at ${C} and wish you a successful apprenticeship.`,
        annexA: {
          title: 'ANNEXURE A — STIPEND DETAILS',
          kv: [['Name', f.name], ['Scheme', S.name], ['Category', cat], ...(f.trade ? [['Trade', f.trade] as [string, any]] : []), ['Qualification', f.qualification], ...(nats && f.institute ? [['Institute', f.institute] as [string, any]] : []),
            ['Department', f.dept], ['Training location', f.location], ['Training supervisor', guide(f)], ['Registration no.', f.registration],
            ['Commences on', day(f.start)], ['Ends on', f.end ? day(f.end) : null], ['Period', f.months ? period(f) : null],
            ['Monthly stipend', money(f.monthly)], ['Prescribed minimum', f.bandMin ? `${money(f.bandMin)} (${(f.bandLabel || '').toLowerCase()})` : null],
            ['Government share (by DBT, where admissible)', f.govShare ? `${money(f.govShare)} per month` : null], ['Company share', f.govShare ? `${money(Math.max(0, f.monthly - f.govShare))} per month` : money(f.monthly)],
            ['TDS', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Not applicable'], ['Net monthly payable', money(f.net)], ['Total stipend for the period', f.months ? money(f.monthly * f.months) : null]],
          notes: [
            `The minimum stipend is prescribed under Rule 11 of the ${S.rules} as amended by ${APPRENTICE_MIN_STIPEND.notification}, with an increase of ${APPRENTICE_MIN_STIPEND.yearlyIncrease}. The Company's stipend will never be below the prescribed minimum.`,
            `Under the ${S.short}, ${S.govShare}. It is credited to the apprentice's Aadhaar-seeded bank account by Direct Benefit Transfer where admissible; the Company pays the balance. Should the Government's share not be received for any period, the Company pays the full stipend.`,
            'An apprentice is not a worker (s.18, Apprentices Act, 1961): no provident fund, ESIC, gratuity, bonus or other benefit of employment applies to the stipend.',
            'Income tax, where applicable, is deducted at source. Please consult your tax advisor on the treatment of the stipend.',
          ],
        },
        annexB: { title: 'ANNEXURE B — TERMS OF THE APPRENTICESHIP', sub: `These terms form part of your offer and of the Contract of Apprenticeship under the ${S.act}`, items: [
          ['Obligations of the apprentice', 'You will learn your trade or subject field conscientiously and diligently, attend training regularly, carry out all lawful instructions of the Company and the persons placed in authority over you, and fulfil the obligations under the Act, the Rules and the Contract (section 12 of the Act).'],
          ['Obligations of the Company', `The Company will impart training in accordance with the ${nats ? 'approved programme' : 'curriculum for the trade'}, make suitable arrangements for your training, pay the stipend set out in Annexure A, and carry out its obligations under the Act, the Rules and the Contract (section 11 of the Act).`],
          ['Nature of engagement', 'You are an apprentice undergoing training. Nothing in this letter or the Contract makes you an employee of the Company, and you will not claim employment, wages, or any benefit available to employees, during or after the apprenticeship.'],
          ['Attendance & conduct', `You will keep the hours of training fixed for you, record your attendance as required, and follow the Company's rules of discipline for apprentices. ${common.conduct}`],
          ['Health & safety', 'The health and safety provisions of the Factories Act, 1948 and the Company\'s safety rules apply to you. You will use the protective equipment provided and follow all safety instructions.'],
          ['Confidentiality', common.confidentiality],
          ['Intellectual property', common.ip],
          ['Company property', common.property],
          ['Absence & extension', 'Absence beyond the leave permitted under the Rules extends the period of training to make up the shortfall. Unauthorised absence may lead to termination of the Contract under section 7 of the Act.'],
          ['Governing law', `The ${S.act}, the ${S.rules} and the laws of India govern this letter and the Contract. Disputes under the Contract are referred to the Apprenticeship Adviser as the Act provides.`],
        ] },
        acceptance: `I, ${f.name}, have read and understood this offer of apprenticeship training and its annexures, and I accept the apprenticeship as ${cat} at ${C} under the ${S.act} on the terms stated. I understand that this is apprenticeship training and not an offer of employment, that I must complete my registration and e-KYC on the ${S.short} portal, and that my training will commence on ${day(f.start)}.`,
        signLines: ['Signature of apprentice', 'Guardian (if a minor)', 'Date & place'],
      }
    }

    case 'CONTRACT': case 'CONSULTANT': {
      // A consultant's engagement is open-ended unless the file records a period.
      const fixed = f.kind === 'CONTRACT' || !!f.months
      const who = f.kind === 'CONTRACT' ? 'contractor' : 'consultant'
      return {
        subject: f.kind === 'CONTRACT' ? `Fixed-Term Contract Engagement — ${f.role}` : `Consulting Engagement — ${f.role}`,
        opening: `Further to our discussions, ${C} (the "Company") is pleased to engage you as an independent ${who} to provide services as ${f.role}${where(f)}${fixed && f.kind !== 'CONTRACT' ? ` for a term of ${period(f)}` : ''}, on the terms set out in this letter and its annexures. This is a contract for services; it does not create an employer-employee relationship, partnership or agency between you and the Company.`,
        items: [
          ['Term', fixed
            ? `The engagement is ${spanText(f)}. It ends automatically on the end date unless renewed by written agreement; neither party is under any obligation to renew, and no expectation of renewal or of employment arises from this engagement.`
            : `The engagement commences on ${day(f.start)} and continues until ended by either party under clause 6 below.`],
          ['Services & reporting', `You will provide the services of ${f.role}${f.dept ? ` to the ${f.dept} function` : ''} with due skill, care and diligence, to the standard the Company reasonably requires, and will coordinate your work with ${f.reportsTo || 'the manager the Company designates'}. You decide how the services are performed within the Company's requirements, timelines and site rules.`],
          ['Fees', `The Company will pay you professional fees of ${money(f.monthly)} per month against your monthly invoice${tdsText(f, 'fees')}. Where you are registered under GST, GST is payable over and above the fees on a valid tax invoice. Fees are paid within 15 days of receipt of a correct invoice, by bank transfer. The fee details are in Annexure A. No other payment, allowance, reimbursement or benefit is payable unless agreed in writing.`],
          ['Independent status', `You are responsible for your own income tax, GST and other statutory dues. As an independent ${who} you are not entitled to provident fund, ESIC, gratuity, bonus, leave, insurance or any other benefit the Company provides to its employees, and the Company's employment policies do not apply to you except its rules on conduct, safety, confidentiality and information security while on its premises or systems.`],
          ['Exclusivity & conflicts', `During the engagement you will not provide services to a competitor of the Company or take up any engagement that conflicts with, or impairs your availability for, the services, without the Company's written consent.`],
          ['Termination', `Either party may end the engagement by giving ${f.noticeDays ?? 30} days' written notice. The Company may end it immediately for breach of these terms, misconduct, failure to provide the services to the required standard, or if any information you provided is found to be false. Fees are payable pro rata up to the last day of the engagement, against your final invoice.`],
          ['Conditions of engagement', `${common.conditions} The documents include your PAN, GST registration (if any), bank details, address proof and identity proof.`],
          ['Validity', common.validity],
        ],
        closing: `We look forward to working with you.`,
        annexA: {
          title: 'ANNEXURE A — FEE DETAILS',
          kv: [['Name', f.name], ['Services', f.role], ['Function', f.dept], ['Location', f.location], ['Coordinates with', f.reportsTo], ['Commences on', day(f.start)], ...(fixed ? [['Ends on', f.end ? day(f.end) : null] as [string, any], ['Term', f.months ? period(f) : null] as [string, any]] : []),
            ['Monthly fees', money(f.monthly)], ['TDS (s.194J)', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Nil at source'], ['Net monthly payable', money(f.net)], ...(fixed && f.months ? [['Total fees for the term', money(f.monthly * f.months)] as [string, any]] : []), ['GST', 'As applicable, over and above, on a valid tax invoice'], ['Payment terms', 'Within 15 days of a correct monthly invoice, by bank transfer']],
          notes: [
            'Fees are for services rendered and are not salary or wages. No provident fund, ESIC, gratuity, bonus, leave encashment or any other employee benefit applies.',
            'Tax is deducted at source under section 194J of the Income-tax Act, 1961 at the applicable rate and a TDS certificate is issued. You are responsible for your own income tax and GST compliance.',
            'Each invoice must carry your PAN (and GSTIN, where registered), the period of service and the fees for that period.',
          ],
        },
        annexB: { title: 'ANNEXURE B — TERMS OF ENGAGEMENT', sub: 'These terms form part of your engagement', items: [
          ['Standard of services', 'You will provide the services personally, with the skill, care and diligence of a competent professional, in line with the Company\'s reasonable requirements, timelines and applicable law, and will promptly correct any deficiency the Company points out.'],
          ['Confidentiality', common.confidentiality],
          ['Intellectual property', `${common.ip} You warrant that your work product will not infringe any third party's rights.`],
          ['Data protection', 'You will process personal data you receive only as instructed by the Company, keep it secure, and return or delete it at the end of the engagement, in line with the Digital Personal Data Protection Act, 2023 and the Company\'s policies.'],
          ['Conduct on premises & systems', common.conduct],
          ['Non-solicitation', 'For 12 months after the engagement ends you will not solicit for employment or engagement any employee of the Company with whom you worked, nor solicit the Company\'s customers for a competing business.'],
          ['Company property', common.property],
          ['Indemnity', 'You will indemnify the Company against loss arising from your breach of these terms, your negligence or wilful misconduct, or any claim that you are an employee of the Company.'],
          ['No authority', 'You have no authority to bind the Company or hold yourself out as its employee or agent.'],
          ['Governing law', common.law],
        ] },
        acceptance: `I, ${f.name}, have read and understood this engagement letter and its annexures, and I accept the engagement as an independent ${who} to provide services as ${f.role} to ${C} on the terms stated. I understand that this is a contract for services and not employment, and that my engagement commences on ${day(f.start)}.`,
        signLines: ['Signature', 'Date', 'Place'],
      }
    }

    default: return {   // EMPLOYMENT
      subject: `Offer of Employment — ${f.role}`,
      opening: `With reference to your application and the subsequent discussions and interviews you had with us, we are pleased to offer you the position of ${f.role} at ${C} (the "Company")${f.dept ? `, in the ${f.dept} department` : ''}${f.location ? `, based at ${f.location}` : ''}, on the terms and conditions set out in this letter and its annexures.`,
      items: [
        ['Date of joining', `You are requested to join on or before ${day(f.start)}. If you are unable to join on this date, please inform us in advance; the Company may revise or withdraw this offer if you do not join on the agreed date.`],
        ['Compensation', `Your total annual Cost to Company (CTC) will be ${money(f.ctc)}${f.variable ? `, comprising a fixed component of ${money(f.ctc - f.variable)} and a variable component of ${money(f.variable)} (${f.vPct}% of CTC) payable as per the Company's performance policy` : ''}. The detailed salary break-up is given in Annexure A. Your compensation is confidential and must not be disclosed.`],
        ...(f.reportsTo ? [['Reporting', `You will report to ${f.reportsTo}, or to such other person as the Company may designate from time to time.`] as Item] : []),
        ['Probation', `You will be on probation for a period of ${f.probation} days from your date of joining. On satisfactory completion, your employment will be confirmed in writing. The Company may extend the probation period at its discretion.`],
        ['Notice period', `After confirmation, either party may terminate the employment by giving ${f.notice} days' written notice or salary in lieu thereof. During probation, the notice period will be as per Company policy.`],
        ['Conditions of offer', `This offer is subject to satisfactory background and reference verification, submission of the original documents listed by the Company on or before your date of joining, and the accuracy of the information you have provided. If any information is found to be incorrect, the Company may withdraw this offer or terminate your employment.`],
        ['Validity', common.validity],
      ],
      closing: `We look forward to welcoming you to ${C} and wish you a long and rewarding career with us.`,
      annexA: {
        title: 'ANNEXURE A — COMPENSATION DETAILS',
        kv: [['Name', f.name], ['Position', f.role], ['Department', f.dept], ['Location', f.location], ['Date of joining', day(f.start)],
          ['Total annual CTC', money(f.ctc)], ['Fixed CTC (annual)', money(f.ctc - f.variable)], ...(f.variable ? [['Variable (annual)', `${money(f.variable)} (${f.vPct}%)`] as [string, any]] : [])],
        notes: [
          'Income tax will be deducted at source as per the Income Tax Act, 1961 and the regime you opt for.',
          'Statutory contributions (PF / ESIC) are made as per the applicable laws; the employer contribution forms part of your CTC.',
          f.variable ? 'The variable component is linked to individual and Company performance and is paid as per the Company\'s policy.' : '',
          'The Company may restructure the components of your salary from time to time without reducing your total CTC.',
        ].filter(Boolean),
      },
      annexB: { title: 'ANNEXURE B — TERMS & CONDITIONS', sub: 'These terms form part of your offer of employment', items: [
        ['Working hours', `Your working hours, weekly off and attendance will be as per the Company's policy applicable to your location and function${f.workMode ? ` (work mode: ${f.workMode})` : ''}.`],
        ['Leave', 'You will be entitled to leave as per the Company\'s leave policy, as amended from time to time.'],
        ['Transfer', 'Your services may be transferred to any department, location, group company or associate company of the Company, as business requires.'],
        ['Confidentiality', 'You will keep confidential all information about the Company, its customers, employees and business, during and after your employment, and will not use it for any purpose other than your work.'],
        ['Exclusive service', 'You will devote your full time to the Company and will not take up any other employment, business or engagement, paid or unpaid, without the Company\'s written consent.'],
        ['Company property', 'All property, documents, data and equipment given to you remain the Company\'s property and must be returned on separation.'],
        ['Code of conduct', 'You will abide by the Company\'s code of conduct, policies and rules in force from time to time.'],
        ['Termination', 'The Company may terminate your employment without notice for misconduct, breach of these terms, or if any information provided by you is found to be false.'],
        ['Governing law', 'This offer and your employment are governed by the laws of India.'],
      ] },
      acceptance: `I, ${f.name}, have read and understood this offer letter and its annexures, and I accept the offer of employment as ${f.role} at ${C} on the terms and conditions stated. I confirm that I will join on ${day(f.start)}.`,
      signLines: ['Signature', 'Date', 'Place'],
    }
  }
}

/** Build the letter for this engagement. Returns the finished PDF. */
export async function offerLetterPdf(dossier: Dossier): Promise<{ name: string; content: Buffer }> {
  const { request: req, candidate: cand, company, mrf, negotiation: neg, ctx } = dossier
  const kind = dossier.kind
  const spec = specOf(kind)
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
  const T = words(f)
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
    d.moveDown(1.6)
    const yS = d.y, col = W / T.signLines.length
    T.signLines.forEach((l, i) => {
      d.moveTo(x0 + i * col, yS).lineTo(x0 + i * col + col - 18, yS).lineWidth(0.6).strokeColor(INK).stroke()
      d.font('Helvetica').fontSize(9).fillColor(MUTED).text(clean(l), x0 + i * col, yS + 4, { width: col - 18 })
    })

    d.end()
  })

  const fileName = `${spec.fileStem}-${String(name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Candidate'}.pdf`

  // Final pass with pdf-lib: every content page onto the uploaded letterhead (when there is
  // one), and "Page x of y" just under the content area.
  const out = await LibDoc.create()
  const fgDoc = await LibDoc.load(content)
  const fgs = await out.embedPdf(fgDoc, fgDoc.getPageIndices())
  const bg = lh.pdf ? (await out.embedPdf(await LibDoc.load(lh.pdf), [0]))[0] : null
  const font = await out.embedFont(StandardFonts.Helvetica)
  // pdf-lib's standard fonts throw on characters outside WinAnsi (e.g. a name in Devanagari).
  const winAnsi = (t: string) => t.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
  const label = (i: number) => winAnsi(clean(`${name} - ${spec.title} | Page ${i + 1} of ${fgs.length}`))
  fgs.forEach((fg, i) => {
    const p = out.addPage(lh.size)
    if (bg) p.drawPage(bg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    p.drawPage(fg, { x: 0, y: 0, width: lh.size[0], height: lh.size[1] })
    const t = label(i), size = 7.5
    p.drawText(t, { x: (lh.size[0] - font.widthOfTextAtSize(t, size)) / 2, y: M.bottom - 14, size, font, color: rgb(0.42, 0.45, 0.5) })
  })
  out.setTitle(docTitle); out.setAuthor(companyName)
  return { name: fileName, content: Buffer.from(await out.save()) }
}
