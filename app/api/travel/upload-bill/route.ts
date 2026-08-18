// ============================================================================
// EZER HRMS — Travel Claim Module
// app/api/travel/upload-bill/route.ts
//
//   POST   multipart { travel_log_id, file, attachment_type? }   attach a slip
//   GET    ?travel_log_id=...                                    list slips
//   GET    ?path=...                                             signed view URL
//   DELETE ?id=...                                               remove a slip
//
// The proof half of a travel claim. A GPS-priced journey is evidenced by its
// recorded trail; a billed one is evidenced by the receipt — an Uber or Ola
// summary, a taxi slip, a toll receipt. Without this the MISSING_BILL flag
// raised at entry could never be satisfied: the employee was told to attach a
// bill and had nowhere to attach it.
//
// ----------------------------------------------------------------------------
// TWO THINGS THAT MATTER MORE THAN THE UPLOAD ITSELF
// ----------------------------------------------------------------------------
// 1. DUPLICATE DETECTION. Every file is hashed (SHA-256) into
//    travel_attachments.file_hash. The same receipt attached to two journeys is
//    the obvious way to claim one ride twice, and it is invisible to a human
//    reviewer looking at one claim at a time. A repeat hash does not block the
//    upload — a legitimate case exists, a single Ola invoice covering a
//    round trip logged as two legs — but it is flagged for the approver.
//
// 2. WHO MAY SEE IT. A receipt carries a home address, a name, a card tail.
//    An employee attaches and views only their own; a dashboard user may view
//    any, which is how HR and Finance check the proof. Enforced through
//    resolveActor against the journey's owner, not against a supplied id.
//
// Storage: the existing onboarding-docs bucket under travel/bills/, mirroring
// app/api/recruitment/upload-mrf-doc/route.ts. A dedicated bucket would need
// the admin API, which this deployment's key cannot reach; a path prefix in a
// private bucket gives the same isolation for what we can actually do here.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { serviceClient } from '@/lib/travel/access';
import { resolveActor } from '@/lib/travel/actor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'onboarding-docs';
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ['BILL', 'TOLL_SLIP', 'FASTAG_STATEMENT', 'BOOKING', 'OTHER'] as const;

// A phone camera produces JPEG or HEIC; a ride app emails a PDF. Anything else
// is either a mistake or someone testing what the endpoint accepts.
const ALLOWED = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
];

const SIGNED_URL_TTL = 60 * 60; // one hour: long enough to review, short enough not to leak

/** Loads the journey and confirms this caller may touch it. */
async function journeyForActor(req: NextRequest, logId: string) {
  const sb = serviceClient();
  const { data: log } = await sb
    .from('travel_logs')
    .select('id, employee_id, company_id, claim_id, type_code, log_date, total_amount, status')
    .eq('id', logId)
    .maybeSingle();

  if (!log) return { error: NextResponse.json({ error: 'Journey not found' }, { status: 404 }) };

  const actor = await resolveActor(req, log.employee_id);
  if (!actor.ok) return { error: actor.response };
  if (!actor.onBehalf && actor.employeeId !== log.employee_id) {
    return {
      error: NextResponse.json(
        { error: 'You can only attach bills to your own journeys.' },
        { status: 403 },
      ),
    };
  }
  return { sb, log, actor };
}

// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    // No token at all: refuse before the lookup, so this is not a probe for
    // valid journey ids.
    if (!req.headers.get('authorization')) {
      return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
    }

    // Parsing is what fails on a very large body — the framework rejects it
    // before any check of mine runs, which surfaced as a 500. A 10 MB cap is a
    // rule, so it should read like one.
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      return NextResponse.json(
        {
          error: 'That file is too large to upload. Keep it under 10 MB — a photo of the slip is enough.',
          code: 'FILE_TOO_LARGE',
        },
        { status: 413 },
      );
    }

    const logId = fd.get('travel_log_id') as string | null;
    const kind = ((fd.get('attachment_type') as string) || 'BILL').toUpperCase();
    const file = fd.get('file') as File | null;

    if (!logId || !file) {
      return NextResponse.json(
        { error: 'travel_log_id and file are both required.' },
        { status: 400 },
      );
    }
    if (!KINDS.includes(kind as (typeof KINDS)[number])) {
      return NextResponse.json({ error: `attachment_type must be one of ${KINDS.join(', ')}` }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB — a photo of the slip is enough.`,
          code: 'FILE_TOO_LARGE' },
        { status: 413 },
      );
    }
    if (file.type && !ALLOWED.includes(file.type)) {
      return NextResponse.json(
        { error: `${file.type} is not accepted. Attach a photo (JPEG, PNG, HEIC) or a PDF.` },
        { status: 400 },
      );
    }

    const gate = await journeyForActor(req, logId);
    if ('error' in gate) return gate.error;
    const { sb, log, actor } = gate;

    // A claim already with an approver should not have its evidence changed
    // underneath them. SENT_BACK reopens the journey, so that case is allowed.
    if (log.claim_id) {
      const { data: claim } = await sb
        .from('travel_claims').select('status, claim_no').eq('id', log.claim_id).maybeSingle();
      const editable = !claim || claim.status === 'DRAFT' || claim.status === 'SENT_BACK';
      if (!editable && !actor.onBehalf) {
        return NextResponse.json(
          {
            error: `${claim.claim_no} has already been submitted, so its bills cannot be changed. Ask HR to send it back if a bill is missing.`,
            code: 'CLAIM_LOCKED',
          },
          { status: 409 },
        );
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    // ---- has this exact file been attached before? ------------------------
    // Scoped to the same employee's other journeys and to any journey in the
    // company, so a receipt passed between colleagues is caught too.
    const { data: sameHash } = await sb
      .from('travel_attachments')
      .select('id, travel_log_id, file_name, uploaded_at, uploaded_by')
      .eq('file_hash', hash)
      .neq('travel_log_id', logId);

    const duplicates = sameHash ?? [];
    let duplicateOf: { log_id: string; log_date: string | null; purpose: string | null; amount: number | null } | null = null;

    if (duplicates.length) {
      const { data: otherLog } = await sb
        .from('travel_logs')
        .select('id, log_date, purpose, total_amount, employee_id')
        .eq('id', duplicates[0].travel_log_id)
        .maybeSingle();
      if (otherLog) {
        duplicateOf = {
          log_id: otherLog.id,
          log_date: otherLog.log_date,
          purpose: otherLog.purpose,
          amount: otherLog.total_amount,
        };
      }
    }

    // ---- store it ---------------------------------------------------------
    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'bill';
    const path = `travel/bills/${log.employee_id}/${logId}/${kind}_${Date.now()}_${safeName}`;

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type || 'application/octet-stream', upsert: false });

    if (upErr) {
      return NextResponse.json({ error: 'Upload failed: ' + upErr.message }, { status: 500 });
    }

    const { data: row, error: insErr } = await sb
      .from('travel_attachments')
      .insert({
        travel_log_id: logId,
        attachment_type: kind,
        file_url: path, // the storage path; a signed URL is minted on demand
        file_hash: hash,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: actor.employeeId,
      })
      .select()
      .single();

    if (insErr) {
      // Do not leave an orphan in the bucket that nothing points at.
      await sb.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: 'Could not record the bill: ' + insErr.message }, { status: 500 });
    }

    // ---- the flags this changes ------------------------------------------
    // MISSING_BILL was raised at entry telling the employee to attach a bill.
    // It has now been satisfied, so it is resolved rather than left to worry an
    // approver about something that is sitting right in front of them.
    await sb
      .from('travel_flags')
      .update({ resolved_by: actor.employeeId, resolved_at: new Date().toISOString() })
      .eq('travel_log_id', logId)
      .eq('flag_type', 'MISSING_BILL')
      .is('resolved_at', null);

    if (duplicateOf) {
      await sb.from('travel_flags').insert({
        travel_log_id: logId,
        flag_type: 'DUPLICATE',
        severity: 'WARN',
        message:
          `This exact bill is already attached to another journey on ${duplicateOf.log_date} ` +
          `(${duplicateOf.purpose ?? 'no purpose given'}, ₹${duplicateOf.amount ?? '—'}). ` +
          'Same file, byte for byte. It may be one invoice covering both legs — confirm before approving.',
      });
    }

    const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);

    return NextResponse.json({
      attachment: { ...row, url: signed?.signedUrl ?? null },
      duplicate: duplicateOf,
      message: duplicateOf
        ? 'Bill attached, but it is the same file as another journey — your approver will see a note.'
        : 'Bill attached.',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not attach the bill' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — the slips on a journey, or a fresh signed URL for one path.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    if (!req.headers.get('authorization')) {
      return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
    }

    const p = req.nextUrl.searchParams;
    const logId = p.get('travel_log_id');
    const path = p.get('path');

    // A single path: mint a signed URL, but only after proving the caller may
    // see the journey it belongs to. Otherwise any path string is a free read.
    if (path) {
      const sb = serviceClient();
      const { data: att } = await sb
        .from('travel_attachments').select('travel_log_id').eq('file_url', path).maybeSingle();
      if (!att) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

      const gate = await journeyForActor(req, att.travel_log_id!);
      if ('error' in gate) return gate.error;

      const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ url: signed.signedUrl });
    }

    if (!logId) {
      return NextResponse.json({ error: 'travel_log_id or path is required' }, { status: 400 });
    }

    const gate = await journeyForActor(req, logId);
    if ('error' in gate) return gate.error;
    const { sb } = gate;

    const { data: rows } = await sb
      .from('travel_attachments')
      .select('*')
      .eq('travel_log_id', logId)
      .order('uploaded_at', { ascending: true });

    // Signed per row — the bucket is private, so a stored path is not viewable
    // on its own.
    const attachments = await Promise.all(
      (rows ?? []).map(async (a) => {
        const { data: s } = await sb.storage.from(BUCKET).createSignedUrl(a.file_url, SIGNED_URL_TTL);
        return { ...a, url: s?.signedUrl ?? null };
      }),
    );

    return NextResponse.json({ attachments });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not load the bills' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a slip the employee attached by mistake.
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    if (!req.headers.get('authorization')) {
      return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
    }

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const sb = serviceClient();
    const { data: att } = await sb
      .from('travel_attachments').select('*').eq('id', id).maybeSingle();
    if (!att) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const gate = await journeyForActor(req, att.travel_log_id!);
    if ('error' in gate) return gate.error;
    const { log, actor } = gate;

    // Evidence under review is not the employee's to withdraw.
    if (log.claim_id) {
      const { data: claim } = await sb
        .from('travel_claims').select('status, claim_no').eq('id', log.claim_id).maybeSingle();
      const editable = !claim || claim.status === 'DRAFT' || claim.status === 'SENT_BACK';
      if (!editable && !actor.onBehalf) {
        return NextResponse.json(
          { error: `${claim.claim_no} has been submitted — its bills can no longer be removed.`, code: 'CLAIM_LOCKED' },
          { status: 409 },
        );
      }
    }

    await sb.storage.from(BUCKET).remove([att.file_url]);
    const { error } = await sb.from('travel_attachments').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // The bill is gone, so the requirement to have one applies again.
    const { data: left } = await sb
      .from('travel_attachments').select('id').eq('travel_log_id', att.travel_log_id!).limit(1);
    if (!left?.length) {
      await sb
        .from('travel_flags')
        .update({ resolved_by: null, resolved_at: null })
        .eq('travel_log_id', att.travel_log_id!)
        .eq('flag_type', 'MISSING_BILL');
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not remove the bill' },
      { status: 500 },
    );
  }
}
