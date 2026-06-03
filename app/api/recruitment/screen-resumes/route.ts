// app/api/recruitment/screen-resumes/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { resume_text, jd_text, candidate_name } = await req.json()

  const prompt = `You are an expert HR recruiter. Score this resume against the Job Description.

JOB DESCRIPTION:
${jd_text}

CANDIDATE RESUME:
${resume_text}

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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  const raw = data.content?.[0]?.text || '{}'
  try {
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim())
    return NextResponse.json({ ...result, candidate_name })
  } catch {
    return NextResponse.json({ score: 0, match_tag: 'NOT_SUITABLE', reasoning: 'Could not parse', candidate_name })
  }
}
