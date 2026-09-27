'use client'
// components/attendance/LeaveRulesTab.tsx — HR sets how far back leave may be applied.
//
// Lives under Attendance & Shifts because that is where absence is managed: the
// question this answers is "somebody was absent last Tuesday — can they still
// claim it as sick leave?". The number is stored per company (migration 132)
// and read by BOTH the ESS leave calendar and the server guard that accepts the
// application, so the screen and the API cannot disagree about it.
//
// 0 means no backdating, which is exactly how the product behaved before this
// existed — so a company that wants the old behaviour keeps it by doing nothing.

import { useState } from 'react'
import { C as TK } from '@/lib/ui'
import type { BackdateConfig, CompanyLite } from '@/lib/supabase-shift'

const T = {
  card:  { background: TK.surface, borderRadius: 10, border: '1px solid var(--ez-line)', padding: '14px 16px', marginBottom: 12, boxShadow: 'var(--ez-shadow-flat)' } as React.CSSProperties,
  sec:   { fontSize: 12, fontWeight: 600, color: TK.brand, textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 10 } as React.CSSProperties,
  input: { width: 90, padding: '8px 10px', background: TK.sunken, border: `1px solid ${TK.brandEdge}`, borderRadius: 7, color: TK.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' } as React.CSSProperties,
  pri:   { padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: TK.brand, color: TK.onAccent, whiteSpace: 'nowrap' as const } as React.CSSProperties,
}

/** today + the previous n-1 days, said in words, so HR sees the consequence
 *  rather than the parameter. */
function explain(n: number): string {
  if (!n) return 'No backdating — only today and future dates can be selected.'
  if (n === 1) return 'Today only.'
  const earliest = new Date()
  earliest.setDate(earliest.getDate() - (n - 1))
  const when = earliest.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return `Employees can claim absences back to ${when} — today and the previous ${n - 1} days.`
}

export default function LeaveRulesTab({ companies, windows, onSave, saving }: {
  companies: CompanyLite[]
  windows: BackdateConfig[]
  onSave: (companyId: string, days: number) => void | Promise<void>
  saving?: boolean
}) {
  /**
   * OVERRIDES ONLY — a company with no entry shows what is stored.
   *
   * The first version copied every stored value into state in an effect. Two
   * things wrong with that: it is the copy-props-into-state pattern React's own
   * lint objects to, and it keeps showing what was typed after a save comes
   * back, because nothing clears it. Deriving the displayed value instead means
   * the saved number appears the moment the reload lands, and the effect is
   * gone rather than silenced.
   */
  const [draft, setDraft] = useState<Record<string, string>>({})

  return (
    <div style={T.card}>
      <div style={T.sec}>Backdated leave window</div>
      <div style={{ fontSize: 12, color: TK.muted, marginBottom: 14, lineHeight: 1.6, maxWidth: 680 }}>
        How many days back an employee may apply for leave, counted from today
        inclusive. This is what lets somebody claim an absence that has already
        happened — set it to 0 and only today and future dates can be chosen.
        <br />
        The same number limits the ESS calendar <em>and</em> the server, so an
        employee is never offered a date their application would then be refused.
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 10px', color: TK.muted, fontWeight: 600 }}>Company</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', color: TK.muted, fontWeight: 600, width: 130 }}>Window (days)</th>
            <th style={{ textAlign: 'left', padding: '8px 10px', color: TK.muted, fontWeight: 600 }}>What employees get</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {companies.length === 0 && (
            <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: TK.muted }}>No companies.</td></tr>
          )}
          {companies.map(c => {
            const stored = windows.find(w => w.company_id === c.id)?.window_days ?? 0
            const raw = draft[c.id] ?? String(stored)
            const n = Math.max(0, Math.min(365, Math.floor(Number(raw) || 0)))
            const dirty = n !== stored
            return (
              <tr key={c.id} style={{ borderTop: '1px solid var(--ez-line)' }}>
                <td style={{ padding: '10px', fontWeight: 600, color: TK.ink }}>{c.name}</td>
                <td style={{ padding: '10px' }}>
                  <input
                    style={T.input}
                    type="number" min={0} max={365} step={1}
                    value={raw}
                    onChange={e => setDraft(d => ({ ...d, [c.id]: e.target.value }))}
                  />
                </td>
                <td style={{ padding: '10px', color: TK.muted }}>{explain(n)}</td>
                <td style={{ padding: '10px', textAlign: 'right' }}>
                  <button
                    style={{ ...T.pri, opacity: dirty && !saving ? 1 : .45, cursor: dirty && !saving ? 'pointer' : 'default' }}
                    disabled={!dirty || !!saving}
                    // Drop the override so the row falls back to whatever the
                    // reload brings back — the stored truth, not what was typed.
                    onClick={() => {
                      setDraft(d => { const next = { ...d }; delete next[c.id]; return next })
                      onSave(c.id, n)
                    }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 14, lineHeight: 1.6 }}>
        Capped at 365 days. Leave taken outside the current financial year is not
        counted by the balance arithmetic, so a window wide enough to cross two
        financial years would approve leave that is never deducted from anybody&rsquo;s
        entitlement.
      </div>
    </div>
  )
}
