// POST /api/te/upload            multipart: file, kind?   -> { file }
// GET  /api/te/upload?path=…     a one-hour link to open a stored file (&claim_id=… when it is not your own)
//
// POST stores a bill (or a photo of an RC) and answers the file object to send
// back, unchanged, in `files: [...]` of an expense or a leg report
// (POST /api/te/expenses, /api/te/legs/[id]/action). It does NOT attach the file to
// anything: the line that carries it is saved by those routes, which write the
// te_expense_files row. For an RC photo, pass file.storage_path as rc_file_url
// to POST /api/te/vehicles.
//
// Stored the way app/api/travel/upload-bill does it: the existing private
// bucket `onboarding-docs` (a dedicated bucket needs the admin API), the same
// 10 MB limit and file types, a signed URL minted on demand. The path is
//     te/bills/<employee id>/<KIND>_<time>_<file name>
// so "is this file mine" is a prefix check.
//
// What the server works out from the bytes it received (never from what the
// browser says): the SHA-256 fingerprint for the duplicate checks, the
// editing-software / bill-generator hints, and the OCR reading when a provider
// is configured (none is today: lib/te/providers/ocr.ts).
import { NextRequest, NextResponse } from 'next/server'
import { teOpen, teRoute, type TeCall } from '@/lib/te/server'
import { TeHttpError, isUuid, needOneOf, needText, rpcError } from '@/lib/te/errors'
import { fileMetadata, ocrProvider, sha256 } from '@/lib/te/providers/ocr'
import { claimDetail } from '@/lib/te/engine/te-service.js'
import type { TeUploadedFile } from '@/lib/te/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'onboarding-docs'
const MAX_BYTES = 10 * 1024 * 1024
/** What the caller may say the file is. RC = a photo of a registration certificate. */
const KINDS = ['BILL', 'TICKET', 'TOLL_SLIP', 'FASTAG_STATEMENT', 'OTHER', 'RC'] as const
// A phone camera produces JPEG or HEIC; a ride app emails a PDF. Nothing else is a bill.
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
const SIGNED_URL_TTL = 60 * 60

/** The type the bytes say they are. A file named .pdf that is not a PDF is refused. */
function sniff(b: Uint8Array): string | null {
  const hex = Buffer.from(b.subarray(0, 12)).toString('hex')
  const ascii = Buffer.from(b.subarray(0, 12)).toString('latin1')
  if (ascii.startsWith('%PDF-')) return 'application/pdf'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  if (ascii.slice(4, 8) === 'ftyp') return /hei[cfx]|mif1|msf1|hevc/.test(ascii.slice(8, 12)) ? 'image/heic' : null
  return null
}

export async function POST(req: NextRequest) {
  return teRoute(req, async t => {
    const employeeId = await t.employee()

    // A very large body fails while it is being parsed; say so as the rule it is.
    let fd: FormData
    try {
      fd = await req.formData()
    } catch {
      throw new TeHttpError(413, 'FILE_TOO_LARGE', 'That file could not be read, or is too large. Keep it under 10 MB: a photo of the bill is enough.')
    }
    const file = fd.get('file')
    if (!(file instanceof File)) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'Attach the file in a form field named "file".')
    const kind = needOneOf(String(fd.get('kind') || 'BILL').toUpperCase(), KINDS, 'kind')
    if (file.size === 0) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'That file is empty.')
    if (file.size > MAX_BYTES) {
      throw new TeHttpError(413, 'FILE_TOO_LARGE', `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB: a photo of the bill is enough.`)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = sniff(bytes)
    if (!mime || !ALLOWED.includes(mime)) {
      throw new TeHttpError(400, 'FILE_TYPE', 'Attach a photo (JPEG, PNG, WebP, HEIC) or a PDF.')
    }

    const hash = sha256(bytes)
    const safeName = (file.name || 'bill').replace(/[^\w.\-]+/g, '_').slice(-80) || 'bill'
    const path = `te/bills/${employeeId}/${kind}_${Date.now()}_${safeName}`
    const sb = t.sb()
    const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(bytes), { contentType: mime, upsert: false })
    if (up.error) {
      console.error('[te] upload failed', up.error)
      throw new TeHttpError(502, 'UPLOAD_FAILED', 'The file could not be stored. Try again.')
    }

    // OCR is optional, and a scanner that is down must not stop an employee from filing a bill.
    let ocr: TeUploadedFile['ocr'] = null
    let phash: string | null = null
    const scan = ocrProvider()                                   // throws only on a mis-typed provider name
    if (scan && kind !== 'RC') {
      try {
        const read = await scan({ bytes, mime, name: file.name })
        if (read) {
          phash = read.phash
          ocr = { amount: read.amount, date: read.date, gstin: read.gstin, bill_no: read.bill_no, text: read.text }
        }
      } catch (e) {
        console.error('[te] bill scan failed', e)
      }
    }

    const out: TeUploadedFile = {
      kind: kind === 'RC' ? 'OTHER' : kind,
      storage_path: path,
      file_name: file.name || safeName,
      mime_type: mime,
      file_size: file.size,
      sha256: hash,
      phash,
      ocr,
      metadata: kind === 'RC' ? null : fileMetadata(bytes, mime),
    }
    return { file: out }
  })
}

/**
 * Is this path the ticket of a booking on a trip this person is travelling on?
 *
 * Their own trip, or one they are a co-traveller on — te_trip_people carries
 * the second case, and a co-traveller is shown the same bookings. Deliberately not
 * "any trip of the company": a ticket is a named document and this is the one
 * question that should open it.
 */
async function ticketOnMyTrip(
  t: TeCall,
  sb: ReturnType<TeCall['sb']>,
  path: string,
  employeeId: string,
): Promise<boolean> {
  const bk = await sb.from('te_bookings').select('trip_id').eq('ticket_url', path).limit(50)
  if (bk.error) {
    // The column has existed since the table was built; a failure here is real.
    throw rpcError(bk.error, 'te_bookings')
  }
  const tripIds = [...new Set((bk.data ?? []).map(r => r.trip_id as string))]
  if (!tripIds.length) return false
  const mine = await sb.from('te_trips').select('id').in('id', tripIds).eq('employee_id', employeeId).limit(1)
  if (mine.error) throw rpcError(mine.error, 'te_trips')
  if (mine.data?.length) return true
  // A co-traveller is shown the same bookings, so they may open the same
  // ticket. The table is te_trip_people — te_trip_co is a FUNCTION returning
  // their ids, which a PostgREST .from() cannot read, and reaching for it here
  // would have failed quietly and locked every co-traveller out of their own
  // ticket. Only rows whose code was matched to an employee count.
  const co = await sb.from('te_trip_people').select('trip_id')
    .in('trip_id', tripIds).eq('employee_id', employeeId).limit(1)
  if (co.error) throw rpcError(co.error, 'te_trip_people')
  return (co.data?.length ?? 0) > 0
}

export async function GET(req: NextRequest) {
  return teRoute(req, async t => {
    const employeeId = await t.employee()
    const path = needText(req.nextUrl.searchParams.get('path'), 'path')
    if (!path.startsWith('te/bills/') || path.includes('..')) throw new TeHttpError(400, 'TE_BAD_REQUEST', 'That is not a Travel and Expenses file.')
    const sb = t.sb()

    if (!path.startsWith(`te/bills/${employeeId}/`)) {
      // AN RC PHOTO IS NOT A BILL, so it can never name a claim. The Travel
      // Desk is handed rc_file_url for every vehicle waiting on it and the
      // engine refuses the vehicle until somebody has looked — "Attach a photo
      // of the RC. HR checks it before the vehicle is paid." The claim test
      // below made that check impossible: the desk could open only the RCs of
      // its own vehicles, and "Open the RC photo" on the desk screen answered
      // "You can only open your own files" for everybody else's.
      //
      // So the RC is let through on its own terms, and narrowly: the path must
      // BE the rc_file_url of a vehicle of this company — the same company
      // whose queue GET /api/te/desk hands out — and the caller must be on the
      // travel desk or hold the module. Exactly the files the desk was asked
      // to verify, and nothing else that happens to sit in the same folder.
      const rc = await sb.from('te_employee_vehicles')
        .select('id').eq('company_id', await t.company()).eq('rc_file_url', path).limit(1)
      if (rc.error) throw rpcError(rc.error, 'te_employee_vehicles')

      if (rc.data?.length) {
        await t.permitDesk('travel', 'Travel Claims', 'EDIT')
      } else if (await ticketOnMyTrip(t, sb, path, employeeId)) {
        // A TICKET THE DESK BOUGHT FOR THIS PERSON. It is uploaded by whoever
        // is on the desk, so it lands under THEIR folder — and the traveller,
        // whose journey it is, failed the prefix test on their own ticket. The
        // trip screen shows them a link to it, so "You can only open your own
        // files" was the answer to opening their own boarding pass.
        //
        // Exactly the same shape as the RC above, and exactly as narrow: the
        // path must BE the ticket_url of a booking on a trip this person is
        // travelling on. Nothing else in that folder opens.
      } else {
        // Somebody else's file. It is shown only as part of a claim the caller may open
        // (its approvers, Finance, or a role that grants it), and only if it is a bill of that claim.
        const claimId = req.nextUrl.searchParams.get('claim_id')
        if (!isUuid(claimId)) throw new TeHttpError(403, 'TE_FORBIDDEN', 'You can only open your own files.')
        const ctx = await t.ctx()
        const detail = await teOpen(t, 'claim', claimId, admin => claimDetail(ctx, claimId, admin))
        const lineIds = detail.lines.map(l => l.id)
        const f = lineIds.length
          ? await sb.from('te_expense_files').select('id').eq('storage_path', path).in('expense_id', lineIds).limit(1)
          : { data: [], error: null }
        if (f.error) throw rpcError(f.error, 'te_expense_files')
        if (!f.data?.length) throw new TeHttpError(403, 'TE_FORBIDDEN', 'That file is not part of this claim.')
      }
    }

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
    if (signed.error || !signed.data?.signedUrl) throw new TeHttpError(404, 'TE_BAD_REQUEST', 'That file is no longer available.')
    return NextResponse.json({ url: signed.data.signedUrl, expires_in: SIGNED_URL_TTL })
  })
}
