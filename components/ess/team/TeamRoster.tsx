'use client'
// components/ess/team/TeamRoster.tsx — the scope-aware roster (RM / HOD only).
//
// Moved out of RoleTabs.tsx and restyled. NOTHING ABOUT THE DATA MOVED:
//
//   · the same api(`/api/ess/team?scope=${scope}`, employeeId) call, the same
//     effect deps, the same live-flag cleanup, the same error capture
//   · the same initial scope: isRm ? 'TEAM' : 'DEPT'
//   · the same `if (!isRm && !isHod) return null` gate
//   · the toggle still only draws for somebody who is BOTH an RM and an HOD,
//     and asking for DEPT without being an HOD still silently returns TEAM —
//     that decision lives on the server, not here
//   · status precedence is untouched: the row arrives carrying its own `tone`,
//     and notice period beats leave beats normal upstream
//   · the DEPT-only "Reports to you" column, both footnotes and the
//     "Nobody in this scope yet." empty state, word for word
//
// WHAT CHANGED — LOOK ONLY
//   · styles come from team.css (`.tm`) instead of inline S.* reads
//   · the two loose buttons became one segmented control with aria-pressed
//   · the table head is a light sunken band, not the hardcoded #1E1B4B slab
//   · the status pill carries a tone dot and the column is right-aligned, so
//     the pills form one edge you can scan without reading the labels
//   · the header gained a plain-language line under the title
import { useEffect, useState } from 'react'
import { api } from '@/lib/ess/api'
import { ROSTER_ICON } from './icons'
import './team.css'

export function TeamRoster({ employeeId, isHod, isRm }: { employeeId: string; isHod: boolean; isRm: boolean }) {
  const [scope, setScope] = useState<'TEAM' | 'DEPT'>(isRm ? 'TEAM' : 'DEPT')
  const [rows, setRows] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    api(`/api/ess/team?scope=${scope}`, employeeId).then(d => { if (live) { setRows(d.rows || []); setErr('') } }).catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [employeeId, scope])
  if (!isRm && !isHod) return null

  const dept = scope === 'DEPT'
  return (
    <div className="tm-panel">
      <div className="tm-head">
        <span className="tm-ico" aria-hidden="true">{ROSTER_ICON}</span>
        <span className="tm-htext">
          <span className="tm-h" style={{ display: 'block' }}>{dept ? 'My department' : 'My team — direct reports'}</span>
          <span className="tm-hsub" style={{ display: 'block' }}>
            {dept ? 'Everyone in the department you head' : 'People whose reporting line ends with you'}
          </span>
        </span>
        {isRm && isHod ? (
          <span className="tm-seg" role="group" aria-label="Roster scope">
            <button type="button" aria-pressed={scope === 'TEAM'} onClick={() => setScope('TEAM')}>Direct reports</button>
            <button type="button" aria-pressed={scope === 'DEPT'} onClick={() => setScope('DEPT')}>Whole department</button>
          </span>
        ) : rows ? <span className="tm-count">{rows.length}</span> : null}
      </div>

      {err && <p className="tm-note warn">{err}</p>}
      {rows && rows.length === 0 && (
        <p className="tm-empty">
          <span className="tm-empty__ico" aria-hidden="true">{ROSTER_ICON}</span>
          <span>Nobody in this scope yet.</span>
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="tm-tablewrap">
          <table className="tm-table">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Designation</th>
                {dept && <th>Reports to you</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="tm-code">{r.code || '—'}</td>
                  <td className="tm-nm">{r.name}</td>
                  <td>{r.designation || '—'}</td>
                  {dept && <td>{r.direct ? 'Direct' : <span className="tm-dim">—</span>}</td>}
                  <td>
                    <span className={`tm-pill ${r.tone === 'warn' ? 'warn' : r.tone === 'info' ? 'info' : 'ok'}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="tm-note">
        {dept
          ? 'DEPT scope — everyone in the department(s) you head. Company-wide headcount is under the Company tab.'
          : 'TEAM scope — your direct reports only. Your HOD sees this list plus every other team in the department.'}
      </p>
    </div>
  )
}

export default TeamRoster
