// app/api/recruitment/screen-resumes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'

// mammoth + Buffer need the Node.js runtime (not Edge)
export const runtime = 'nodejs'

const MODEL = 'claude-sonnet-4-6'
const MAX_RESUME_CHARS = 30000 // guard against huge text dumps

function buildPrompt(jd_text: string, resume_text?: string) {
  return `You are an expert HR recruiter. Score this resume against the Job Description.

JOB DESCRIPTION:
${jd_text}
${resume_text ? `\nCANDIDATE RESUME:\n${resume_text}` : '\nThe candidate resume is attached as a document. Read it fully before scoring.'}

Evaluate and respond ONLY with valid JSON (no markdown, no extra text):
{
  "score": <number 0-100>,
  "match_tag": "<STRONG|PARTIAL|NOT_SUITABLE>",
  "reasoning": "<2-3 sentences why this score>",
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

Rules:
- STRONG = score 75-100 (excellent match)
- PARTIAL = score 40-74 (partial match, worth interviewing)
- NOT_SUITABLE = score 0-39 (poor match)
- Be objective and specific`
}

// Turn an uploaded resume into Anthropic message content.
// PDF -> native document block (Claude reads it directly, incl. scanned via vision)
// DOCX -> mammoth text extraction
// TXT/CSV/other text -> raw text
async function buildContent(file: File, jd_text: string) {
  const name = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const isDocx =
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')

  if (isPdf) {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: buildPrompt(jd_text) },
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
  return [{ type: 'text', text: buildPrompt(jd_text, text) }]
}

export async function POST(req: NextRequest) {
  let candidate_name = ''
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const jd_text = (form.get('jd_text') as string) || ''
    candidate_name = (form.get('candidate_name') as string) || ''

    if (!file) return NextResponse.json({ error: 'No resume file provided' }, { status: 400 })
    if (!jd_text.trim()) return NextResponse.json({ error: 'No job description provided' }, { status: 400 })

    const content = await buildContent(file, jd_text)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content }] }),
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error('Anthropic API error:', res.status, detail)
      return NextResponse.json(
        { score: 0, match_tag: 'NOT_SUITABLE', reasoning: `AI service error (${res.status})`, candidate_name },
        { status: 502 },
      )
    }

    const data = await res.json()
    const raw = data.content?.[0]?.text || '{}'
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return NextResponse.json({ ...result, candidate_name })
  } catch (err) {
    console.error('screen-resumes failed:', err)
    return NextResponse.json(
      { score: 0, match_tag: 'NOT_SUITABLE', reasoning: 'Could not process resume', candidate_name },
      { status: 200 }, // keep batch screening going on the client
    )
  }
}
