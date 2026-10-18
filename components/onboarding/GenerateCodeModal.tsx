'use client'
// components/onboarding/GenerateCodeModal.tsx — the last step on the onboarding card: the
// employee code. Shown once IT, Admin and Payroll have approved and the HR Manager has assigned
// the role; it recaps both, suggests the next type-wise code (editable) and generates it, which
// creates the employee record, applies the reporting line and the ESS role, and mails the joiner.
import { C as TK, Z } from '@/lib/ui'

const btn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: TK.positive, color: TK.onAccent }
const btnO: React.CSSProperties = { ...btn, background: TK.surface, color: TK.brandDeep, border: `1px solid ${TK.brandEdge}`, fontWeight: 600 }
const LABEL: Record<string, string> = { IT: 'IT', ADMIN: 'Admin', PAYROLL: 'Payroll', HR_MANAGER: 'HR Manager' }

export default function GenerateCodeModal({ candidate, genCode, setGenCode, codeType, codeLoading, saving, onGenerate, onClose }: {
  candidate: { full_name: string; designation?: string | null; department?: string | null; employment_type?: string | null; date_of_joining?: string | null; approvals?: { team: string; status: string }[]; role_assignment?: any }
  genCode: string; setGenCode: (v: string) => void; codeType: string; codeLoading: boolean; saving: boolean; onGenerate: () => void; onClose: () => void
}) {
  const ra = candidate.role_assignment
  const pending = (candidate.approvals || []).filter(a => a.status !== 'APPROVED').map(a => LABEL[a.team] || a.team)
  const ok = !!ra && !pending.length
  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: Z.modal, overflowY: 'auto', padding: '28px 12px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <div style={{ background: TK.surface, color: TK.ink, borderRadius: 12, width: 'min(560px, 100%)', margin: '0 auto', padding: '20px 22px', boxShadow: '0 24px 70px rgba(15,23,42,.3)', fontSize: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: TK.muted }}>Generate employee code</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{candidate.full_name}</div>
            <div style={{ fontSize: 12.5, color: TK.inkSoft }}>{[candidate.designation, candidate.department, candidate.employment_type || 'Employee'].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={onClose} style={btnO}>✕ Close</button>
        </div>

        <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(candidate.approvals || []).map(a => <span key={a.team} style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: a.status === 'APPROVED' ? TK.positiveTint : TK.warningTint, color: a.status === 'APPROVED' ? TK.positive : TK.warning }}>{LABEL[a.team] || a.team} {a.status === 'APPROVED' ? '✓' : '· pending'}</span>)}
          </div>
          <div style={{ border: `1px solid ${ra ? TK.positiveEdge : TK.warningEdge}`, background: ra ? TK.positiveTint : TK.warningTint, borderRadius: 9, padding: '10px 12px' }}>
            {ra
              ? <>
                  <div style={{ fontWeight: 700 }}>Role: {ra.role_name} <span style={{ color: TK.muted, fontWeight: 500, fontSize: 11 }}>· {ra.permissions?.length || 0} modules</span></div>
                  <div style={{ fontSize: 12, color: TK.inkSoft, marginTop: 2 }}>L1 {ra.l1_name || '—'}{ra.l2_name ? ` · L2 ${ra.l2_name}` : ''}{ra.hod_name ? ` · HOD ${ra.hod_name}` : ''} · assigned by {ra.by_name || '—'}</div>
                </>
              : <div style={{ color: TK.warning, fontWeight: 600 }}>Role not assigned yet — press Role assignment on the card first.</div>}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: TK.brandDeep, textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>Employee code{codeType ? ` · ${codeType}` : ''}</label>
          <input value={genCode} onChange={e => setGenCode(e.target.value.toUpperCase())} placeholder={codeLoading ? 'Suggesting the next code…' : 'e.g. SSM0042'} style={{ width: '100%', padding: '11px 12px', border: `1px solid ${TK.brandEdge}`, borderRadius: 8, fontSize: 18, fontWeight: 700, letterSpacing: '.06em', fontFamily: 'inherit', boxSizing: 'border-box', background: TK.surface, color: TK.ink }} />
          <div style={{ fontSize: 11.5, color: TK.muted, marginTop: 4 }}>The next number for this type is suggested and reserved atomically on generation; a custom code is honoured as typed.</div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <button disabled={saving || codeLoading || !genCode.trim() || !ra} onClick={onGenerate} style={{ ...btn, opacity: ra && genCode.trim() ? 1 : .55, cursor: ra && genCode.trim() ? 'pointer' : 'not-allowed' }}>{saving ? 'Generating…' : '⚡ Generate code & create employee'}</button>
          {!ok && ra && <span style={{ fontSize: 12, color: TK.warning }}>Still waiting on {pending.join(', ')} — you will be asked to confirm.</span>}
        </div>
      </div>
    </div>
  )
}
