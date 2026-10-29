'use client'
// components/onboarding/AssignManagersModal.tsx — Assign managers, from the review sheet, BEFORE
// the form is accepted: the joiner's L1 (reporting manager), L2 and HOD. Accept form on the
// sheet stays disabled until the L1 is saved. Kept on onboarding_candidates (l1_manager_id,
// l2_manager_id, hod_id) and applied to the employee record when the code is generated — and
// to their team: everybody under the joiner inherits this line one level down
// (lib/onboarding/team-plan.ts). API: /api/onboarding/managers.
import { useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import { C as TK, Z, E } from '@/lib/ui'
import { PersonPicker, Avatar, PICKER_CSS, describe, type Emp } from './PeoplePicker'

export type ManagerIds = { l1: string; l2: string; hod: string }

const CSS = `
  .am-card{background:${TK.surface};color:${TK.ink};border-radius:14px;width:min(820px,100%);margin:0 auto;box-shadow:${E.overlay};font-size:13px;overflow:hidden}
  .am-head{padding:20px 24px 16px;border-bottom:1px solid ${TK.line};display:flex;justify-content:space-between;gap:12px;align-items:flex-start;background:${TK.sunken}}
  .am-kicker{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${TK.brand}}
  .am-title{font-size:21px;font-weight:700;letter-spacing:-.01em;margin-top:2px}
  .am-sub{font-size:12.5px;color:${TK.inkSoft};margin-top:3px}
  .am-body{padding:20px 24px 22px;display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:22px}
  .am-chain{border:1px solid ${TK.line};border-radius:12px;padding:14px;background:${TK.sunken};align-self:start}
  .am-chain-h{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${TK.muted};margin-bottom:10px}
  .am-node{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;background:${TK.surface};border:1px solid ${TK.line}}
  .am-node.me{border-color:${TK.brand};background:${TK.brandTint}}
  .am-node.empty{border-style:dashed;color:${TK.muted}}
  .am-lvl{font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${TK.muted}}
  .am-nm{font-size:12.5px;font-weight:600;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .am-link{width:2px;height:12px;background:${TK.lineStrong};margin:0 auto}
  .am-foot{padding:14px 24px 18px;border-top:1px solid ${TK.line};display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .am-btn{padding:10px 18px;border-radius:9px;border:none;cursor:pointer;font-size:13px;font-weight:700;font-family:inherit;background:${TK.brand};color:${TK.onAccent}}
  .am-btn:disabled{opacity:.55;cursor:not-allowed}
  .am-ghost{padding:8px 13px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;font-family:inherit;background:${TK.surface};color:${TK.brandDeep};border:1px solid ${TK.brandEdge}}
  @media (max-width:700px){.am-body{grid-template-columns:1fr}.am-chain{order:-1}}
`

function Node({ level, emp, me, name }: { level: string; emp?: Emp | null; me?: boolean; name?: string }) {
  if (me) return <div className="am-node me"><Avatar name={name || ''} size={30} /><div style={{ minWidth: 0 }}><div className="am-lvl">Joiner</div><div className="am-nm">{name}</div></div></div>
  if (!emp) return <div className="am-node empty"><span style={{ width: 30, height: 30, borderRadius: 99, border: `2px dashed ${TK.lineStrong}`, flex: 'none' }} /><div><div className="am-lvl">{level}</div><div className="am-nm" style={{ color: TK.muted, fontWeight: 500 }}>not set</div></div></div>
  return <div className="am-node"><Avatar name={emp.full_name} size={30} tone="muted" /><div style={{ minWidth: 0 }}><div className="am-lvl">{level}</div><div className="am-nm" title={describe(emp)}>{emp.full_name}</div></div></div>
}

export default function AssignManagersModal({ onboardingId, name, designation, initial, onClose, onSaved, onDone }: {
  onboardingId: string; name: string; designation?: string | null; initial: ManagerIds
  onClose: () => void
  /** Called with the saved ids and names so the sheet can enable Accept without a reload. */
  onSaved: (m: { ids: ManagerIds; names: { l1: string | null; l2: string | null; hod: string | null } }) => void
  onDone: (msg: string, type?: 'ok' | 'err') => void
}) {
  const [employees, setEmployees] = useState<Emp[] | null>(null)
  const [err, setErr] = useState('')
  const [l1, setL1] = useState(initial.l1 || ''); const [l2, setL2] = useState(initial.l2 || ''); const [hod, setHod] = useState(initial.hod || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/onboarding/managers?onboarding_id=${onboardingId}`, { headers: await authHeaders() })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load the employees')
        if (alive) setEmployees(d.employees || [])
      } catch (e: any) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [onboardingId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const byId = (id: string) => employees?.find(e => e.id === id) || null
  const canSave = !!l1 && l1 !== l2
  const changed = l1 !== (initial.l1 || '') || l2 !== (initial.l2 || '') || hod !== (initial.hod || '')

  async function save() {
    if (!canSave) { onDone(l1 && l1 === l2 ? 'L1 and L2 cannot be the same person.' : 'Pick the L1 manager — the person the joiner reports to.', 'err'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/onboarding/managers', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarding_id: onboardingId, l1_manager_id: l1, l2_manager_id: l2 || null, hod_id: hod || null }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save')
      onSaved({ ids: { l1, l2, hod }, names: { l1: byId(l1)?.full_name || null, l2: l2 ? byId(l2)?.full_name || null : null, hod: hod ? byId(hod)?.full_name || null : null } })
      onDone(`Reporting line saved — ${name} reports to ${byId(l1)?.full_name || 'the L1'}. You can accept the form now.`, 'ok')
      onClose()
    } catch (e: any) { onDone(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal, overflowY: 'auto', padding: '36px 12px', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <style>{CSS}{PICKER_CSS}</style>
      <div className="am-card" role="dialog" aria-label="Assign managers">
        <div className="am-head">
          <div style={{ minWidth: 0 }}>
            <div className="am-kicker">Assign managers · before accepting</div>
            <div className="am-title">{name}</div>
            <div className="am-sub">{designation ? `${designation} · ` : ''}Who they report to. Everybody who later reports to {name.split(' ')[0]} inherits this line one level down.</div>
          </div>
          <button onClick={onClose} className="am-ghost" aria-label="Close">✕ Close</button>
        </div>

        {err && <div style={{ color: TK.critical, padding: '18px 24px' }}>{err}</div>}
        {!err && !employees && <div style={{ color: TK.muted, padding: '22px 24px' }}>Loading the company's people…</div>}
        {employees && (
          <>
            <div className="am-body">
              <div style={{ display: 'grid', gap: 16 }}>
                <PersonPicker label="L1 · reporting manager" required value={l1} onChange={setL1} employees={employees} exclude={[l2, hod].filter(Boolean)} hint="approves their leave, attendance and reviews" />
                <PersonPicker label="L2 · second-level manager" value={l2} onChange={setL2} employees={employees} exclude={[l1].filter(Boolean)} hint="usually the L1's own manager" />
                <PersonPicker label="HOD · head of department" value={hod} onChange={setHod} employees={employees} exclude={[l1].filter(Boolean)} hint="optional" />
              </div>
              <aside className="am-chain" aria-label="Reporting line preview">
                <div className="am-chain-h">Reporting line</div>
                <Node level="HOD" emp={byId(hod)} />
                <div className="am-link" />
                <Node level="L2" emp={byId(l2)} />
                <div className="am-link" />
                <Node level="L1" emp={byId(l1)} />
                <div className="am-link" />
                <Node level="" me name={name} />
                <div style={{ fontSize: 11, color: TK.muted, marginTop: 12, lineHeight: 1.45 }}>Their direct reports will get <b>{byId(l1)?.full_name.split(' ')[0] || 'the L1'}</b> as L2 and <b>{byId(l2)?.full_name.split(' ')[0] || byId(hod)?.full_name.split(' ')[0] || 'the L2'}</b> as HOD.</div>
              </aside>
            </div>
            <div className="am-foot">
              <button className="am-btn" disabled={busy || !canSave || (!changed && !!initial.l1)} onClick={save}>{busy ? 'Saving…' : initial.l1 ? 'Update reporting line' : 'Save reporting line'}</button>
              <span style={{ fontSize: 12, color: TK.muted }}>{canSave ? 'Accept form opens on the sheet once this is saved.' : 'The L1 manager is required.'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
