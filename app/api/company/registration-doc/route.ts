// app/api/company/registration-doc/route.ts — the certificate behind a
// statutory registration.
//
//   POST   multipart { registration_id, file }  -> upload / replace
//   GET    ?id=<registration>                   -> a short-lived signed URL
//   DELETE ?id=<registration>                   -> detach and delete the file
//
// ── WHO ─────────────────────────────────────────────────────────────────────
// WRITING is restricted to COMPANY_EDIT_ROLES, which as of this change means
// the EZER platform admin and EZER customer support — nobody from the
// customer's own organisation. READING is not: a company user may look at
// their own certificates, they simply cannot change them. That split is the
// whole point of the brief, so it is enforced here, server-side, and not by
// hiding a button.
//
// ── WHY THE FILE NEVER GETS A PUBLIC URL ────────────────────────────────────
// These are PAN, GST, EPF and ESIC certificates. The bucket is private and
// every view is a signed URL minted here, valid for minutes. Nothing in the
// app ever hands out a durable link, so a leaked screenshot of a URL stops
// working on its own.

import { NextRequest, NextResponse } from 'next/server'
import { rmsServiceClient as sb, grantForRequest } from '@/lib/rms/server'
import { companyEditRight } from '@/lib/company/authz'

export const dynamic = 'force-dynamic'

const BUCKET = 'company-docs'
const TTL = 300                       // five minutes is long enough to open it
const MAX = 15 * 1024 * 1024          // mirrors the CHECK in migration 081

const PDF  = 'application/pdf'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ALLOWED = new Set([PDF, DOCX])

/** True when the bucket has not been created yet. Told apart from a real
 *  storage failure so the UI can say "ask Nayan for the bucket" rather than
 *  "something went wrong". */
const noBucket = (e: any) =>
  /bucket not found|does not exist/i.test(String(e?.message || e || ''))

async function mayWrite(req: NextRequest) {
  const grant = await grantForRequest(req)
  const right = companyEditRight(grant)
  return { grant, right }
}

// ── view ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const grant = await grantForRequest(req)
  // Reading is open to anyone signed in — see the note at the top. What is
  // NOT open is an unauthenticated caller, because the URL this mints would
  // otherwise be handed to the world.
  if (!grant.employeeId && !grant.legacy && !grant.isSuperAdmin) {
    return NextResponse.json({ error: 'Sign in to view this document.' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Which registration?' }, { status: 400 })

  const { data: reg } = await sb.from('registrations')
    .select('id, reg_type, document_path, document_name, document_mime')
    .eq('id', id).maybeSingle()
  if (!reg) return NextResponse.json({ error: 'No such registration.' }, { status: 404 })
  if (!reg.document_path) {
    return NextResponse.json({ error: 'No document has been uploaded for this registration.' }, { status: 404 })
  }

  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(reg.document_path, TTL)
  if (error || !data?.signedUrl) {
    return NextResponse.json({
      error: noBucket(error) ? 'The company-docs storage bucket does not exist yet.'
                             : 'Could not open that document.',
    }, { status: 500 })
  }
  return NextResponse.json({
    url: data.signedUrl,
    name: reg.document_name,
    mime: reg.document_mime,
    // A browser renders PDF and cannot render DOCX. Said here rather than
    // guessed in the client, so both agree about what "view" means.
    inline: reg.document_mime === PDF,
    expires_in: TTL,
  })
}

// ── upload / replace ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { grant, right } = await mayWrite(req)
  if (!right.canEdit) return NextResponse.json({ error: right.reason }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const id = String(form?.get('registration_id') || '')
  const file = form?.get('file') as File | null
  if (!id || !file) return NextResponse.json({ error: 'Pick a registration and a file.' }, { status: 400 })

  const type = file.type || ''
  if (!ALLOWED.has(type)) {
    return NextResponse.json({
      error: 'Only a PDF or a Word (.docx) file can be attached to a registration.',
    }, { status: 415 })
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: 'That file is over 15 MB.' }, { status: 413 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  }

  const { data: reg } = await sb.from('registrations')
    .select('id, company_id, reg_type, document_path').eq('id', id).maybeSingle()
  if (!reg) return NextResponse.json({ error: 'No such registration.' }, { status: 404 })

  // Keyed by company and registration so the bucket stays browsable by a
  // human, and suffixed with the time so replacing a certificate does not
  // overwrite the old bytes before the row has been updated.
  const ext = type === PDF ? 'pdf' : 'docx'
  const safe = (reg.reg_type || 'registration').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const path = `registrations/${reg.company_id}/${reg.id}/${safe}-${Date.now()}.${ext}`

  const buf = Buffer.from(await file.arrayBuffer())
  const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false })
  if (up.error) {
    return NextResponse.json({
      error: noBucket(up.error)
        ? 'Uploads are not available yet — the company-docs storage bucket has not been created.'
        : 'Upload failed: ' + up.error.message,
    }, { status: noBucket(up.error) ? 503 : 500 })
  }

  const { error: ue } = await sb.from('registrations').update({
    document_path: path,
    document_name: file.name || `${safe}.${ext}`,
    document_mime: type,
    document_size: file.size,
    document_uploaded_at: new Date().toISOString(),
    document_uploaded_by: grant.employeeId ?? null,
  }).eq('id', id)

  if (ue) {
    // The row is the record; a file with no row pointing at it is litter.
    // Roll the upload back rather than leave one behind.
    await sb.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: ue.message }, { status: 500 })
  }

  // Only now is the previous file safe to drop.
  if (reg.document_path && reg.document_path !== path) {
    await sb.storage.from(BUCKET).remove([reg.document_path])
  }

  return NextResponse.json({ ok: true, name: file.name, mime: type, size: file.size })
}

// ── detach ──────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { right } = await mayWrite(req)
  if (!right.canEdit) return NextResponse.json({ error: right.reason }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Which registration?' }, { status: 400 })

  const { data: reg } = await sb.from('registrations')
    .select('id, document_path').eq('id', id).maybeSingle()
  if (!reg) return NextResponse.json({ error: 'No such registration.' }, { status: 404 })

  // The row is cleared first. If the storage delete fails afterwards the
  // worst case is an orphaned file nobody can reach; clearing the row second
  // would leave a row pointing at bytes that are gone, which is a broken
  // "View" button for everyone.
  const { error } = await sb.from('registrations').update({
    document_path: null, document_name: null, document_mime: null,
    document_size: null, document_uploaded_at: null, document_uploaded_by: null,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (reg.document_path) await sb.storage.from(BUCKET).remove([reg.document_path])
  return NextResponse.json({ ok: true })
}
