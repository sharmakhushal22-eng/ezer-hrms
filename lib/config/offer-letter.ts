// lib/config/offer-letter.ts — the six offer letters as Configuration templates.
//
// Pure (no database, no React). lib/recruitment/offer-letter-pdf.ts draws the letter; this
// file decides its WORDS, from the template for the engagement (Employment, Internship,
// NATS, NAPS, Contract, Consultant — lib/recruitment/engagement.ts) resolved for the
// offer's company and branch.
//
// A letter template is ordinary template text (lib/config/render.ts) laid out like this:
//
//   Opening paragraph(s)…
//
//   [Clause heading] Clause text…            ← every paragraph starting with [..] is a
//   [Next clause] …                             numbered clause; numbers are automatic
//
//   Closing paragraph(s)…
//
//   --- Annexure A notes ---
//   One note per line (bulleted under the break-up table)
//
//   --- Annexure B terms ---
//   [Term heading] Term text…
//
//   --- Acceptance ---
//   The acceptance paragraph the candidate signs
//
// What stays in code, because it is data rather than wording: the letterhead, the reference
// number and date, the Annexure A table of figures (name, period, stipend, TDS …), the
// salary break-up, the annexure titles and the signature lines.
//
// Unit-tested in lib/config/__tests__/offer-letter.test.ts against the wording the letters
// had before they were templates.

import { isFeesKind, SCHEMES, APPRENTICE_MIN_STIPEND, type LetterKind } from '../recruitment/engagement.ts'
import { renderText } from './render.ts'

export type Item = [string, string]

/** The letter as offer-letter-pdf.ts lays it out. */
export type LetterText = {
  subject: string
  opening: string
  items: Item[]
  closing: string
  annexA: { title: string; kv: [string, any][]; notes: string[] }
  annexB: { title: string; sub: string; items: Item[] }
  acceptance: string
  signLines: string[]
}

/** Every fact the letter can state — built by offer-letter-pdf.ts from the offer file. */
export type Facts = {
  kind: LetterKind; name: string; first: string; role: string; companyName: string; companyShort: string
  dept: string | null; location: string | null; reportsTo: string | null; mentor: string | null; workMode: string | null
  start: any; months: number | null; end: string | null
  ctc: number; variable: number; vPct: number
  monthly: number; tdsPct: number; net: number; govShare: number; bandLabel: string | null; bandMin: number
  probation: number; notice: number; noticeDays: number | null
  registration: string | null; trade: string | null; qualification: string | null; institute: string | null
  salaryExtras: [string, number | string][]
}

export const OFFER_LETTER_KEY: Record<LetterKind, string> = {
  EMPLOYMENT: 'offer_letter.employment',
  INTERNSHIP: 'offer_letter.internship',
  NATS: 'offer_letter.nats',
  NAPS: 'offer_letter.naps',
  CONTRACT: 'offer_letter.contract',
  CONSULTANT: 'offer_letter.consultant',
}

const money = (n: any) => `Rs. ${Math.round(Number(n || 0)).toLocaleString('en-IN')}`
const day = (v: any) => v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'
const period = (f: Facts) => f.months ? `${f.months} month${f.months === 1 ? '' : 's'}` : 'the period communicated to you'
const spanText = (f: Facts) => f.months && f.end ? `commencing on ${day(f.start)} and ending on ${day(f.end)} (${period(f)})` : `commencing on ${day(f.start)} for ${period(f)}`
const tdsText = (f: Facts, noun: string) => f.tdsPct > 0 ? `, subject to deduction of tax at source at ${f.tdsPct}%${isFeesKind(f.kind) ? ' under section 194J of the Income-tax Act, 1961' : ' as applicable'}` : `; tax, where applicable, will be deducted at source on the ${noun}`
const guideOf = (f: Facts) => f.mentor || f.reportsTo
const isFixed = (f: Facts) => f.kind === 'CONTRACT' || !!f.months
const categoryOf = (f: Facts) => f.kind === 'NATS'
  ? (f.bandLabel && /diploma/i.test(f.bandLabel) ? 'Technician (Diploma) Apprentice' : 'Graduate Apprentice')
  : `Trade Apprentice${f.trade ? ` — ${f.trade}` : ''}`

/** The values a letter template can use. Empty string = "not applicable", so
 *  {{#if name}}…{{/if}} blocks drop out cleanly. */
export function offerLetterVars(f: Facts): Record<string, string> {
  const appr = f.kind === 'NATS' || f.kind === 'NAPS'
  const S = appr ? SCHEMES[f.kind as 'NATS' | 'NAPS'] : null
  const noun = isFeesKind(f.kind) ? 'fees' : 'stipend'
  const guide = guideOf(f)
  return {
    name: f.name, first_name: f.first, role: f.role,
    company_name: f.companyName, company_short: f.companyShort,
    department: f.dept || '', location: f.location || '', reports_to: f.reportsTo || '',
    mentor: f.mentor || '', work_mode: f.workMode || '',
    guide: guide || (appr ? 'the training supervisor assigned to you' : 'the mentor assigned to you'),
    coordinator: f.reportsTo || 'the manager the Company designates',
    start_date: day(f.start), end_date: f.end ? day(f.end) : '',
    months: f.months ? String(f.months) : '', period: period(f), span: spanText(f),
    fixed_term: isFixed(f) ? 'yes' : '', open_ended: isFixed(f) ? '' : 'yes',
    ctc: money(f.ctc), fixed: money(f.ctc - f.variable), variable: f.variable ? money(f.variable) : '', variable_pct: String(f.vPct),
    monthly: money(f.monthly), net_monthly: money(f.net), tds_pct: f.tdsPct > 0 ? String(f.tdsPct) : '',
    tds_clause: tdsText(f, noun),
    probation_days: String(f.probation),
    notice_days: String(f.kind === 'EMPLOYMENT' ? f.notice : (f.noticeDays ?? (f.kind === 'INTERNSHIP' ? 7 : 30))),
    jurisdiction: f.location || 'the Company\'s registered office',
    // apprenticeship
    category: appr ? categoryOf(f) : '',
    trade: f.trade || '', trade_or_role: f.trade || f.role,
    role_suffix: f.role && f.role !== f.trade ? ` (${f.role})` : '',
    registration: f.registration || '', qualification: f.qualification || '', institute: f.institute || '',
    scheme_name: S?.name || '', scheme_short: S?.short || '', scheme_act: S?.act || '', scheme_rules: S?.rules || '',
    scheme_authority: S?.authority || '', scheme_portal: S?.portal || '', scheme_gov_share: S?.govShare || '', scheme_certificate: S?.certificate || '',
    minimum_stipend_clause: S && f.bandMin && f.monthly >= f.bandMin
      ? `, which is not below the minimum of ${money(f.bandMin)} prescribed for a ${(f.bandLabel || '').toLowerCase()} under Rule 11 of the ${S.rules}` : '',
    stipend_notification: APPRENTICE_MIN_STIPEND.notification,
    stipend_yearly_increase: APPRENTICE_MIN_STIPEND.yearlyIncrease,
  }
}

/** The parts that are data, not wording — exactly as the letters had them. */
function fixedParts(f: Facts): Pick<LetterText, 'signLines'> & { annexA: { title: string; kv: [string, any][] }; annexB: { title: string; sub: string } } {
  const guide = guideOf(f)
  switch (f.kind) {
    case 'INTERNSHIP': return {
      annexA: { title: 'ANNEXURE A — STIPEND DETAILS', kv: [['Name', f.name], ['Internship role', f.role], ['Department', f.dept], ['Location', f.location], ['Mentor', guide], ['Commences on', day(f.start)], ['Ends on', f.end ? day(f.end) : null], ['Period', f.months ? period(f) : null],
        ['Monthly stipend', money(f.monthly)], ['TDS', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Not applicable'], ['Net monthly payable', money(f.net)], ['Total stipend for the period', f.months ? money(f.monthly * f.months) : null]] },
      annexB: { title: 'ANNEXURE B — TERMS OF THE INTERNSHIP', sub: 'These terms form part of your internship offer' },
      signLines: ['Signature', 'Date', 'Place'],
    }
    case 'NATS': case 'NAPS': {
      const S = SCHEMES[f.kind]
      const nats = f.kind === 'NATS'
      const cat = categoryOf(f)
      return {
        annexA: { title: 'ANNEXURE A — STIPEND DETAILS', kv: [['Name', f.name], ['Scheme', S.name], ['Category', cat], ...(f.trade ? [['Trade', f.trade] as [string, any]] : []), ['Qualification', f.qualification], ...(nats && f.institute ? [['Institute', f.institute] as [string, any]] : []),
          ['Department', f.dept], ['Training location', f.location], ['Training supervisor', guide], ['Registration no.', f.registration],
          ['Commences on', day(f.start)], ['Ends on', f.end ? day(f.end) : null], ['Period', f.months ? period(f) : null],
          ['Monthly stipend', money(f.monthly)], ['Prescribed minimum', f.bandMin ? `${money(f.bandMin)} (${(f.bandLabel || '').toLowerCase()})` : null],
          ['Government share (by DBT, where admissible)', f.govShare ? `${money(f.govShare)} per month` : null], ['Company share', f.govShare ? `${money(Math.max(0, f.monthly - f.govShare))} per month` : money(f.monthly)],
          ['TDS', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Not applicable'], ['Net monthly payable', money(f.net)], ['Total stipend for the period', f.months ? money(f.monthly * f.months) : null]] },
        annexB: { title: 'ANNEXURE B — TERMS OF THE APPRENTICESHIP', sub: `These terms form part of your offer and of the Contract of Apprenticeship under the ${S.act}` },
        signLines: ['Signature of apprentice', 'Guardian (if a minor)', 'Date & place'],
      }
    }
    case 'CONTRACT': case 'CONSULTANT': {
      const fixed = isFixed(f)
      return {
        annexA: { title: 'ANNEXURE A — FEE DETAILS', kv: [['Name', f.name], ['Services', f.role], ['Function', f.dept], ['Location', f.location], ['Coordinates with', f.reportsTo], ['Commences on', day(f.start)], ...(fixed ? [['Ends on', f.end ? day(f.end) : null] as [string, any], ['Term', f.months ? period(f) : null] as [string, any]] : []),
          ['Monthly fees', money(f.monthly)], ['TDS (s.194J)', f.tdsPct > 0 ? `${f.tdsPct}%` : 'Nil at source'], ['Net monthly payable', money(f.net)], ...(fixed && f.months ? [['Total fees for the term', money(f.monthly * f.months)] as [string, any]] : []), ['GST', 'As applicable, over and above, on a valid tax invoice'], ['Payment terms', 'Within 15 days of a correct monthly invoice, by bank transfer']] },
        annexB: { title: 'ANNEXURE B — TERMS OF ENGAGEMENT', sub: 'These terms form part of your engagement' },
        signLines: ['Signature', 'Date', 'Place'],
      }
    }
    default: return {
      annexA: { title: 'ANNEXURE A — COMPENSATION DETAILS', kv: [['Name', f.name], ['Position', f.role], ['Department', f.dept], ['Location', f.location], ['Date of joining', day(f.start)],
        ['Total annual CTC', money(f.ctc)], ['Fixed CTC (annual)', money(f.ctc - f.variable)], ...(f.variable ? [['Variable (annual)', `${money(f.variable)} (${f.vPct}%)`] as [string, any]] : [])] },
      annexB: { title: 'ANNEXURE B — TERMS & CONDITIONS', sub: 'These terms form part of your offer of employment' },
      signLines: ['Signature', 'Date', 'Place'],
    }
  }
}

// ── Parsing a rendered letter template ───────────────────────────────────────

const SECTION = /^-{3,}\s*(.+?)\s*-{3,}$/
const CLAUSE = /^\[([^\]\n]+)\]\s*([\s\S]*)$/

export type LetterSections = { main: string; notes: string; terms: string; acceptance: string }

/** Split template text into its four parts by the "--- … ---" marker lines. */
export function splitSections(text: string): LetterSections {
  const out: LetterSections = { main: '', notes: '', terms: '', acceptance: '' }
  let cur: keyof LetterSections = 'main'
  const buf: Record<keyof LetterSections, string[]> = { main: [], notes: [], terms: [], acceptance: [] }
  for (const line of text.split('\n')) {
    const m = line.trim().match(SECTION)
    if (m) {
      const n = m[1].toLowerCase()
      cur = n.includes('acceptance') ? 'acceptance' : n.includes('annexure b') || n.includes('terms') ? 'terms' : n.includes('note') || n.includes('annexure a') ? 'notes' : cur
      continue
    }
    buf[cur].push(line)
  }
  for (const k of Object.keys(buf) as (keyof LetterSections)[]) out[k] = buf[k].join('\n').trim()
  return out
}

const paragraphs = (s: string) => s.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)

/** Paragraphs → opening, numbered clauses, closing. */
export function parseClauses(s: string): { opening: string; items: Item[]; closing: string } {
  const opening: string[] = [], items: Item[] = []
  let pending: string[] = []
  for (const p of paragraphs(s)) {
    const m = p.match(CLAUSE)
    if (m) {
      // A plain paragraph between two clauses belongs to the clause before it.
      if (pending.length && items.length) items[items.length - 1][1] += '\n\n' + pending.join('\n\n')
      pending = []
      items.push([m[1].trim(), m[2].trim()])
    } else if (!items.length) opening.push(p)
    else pending.push(p)
  }
  // Plain paragraphs after the last clause are the closing.
  return { opening: opening.join('\n\n'), items, closing: pending.join('\n\n') }
}

/** Structure problems a letter template must not have (shown in Configuration). */
export function validateLetterStructure(body: string): string[] {
  const s = splitSections(body)
  const errors: string[] = []
  if (!parseClauses(s.main).items.length) errors.push('The letter needs at least one numbered clause — a paragraph that starts with [Heading].')
  if (!s.acceptance) errors.push('Add the acceptance paragraph under a line "--- Acceptance ---".')
  return errors
}

/** Render a letter template for these facts into the structure the PDF lays out. */
export function letterFromTemplate(tpl: { subject: string; body: string }, f: Facts): LetterText {
  const vars = offerLetterVars(f)
  const fill = (t: string) => renderText(t, vars).text
  const sec = splitSections(tpl.body)
  const main = parseClauses(fill(sec.main))
  // A clause whose text rendered empty (its {{#if}} was false) is left out.
  main.items = main.items.filter(([, t]) => t.trim() !== '')
  const fixed = fixedParts(f)
  return {
    subject: fill(tpl.subject).replace(/\s*\n\s*/g, ' '),
    opening: main.opening,
    items: main.items,
    closing: main.closing,
    annexA: { ...fixed.annexA, notes: fill(sec.notes).split('\n').map(l => l.trim()).filter(Boolean) },
    annexB: { ...fixed.annexB, items: parseClauses(fill(sec.terms)).items.filter(([, t]) => t.trim() !== '') },
    acceptance: fill(sec.acceptance),
    signLines: fixed.signLines,
  }
}

/** Sample facts for the Configuration preview — fictional. */
export function sampleFacts(kind: LetterKind): Facts {
  const fees = isFeesKind(kind), appr = kind === 'NATS' || kind === 'NAPS'
  const months = kind === 'EMPLOYMENT' || kind === 'CONSULTANT' ? null : kind === 'INTERNSHIP' ? 6 : 12
  return {
    kind, name: 'Priya Sharma', first: 'Priya', role: appr ? 'Mechanical Engineering' : kind === 'INTERNSHIP' ? 'Marketing Intern' : fees ? 'Data Analytics' : 'Senior Sales Manager',
    companyName: 'Sharma Retail Solutions Pvt Ltd', companyShort: 'SRS',
    dept: 'Sales', location: 'Gurugram, Haryana', reportsTo: 'Anita Verma, Head of Sales', mentor: kind === 'INTERNSHIP' ? 'Rahul Nair' : null, workMode: 'Office',
    start: '2026-11-01', months, end: months ? new Date(new Date('2026-11-01').setMonth(10 + months)).toISOString().slice(0, 10) : null,
    ctc: 1800000, variable: kind === 'EMPLOYMENT' ? 180000 : 0, vPct: kind === 'EMPLOYMENT' ? 10 : 0,
    monthly: kind === 'EMPLOYMENT' ? 0 : appr ? 13000 : fees ? 90000 : 20000, tdsPct: fees ? 10 : 0,
    net: kind === 'EMPLOYMENT' ? 0 : appr ? 13000 : fees ? 81000 : 20000, govShare: kind === 'NATS' ? 4500 : kind === 'NAPS' ? 1500 : 0,
    bandLabel: appr ? 'Graduate / degree apprentice' : null, bandMin: appr ? 12300 : 0,
    probation: 180, notice: 30, noticeDays: null,
    registration: appr ? 'NATS-2026-104233' : null, trade: kind === 'NAPS' ? 'Fitter' : null, qualification: appr ? 'B.Tech Mechanical' : null, institute: kind === 'NATS' ? 'Delhi Technological University' : null,
    salaryExtras: [],
  }
}
