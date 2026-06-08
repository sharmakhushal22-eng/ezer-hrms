// app/api/recruitment/screen-resumes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'

// mammoth + Buffer need the Node.js runtime (not Edge)
export const runtime = 'nodejs'

// Google Gemini. Override the model via GEMINI_MODEL if needed.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const MAX_RESUME_CHARS = 30000 // guard against huge text dumps

interface Criteria {
  jd_text: string
  skills_required: string
  experience_required: string
  education_required: string
  designation: string
  previous_company_preference: string
}

function buildPrompt(c: Criteria, resume_text?: string) {
  return `You are an experienced HR recruiter and ATS (Applicant Tracking System) engine. Score this candidate's resume against the structured job requirements below, the way an ATS + human recruiter would.

ROLE / DESIGNATION: ${c.designation || 'Not specified'}
REQUIRED SKILLS (comma-separated, these are the primary screening criteria): ${c.skills_required || 'Not specified'}
REQUIRED EXPERIENCE: ${c.experience_required || 'Not specified'}
REQUIRED EDUCATION: ${c.education_required || 'Any'}
PREVIOUS COMPANY PREFERENCE: ${c.previous_company_preference || 'No preference'}

JOB DESCRIPTION:
${c.jd_text}
${resume_text ? `\nCANDIDATE RESUME:\n${resume_text}` : '\nThe candidate resume is attached as a document. Read it fully before scoring.'}

SCORING METHOD — compute a weighted overall score (0-100):
- Skills match (weight 50%): of the REQUIRED SKILLS, what fraction does the resume clearly demonstrate? This drives ats_score.
- Experience match (weight 20%): does the candidate's years/seniority meet REQUIRED EXPERIENCE?
- Education match (weight 10%): does the candidate meet REQUIRED EDUCATION? Treat "Any" as satisfied.
- JD relevance (weight 20%): overall fit to the job description beyond the explicit fields.

Be objective. Only count a skill as matched if the resume gives concrete evidence (projects, roles, tools). Do not invent skills.

Respond ONLY with valid JSON (no markdown, no commentary):
{
  "score": <number 0-100, the weighted overall>,
  "ats_score": <number 0-100, = percent of REQUIRED SKILLS matched>,
  "match_tag": "<STRONG|PARTIAL|NOT_SUITABLE>",
  "matched_skills": ["<required skill found in resume>"],
  "missing_skills": ["<required skill NOT found in resume>"],
  "experience_match": "<one short line: candidate's experience vs required>",
  "education_match": "<one short line: candidate's education vs required>",
  "reasoning": "<2-3 sentence defensible justification of the overall score>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "gaps": ["<gap 1>", "<gap 2>"],
  "interview_questions": [
    "<Technical question 1>",
    "<Technical question 2>",
    "<Behavioral question>",
    "<Situational question>",
    "<Role-specific question>"
  ]
}

Tag rules: STRONG = 75-100, PARTIAL = 40-74, NOT_SUITABLE = 0-39. If REQUIRED SKILLS is "Not specified", score against the JOB DESCRIPTION only and set matched_skills/missing_skills to [].`
}

// Turn an uploaded resume into Gemini "parts".
// PDF  -> inlineData base64 (Gemini reads the document directly, incl. scanned)
// DOCX -> mammoth text extraction (Gemini can't parse .docx natively)
// TXT/CSV/other text -> raw text
async function buildParts(file: File, c: Criteria) {
  const name = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isDocx =
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')

  if (isPdf) {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    return [
      { text: buildPrompt(c) },
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
    ]
  }

  let text: string
  if (isDocx) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const { value } = await mammoth.extractRawText({ buffer })
    text = value
  } else {
    text = await file.text()
  }
  text = text.trim().slice(0, MAX_RESUME_CHARS)
  if (!text) throw new Error('Empty resume text after extraction')
  return [{ text: buildPrompt(c, text) }]
}

// Robustly pull the JSON object out of the model's reply, even if it leaks
// prose like "Here is the JSON:" or wraps it in ```json fences.
function parseModelJson(raw: string): any {
  let s = raw.replace(/```json|```/g, '').trim()
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1)
  return JSON.parse(s) // throws on malformed -> caught by caller -> safe fallback
}

export async function POST(req: NextRequest) {
  let candidate_name = ''
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const c: Criteria = {
      jd_text: (form.get('jd_text') as string) || '',
      skills_required: (form.get('skills_required') as string) || '',
      experience_required: (form.get('experience_required') as string) || '',
      education_required: (form.get('education_required') as string) || '',
      designation: (form.get('designation') as string) || '',
      previous_company_preference: (form.get('previous_company_preference') as string) || '',
    }
    candidate_name = (form.get('candidate_name') as string) || ''

    if (!file) return NextResponse.json({ error: 'No resume file provided' }, { status: 400 })
    if (!c.jd_text.trim()) return NextResponse.json({ error: 'No job description provided' }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { score: 0, ats_score: 0, match_tag: 'NOT_SUITABLE', matched_skills: [], missing_skills: [], reasoning: 'GEMINI_API_KEY is not configured on the server', candidate_name },
        { status: 502 },
      )
    }

    const parts = await buildParts(file, c)

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            // gemini-2.5-* are "thinking" models — disable thinking so the full
            // JSON answer isn't truncated by reasoning tokens.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    )

    if (!res.ok) {
      const detail = await res.text()
      console.error('Gemini API error:', res.status, detail)
      return NextResponse.json(
        { score: 0, ats_score: 0, match_tag: 'NOT_SUITABLE', matched_skills: [], missing_skills: [], reasoning: `AI service error (${res.status})`, candidate_name },
        { status: 502 },
      )
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const result = parseModelJson(raw)
    return NextResponse.json({ ...result, candidate_name })
  } catch (err) {
    console.error('screen-resumes failed:', err)
    return NextResponse.json(
      { score: 0, ats_score: 0, match_tag: 'NOT_SUITABLE', matched_skills: [], missing_skills: [], reasoning: 'Could not process resume', candidate_name },
      { status: 200 }, // keep batch screening going on the client
    )
  }
}
