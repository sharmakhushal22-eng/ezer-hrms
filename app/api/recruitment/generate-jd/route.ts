// app/api/recruitment/generate-jd/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { designation, department, company_type, experience, employee_type } = await req.json()

  const prompt = `Generate a professional Job Description for the following role:

Position: ${designation}
Department: ${department}
Company Type: ${company_type || 'Manufacturing/Services'}
Experience Required: ${experience || 'As per requirement'}
Employment Type: ${employee_type || 'Full-time'}

Write a complete JD with:
1. About the Role (2-3 lines)
2. Key Responsibilities (6-8 bullet points)
3. Required Qualifications (4-5 points)
4. Required Skills (5-6 points)
5. Preferred/Good to have (3-4 points)
6. Key Competencies (3-4 points)

Keep it professional, concise, and India-market appropriate.
Do NOT include salary range or company name. 
Format with clear headings.`

  // Without a key the upstream call returns an auth error whose body has no
  // `content`, which used to collapse to an empty string and read as success.
  // Fail loudly instead, so the UI can say what is actually wrong.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'NO_API_KEY', message: 'API key not exist, please connect LLM key' },
      { status: 503 },
    )
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await res.json()

    if (!res.ok) {
      const upstream = data?.error?.message || `AI service returned ${res.status}`
      const badKey = res.status === 401 || res.status === 403
      return NextResponse.json(
        { error: badKey ? 'NO_API_KEY' : 'AI_ERROR',
          message: badKey ? 'API key not exist, please connect LLM key' : upstream },
        { status: res.status },
      )
    }

    const jd = data.content?.[0]?.text || ''
    if (!jd) {
      return NextResponse.json(
        { error: 'EMPTY', message: 'The AI service returned no text. Please try again.' },
        { status: 502 },
      )
    }
    return NextResponse.json({ jd })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'AI_ERROR', message: e?.message || 'Could not reach the AI service' },
      { status: 502 },
    )
  }
}
