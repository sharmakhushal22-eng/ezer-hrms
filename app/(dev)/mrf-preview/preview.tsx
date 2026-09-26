'use client'
// app/(dev)/mrf-preview/preview.tsx — the harness around the MRF form.
//
// It mounts <MrfForm> in both of the states its two LIVE call sites produce:
//
//   * "Raise new"        — recruitment/page.tsx:1638, no initial, no replaceId.
//   * "Edit & resubmit"  — RoleTabs.tsx:270, prefilled via mrfToForm() with a
//                          replaceId, which is what raises the amber banner.
//
// It mirrors the two things the podium and social previews mirror, so the
// preview cannot flatter the design:
//
//   * <UIKeyframes/>, which carries `button { border-radius:10px !important }`.
//     That rule is global and unbeatable outside `.rx`, so buttons here render
//     at 10px no matter what the form asks for — the same as in ESS.
//   * the --ez-* token surface, via var() on a real canvas background.
//
// NO HEX AND NO z-index IN THIS FILE, deliberately: the theme ratchet fails a
// new file for any hardcoded colour and the z-index ratchet fails a new file
// for any raw number, so the toolbar below is not sticky.
//
// DO NOT PRESS "Submit for Approval" HERE. Save writes a real row through
// /api/ess/mrf. Reading the form is free; submitting it is not.
import { useEffect, useState } from 'react'
import MrfForm, { mrfToForm } from '@/components/ess/MrfForm'
import { UIKeyframes } from '@/lib/ui'

// Rahul Nair (SRS9007) — Senior Manager, Sales & Marketing. Picked because he
// holds L1 + L2 + HOD and has company_id, department_id, l1_manager_id and
// hod_id all populated, so every locked autofill field resolves to a real
// value instead of an em dash.
const EMPLOYEE_ID = 'bf216364-4093-44fe-ab7f-7d2ff39d128b'

// A plausible sent-back requisition, shaped like a manpower_requisitions row.
// Only the columns mrfToForm() reads are set.
const SENT_BACK = {
  id: 'preview-sent-back',
  mrf_type: 'Full MRF',
  hiring_type: 'Replacement',
  urgency: 'HIGH',
  job_title: 'Regional Sales Lead',
  designation: 'Senior Manager',
  no_of_openings: 2,
  employment_type: 'Employee',
  work_mode: 'Hybrid',
  currency: 'INR',
  budget_min: 1800000,
  budget_max: 2400000,
  reason: 'Replacement',
  business_justification: 'Backfill for the west-region lead who exits this quarter.',
  target_joining_date: '2026-11-01',
  validity_date: '2026-12-31',
  experience_min: 6,
  experience_max: 10,
  education_min: 'MBA/PGDM',
  skills_required: 'Channel Sales, Negotiation, Forecasting',
  good_to_have_skills: 'CRM, Territory Planning',
  job_description: 'Own the west-region channel, carry the number, build the team.',
  sourcing_mode: 'Both',
  sourcing_channels: [],
  remarks: 'Budget looks high for the band — please re-check against the grade.',
}

const WIDTHS = [
  { label: 'Desktop', w: 1100 },
  { label: 'Portal column', w: 900 },
  { label: 'Tablet', w: 680 },
  { label: 'Phone', w: 390 },
]

export default function Preview() {
  const [w, setW] = useState(900)
  // null = follow whatever themeBootScript already put on <html>.
  //
  // THIS STARTED AS useState(false) AND THAT WAS WRONG. The effect below wrote
  // the attribute unconditionally on mount, so loading this page with the
  // theme persisted to dark slammed it back to light — which would have made
  // a dark audit here impossible, and quietly. Reading the attribute rather
  // than a storage key also keeps this agnostic to what that key is named.
  const [dark, setDark] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)

  // The same attribute ThemeToggle writes, so dark is exercised through the
  // real path. NOTE: flipping at runtime leaves stale computed styles behind —
  // for an actual audit, persist the theme and RELOAD rather than toggling.
  useEffect(() => {
    if (dark === null) return
    document.documentElement.setAttribute('data-ez-theme', dark ? 'dark' : 'light')
  }, [dark])

  const notify = (text: string, tone: 'success' | 'error' = 'success') => setMsg({ text, tone })

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ez-canvas)', paddingBottom: 60,
                  fontFamily: '"DM Sans","Segoe UI",system-ui,sans-serif' }}>
      <UIKeyframes />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--ez-surface)',
        borderBottom: '1px solid var(--ez-line)', fontSize: 12.5,
      }}>
        <strong style={{ fontSize: 13, color: 'var(--ez-ink)' }}>MRF form — design preview</strong>
        <span style={{ color: 'var(--ez-faint)' }}>live Supabase reads · do not submit</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WIDTHS.map(x => (
            <button key={x.w} type="button" onClick={() => setW(x.w)} style={pill(w === x.w)}>
              {x.label}
            </button>
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

      {msg && (
        <div style={{
          padding: '9px 16px', fontSize: 12.5, fontWeight: 500,
          background: msg.tone === 'error' ? 'var(--ez-critical-tint)' : 'var(--ez-positive-tint)',
          color: msg.tone === 'error' ? 'var(--ez-critical)' : 'var(--ez-positive)',
          borderBottom: '1px solid var(--ez-line)',
        }}>
          notify(): {msg.text}
        </div>
      )}

      <div style={{ width: w, maxWidth: '100%', margin: '18px auto', display: 'grid', gap: 18 }}>
        <div style={{
          border: '1px solid var(--ez-line)', borderRadius: 14,
          background: 'var(--ez-surface)', padding: '14px 18px 18px',
        }}>
          <div style={caseHead}>Raise new — recruitment/page.tsx:1638</div>
          <MrfForm
            employeeId={EMPLOYEE_ID}
            notify={notify}
            onDone={() => notify('onDone() fired')}
            onCancel={() => notify('onCancel() fired')}
          />
        </div>

        <div style={{
          border: '1px solid var(--ez-line)', borderRadius: 14,
          background: 'var(--ez-surface)', padding: '14px 18px 18px',
        }}>
          <div style={caseHead}>Edit &amp; resubmit — RoleTabs.tsx:270</div>
          <MrfForm
            employeeId={EMPLOYEE_ID}
            notify={notify}
            initial={mrfToForm(SENT_BACK)}
            replaceId={SENT_BACK.id}
            onDone={() => notify('onDone() fired')}
            onCancel={() => notify('onCancel() fired')}
          />
        </div>
      </div>
    </div>
  )
}
