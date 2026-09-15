'use client'
// ============================================================================
// components/ess/team/MyTeam.tsx — the Team section, direction B: one line.
//
// Replaces the four-panel MyTeam that lived in EmployeePortal.tsx. B stops
// treating "above you", "beside you" and "below you" as three lists that
// happen to sit near each other and draws them as one structure with you in
// the middle: your chain stacks up from a highlighted YOU band, your
// team-mates sit inside that band because they are at your level, and your
// reports branch off it.
//
// WHAT IS IDENTICAL TO THE OLD VERSION
//   · the same two fetches, in the same Promise.all, with the same headers,
//     the same `cache: 'no-store'` and the same .catch(() => ({}))
//   · the same useManagerChain(emp.id) and useEssMenu(emp.id)
//   · the same peers mapping — isSelf / directReports read off peersFor()'s
//     camelCase shape, NOT the raw RPC columns
//   · the same `!p.isSelf` filter
//   · the same roster gate: essMenu.is_rm || essMenu.is_hod
//   · every empty-state string, word for word
//   · no write path, no new request, nothing derived that was not on screen
//     before
//
// TWO THINGS TO KNOW BEFORE READING
//   1. `managers` is reversed FOR DISPLAY ONLY. The payload arrives
//      nearest-first; drawn top-down, the senior end has to be at the top or
//      the chain reads upside down. `.slice().reverse()` — the array from the
//      hook is never mutated.
//   2. The roster now sits BELOW the line rather than above it. The line is
//      what every audience sees; the roster is the manager's work surface.
//
// THE ONE BEHAVIOUR CHANGE, ASKED FOR DELIBERATELY
//   The team-mates count used to read `peers.length`, which includes you —
//   peersFor() returns you flagged isSelf and the screen filters you out
//   AFTER counting, so the heading said 6 above 5 cards. It now counts
//   `mates`, the list actually rendered.
// ============================================================================
import { useEffect, useState } from 'react'
import { authToken, useManagerChain } from '@/lib/rms/client'
import { useEssMenu } from '@/components/ess/RoleTabs'
import type { EmployeeDetail } from '@/lib/supabase-ess'
import { TeamRoster } from './TeamRoster'
import { LINE_ICON } from './icons'
import { Avatar, LineNode, LineSkeleton, YouDot } from './ui'
import './team.css'

export function MyTeam({ emp, isMobile }: { emp: EmployeeDetail; isMobile: boolean }) {
  const { managers, loading: chainLoading } = useManagerChain(emp.id)
  // Scope-aware roster with status pills for an RM / HOD; renders nothing otherwise.
  const { menu: essMenu } = useEssMenu(emp.id)
  const [peers, setPeers] = useState<{ id: string; full_name: string; designation: string | null; department: string | null; isSelf: boolean; direct_reports: number }[]>([])
  const [reports, setReports] = useState<{ id: string; emp_code: string | null; full_name: string | null; designation: string | null; department: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    ;(async () => {
      const token = await authToken()
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
      const [peersRes, reportsRes] = await Promise.all([
        fetch(`/api/rms/orgchart?view=peers&employee_id=${emp.id}`, { headers, cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
        fetch(`/api/rms/hierarchy?employee_id=${emp.id}&view=reports`, { headers, cache: 'no-store' }).then(r => r.json()).catch(() => ({})),
      ])
      if (!live) return
      // peersFor() already camel-cases the RPC's columns before it leaves the
      // server: { id, emp_code, full_name, designation, department, isSelf,
      // directReports }. Reading employee_id / is_self / direct_reports here
      // yielded undefined three times over — an undefined key (React's warning),
      // a self-filter that never matched so you appeared in your own team-mates
      // list, and a reports badge that never showed.
      setPeers((peersRes.peers || []).map((p: any) => ({
        id: p.id, full_name: p.full_name, designation: p.designation,
        department: p.department, isSelf: !!p.isSelf, direct_reports: p.directReports || 0,
      })))
      setReports(reportsRes.reports || [])
      setLoading(false)
    })()
    return () => { live = false }
  }, [emp.id])

  const busy = loading || chainLoading
  const mates = peers.filter(p => !p.isSelf)
  // Display order only — the hook's array is not mutated.
  const chain = managers.slice().reverse()

  // The same screen for everyone. Somebody at the top of the org has no rail
  // above the band and the line simply starts at them; that case is not
  // special-cased, it just has an empty chain.
  return (
    <div className={`tm tm--line${isMobile ? ' tm--mobile' : ''}`}>
      <div className="tm-panel tm-panel--lead">
        <div className="tm-head">
          <span className="tm-ico" aria-hidden="true">{LINE_ICON.line}</span>
          <span className="tm-htext">
            <span className="tm-h" style={{ display: 'block' }}>Where you sit</span>
            <span className="tm-hsub" style={{ display: 'block' }}>
              Above you, beside you, below you — read from the reporting lines HR maintains
            </span>
          </span>
        </div>

        {busy ? <LineSkeleton /> : (
          <div className="tl">
            <p className="tl-label">Reporting line above you</p>
            {chain.length === 0 ? (
              <p className="tl-empty">Nobody above you — you are at the top of your chain.</p>
            ) : (
              <div className="tl-up">
                {chain.map(m => (
                  <LineNode key={m.relationship_type}
                    name={m.manager?.full_name ?? null}
                    sub={m.manager?.designation ?? null}
                    rank={m.relationship_type === 'HOD' ? 'Head of Department' : m.relationship_type} />
                ))}
              </div>
            )}

            <div className="tl-you">
              <div className="tl-you__head">
                <YouDot />
                <span className="tm-txt">
                  <span className="tl-youname" style={{ display: 'block' }}>You</span>
                  <span className="tm-sub" style={{ display: 'block' }}>Managers above you, your team below</span>
                </span>
              </div>

              {/* mates.length, not peers.length — the count now matches the cards. */}
              <p className="tl-beside">Your team-mates{mates.length ? ` (${mates.length})` : ''}</p>
              {mates.length === 0 ? (
                <p className="tl-empty">Nobody else shares your reporting manager — or you have no manager on record.</p>
              ) : (
                <div className="tl-mates">
                  {mates.map(p => (
                    <span className="tl-chip" key={p.id}>
                      <Avatar name={p.full_name} />
                      {p.full_name || '—'}
                      <small>
                        {p.designation || '—'}
                        {p.direct_reports > 0 && ` · ${p.direct_reports} ${p.direct_reports === 1 ? 'report' : 'reports'}`}
                      </small>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <p className="tl-label tl-label--branch">Your team</p>
            {reports.length === 0 ? (
              <p className="tl-empty">Nobody reports to you directly.</p>
            ) : (
              <div className="tl-down">
                {reports.map(r => (
                  <LineNode key={r.id} name={r.full_name}
                    sub={[r.designation, r.department].filter(Boolean).join(' · ')} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(essMenu.is_rm || essMenu.is_hod) && (
        <TeamRoster employeeId={emp.id} isRm={essMenu.is_rm} isHod={essMenu.is_hod} />
      )}
    </div>
  )
}

export default MyTeam
