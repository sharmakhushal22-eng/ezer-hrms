'use client'
// components/rms/ManagerInformation.tsx — who this employee reports to.
//
// The names are never rendered from a text column. They come from
// employee_relationships through /api/rms/hierarchy, so moving somebody's manager in the
// data moves it here, and so a manager who has since left shows their real record rather
// than a string that was typed once and never revisited.
//
// Levels that do not exist for a person are absent rather than shown empty: the workbook
// collapses a level when the same person already appears below it, and rendering three
// cards where the organisation has one would be inventing structure.
import { useManagerChain } from '@/lib/rms/client'
import type { ManagerSlot } from '@/lib/rms/hierarchy'

const P = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleBg: '#EEEDFE',
  border: '#E9E7F5', text: '#1E1B4B', muted: '#6B6B7B',
}

const LEVEL_LABEL: Record<string, string> = {
  L1: 'L1 Manager',
  L2: 'L2 Manager',
  L3: 'L3 Manager',
  L4: 'L4 Manager',
  HOD: 'Head of Department',
}

const LEVEL_NOTE: Record<string, string> = {
  L1: 'Reports to directly',
  L2: 'One level above L1',
  L3: 'Three levels up',
  L4: 'Four levels up',
  HOD: 'Heads the department',
}

// ── Sub-components outside the parent, per the house rule. ──

function Initials({ name }: { name: string | null }) {
  const text = (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 99, background: P.purpleBg, color: P.purple,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, flexShrink: 0,
    }}>{text}</div>
  )
}

function ManagerCard({ slot }: { slot: ManagerSlot }) {
  const m = slot.manager
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: `1px solid ${P.border}` }}>
      <Initials name={m?.full_name ?? null} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: P.muted, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 500, marginBottom: 2 }}>
          {LEVEL_LABEL[slot.relationship_type] || slot.relationship_type}
        </div>
        {m ? (
          <>
            <div style={{ fontSize: 13, color: P.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {m.full_name || '—'}
            </div>
            <div style={{ fontSize: 11.5, color: P.muted, marginTop: 1 }}>
              {[m.designation, m.department].filter(Boolean).join(' · ') || '—'}
            </div>
            <div style={{ fontSize: 10.5, color: P.muted, marginTop: 2, fontFamily: 'monospace' }}>
              {m.emp_code || '—'}{m.office_email ? ` · ${m.office_email}` : ''}
            </div>
          </>
        ) : (
          // The relationship exists but the person behind it could not be read — a
          // deleted record, most likely. Saying so beats rendering a blank card.
          <div style={{ fontSize: 12.5, color: P.muted }}>This manager’s record could not be found.</div>
        )}
      </div>
      <span style={{ fontSize: 10, color: P.muted, whiteSpace: 'nowrap', paddingTop: 2 }}>
        {LEVEL_NOTE[slot.relationship_type] || ''}
      </span>
    </div>
  )
}

export default function ManagerInformation({ employeeId, employeeName }: {
  employeeId: string | null | undefined
  employeeName?: string | null
}) {
  const { managers, reportCount, loading, error } = useManagerChain(employeeId)

  if (loading) {
    return <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0' }}>Loading the reporting line…</div>
  }
  if (error) {
    return <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0' }}>{error}</div>
  }
  if (!managers.length) {
    return (
      <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0', lineHeight: 1.6 }}>
        No reporting line on record{employeeName ? ` for ${employeeName}` : ''}.
        {reportCount > 0
          ? ` They are at the top of their chain — ${reportCount} ${reportCount === 1 ? 'person reports' : 'people report'} to them.`
          : ' Import the org chart from Bulk Uploader → Org Structure & Roles, or set it on this employee.'}
      </div>
    )
  }

  return (
    <div>
      {managers.map(slot => <ManagerCard key={slot.relationship_type} slot={slot} />)}
      {reportCount > 0 && (
        <div style={{ fontSize: 11.5, color: P.muted, paddingTop: 10 }}>
          {reportCount} {reportCount === 1 ? 'person reports' : 'people report'} to this employee directly.
        </div>
      )}
    </div>
  )
}
