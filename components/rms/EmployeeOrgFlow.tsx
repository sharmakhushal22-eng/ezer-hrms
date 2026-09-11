'use client'
// components/rms/EmployeeOrgFlow.tsx — this employee, in their place in the company.
//
// Replaces the plain card list that used to sit under Employment → Manager Information.
// The request was specific: the chain above as one line (down to the immediate manager),
// this employee's own level shown beside them — everyone who shares their manager — and
// their whole team beneath, all connected in one picture.
//
// Nothing here is a second data path. It fetches the same /api/rms/orgchart tree the
// full company Org Chart page reads, and reuses the same forest-building and path-finding
// functions (lib/rms/tree.ts) that page already relies on. A person's ancestor line is
// exactly pathTo(forest, id); their peers are exactly their parent's other children;
// their whole team is exactly their own node's children, however many levels deep — all
// three fall out of the one tree, one fetch, with no separate lookup for any of them.
//
// The three pieces are stitched into one small SYNTHETIC tree before rendering: each
// ancestor keeps only the single child that leads down to this employee (nobody else's
// branch of the company appears on the way up), the level the employee stands on carries
// every peer as a leaf beside them, and the employee's own node keeps its real subtree
// exactly as the full chart built it. One recursive renderer draws all of it.
import { useState, useEffect, useMemo } from 'react'
import { authToken } from '@/lib/rms/client'
import { buildForest, pathTo, flatten, type TreeNode } from '@/lib/rms/tree'
import type { OrgTreeNode } from '@/lib/rms/server'

const P = {
  purple: '#7C3AED', purpleDark: '#3C3489', purpleBg: '#EEEDFE', purpleLight: '#F5F3FF',
  border: '#E9E7F5', card: '#FFFFFF', text: '#1E1B4B', muted: '#6B6B7B',
  blue: '#1D4ED8', amber: '#B45309', grey: '#9CA3AF',
}
const font = '"DM Sans","Segoe UI",sans-serif'

type Row = OrgTreeNode

// ── Sub-components outside the parent, per house convention. FlowBranch recurses on
//    itself, which is normal for a tree renderer, not the same thing as redefinition. ──

function initials(name: string | null): string {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
}

/** One box in the flow. Colour is derived from the data the same way the full Org Chart
 *  derives it — root, department head, has-reports, or plain — never hand-tagged.
 *  `emphasis` marks the one employee this whole panel is about. */
function FlowBox({ n, emphasis }: { n: Row; emphasis?: boolean }) {
  const tier = !n.managerId ? 'root' : n.isHod ? 'hod' : n.directReports > 0 ? 'manager' : 'ic'
  const bar = tier === 'root' ? P.amber : tier === 'hod' ? P.blue : tier === 'manager' ? P.purple : P.grey
  return (
    <div className="org-node" style={{
      width: 148, background: P.card, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
      border: `1px solid ${emphasis ? P.purple : P.border}`,
      boxShadow: emphasis ? `0 0 0 3px ${P.purpleBg}, 0 4px 14px rgba(124,58,237,0.18)` : '0 1px 3px rgba(30,27,75,0.06)',
    }}>
      <div style={{ height: 5, background: bar }} />
      <div style={{ padding: '8px 8px 7px', textAlign: 'center' }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', background: bar + '22', color: bar,
          fontSize: 11.5, fontWeight: 700, margin: '0 auto 5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials(n.fullName)}</div>
        <div style={{
          fontSize: 11.5, fontWeight: 700, color: P.text, lineHeight: 1.2,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{n.fullName || '—'}</div>
        <div style={{ fontSize: 9.5, color: P.muted, fontFamily: 'monospace', marginTop: 1 }}>{n.empCode || '—'}</div>
        <div style={{
          fontSize: 9.5, color: P.muted, marginTop: 2, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{n.designation || '—'}</div>
        {emphasis && <div style={{ fontSize: 8.5, fontWeight: 700, color: P.purple, marginTop: 2 }}>THIS EMPLOYEE</div>}
      </div>
      {n.directReports > 0 && (
        <div style={{ fontSize: 9, fontWeight: 700, color: P.purpleDark, background: P.purpleLight, textAlign: 'center', padding: '2px 0', borderTop: `1px solid ${P.border}` }}>
          {n.directReports} direct
        </div>
      )}
    </div>
  )
}

/** Draws one synthetic node and, if it has any, its children below it — the same nested
 *  <ul>/<li> connector pattern the full Org Chart uses, rooted here instead of at the
 *  top of the company. */
function FlowBranch({ node, meId }: { node: TreeNode<Row>; meId: string }) {
  const hasChildren = node.children.length > 0
  return (
    <li className={hasChildren ? 'has-children' : ''}>
      <FlowBox n={node.node} emphasis={node.node.id === meId} />
      {hasChildren && (
        <ul>
          {node.children.map(c => <FlowBranch key={c.node.id} node={c} meId={meId} />)}
        </ul>
      )}
    </li>
  )
}

export default function EmployeeOrgFlow({ employeeId, companyId, employeeName }: {
  employeeId: string | null | undefined
  companyId: string | null | undefined
  employeeName?: string | null
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employeeId || !companyId) { setLoading(false); return }
    let live = true
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const token = await authToken()
        const res = await fetch(`/api/rms/orgchart?company_id=${companyId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
        })
        const json = await res.json().catch(() => ({}))
        if (!live) return
        if (!res.ok) { setError(json?.error || 'Could not load the reporting line.'); setRows([]) }
        else setRows(json.tree || [])
      } catch {
        if (live) setError('Could not reach the server.')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [employeeId, companyId])

  const forest = useMemo(() => buildForest<Row>(rows), [rows])

  // Everything asked for, out of one tree:
  //   ancestors   pathTo() minus this employee — the straight line to the top
  //   peers       this employee's parent's other children — their own level
  //   me          this employee's own node; its .children IS the whole team,
  //               however deep, because buildForest already nested it
  const { synthetic, peerCount, teamCount } = useMemo(() => {
    if (!employeeId) return { synthetic: null as TreeNode<Row> | null, peerCount: 0, teamCount: 0 }
    const path = pathTo(forest, employeeId)
    if (!path.length) return { synthetic: null as TreeNode<Row> | null, peerCount: 0, teamCount: 0 }

    const me = path[path.length - 1]
    const ancestors = path.slice(0, -1)
    const parent = ancestors[ancestors.length - 1]
    const peers = parent ? parent.children.filter(c => c.node.id !== employeeId) : []
    const team = flatten(me.children)

    // The level this employee stands on: every peer as a leaf (their own teams do not
    // expand here — this panel is about this employee, not a tour of the company), and
    // this employee's node exactly as it came from the real tree, subtree intact.
    let level: TreeNode<Row> = {
      node: (parent ?? me).node,
      children: parent
        ? [...peers.map(p => ({ node: p.node, children: [] as TreeNode<Row>[] })), me]
            .sort((a, b) => String(a.node.fullName || '').localeCompare(String(b.node.fullName || '')))
        : me.children,
    }
    // If there is no manager, the "level" IS this employee — nothing to wrap.
    if (!parent) level = me

    // Each ancestor above the immediate manager keeps only the single child that leads
    // down to this employee, so nobody else's branch of the company appears on the way
    // up — matching what was asked for: a straight line, not a wider chart.
    let root = level
    for (let i = ancestors.length - 2; i >= 0; i--) {
      root = { node: ancestors[i].node, children: [root] }
    }

    return { synthetic: root, peerCount: peers.length, teamCount: team.length }
  }, [forest, employeeId])

  if (loading) return <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0' }}>Loading the reporting line…</div>
  if (error) return <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0' }}>{error}</div>
  if (!synthetic) {
    return (
      <div style={{ fontSize: 12.5, color: P.muted, padding: '8px 0', lineHeight: 1.6 }}>
        No reporting line on record{employeeName ? ` for ${employeeName}` : ''}.
      </div>
    )
  }

  return (
    <div style={{ fontFamily: font, overflowX: 'auto', padding: '4px 0 0' }}>
      <ul className="org-tree" style={{ justifyContent: 'center', minWidth: 'fit-content', margin: '0 auto' }}>
        <FlowBranch node={synthetic} meId={employeeId as string} />
      </ul>
      {(peerCount > 0 || teamCount > 0) && (
        <div style={{ fontSize: 10.5, color: P.muted, textAlign: 'center', marginTop: 4 }}>
          {peerCount > 0 && `${peerCount} at the same level`}
          {peerCount > 0 && teamCount > 0 && ' · '}
          {teamCount > 0 && `${teamCount} in their team`}
        </div>
      )}
    </div>
  )
}
