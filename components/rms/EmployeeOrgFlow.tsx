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
import { buildForest, pathTo, type TreeNode } from '@/lib/rms/tree'
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

const clamp2: React.CSSProperties = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
const TIER: Record<string, { bar: string; tag: string }> = {
  root:    { bar: P.amber,  tag: 'Leadership' },
  hod:     { bar: P.blue,   tag: 'Dept Head' },
  manager: { bar: P.purple, tag: 'Manager' },
  ic:      { bar: P.grey,   tag: 'Team' },
}

/** One box in the flow. Colour and tier come from the data — root, department head,
 *  has-reports, or plain — never hand-tagged. `emphasis` marks the one employee this
 *  panel is about. */
const REPORT_GREEN = '#059669'
function FlowBox({ n, emphasis, isReport }: { n: Row; emphasis?: boolean; isReport?: boolean }) {
  const tier = !n.managerId ? 'root' : n.isHod ? 'hod' : n.directReports > 0 ? 'manager' : 'ic'
  const t = TIER[tier]
  const accent = isReport ? REPORT_GREEN : emphasis ? P.purple : null
  return (
    <div className="org-node" style={{
      width: 170, background: isReport ? '#ECFDF5' : emphasis ? P.purpleLight : P.card, borderRadius: 11, overflow: 'hidden', flexShrink: 0,
      border: `1.5px solid ${accent || P.border}`,
      boxShadow: isReport ? `0 0 0 3px ${REPORT_GREEN}22, 0 6px 16px rgba(5,150,105,0.18)`
        : emphasis ? `0 0 0 3px ${P.purpleBg}, 0 6px 18px rgba(124,58,237,0.20)` : '0 1px 4px rgba(30,27,75,0.07)',
    }}>
      <div style={{ height: 4, background: isReport ? REPORT_GREEN : t.bar }} />
      <div style={{ padding: '10px 10px 9px', textAlign: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: (isReport ? REPORT_GREEN : t.bar) + '20', color: isReport ? REPORT_GREEN : t.bar,
          fontSize: 13, fontWeight: 700, margin: '0 auto 6px', border: `1.5px solid ${(isReport ? REPORT_GREEN : t.bar)}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials(n.fullName)}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: P.text, lineHeight: 1.2, ...clamp2 }}>{n.fullName || '—'}</div>
        <div style={{ fontSize: 10, color: P.muted, fontFamily: 'monospace', marginTop: 2 }}>{n.empCode || '—'}</div>
        <div style={{ fontSize: 10, color: P.muted, marginTop: 3, lineHeight: 1.3, ...clamp2 }}>{n.designation || '—'}</div>
        <div style={{ marginTop: 7, display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
          {emphasis
            ? <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.06em', color: '#fff', background: P.purple, padding: '2px 9px', borderRadius: 99 }}>YOU</span>
            : isReport
              ? <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '.04em', color: '#fff', background: REPORT_GREEN, padding: '2px 9px', borderRadius: 99 }}>REPORTS TO YOU</span>
              : <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.04em', color: t.bar, background: t.bar + '18', padding: '2px 9px', borderRadius: 99 }}>{t.tag}</span>}
          {n.directReports > 0 && <span style={{ fontSize: 8.5, fontWeight: 700, color: P.purpleDark, background: P.purpleLight, padding: '2px 8px', borderRadius: 99 }}>{n.directReports} report{n.directReports > 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  )
}

/** Draws one synthetic node and, if it has any, its children below it — the same nested
 *  <ul>/<li> connector pattern the full Org Chart uses, rooted here instead of at the
 *  top of the company. */
function FlowBranch({ node, meId, reportIds }: { node: TreeNode<Row>; meId: string; reportIds: Set<string> }) {
  const hasChildren = node.children.length > 0
  return (
    <li className={hasChildren ? 'has-children' : ''}>
      <FlowBox n={node.node} emphasis={node.node.id === meId} isReport={reportIds.has(node.node.id)} />
      {hasChildren && (
        <ul>
          {node.children.map(c => <FlowBranch key={c.node.id} node={c} meId={meId} reportIds={reportIds} />)}
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
  const { synthetic, teamCount, chainLen, reportIds } = useMemo(() => {
    if (!employeeId) return { synthetic: null as TreeNode<Row> | null, teamCount: 0, chainLen: 0, reportIds: new Set<string>() }
    const path = pathTo(forest, employeeId)
    if (!path.length) return { synthetic: null as TreeNode<Row> | null, teamCount: 0, chainLen: 0, reportIds: new Set<string>() }

    const me = path[path.length - 1]
    const ancestors = path.slice(0, -1)

    // A single, clean line of command — no peers, no side branches, and NOT the whole
    // sub-tree beneath: leadership at the top → … → your manager → YOU → the people who
    // report DIRECTLY to you (one level, as leaves — their own teams are not drawn here).
    const directReports = me.children.map(c => ({ node: c.node, children: [] as TreeNode<Row>[] }))
    const reportIds = new Set(directReports.map(r => r.node.id))
    let node: TreeNode<Row> = { node: me.node, children: directReports }
    for (let i = ancestors.length - 1; i >= 0; i--) {
      node = { node: ancestors[i].node, children: [node] }
    }

    return { synthetic: node, teamCount: directReports.length, chainLen: ancestors.length, reportIds }
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
    <div style={{ fontFamily: font }}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 10.5, color: P.muted, marginBottom: 8 }}>
        <span>Your reporting line — leadership on top, <b style={{ color: P.purple }}>you</b> in the middle, your direct reports below.</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {chainLen > 0 && <span>{chainLen} level{chainLen > 1 ? 's' : ''} above you</span>}
          {teamCount > 0 && <span>{teamCount} direct report{teamCount > 1 ? 's' : ''}</span>}
        </span>
      </div>
      <div style={{ overflowX: 'auto', padding: '4px 0 2px' }}>
        <ul className="org-tree" style={{ justifyContent: 'center', minWidth: 'fit-content', margin: '0 auto' }}>
          <FlowBranch node={synthetic} meId={employeeId as string} reportIds={reportIds} />
        </ul>
      </div>
    </div>
  )
}
