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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  const jd = data.content?.[0]?.text || ''
  return NextResponse.json({ jd })
}
