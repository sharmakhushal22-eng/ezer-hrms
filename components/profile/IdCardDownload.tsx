'use client'
// components/profile/IdCardDownload.tsx — "Download ID card (PDF)".
//
// The printed counterpart of the digital card above it. Two pages at CR80
// portrait (54 x 85.6 mm), front and back, built in the browser with pdf-lib —
// the same library and the same client-side approach components/payroll/
// PayslipDownload.tsx already uses, so this adds no dependency.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It never prints a working QR. The digital card's code is a 30-second,
// single-use, signed token bound to card_version; printing the live one gives
// you a dead code, and printing a static "EZER-ID|code|name" string — what the
// design reference did — manufactures a permanent forgeable credential that
// cannot be revoked. The PDF carries a deliberately blurred code and a line
// saying where the real one lives. See lib/profile/id-card-pdf.ts.
//
// AND IT NEVER BLOCKS
//
// Missing fields print "Not available" rather than disabling the button. Today
// that matters: blood group is on file for 393 of 398 employees, but an
// emergency contact for 7 and a photo for 1. Gating would stop almost everyone
// from downloading anything, and the fields the card carries are mostly
// HR-owned and locked — an employee cannot fix them even if told to.

import React, { useState } from 'react'
import { buildIdCardPdf, idCardFileName, type IdCardData } from '@/lib/profile/id-card-pdf'

/** Same helper PayslipDownload uses; local because that one is not exported. */
function saveBlob(name: string, data: Uint8Array, type: string) {
  const blob = new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.style.display = 'none'
  document.body.appendChild(a); a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1000)
}

/**
 * A signed photo URL cannot be drawn onto a canvas that we then export —
 * toDataURL on a canvas tainted by a cross-origin image throws a
 * SecurityError. Fetching it as a blob first keeps the canvas clean.
 *
 * A failure here is not a failure of the download: the card falls back to
 * initials on a gradient, which is what 397 of 398 employees get anyway.
 */
async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>(resolve => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

export default function IdCardDownload(props: {
  name: string
  code: string
  company: string
  designation?: string | null
  department?: string | null
  location?: string | null
  doj?: string | null
  blood?: string | null
  photoUrl?: string | null
  emergencyName?: string | null
  emergencyRelation?: string | null
  emergencyPhone?: string | null
  cardNo?: string | null
  validTill?: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setErr(null)
    try {
      const data: IdCardData = {
        name: props.name,
        code: props.code,
        company: props.company,
        designation: props.designation ?? null,
        department: props.department ?? null,
        location: props.location ?? null,
        doj: props.doj ?? null,
        blood: props.blood ?? null,
        cardNo: props.cardNo ?? null,
        validTill: props.validTill ?? null,
        emergencyName: props.emergencyName ?? null,
        emergencyRelation: props.emergencyRelation ?? null,
        emergencyPhone: props.emergencyPhone ?? null,
        photoDataUrl: await toDataUrl(props.photoUrl ?? null),
      }
      const bytes = await buildIdCardPdf(data)
      saveBlob(idCardFileName(data), bytes, 'application/pdf')
    } catch (e) {
      // Said plainly rather than swallowed — a silent no-op on a download
      // button reads as a broken page.
      setErr(e instanceof Error ? e.message : 'Could not build the PDF.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn ghost wide" onClick={run} disabled={busy}>
        {busy ? 'Preparing…' : 'Download ID card (PDF)'}
      </button>
      {/* Says what you get, not how the gate code works. Describing the
          rotation would put the security model on a card anyone can pick up,
          and in help text anyone can read. */}
      <div style={{ fontSize: 10.5, color: 'var(--ez-muted)', marginTop: 6, lineHeight: 1.5 }}>
        Two pages at card size, 54 × 85.6 mm. For identification only — scan at
        the gate from your digital ID above.
      </div>
      {err && (
        <div style={{ fontSize: 11, color: 'var(--ez-critical)', marginTop: 6 }}>{err}</div>
      )}
    </div>
  )
}
