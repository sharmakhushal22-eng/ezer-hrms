// app/api/recruitment/interview-ai/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { type, designation, round, candidate_summary, existing_notes } = await req.json()

  let prompt = ''

  if (type === 'questions') {
    prompt = `Generate interview questions for:
Role: ${designation}
Round: ${round} (${round === 'L1' ? 'Technical screening' : round === 'L2' ? 'Deep technical' : round === 'MD' ? 'Leadership & culture fit' : 'Telephonic screening'})
Candidate: ${candidate_summary || 'General candidate'}

Give 8 questions with expected answers. Format as JSON array:
[{"question": "...", "expected_answer": "...", "type": "technical|behavioral|situational"}]

Respond ONLY with the JSON array, no extra text.`
  } else if (type === 'feedback') {
    prompt = `Based on these interview notes, write a structured interview feedback:

Role: ${designation}
Round: ${round}
Notes: ${existing_notes}

Write feedback with:
1. Overall Assessment (1 line)
2. Technical Score (/10) with justification
3. Communication Score (/10)
4. Culture Fit Score (/10)
5. Key Strengths (3 bullets)
6. Areas of Concern (2 bullets)
7. Recommendation: PROCEED / HOLD / REJECT with reason

Keep it concise and professional.`
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  const result = data.content?.[0]?.text || ''
  return NextResponse.json({ result })
}
