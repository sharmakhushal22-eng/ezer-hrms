'use client'
// app/(dev)/offer-flow-preview/preview.tsx — the harness around the offer flow.
//
// DO NOT PRESS "Submit for Approval" HERE. CreateOfferApproval writes for real:
// it updates ctc_negotiations, inserts into offer_approval_requests and writes
// a recruitment_audit_logs row. Reading the form is free; submitting it is not.
// HRManagerSendOffer only reads on mount (offer_approval_requests), so it is
// safe to look at.
//
// The rows below are REAL and fetched at runtime, not mocked. A fabricated
// negotiation would exercise different branches — is_stipend, hike_pct,
// variable_pct and the bonus fields all drive layout — and would give false
// confidence about fields that never rendered.
//
// NO HEX AND NO z-index in this file: the theme ratchet fails a new file for
// any hardcoded colour and the z-index ratchet for any raw number.
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CreateOfferApproval, HRManagerSendOffer } from '@/app/dashboard/recruitment/offer-flow-components'
import { UIKeyframes } from '@/lib/ui'
// THE SHEET MUST BE LOADED HERE TOO, and forgetting it made this harness
// reproduce the very bug fixed in 7c04240: these panes use rx-* classes, the
// stylesheet is loaded by app/dashboard/recruitment/layout.tsx, and a route
// layout does not run for /offer-flow-preview. Without this import every
// rx-label and rx-input measured 16px/h24/r0 — unstyled — which reads like a
// failed conversion when it is really a missing stylesheet.
//
// mrf-preview needs no such import because MrfForm is inline-styled by design;
// that is exactly why this trap did not bite there.
import '@/lib/ui/recruitment.redesign.css'

const WIDTHS = [
  { label: 'Desktop', w: 1180 },
  { label: 'Portal column', w: 900 },
  { label: 'Tablet', w: 680 },
  { label: 'Phone', w: 390 },
]

export default function Preview() {
  const [w, setW] = useState(1180)
  // null = follow whatever themeBootScript already put on <html>. Writing the
  // attribute unconditionally on mount would slam a persisted dark reload back
  // to light, which is how mrf-preview's first version made a dark audit
  // impossible, and quietly.
  const [dark, setDark] = useState<boolean | null>(null)
  const [row, setRow] = useState<{ candidate: unknown; negotiation: unknown; mrf: unknown } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (dark === null) return
    document.documentElement.setAttribute('data-ez-theme', dark ? 'dark' : 'light')
  }, [dark])

  // Pull a real negotiation and its candidate + MRF, the same three props
  // page.tsx:4215 passes.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const supabase = createClient()
        const { data: negs } = await supabase.from('ctc_negotiations').select('*').limit(1)
        const negotiation = negs?.[0]
        if (!negotiation) { if (live) setErr('No ctc_negotiations row to preview against.'); return }
        const { data: cands } = await supabase.from('candidates').select('*').eq('id', negotiation.candidate_id).limit(1)
        const candidate = cands?.[0] ?? null
        const { data: mrfs } = candidate?.mrf_id
          ? await supabase.from('manpower_requisitions').select('*').eq('id', candidate.mrf_id).limit(1)
          : { data: [] as unknown[] }
        if (live) setRow({ candidate, negotiation, mrf: mrfs?.[0] ?? null })
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { live = false }
  }, [])

  const pill = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--ez-brand)' : 'var(--ez-line)'}`,
    background: on ? 'var(--ez-brand-tint)' : 'var(--ez-surface)',
    color: on ? 'var(--ez-brand)' : 'var(--ez-muted)',
  })
  const caseHead: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
    color: 'var(--ez-muted)', marginBottom: 12,
  }
  const frame: React.CSSProperties = {
    border: '1px solid var(--ez-line)', borderRadius: 14,
    background: 'var(--ez-surface)', padding: '14px 18px 18px', marginBottom: 18,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ez-canvas)', paddingBottom: 60,
                  fontFamily: '"DM Sans","Segoe UI",system-ui,sans-serif' }}>
      <UIKeyframes />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '10px 16px', background: 'var(--ez-surface)',
                    borderBottom: '1px solid var(--ez-line)', fontSize: 12.5 }}>
        <strong style={{ fontSize: 13, color: 'var(--ez-ink)' }}>Offer flow — design preview</strong>
        <span style={{ color: 'var(--ez-critical)', fontWeight: 600 }}>live Supabase · do NOT submit</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WIDTHS.map(x => (
            <button key={x.w} type="button" onClick={() => setW(x.w)} style={pill(w === x.w)}>{x.label}</button>
          ))}
          <button
            type="button"
            onClick={() => setDark(d => (d === null
              ? document.documentElement.getAttribute('data-ez-theme') !== 'dark'
              : !d))}
            style={{ ...pill(false), borderColor: 'var(--ez-line-strong)', color: 'var(--ez-ink)' }}
          >{dark === null ? 'Toggle theme' : dark ? 'Light' : 'Dark'}</button>
        </span>
      </div>

      <div style={{ width: w, maxWidth: '100%', margin: '18px auto' }}>
        <div style={frame}>
          <div style={caseHead}>CreateOfferApproval — recruitment/page.tsx:4215 (21 sites)</div>
          {err && <div style={{ fontSize: 12.5, color: 'var(--ez-critical)' }}>{err}</div>}
          {!err && !row && <div style={{ fontSize: 12.5, color: 'var(--ez-muted)' }}>Loading a real negotiation…</div>}
          {row && (
            <CreateOfferApproval
              candidate={row.candidate}
              negotiation={row.negotiation}
              mrf={row.mrf}
              onSubmitted={() => { /* harness: never submitted */ }}
            />
          )}
        </div>

        <div style={frame}>
          <div style={caseHead}>HRManagerSendOffer — recruitment/page.tsx:439 (8 sites)</div>
          {/* Every prop is optional and it loads its own approved list on mount. */}
          <HRManagerSendOffer />
        </div>
      </div>
    </div>
  )
}
