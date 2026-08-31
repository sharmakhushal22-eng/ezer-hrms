'use client'
// components/company/Compliance.tsx — the statutory register for one company.
//
// Every registration a company is expected to hold gets a row WHETHER OR NOT
// it exists. A table that only lists what has been entered answers "what do we
// have"; this screen has to answer "what are we missing", which is the question
// that carries a penalty. All seven rows are always present, and an absent one
// says "Not recorded" rather than not appearing.
//
// Validity is shown next to the number rather than in a separate column of
// dates: a registration number without its expiry is not useful for compliance,
// and separating them makes you read two places to answer one question.

import { useState } from 'react'
import { C, F, W, R } from '@/lib/ui'
import {
  REG_TYPES, regHealth,
  type Registration, type Company, type Branch, type RegHealth,
} from '@/lib/supabase-company-profile'

const HEALTH: Record<RegHealth, { label: (d: number | null) => string; fg: string; bg: string }> = {
  MISSING:   { label: () => 'Not recorded',                       fg: C.critical, bg: C.criticalTint },
  EXPIRED:   { label: d => `Expired ${Math.abs(d ?? 0)}d ago`,    fg: C.critical, bg: C.criticalTint },
  EXPIRING:  { label: d => `Expires in ${d}d`,                    fg: C.warning,  bg: C.warningTint },
  VALID:     { label: d => `Valid · ${d}d left`,                  fg: C.positive, bg: C.positiveTint },
  NO_EXPIRY: { label: () => 'No expiry recorded',                 fg: C.muted,    bg: C.sunken },
}

function Pill({ h, days }: { h: RegHealth; days: number | null }) {
  const s = HEALTH[h]
  return (
    <span style={{
      fontSize: F.micro, fontWeight: W.semi, padding: '2px 9px', borderRadius: R.pill,
      background: s.bg, color: s.fg, whiteSpace: 'nowrap',
    }}>{s.label(days)}</span>
  )
}

/** Inline editor for one field. Commits on blur or Enter, cancels on Escape —
 *  the same interaction the rest of this screen already uses, so nothing here
 *  behaves differently from the fields beside it. */
function Cell({ value, placeholder, type = 'text', onSave }: {
  value: string | null; placeholder: string; type?: 'text' | 'date'
  onSave: (v: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  if (!editing) {
    return (
      <button onClick={() => { setDraft(value ?? ''); setEditing(true) }}
        title="Click to edit"
        style={{
          background: 'none', border: 'none', padding: '2px 0', cursor: 'text', textAlign: 'left',
          fontFamily: 'inherit', fontSize: F.small,
          color: value ? C.ink : C.faint,
          fontVariantNumeric: 'tabular-nums',
        }}>
        {value || placeholder}
      </button>
    )
  }
  const commit = async () => {
    setBusy(true); await onSave(draft.trim()); setBusy(false); setEditing(false)
  }
  return (
    <input autoFocus type={type} value={draft} disabled={busy}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      style={{
        width: type === 'date' ? 132 : '100%', maxWidth: 220,
        padding: '4px 7px', fontSize: F.small, fontFamily: 'inherit',
        border: `1px solid ${C.brand}`, borderRadius: R.sm,
        background: C.surface, color: C.ink, outline: 'none',
      }} />
  )
}

export function Compliance({ co, regs, isMobile, onSave }: {
  co: Company
  regs: Registration[]
  isMobile: boolean
  onSave: (reg_type: string, patch: Record<string, string | null>, location_id?: string | null) => Promise<void>
}) {
  // Company-level registrations only — a branch certificate is shown on its
  // own branch card, where the address it belongs to is already on screen.
  const byType = new Map<string, Registration>()
  for (const r of regs) if (!r.location_id) byType.set(r.reg_type, r)

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '160px 1fr 132px 132px 150px',
        gap: 10, padding: '8px 12px', background: C.sunken,
        fontSize: F.micro, fontWeight: W.bold, color: C.muted,
        letterSpacing: .3, textTransform: 'uppercase',
      }}>
        <span>Registration</span>
        {!isMobile && <><span>Number</span><span>Valid from</span><span>Valid till</span><span>Status</span></>}
      </div>

      {REG_TYPES.map(t => {
        const r = byType.get(t.code)
        // Fall back to the legacy single column on companies for the three
        // that have one. A number entered before this table existed should not
        // read as "Not recorded".
        const legacyVal = t.legacy ? ((co as any)[t.legacy] as string | null) : null
        const number = r?.reg_number || legacyVal || null
        const h = regHealth(r ?? (number ? ({ reg_number: number } as Registration) : undefined))

        return (
          <div key={t.code} style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '160px 1fr 132px 132px 150px',
            gap: 10, padding: '9px 12px', alignItems: 'center',
            borderTop: `1px solid ${C.line}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: F.small, fontWeight: W.semi, color: C.ink }}>{t.label}</span>
              {t.scope === 'BRANCH' && (
                <span title="Held per establishment — see the branch cards below"
                  style={{ fontSize: 9, padding: '1px 5px', borderRadius: R.pill,
                           background: C.brandTint, color: C.brandDeep, fontWeight: W.semi }}>per site</span>
              )}
            </div>
            <Cell value={number} placeholder="Not recorded"
              onSave={v => onSave(t.code, { reg_number: v || null })} />
            <Cell value={r?.valid_from ?? null} placeholder="—" type="date"
              onSave={v => onSave(t.code, { valid_from: v || null })} />
            <Cell value={r?.valid_till ?? null} placeholder="—" type="date"
              onSave={v => onSave(t.code, { valid_till: v || null })} />
            <Pill h={h.state} days={h.days} />
          </div>
        )
      })}
    </div>
  )
}

/** The certificate for one branch: which licence it holds, its number and its
 *  expiry. A factory needs a Factory Licence; a shop or office needs a Shops &
 *  Establishment registration — so the row offered depends on what the branch
 *  actually is rather than showing both and letting somebody guess. */
export function BranchCertificate({ branch, regs, onSave }: {
  branch: Branch
  regs: Registration[]
  onSave: (reg_type: string, patch: Record<string, string | null>, location_id: string) => Promise<void>
}) {
  const isFactory = (branch.location_type || '').toLowerCase().includes('factory')
  const type = isFactory ? 'FACTORY' : 'SE'
  const label = isFactory ? 'Factory Licence' : 'S&E Registration'
  const r = regs.find(x => x.location_id === branch.id && x.reg_type === type)
  const h = regHealth(r)

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.muted,
                       letterSpacing: .3, textTransform: 'uppercase' }}>{label}</span>
        <Pill h={h.state} days={h.days} />
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: F.micro, color: C.faint }}>Certificate no.</div>
          <Cell value={r?.reg_number ?? null} placeholder="Not recorded"
            onSave={v => onSave(type, { reg_number: v || null }, branch.id)} />
        </div>
        <div>
          <div style={{ fontSize: F.micro, color: C.faint }}>Valid till</div>
          <Cell value={r?.valid_till ?? null} placeholder="—" type="date"
            onSave={v => onSave(type, { valid_till: v || null }, branch.id)} />
        </div>
      </div>
    </div>
  )
}
