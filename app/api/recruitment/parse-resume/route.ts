// app/api/recruitment/parse-resume/route.ts — "Upload & Parse Resume" for Add Candidate.
//   POST multipart { file }  ->  { ok, fields, filled, missing, meta }
//
// Accuracy comes from three layers: (1) real text extraction (pdf-parse / mammoth) PLUS the
// PDF itself sent inline so Gemini can read layout, tables and two-column resumes;
// (2) a strict JSON schema with "null when absent — never guess" rules; (3) server-side
// normalisation + regex fallbacks (email, phone, LinkedIn) so a missed field is still caught.

import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
// pdf-parse v1 — import the lib entry directly to avoid its debug-mode file read.
import pdf from 'pdf-parse/lib/pdf-parse.js'
import { normalizeStateName } from '@/lib/recruitment/min-wages'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const MAX_BYTES = 10 * 1024 * 1024
const MAX_CHARS = 40000

// Keys mirror the Add Candidate form so the client can apply them 1:1.
const SCHEMA = `{
  "first_name": string|null, "middle_name": string|null, "last_name": string|null,
  "dob": "YYYY-MM-DD"|null, "gender": "Male"|"Female"|"Other"|null, "marital_status": "Single"|"Married"|"Other"|null,
  "nationality": string|null, "languages": string[]|null,
  "email": string|null, "phone": string|null, "alt_mobile": string|null, "dial_code": string|null,
  "current_city": string|null, "permanent_address": string|null,
  "perm_line1": string|null, "perm_line2": string|null, "perm_pincode": string|null, "perm_city": string|null, "perm_state": string|null, "perm_country": string|null,
  "total_exp_years": number|null, "total_exp_months": number|null, "relevant_exp": string|null,
  "current_company": string|null, "designation": string|null, "function": string|null,
  "qualification": string|null, "specialization": string|null, "passing_year": number|null, "institute": string|null,
  "certifications": string|null, "skills": string[]|null,
  "notice_period": string|null, "current_fixed_lpa": number|null, "current_variable_lpa": number|null, "expected_ctc_lpa": number|null,
  "linkedin": string|null, "portfolio": string|null,
  "confidence": number
}`

function buildPrompt(text?: string) {
  return `You are an expert Indian-recruitment resume parser. Extract the candidate's details from the resume and return ONLY a JSON object with exactly this shape:
${SCHEMA}

Rules — follow every one:
- Return null for anything not explicitly present. NEVER guess, infer or fabricate (no invented DOB, gender, CTC, city).
- Names: split the candidate's own name into first / middle / last (middle null if none). Ignore references' or companies' names.
- phone: the primary mobile as digits only, WITHOUT country code (India: 10 digits). alt_mobile: a second number if any. dial_code: "+91" unless the number is clearly foreign.
- email: lowercase. linkedin / portfolio: full URLs (add https:// if missing).
- dob: convert any format (12/03/1994, 12-Mar-94, March 12 1994) to YYYY-MM-DD.
- total_exp_years / total_exp_months: overall professional experience as whole years + remaining months (compute from dates if only dates are given; today is ${new Date().toISOString().slice(0, 10)}). relevant_exp: a short phrase like "5 yrs in backend development".
- current_company + designation: the MOST RECENT employer and title (a "Present"/"Till date" role wins).
- function: the broad job function (e.g. Software Development, Sales, Finance, HR, Operations, Marketing, Design).
- qualification: HIGHEST degree (e.g. B.Tech, MBA, M.Sc, B.Com, 12th). specialization: its stream. institute + passing_year for that degree.
- skills: 5-30 short canonical skill names (e.g. "React", "Node.js", "SQL", "Excel", "Salesforce"), no sentences, no duplicates.
- CTC values in LPA (lakhs per annum) as numbers: "8.5 LPA" → 8.5, "₹8,50,000 p.a." → 8.5, "70,000 per month" → 8.4. current_variable_lpa only if separately stated.
- Permanent / residential address: also split it — perm_line1 = house/flat/building/street, perm_line2 = area/locality/landmark (null if none), perm_pincode = the 6-digit PIN, perm_city, perm_state = the full Indian state name (the city's state when unambiguous, e.g. Bengaluru → Karnataka), perm_country = "India" for Indian addresses. Keep permanent_address as the full one-line address too.
- notice_period: as written ("30 days", "Immediate", "2 months", "Serving notice till 15 Oct").
- certifications: comma-separated names. languages: array of language names.
- confidence: 0-1, your overall confidence that the extraction is complete and correct.
Output the JSON only — no markdown, no commentary.${text ? `

RESUME TEXT:
"""
${text}
"""` : ''}`
}

function parseModelJson(raw: string): any {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(s) } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}')
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch { /* fall through */ } }
    return {}
  }
}

// ── normalisation ──
const str = (v: any) => (v == null ? '' : String(v).trim())
const digits10 = (v: any) => { const d = str(v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : (d || '') }
const num = (v: any) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null }
const isoDate = (v: any) => { const s = str(v); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) }
const url = (v: any) => { let s = str(v); if (!s) return ''; if (!/^https?:\/\//i.test(s)) s = 'https://' + s; return s }
const lpa = (v: any) => { const n = num(v); if (n == null) return null; return n >= 10000 ? Math.round((n / 100000) * 100) / 100 : n }  // rupees slipped through → LPA

function normalise(m: any, text: string) {
  const emailRx = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
  const phoneRx = /(?:\+91[\s-]?|0)?([6-9]\d{9})(?!\d)/
  const liRx = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i
  const f: Record<string, any> = {
    first_name: str(m.first_name), middle_name: str(m.middle_name), last_name: str(m.last_name),
    dob: isoDate(m.dob), gender: ['Male', 'Female', 'Other'].includes(str(m.gender)) ? str(m.gender) : '',
    marital_status: ['Single', 'Married', 'Other'].includes(str(m.marital_status)) ? str(m.marital_status) : '',
    nationality: str(m.nationality), languages: Array.isArray(m.languages) ? m.languages.map(str).filter(Boolean).join(', ') : str(m.languages),
    email: str(m.email).toLowerCase() || (text.match(emailRx)?.[0] || '').toLowerCase(),
    phone: digits10(m.phone) || (text.replace(/\s/g, ' ').match(phoneRx)?.[1] || ''),
    alt_mobile: digits10(m.alt_mobile), dial_code: /^\+\d{1,3}$/.test(str(m.dial_code)) ? str(m.dial_code) : '+91',
    current_city: str(m.current_city), permanent_address: str(m.permanent_address),
    perm_line1: str(m.perm_line1) || str(m.permanent_address), perm_line2: str(m.perm_line2),
    perm_pincode: (() => { const p = str(m.perm_pincode).replace(/\D/g, ''); if (p.length === 6) return p; const rx = (str(m.permanent_address) + ' ' + text).match(/\b[1-9]\d{5}\b/); return rx ? rx[0] : '' })(),
    perm_city: str(m.perm_city), perm_state: normalizeStateName(m.perm_state) || str(m.perm_state),
    perm_country: str(m.perm_country) || ((str(m.perm_state) || str(m.perm_pincode) || /india/i.test(text)) ? 'India' : ''),
    total_exp_years: num(m.total_exp_years) != null ? String(Math.floor(num(m.total_exp_years) as number)) : (m.total_exp_years === 0 ? '0' : ''),
    total_exp_months: m.total_exp_months != null && Number.isFinite(Number(m.total_exp_months)) ? String(Math.max(0, Math.min(11, Math.round(Number(m.total_exp_months))))) : '',
    relevant_exp: str(m.relevant_exp), current_company: str(m.current_company), designation: str(m.designation), function: str(m.function),
    qualification: str(m.qualification), specialization: str(m.specialization), passing_year: num(m.passing_year) ? String(Math.round(num(m.passing_year) as number)) : '', institute: str(m.institute),
    certifications: str(m.certifications),
    skills: Array.from(new Set((Array.isArray(m.skills) ? m.skills : []).map(str).filter(Boolean).map((s: string) => s.slice(0, 40)))).slice(0, 30),
    notice_period: str(m.notice_period),
    current_fixed: lpa(m.current_fixed_lpa) != null ? String(lpa(m.current_fixed_lpa)) : '', current_variable: lpa(m.current_variable_lpa) != null ? String(lpa(m.current_variable_lpa)) : '',
    expected_ctc: lpa(m.expected_ctc_lpa) != null ? String(lpa(m.expected_ctc_lpa)) : '',
    linkedin: url(m.linkedin) || url(text.match(liRx)?.[0] || ''), portfolio: url(m.portfolio),
  }
  if (f.alt_mobile && f.alt_mobile === f.phone) f.alt_mobile = ''
  // Name fallback: if the model returned nothing, take the first non-empty line that looks like a name.
  if (!f.first_name && !f.last_name) {
    const line = (text.split('\n').map(l => l.trim()).find(l => l && l.length < 60 && !/@|\d/.test(l) && /^[A-Za-z .'-]+$/.test(l)) || '').split(/\s+/)
    if (line.length >= 2) { f.first_name = line[0]; f.last_name = line[line.length - 1]; f.middle_name = line.slice(1, -1).join(' ') }
    else if (line.length === 1 && line[0]) f.first_name = line[0]
  }
  return f
}

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Invalid upload' }, { status: 400 }) }
  const file = form.get('file') as File | null
  if (!file || !file.size) return NextResponse.json({ error: 'Choose a resume file (PDF, DOC, DOCX or TXT).' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Resume is larger than 10 MB.' }, { status: 400 })
  const name = (file.name || '').toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isDocx = name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const isDoc = name.endsWith('.doc') || file.type === 'application/msword'
  const isTxt = name.endsWith('.txt') || file.type === 'text/plain'
  if (!isPdf && !isDocx && !isDoc && !isTxt) return NextResponse.json({ error: 'Only PDF, DOC, DOCX or TXT resumes are supported.' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  let text = ''
  try {
    if (isPdf) text = ((await pdf(buffer)).text || '').trim()
    else if (isDocx) text = ((await mammoth.extractRawText({ buffer })).value || '').trim()
    else if (isTxt) text = buffer.toString('utf8').trim()
    else if (isDoc) { try { text = ((await mammoth.extractRawText({ buffer })).value || '').trim() } catch { text = '' } }
  } catch (e) { console.error('parse-resume: extraction failed', e); text = '' }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').slice(0, MAX_CHARS)

  if (!text && !isPdf) return NextResponse.json({ error: 'Could not read any text from this file. Try a PDF or DOCX export.' }, { status: 422 })

  // Any of the three names the project has used for the Gemini key.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'Resume parsing is not configured on the server — add GEMINI_API_KEY in Vercel → Settings → Environment Variables.' }, { status: 502 })

  // Text + (for PDFs) the document itself: the model reads layout, the text keeps it honest.
  const parts: any[] = [{ text: buildPrompt(text || undefined) }]
  if (isPdf) parts.push({ inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } })

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 1024 } },
    }),
  })
  if (!res.ok) { const detail = await res.text(); console.error('parse-resume: Gemini error', res.status, detail); return NextResponse.json({ error: `AI service error (${res.status})` }, { status: 502 }) }
  const data = await res.json()
  const model = parseModelJson(data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '{}')
  const fields = normalise(model, text)
  const filled = Object.entries(fields).filter(([, v]) => Array.isArray(v) ? v.length > 0 : v !== '' && v != null && v !== '+91').map(([k]) => k)
  const missing = Object.keys(fields).filter(k => !filled.includes(k) && k !== 'dial_code')
  return NextResponse.json({ ok: true, fields, filled, missing, meta: { chars: text.length, model: MODEL, confidence: Number(model.confidence) || null, file: file.name } })
}
