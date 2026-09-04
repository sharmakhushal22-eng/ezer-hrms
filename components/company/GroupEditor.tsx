'use client'
// components/company/GroupEditor.tsx — editing the group, and adding a company
// to it.
//
// ── AUTHORISATION IS NOT IN THIS FILE ───────────────────────────────────────
// Nothing here decides who may edit. The panel only opens for somebody the
// SERVER has already said may edit, and every write goes to
// /api/company/profile, which checks the caller's grant again before touching
// a row. That double check is deliberate: this component runs in the browser,
// where a determined person can call the endpoint directly and skip the panel
// entirely. Hiding the button is a courtesy; the route is the control.

import { useState } from 'react'
import { C, F, W, R } from '@/lib/ui'
import { updateRow, createRow } from '@/lib/company/client'
import type { GroupTree } from '@/lib/supabase-company-profile'

/** Fields the panel edits, and how each is entered. `pending` marks the ones
 *  that need migration 079 — shown with a note rather than hidden, so nobody
 *  wonders why the brief's field is missing. */
const GROUP_FIELDS: {
  key: string; label: string; hint?: string
  type?: 'text' | 'date' | 'colour' | 'area'; pending?: boolean
}[] = [
  { key: 'group_name',      label: 'Group name',  hint: 'Shown across the app and on letterheads' },
  { key: 'group_code',      label: 'Group code',  hint: '2–5 letters; prefixes every company code' },
  { key: 'country',         label: 'Country' },
  { key: 'icon_emoji',      label: 'Group icon',  hint: 'One emoji, used where the logo will not fit', pending: true },
  { key: 'tagline',         label: 'Tagline',     pending: true },
  { key: 'website_url',     label: 'Website',     pending: true },
  { key: 'head_office',     label: 'Head office', type: 'area', pending: true },
  { key: 'contact_email',   label: 'Contact email',  pending: true },
  { key: 'contact_phone',   label: 'Contact phone',  pending: true },
  { key: 'holding_pan',     label: 'Holding PAN',    pending: true },
  { key: 'holding_cin',     label: 'Holding CIN',    pending: true },
  { key: 'incorporated_on', label: 'Incorporated', type: 'date', pending: true },
  { key: 'brand_primary',   label: 'Brand colour',   type: 'colour', pending: true },
  { key: 'brand_secondary', label: 'Brand accent',   type: 'colour', pending: true },
  { key: 'description',     label: 'About the group', type: 'area', pending: true },
]

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 14,
  fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
  background: C.sunken, color: C.ink, border: `1.5px solid ${C.line}`,
}

export function GroupEditor({ g, onClose, onSaved, notify }: {
  g: GroupTree
  onClose: () => void
  onSaved: () => void
  notify: (m: string, t?: 'success' | 'error') => void
}) {
  const [tab, setTab] = useState<'details' | 'company'>('details')
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(GROUP_FIELDS.map(f => [f.key, String((g as any)[f.key] ?? '')])))
  const [busy, setBusy] = useState(false)

  // A new company needs enough to be a valid row and to be findable. The rest
  // is filled in on the company card afterwards — a fifteen-field creation
  // form is how a company ends up half-entered and abandoned.
  const [co, setCo] = useState({ company_name: '', company_code: '', company_type: '', industry: '' })

  const dirty = GROUP_FIELDS.filter(f => draft[f.key] !== String((g as any)[f.key] ?? ''))

  async function saveGroup() {
    if (!dirty.length) { notify('Nothing changed.'); return }
    setBusy(true)
    try {
      // One PATCH with every changed field rather than one per field: the
      // audit trail records a row per field either way, but a single request
      // cannot leave the group half-saved if the connection drops.
      await updateRow('GROUP', g.id, Object.fromEntries(dirty.map(f => [f.key, draft[f.key]])))
      notify(`Saved ${dirty.length} field${dirty.length === 1 ? '' : 's'}. Logged.`)
      onSaved(); onClose()
    } catch (e: any) {
      notify('Save failed: ' + (e?.message || 'unknown'), 'error')
    } finally { setBusy(false) }
  }

  async function addCompany() {
    if (!co.company_name.trim() || !co.company_code.trim()) {
      notify('Name and code are both required.', 'error'); return
    }
    setBusy(true)
    try {
      // group_id is passed as company_id because that is the route's parameter
      // name for "the parent this row belongs to"; for a company under a
      // group, the parent IS the group.
      await createRow('COMPANY', null, {
        group_id: g.id,
        company_name: co.company_name.trim(),
        company_code: co.company_code.trim().toUpperCase(),
        company_type: co.company_type.trim() || null,
        industry: co.industry.trim() || null,
        status: 'Active',
      })
      notify(`${co.company_name.trim()} added to ${g.group_name}.`)
      onSaved(); onClose()
    } catch (e: any) {
      notify('Could not add the company: ' + (e?.message || 'unknown'), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(8,12,22,.55)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '5vh 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 720, background: C.surface, borderRadius: 18,
        border: `1px solid ${C.line}`,
        boxShadow: '0 24px 64px -12px rgba(8,12,22,.5)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '18px 22px', color: C.onDark,
          background: `linear-gradient(104deg, ${C.dark} 0%, ${C.darkMid} 52%, ${C.darkAccent} 100%)`,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.16em',
                        textTransform: 'uppercase', color: 'rgba(125,211,252,.95)' }}>Edit group</div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.02em', marginTop: 3 }}>
            {g.group_name}
          </div>
          <div style={{ fontSize: 11.5, color: C.onDarkMuted, marginTop: 4 }}>
            Every change is written to the audit trail with your name against it.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '12px 22px 0' }}>
          {([['details', 'Group details'], ['company', 'Add a company']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '7px 14px', borderRadius: R.pill, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 12, fontWeight: tab === k ? W.bold : W.semi,
              border: `1px solid ${tab === k ? 'transparent' : C.line}`,
              background: tab === k ? C.brand : C.surface,
              color: tab === k ? C.onAccent : C.inkSoft,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ padding: '16px 22px 20px' }}>
          {tab === 'details' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
                {GROUP_FIELDS.map(f => (
                  <div key={f.key} style={{ gridColumn: f.type === 'area' ? '1 / -1' : 'auto' }}>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: W.bold, color: C.muted,
                                    textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                      {f.label}
                      {f.pending && (
                        <span title="Needs migration 079 — saving this field will fail until it is applied"
                          style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: R.pill,
                                   background: C.warningTint, color: C.warning, letterSpacing: 0 }}>079</span>
                      )}
                    </label>
                    {f.type === 'area' ? (
                      <textarea rows={2} value={draft[f.key] ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                        style={{ ...inputStyle, resize: 'vertical' }} />
                    ) : f.type === 'colour' ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="color" value={draft[f.key] || '#2563EB'}
                          onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                          style={{ width: 44, height: 34, padding: 2, borderRadius: 8,
                                   border: `1px solid ${C.line}`, background: C.sunken, cursor: 'pointer' }} />
                        <input value={draft[f.key] ?? ''} placeholder="#2563EB"
                          onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                          style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }} />
                      </div>
                    ) : (
                      <input type={f.type === 'date' ? 'date' : 'text'} value={draft[f.key] ?? ''}
                        onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                        style={inputStyle} />
                    )}
                    {f.hint && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{f.hint}</div>}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                <button onClick={saveGroup} disabled={busy || !dirty.length} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none',
                  cursor: dirty.length && !busy ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', fontSize: 13.5, fontWeight: W.bold, color: '#FFFFFF',
                  background: dirty.length ? `linear-gradient(145deg, ${C.brand}, ${C.brandDeep})` : C.line,
                  opacity: busy ? .7 : 1,
                }}>{busy ? 'Saving…' : dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'No changes'}</button>
                <button onClick={onClose} disabled={busy} style={{
                  padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.line}`,
                  background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: W.semi, color: C.inkSoft,
                }}>Cancel</button>
                {/* Naming the fields rather than a count: "3 changes" does not
                    tell you whether you edited the one you meant to. */}
                {dirty.length > 0 && (
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {dirty.map(f => f.label).join(', ')}
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
                {([
                  ['company_name', 'Legal entity name', 'As on the certificate of incorporation'],
                  ['company_code', 'Company code', '2–5 letters, e.g. SRS'],
                  ['company_type', 'Entity type', 'Private Limited, LLP, Partnership…'],
                  ['industry', 'Industry sector', ''],
                ] as const).map(([k, label, hint]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: 10, fontWeight: W.bold, color: C.muted,
                                    textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>
                      {label}{(k === 'company_name' || k === 'company_code') &&
                        <span style={{ color: C.critical, marginLeft: 3 }}>*</span>}
                    </label>
                    <input value={(co as any)[k]}
                      onChange={e => setCo(c => ({ ...c, [k]: e.target.value }))}
                      style={inputStyle} />
                    {hint && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 3 }}>{hint}</div>}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, padding: '10px 13px', borderRadius: 10,
                            background: C.brandTint, border: `1px solid ${C.brandEdge}`,
                            fontSize: 11.5, color: C.brandDeep, lineHeight: 1.55 }}>
                Only these four are needed to create the company. Branches, registrations,
                bank accounts and the rest are added on its own card afterwards — a long
                creation form is how an entity ends up half-entered.
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button onClick={addCompany} disabled={busy} style={{
                  padding: '10px 20px', borderRadius: 10, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: 13.5, fontWeight: W.bold, color: '#FFFFFF',
                  background: `linear-gradient(145deg, ${C.positive}, ${C.positive}CC)`, opacity: busy ? .7 : 1,
                }}>{busy ? 'Adding…' : 'Add company to group'}</button>
                <button onClick={onClose} disabled={busy} style={{
                  padding: '10px 16px', borderRadius: 10, border: `1px solid ${C.line}`,
                  background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: W.semi, color: C.inkSoft,
                }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
