// ================================================================
// EZER HRMS — Bulk Letter Generation API
// Path: app/api/letters/generate/route.ts
//
// Runs server-side deliberately — generating N PDFs (fetching each
// employee's resolved letterhead PDF + signature image, running
// pdf-lib) is real work that shouldn't block a browser tab or risk
// a client-side timeout on a slow connection. The admin UI POSTs a
// template + company + list of employee codes here and gets back a
// per-employee success/failure summary.
// ================================================================
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMergeFieldsForEmployee } from '@/lib/letters/mergeFields'
import { renderTemplate } from '@/lib/letters/renderTemplate'
import { mergeLetterOntoLetterhead } from '@/lib/letterhead/merge'
import type { ResolvedLetterhead, ResolvedSignatory } from '@/lib/letterhead/types'

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!)

interface GenerateRequest {
  template_id: string
  company_id: string
  employee_codes: string[]
  generated_by?: string
}

interface EmployeeResult {
  employee_code: string
  status: 'GENERATED' | 'SKIPPED_NO_LETTERHEAD' | 'SKIPPED_NOT_FOUND' | 'SKIPPED_UNKNOWN_TOKENS' | 'ERROR'
  employee_name?: string
  generated_letter_id?: string
  unknown_tokens?: string[]
  error?: string
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const { template_id, company_id, employee_codes, generated_by } = body

  if (!template_id || !company_id || !employee_codes?.length) {
    return NextResponse.json({ error: 'template_id, company_id, and employee_codes are required' }, { status: 400 })
  }

  const { data: template, error: templateErr } = await supa
    .from('letter_templates').select('*').eq('id', template_id).eq('is_active', true).maybeSingle()
  if (templateErr || !template) {
    return NextResponse.json({ error: 'Letter template not found' }, { status: 404 })
  }

  const results: EmployeeResult[] = []

  for (const code of employee_codes) {
    try {
      // Employee must belong to the selected company — prevents a
      // pasted code from a different company silently generating a
      // letter under the wrong branding.
      const { data: emp } = await supa
        .from('employees').select('id, emp_code, full_name')
        .eq('emp_code', code.trim()).eq('company_id', company_id).maybeSingle()

      if (!emp) {
        results.push({ employee_code: code, status: 'SKIPPED_NOT_FOUND' })
        continue
      }

      const resolved = await resolveMergeFieldsForEmployee(emp.id)
      if (!resolved || !resolved.locationId) {
        results.push({ employee_code: code, employee_name: emp.full_name, status: 'ERROR', error: 'Employee has no branch/location assigned' })
        continue
      }

      const { text: bodyText, unknownTokens } = renderTemplate(template.content, resolved.fields)
      if (unknownTokens.length > 0) {
        results.push({ employee_code: code, employee_name: emp.full_name, status: 'SKIPPED_UNKNOWN_TOKENS', unknown_tokens: unknownTokens })
        continue
      }

      // Resolve THIS employee's branch letterhead + signatory (Branch > Company > Group)
      const [lhRes, sigRes] = await Promise.all([
        supa.from('letterhead_resolved').select('*').eq('location_id', resolved.locationId).maybeSingle(),
        supa.from('signatory_resolved').select('*').eq('location_id', resolved.locationId).maybeSingle(),
      ])

      const letterhead = lhRes.data as ResolvedLetterhead | null
      const signatory = sigRes.data as ResolvedSignatory | null

      if (!letterhead?.letterhead_configured || !letterhead.file_url) {
        results.push({ employee_code: code, employee_name: emp.full_name, status: 'SKIPPED_NO_LETTERHEAD' })
        continue
      }

      const [lhFileRes, sigFileRes] = await Promise.all([
        supa.storage.from('letterhead-files').download(letterhead.file_url),
        signatory?.signature_url ? supa.storage.from('letterhead-signatures').download(signatory.signature_url) : Promise.resolve({ data: null }),
      ])

      const letterheadPdfBytes = await lhFileRes.data!.arrayBuffer()
      const signatureImageBytes = sigFileRes.data ? await sigFileRes.data.arrayBuffer() : undefined

      const mergedPdf = await mergeLetterOntoLetterhead({
        letterhead,
        letterheadPdfBytes,
        signatory,
        signatureImageBytes,
        signatureMimeType: signatureImageBytes ? 'image/png' : undefined,
        letterTypeLabel: template.name,
        bodyText,
      })

      const storagePath = `${company_id}/${emp.id}/${template_id}_${Date.now()}.pdf`
      await supa.storage.from('generated-letters').upload(storagePath, Buffer.from(mergedPdf), { contentType: 'application/pdf' })

      const { data: glRow } = await supa.from('generated_letters').insert({
        template_id, employee_id: emp.id, company_id,
        location_id: resolved.locationId,
        file_url: storagePath,
        letterhead_resolved_from: letterhead.letterhead_resolved_from,
        signatory_resolved_from: signatory?.signatory_resolved_from ?? null,
        generated_by: generated_by ?? null,
      }).select('id').single()

      results.push({ employee_code: code, employee_name: emp.full_name, status: 'GENERATED', generated_letter_id: glRow?.id })

    } catch (err: any) {
      results.push({ employee_code: code, status: 'ERROR', error: err.message })
    }
  }

  const summary = {
    total: results.length,
    generated: results.filter(r => r.status === 'GENERATED').length,
    skipped: results.filter(r => r.status !== 'GENERATED').length,
  }

  return NextResponse.json({ summary, results })
}
