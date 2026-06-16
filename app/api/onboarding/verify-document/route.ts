// app/api/onboarding/verify-document/route.ts
// Uploads document to Supabase Storage + runs Gemini 2.5 Flash AI extraction
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 60

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
)

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

const DOC_PROMPTS: Record<string, string> = {
  AADHAAR_FRONT: `Extract from this Aadhaar card front image. Return ONLY valid JSON:
{"name":"","dob":"DD/MM/YYYY","gender":"Male/Female","aadhaar_number":"XXXX XXXX XXXX","address":"","pin_code":"","confidence":0.0}`,

  AADHAAR_BACK: `Extract from this Aadhaar card back image. Return ONLY valid JSON:
{"address":"","pin_code":"","confidence":0.0}`,

  PAN: `Extract from this PAN card image. Return ONLY valid JSON:
{"name":"","pan_number":"","dob":"DD/MM/YYYY","father_name":"","confidence":0.0}`,

  DEGREE: `Extract from this degree/certificate. Return ONLY valid JSON:
{"name":"","degree":"","specialization":"","institution":"","year":"","confidence":0.0}`,

  EXP_LETTER: `Extract from this experience/relieving letter. Return ONLY valid JSON:
{"name":"","company":"","designation":"","joining_date":"","last_date":"","confidence":0.0}`,

  BANK_PROOF: `Extract from this bank document (cheque/passbook). Return ONLY valid JSON:
{"account_holder":"","account_number":"","ifsc":"","bank_name":"","branch":"","confidence":0.0}`,

  UAN_CARD: `Extract from this UAN card. Return ONLY valid JSON:
{"name":"","uan":"","member_id":"","confidence":0.0}`,

  PHOTO: `Is this a clear passport-size photo of a person? Return ONLY valid JSON:
{"is_valid_photo":true,"face_detected":true,"confidence":0.0}`,
}

async function geminiExtract(base64Data: string, mimeType: string, docCode: string): Promise<any> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set')

  const prompt = DOC_PROMPTS[docCode] || 'Extract all text from this document. Return as JSON.'

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
    }),
  })

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`)

  const result = await response.json()
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  const clean = raw.replace(/```json|```/g, '').trim()

  try { return JSON.parse(clean) }
  catch { return { raw_text: clean, confidence: 0.5 } }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const token    = formData.get('token') as string
    const docCode  = formData.get('doc_code') as string
    const file     = formData.get('file') as File | null

    if (!token || !docCode || !file) {
      return NextResponse.json({ error: 'token, doc_code, file required' }, { status: 400 })
    }

    // Validate token
    const { data: cand, error: candErr } = await supa
      .from('onboarding_candidates')
      .select('id, company_id')
      .eq('magic_link_token', token)
      .single()

    if (candErr || !cand) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    // Upload to Supabase Storage
    const ext       = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const filePath  = `${cand.id}/${docCode}_${Date.now()}.${ext}`
    const arrayBuf  = await file.arrayBuffer()
    const buffer    = Buffer.from(arrayBuf)

    const { error: uploadErr } = await supa.storage
      .from('onboarding-docs')
      .upload(filePath, buffer, { contentType: file.type, upsert: true })

    if (uploadErr) {
      console.error('Storage upload error:', uploadErr)
      // Continue even if storage fails — still run AI
    }

    // Run Gemini AI extraction
    const base64 = buffer.toString('base64')
    let aiData: any = {}
    let aiStatus: string = 'VERIFIED'
    let aiConfidence = 0.0
    let aiFlags: string[] = []

    try {
      aiData       = await geminiExtract(base64, file.type, docCode)
      aiConfidence = parseFloat(aiData.confidence) || 0.7
      delete aiData.confidence

      // Flag low confidence
      if (aiConfidence < 0.6) {
        aiFlags.push('LOW_CONFIDENCE')
        aiStatus = 'MISMATCH'
      }
    } catch (aiErr: any) {
      console.error('Gemini error:', aiErr)
      aiStatus    = 'FAILED'
      aiFlags     = ['AI_UNAVAILABLE']
      aiConfidence = 0
    }

    // Get doc type id
    const { data: docType } = await supa
      .from('onboarding_document_types')
      .select('id')
      .eq('doc_code', docCode)
      .limit(1)
      .single()

    // Save document record
    const { data: doc, error: docErr } = await supa
      .from('onboarding_documents')
      .upsert({
        onboarding_id:    cand.id,
        doc_type_id:      docType?.id || null,
        doc_code:         docCode,
        storage_path:     uploadErr ? null : filePath,
        file_name:        file.name,
        file_size:        file.size,
        mime_type:        file.type,
        ai_verified:      aiStatus === 'VERIFIED',
        ai_status:        aiStatus,
        ai_extracted_data: aiData,
        ai_confidence:    aiConfidence,
        ai_flags:         aiFlags,
        ai_processed_at:  new Date().toISOString(),
      }, {
        onConflict: 'onboarding_id,doc_code',
        ignoreDuplicates: false,
      })
      .select('id')
      .single()

    if (docErr) {
      console.error('onboarding_documents save error:', docErr)
      return NextResponse.json({ error: 'Could not save the document: ' + docErr.message }, { status: 500 })
    }

    await supa.from('onboarding_audit_log').insert({
      onboarding_id: cand.id,
      action:        'DOCUMENT_UPLOADED',
      actor_type:    'CANDIDATE',
      details:       { doc_code: docCode, ai_status: aiStatus, confidence: aiConfidence },
    })

    return NextResponse.json({
      success:        true,
      doc_id:         doc?.id,
      ai_status:      aiStatus,
      ai_extracted:   aiData,
      ai_confidence:  aiConfidence,
      ai_flags:       aiFlags,
      storage_path:   uploadErr ? null : filePath,
    })

  } catch (err: any) {
    console.error('verify-document error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
