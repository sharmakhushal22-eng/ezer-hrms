'use client'
// app/dashboard/org-chart/page.tsx — the whole company, one query, one tree.
//
// Reads /api/rms/orgchart, which reads v_org_tree (migration 060) — a single recursive
// query over employee_relationships, the same table the Employee Master's Manager
// Information panel reads. Nothing here is a second source of truth: move somebody's
// manager anywhere in the app and this chart moves with it.
//
// The role on a card is derived from the data, not hand-tagged: root (nobody above them, per
// employee_relationships), HOD (named as somebody's department head), manager (has direct
// reports), or individual contributor. It is shown quietly — a small dot and label in neutral
// tones (theme tokens only); the brand colour is kept for "you" and the searched person.
//
// Search: type a name or employee code and pick from the matches (Enter takes the first).
// The chart leaves "My chain" for the whole company, opens the branch down to the person,
// zooms to a readable size and centres their card.
//
// Reached from ESS → Org Chart (the People menu no longer lists it).
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant, authToken } from '@/lib/rms/client'
import { canSee, scopedCompanies } from '@/lib/rms/resolve'
import { buildForest, flatten, pathTo, countNodes, type TreeNode } from '@/lib/rms/tree'
import type { OrgTreeNode } from '@/lib/rms/server'
import { C, W, R, E, Z } from '@/lib/ui'

const font = '"DM Sans","Segoe UI",sans-serif'

interface Company { id: string; company_name: string }
type Row = OrgTreeNode

// ── Sub-components, all outside the parent per house convention. TreeLI recurses on
//    itself, which is normal for a tree renderer and not the same thing as a component
//    being redefined every render. ──

type Tier = 'root' | 'hod' | 'manager' | 'ic'

function tierOf(n: OrgTreeNode): Tier {
  if (!n.managerId) return 'root'
  if (n.isHod) return 'hod'
  if (n.directReports > 0) return 'manager'
  return 'ic'
}

/** Quiet role markers: a dot in a muted tone, never a colour block. */
const TIER_STYLE: Record<Tier, { dot: string; label: string }> = {
  root:    { dot: C.ink,        label: 'Leadership' },
  hod:     { dot: C.info,       label: 'Department head' },
  manager: { dot: C.inkSoft,    label: 'Manager' },
  ic:      { dot: C.lineStrong, label: 'Individual contributor' },
}

function initials(name: string | null): string {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
}

const PATHS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.3-4.3',
  minus: 'M6 12h12', plus: 'M12 6v12M6 12h12',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  expand: 'M8 3H3v5M21 8V3h-5M3 16v5h5M16 21h5v-5M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  alert: 'M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 20a7 7 0 0 0-4-6.3',
  building: 'M4 21V5l8-2v18M12 21V9l8 2v10M2 21h20M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2',
  x: 'M6 6l12 12M18 6 6 18',
  tree: 'M12 3v6M12 9H6v4M12 9h6v4M4 13h4v4H4zM16 13h4v4h-4zM10 3h4v3h-4z',
}
function Icon({ name, size = 15 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={PATHS[name]} />
    </svg>
  )
}

function OrgCard({ node, isSelf, isReport, onToggle, collapsed, hasChildren, registerRef, highlighted }: {
  node: TreeNode<Row>
  isSelf: boolean
  isReport: boolean
  onToggle: () => void
  collapsed: boolean
  hasChildren: boolean
  registerRef: (id: string, el: HTMLDivElement | null) => void
  highlighted: boolean
}) {
  const n = node.node
  const tier = TIER_STYLE[tierOf(n)]
  const ring = highlighted ? C.brand : isSelf ? C.brandEdge : C.line
  return (
    <div
      ref={el => registerRef(n.id, el)}
      className="org-node"
      style={{
        width: 188, background: C.surface, borderRadius: R.md, position: 'relative', flexShrink: 0, textAlign: 'left',
        border: `1px solid ${ring}`,
        boxShadow: highlighted ? `0 0 0 3px ${C.brandTint}, ${E.raised}` : E.flat,
      }}
      title={`${n.fullName || '-'} · ${n.designation || '-'}${n.department ? ' · ' + n.department : ''}`}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 12px 10px' }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: isSelf || highlighted ? C.brandTint : C.sunken, color: isSelf || highlighted ? C.brand : C.inkSoft,
          border: `1px solid ${isSelf || highlighted ? C.brandEdge : C.line}`,
          fontSize: 11.5, fontWeight: W.semi, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials(n.fullName)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="orgcard-clamp" style={{
            fontSize: 12.5, fontWeight: W.semi, color: C.ink, lineHeight: 1.25,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{n.fullName || '-'}</div>
          <div className="orgcard-clamp" style={{
            fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{n.designation || '-'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px 8px', borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.muted }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', color: C.inkSoft }}>{n.empCode || '-'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: tier.dot }} />{tier.label}
        </span>
      </div>
      {(isSelf || isReport) && (
        <div style={{
          position: 'absolute', top: -9, left: 12, fontSize: 9.5, fontWeight: W.semi, letterSpacing: '.04em', textTransform: 'uppercase',
          padding: '1px 8px', borderRadius: R.pill,
          background: isSelf ? C.brand : C.surface, color: isSelf ? C.onAccent : C.positive,
          border: `1px solid ${isSelf ? C.brand : C.positiveEdge}`,
        }}>{isSelf ? 'You' : 'Reports to you'}</div>
      )}
      {hasChildren && (
        <button
          onClick={onToggle}
          title={collapsed ? `Show ${n.directReports} direct report${n.directReports === 1 ? '' : 's'}` : 'Collapse this branch'}
          style={{
            position: 'absolute', left: '50%', bottom: -11, transform: 'translate(-50%, 50%)',
            minWidth: 22, height: 22, padding: collapsed ? '0 8px' : 0, zIndex: Z.raised,
            borderRadius: R.pill, border: `1px solid ${C.lineStrong}`, background: C.surface, color: C.inkSoft,
            fontSize: 11, fontWeight: W.semi, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, boxShadow: E.flat,
          }}
        >{collapsed ? <><Icon name="users" size={11} />{n.directReports}</> : <Icon name="minus" size={12} />}</button>
      )}
    </div>
  )
}

function TreeLI({ node, selfId, reportIds, collapsedIds, onToggle, registerRef, highlightId }: {
  node: TreeNode<Row>
  selfId: string | null
  reportIds: Set<string>
  collapsedIds: Set<string>
  onToggle: (id: string) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
  highlightId: string | null
}) {
  const hasChildren = node.children.length > 0
  const collapsed = collapsedIds.has(node.node.id)
  return (
    <li className={hasChildren && !collapsed ? 'has-children' : ''}>
      <OrgCard
        node={node} isSelf={node.node.id === selfId} isReport={reportIds.has(node.node.id)}
        onToggle={() => onToggle(node.node.id)}
        collapsed={collapsed} hasChildren={hasChildren}
        registerRef={registerRef}
        highlighted={node.node.id === highlightId}
      />
      {hasChildren && !collapsed && (
        <ul>
          {node.children.map(c => (
            <TreeLI key={c.node.id} node={c} selfId={selfId} reportIds={reportIds} collapsedIds={collapsedIds}
              onToggle={onToggle} registerRef={registerRef} highlightId={highlightId} />
          ))}
        </ul>
      )}
    </li>
  )
}

function Legend() {
  const items: Tier[] = ['root', 'hod', 'manager', 'ic']
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: C.muted }}>
      {items.map(t => (
        <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: TIER_STYLE[t].dot }} />{TIER_STYLE[t].label}
        </span>
      ))}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: keyof typeof PATHS; value: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, minWidth: 150, flex: '1 1 150px' }}>
      <span style={{ width: 32, height: 32, borderRadius: R.sm, display: 'grid', placeItems: 'center', background: C.sunken, color: C.inkSoft }}><Icon name={icon} size={16} /></span>
      <div>
        <div style={{ fontSize: 17, fontWeight: W.bold, color: C.ink, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{label}</div>
      </div>
    </div>
  )
}

function DiagPanel({ orphans, span, loading }: {
  orphans: { emp_code: string; full_name: string; designation: string | null; department: string | null }[]
  span: { emp_code: string; full_name: string; direct_reports: number; department: string | null }[]
  loading: boolean
}) {
  const box: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: 14 }
  const head: React.CSSProperties = { fontSize: 11, fontWeight: W.semi, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={box}>
        <div style={head}>No one to approve for them</div>
        {loading ? <div style={{ fontSize: 12, color: C.muted }}>Loading…</div> : orphans.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted }}>Nobody: every active employee has a manager or is a named department head.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {orphans.map(o => (
              <div key={o.emp_code} style={{ fontSize: 12, padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ color: C.ink, fontWeight: W.semi }}>{o.full_name}</span> <span style={{ color: C.muted, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{o.emp_code}</span>
                <div style={{ color: C.muted, fontSize: 11.5 }}>{o.designation}{o.department ? ' · ' + o.department : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={box}>
        <div style={head}>Widest spans of control</div>
        {loading ? <div style={{ fontSize: 12, color: C.muted }}>Loading…</div> : span.slice(0, 8).map(s => (
          <div key={s.emp_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.line}`, fontSize: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.ink, fontWeight: W.semi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.full_name}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{s.department || '-'}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: W.semi, color: s.direct_reports >= 15 ? C.critical : C.inkSoft, flexShrink: 0, marginLeft: 8 }}>{s.direct_reports}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function OrgChartPage() {
  const { grant } = useGrant()
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(100)
  const [q, setQ] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeHit, setActiveHit] = useState(0)
  const [searchMsg, setSearchMsg] = useState('')
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [showDiag, setShowDiag] = useState(false)
  const [orphans, setOrphans] = useState<any[]>([])
  const [span, setSpan] = useState<any[]>([])
  const [diagLoading, setDiagLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const refs = useRef<Map<string, HTMLDivElement>>(new Map())
  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) refs.current.set(id, el); else refs.current.delete(id)
  }, [])
  const outerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  // A searched card to centre once it is rendered; while set, the auto-fit stays out of the way.
  const focusRef = useRef<string | null>(null)

  useEffect(() => {
    // Open on the viewer's OWN company. This page also lives inside every employee's ESS
    // portal, and an STC employee landing on SRS's chart reads as the wrong chart.
    ;(async () => {
      const { data } = await supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      // A non-cross-company viewer only ever sees their own company's chart.
      const list = scopedCompanies(grant, data || [])
      setCompanies(list)
      let own: string | null = null
      if (grant.employeeId) {
        const { data: me } = await supabase.from('employees').select('company_id').eq('id', grant.employeeId).maybeSingle()
        own = me?.company_id ?? null
      }
      setCompanyId(prev => prev || (list.some(c => c.id === own) ? own! : list[0]?.id ?? ''))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.employeeId])

  const load = useCallback(async () => {
    setLoading(true)
    const token = await authToken()
    // '' = All companies → the API's explicit ALL token; the forest gets one tree per company.
    const res = await fetch(`/api/rms/orgchart?company_id=${companyId || 'ALL'}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
    }).then(r => r.json()).catch(() => ({ tree: [] }))
    const tree: OrgTreeNode[] = res.tree || []
    setRows(tree.map(n => ({ ...n, id: n.id, managerId: n.managerId, fullName: n.fullName })))
    setLoading(false)
  }, [companyId])
  useEffect(() => { load() }, [load])

  const forest = useMemo(() => buildForest<Row>(rows), [rows])
  const flat = useMemo(() => flatten(forest), [forest])
  const allIds = useMemo(() => flat.map(n => n.node.id), [flat])
  const total = useMemo(() => countNodes(forest), [forest])
  const managers = useMemo(() => flat.filter(n => n.node.directReports > 0).length, [flat])
  const departments = useMemo(() => new Set(flat.map(n => n.node.department).filter(Boolean)).size, [flat])

  // "My chain" — the single line of command for the viewer: leadership at the top → … →
  // their manager → THEM → their direct reports (one level, as leaves). Null when the viewer
  // has no employee row or isn't in the loaded company (then the whole-company forest shows).
  const chainForest = useMemo(() => {
    if (!grant.employeeId) return null
    const path = pathTo(forest, grant.employeeId)
    if (!path.length) return null
    const me = path[path.length - 1]
    const ancestors = path.slice(0, -1)
    const directReports = me.children.map(c => ({ node: c.node, children: [] as TreeNode<Row>[] }))
    let node: TreeNode<Row> = { node: me.node, children: directReports }
    for (let i = ancestors.length - 1; i >= 0; i--) node = { node: ancestors[i].node, children: [node] }
    return [node]
  }, [forest, grant.employeeId])
  const [chainOnly, setChainOnly] = useState(true)
  // The people who report DIRECTLY to the viewer.
  const reportIds = useMemo(() => {
    if (!grant.employeeId) return new Set<string>()
    const path = pathTo(forest, grant.employeeId)
    if (!path.length) return new Set<string>()
    return new Set(path[path.length - 1].children.map(c => c.node.id))
  }, [forest, grant.employeeId])
  const NO_COLLAPSE = useMemo(() => new Set<string>(), [])
  const inChain = chainOnly && !!chainForest
  const viewForest = inChain ? chainForest! : forest
  const viewCollapsed = inChain ? NO_COLLAPSE : collapsedIds

  // Default view: the root plus its direct reports, everything deeper collapsed.
  const resetToDefault = useCallback(() => {
    const depthOf = new Map(flat.map(n => [n.node.id, n.node.depth]))
    setCollapsedIds(new Set(allIds.filter(id => (depthOf.get(id) ?? 0) >= 1)))
  }, [flat, allIds])
  useEffect(() => { resetToDefault() }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scale the whole tree down until it fits the visible frame, never past 100%.
  const fitToScreen = useCallback(() => {
    const outer = outerRef.current, wrap = wrapRef.current
    if (!outer || !wrap) return
    const prevTransform = wrap.style.transform
    wrap.style.transform = 'none'
    const naturalW = wrap.scrollWidth, naturalH = wrap.scrollHeight
    wrap.style.transform = prevTransform
    if (!naturalW || !naturalH) return
    const availW = outer.clientWidth - 40, availH = outer.clientHeight - 40
    const scale = Math.min(availW / naturalW, availH / naturalH, 1)
    setZoom(Math.max(15, Math.min(140, Math.round(scale * 100))))
  }, [])
  useEffect(() => {
    // A pending search focus keeps the zoom it set; everything else re-fits.
    const id = setTimeout(() => {
      const target = focusRef.current
      if (!target) { fitToScreen(); return }
      focusRef.current = null
      refs.current.get(target)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 80)
    return () => clearTimeout(id)
  }, [forest, collapsedIds, chainOnly, highlightId, fitToScreen])

  const downloadJpeg = useCallback(async () => {
    const wrap = wrapRef.current
    if (!wrap || downloading) return
    setDownloading(true)
    const prevTransform = wrap.style.transform
    wrap.style.transform = 'none'
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(wrap, {
        // The page's own background (a theme token, so read back as a resolved colour).
        backgroundColor: getComputedStyle(outerRef.current || document.body).backgroundColor, scale: 2, useCORS: true,
        // html2canvas cannot measure -webkit-line-clamp and clips the text — un-clamp those
        // cells in the capture clone only (the live chart keeps its 2-line clamp).
        onclone: (doc) => {
          doc.querySelectorAll<HTMLElement>('.orgcard-clamp').forEach((el) => {
            el.style.display = 'block'
            el.style.setProperty('-webkit-line-clamp', 'unset')
            el.style.overflow = 'visible'
            el.style.whiteSpace = 'normal'
            el.style.lineHeight = '1.4'
            el.style.paddingBottom = '2px'
          })
        },
      })
      const companyName = companies.find(c => c.id === companyId)?.company_name || 'All_companies'
      const safeName = companyName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      const link = document.createElement('a')
      link.download = `org-chart-${safeName}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.92)
      link.click()
    } finally {
      wrap.style.transform = prevTransform
      setDownloading(false)
    }
  }, [companies, companyId, downloading])

  useEffect(() => {
    if (!showDiag) return
    // On All companies the params go up empty, which both diagnostic RPCs read as "no
    // company filter" — so the panels cover the whole group.
    setDiagLoading(true)
    authToken().then(token => Promise.all([
      fetch(`/api/rms/orgchart?view=orphans&company_id=${companyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()),
      fetch(`/api/rms/orgchart?view=span&company_id=${companyId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()),
    ])).then(([o, s]) => { setOrphans(o.orphans || []); setSpan(s.span || []); setDiagLoading(false) })
  }, [showDiag, companyId])

  const toggle = (id: string) => setCollapsedIds(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  // ── Search ──
  useEffect(() => {
    const off = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSuggestOpen(false) }
    document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off)
  }, [])
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/\s+/g, ' ')
    if (!needle) return []
    const code = needle.replace(/[\s-]/g, '')
    const scored = flat.map(n => {
      const name = (n.node.fullName || '').toLowerCase(), emp = (n.node.empCode || '').toLowerCase().replace(/[\s-]/g, '')
      const score = emp === code ? 0 : emp.startsWith(code) ? 1 : name.startsWith(needle) ? 2 : emp.includes(code) ? 3 : name.includes(needle) ? 4
        : (n.node.designation || '').toLowerCase().includes(needle) ? 5 : 9
      return { n, score }
    }).filter(x => x.score < 9).sort((a, b) => a.score - b.score || String(a.n.node.fullName).localeCompare(String(b.n.node.fullName)))
    return scored.slice(0, 8).map(x => x.n)
  }, [q, flat])

  const focusOn = (hit: TreeNode<Row>) => {
    const path = pathTo(forest, hit.node.id)
    // The whole company, the branch down to the person open, a readable zoom, their card centred.
    setChainOnly(false)
    setCollapsedIds(s => { const n = new Set(s); path.slice(0, -1).forEach(p => n.delete(p.node.id)); return n })
    setZoom(z => Math.max(z, 85))
    focusRef.current = hit.node.id
    setHighlightId(hit.node.id)
    setSearchMsg('')
    setSuggestOpen(false)
    setQ(`${hit.node.fullName || ''}${hit.node.empCode ? ` · ${hit.node.empCode}` : ''}`)
  }
  const search = () => {
    if (!q.trim()) return
    if (hits[activeHit] || hits[0]) focusOn(hits[activeHit] || hits[0])
    else setSearchMsg(`No one matching “${q.trim()}” in ${companies.find(c => c.id === companyId)?.company_name || 'this chart'}.`)
  }
  const clearSearch = () => { setQ(''); setHighlightId(null); setSearchMsg(''); setSuggestOpen(false) }

  const btn: React.CSSProperties = { height: 34, padding: '0 12px', borderRadius: R.sm, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: W.medium, cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }
  const iconBtn: React.CSSProperties = { width: 28, height: 28, border: 'none', borderRadius: R.sm, background: 'transparent', color: C.inkSoft, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const seg = (on: boolean): React.CSSProperties => ({ height: 28, padding: '0 12px', borderRadius: R.sm - 1, border: 'none', cursor: 'pointer', fontFamily: font, fontSize: 12.5, fontWeight: on ? W.semi : W.medium, background: on ? C.surface : 'transparent', color: on ? C.ink : C.muted, boxShadow: on ? E.flat : 'none', display: 'inline-flex', alignItems: 'center', gap: 6 })

  return (
    <div style={{ padding: '20px 20px 32px', background: C.canvas, minHeight: '100vh', fontFamily: font, color: C.ink, fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: W.bold, letterSpacing: '-.01em', color: C.ink }}>Organisation chart</h1>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>Reporting lines from the Employee Master. Change someone’s manager there and the chart follows.</div>
        </div>
        <button onClick={downloadJpeg} disabled={downloading || forest.length === 0}
          style={{ ...btn, background: C.brand, color: C.onAccent, border: `1px solid ${C.brand}`, fontWeight: W.semi, opacity: downloading || forest.length === 0 ? .55 : 1, cursor: downloading || forest.length === 0 ? 'default' : 'pointer' }}>
          <Icon name="download" />{downloading ? 'Preparing…' : 'Download image'}
        </button>
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <Stat icon="users" value={loading ? '…' : String(total)} label="People in the chart" />
        <Stat icon="user" value={loading ? '…' : String(managers)} label="People managers" />
        <Stat icon="building" value={loading ? '…' : String(departments)} label="Departments" />
      </div>

      {/* Toolbar */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, padding: 10, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {companies.length > 1 || !companies.length ? (
          <select value={companyId} onChange={e => { setCompanyId(e.target.value); clearSearch() }}
            style={{ height: 34, padding: '0 10px', borderRadius: R.sm, border: `1px solid ${C.line}`, fontSize: 12.5, background: C.surface, color: C.ink, fontFamily: font }} aria-label="Company">
            <option value="">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        ) : <span style={{ fontSize: 12.5, fontWeight: W.semi, color: C.inkSoft, padding: '0 4px' }}>{companies[0]?.company_name}</span>}

        <div ref={searchRef} style={{ position: 'relative', flex: '1 1 260px', minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint, display: 'flex', pointerEvents: 'none' }}><Icon name="search" /></span>
          <input value={q}
            onChange={e => { setQ(e.target.value); setSuggestOpen(true); setActiveHit(0); setSearchMsg('') }}
            onFocus={() => q.trim() && setSuggestOpen(true)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActiveHit(a => Math.min(a + 1, Math.max(hits.length - 1, 0))) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveHit(a => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); search() }
              else if (e.key === 'Escape') setSuggestOpen(false)
            }}
            placeholder="Search by name or employee ID…" aria-label="Search the chart"
            style={{ width: '100%', boxSizing: 'border-box', height: 34, padding: '0 30px 0 32px', borderRadius: R.sm, border: `1px solid ${C.line}`, fontSize: 12.5, background: C.surface, color: C.ink, fontFamily: font, outline: 'none' }} />
          {q && <button onClick={clearSearch} aria-label="Clear search" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', ...iconBtn, width: 24, height: 24 }}><Icon name="x" size={13} /></button>}
          {suggestOpen && q.trim() && (
            <div role="listbox" style={{ position: 'absolute', top: 38, left: 0, right: 0, background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.md, boxShadow: E.overlay, padding: 4, zIndex: Z.sticky, maxHeight: 320, overflowY: 'auto' }}>
              {hits.length === 0 ? <div style={{ padding: '10px 10px', fontSize: 12.5, color: C.muted }}>No one matching “{q.trim()}”.</div>
                : hits.map((h, i) => (
                  <button key={h.node.id} role="option" aria-selected={i === activeHit} onMouseEnter={() => setActiveHit(i)} onClick={() => focusOn(h)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '7px 9px', border: 'none', borderRadius: R.sm, cursor: 'pointer', fontFamily: font, background: i === activeHit ? C.sunken : 'transparent' }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: C.sunken, border: `1px solid ${C.line}`, color: C.inkSoft, fontSize: 10.5, fontWeight: W.semi, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{initials(h.node.fullName)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: W.semi, color: C.ink }}>{h.node.fullName}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[h.node.designation, h.node.department].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <span style={{ fontSize: 11.5, color: C.inkSoft, fontFamily: 'ui-monospace, monospace' }}>{h.node.empCode}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {chainForest && (
          <div role="tablist" style={{ display: 'inline-flex', padding: 3, gap: 2, background: C.sunken, borderRadius: R.sm, border: `1px solid ${C.line}` }}>
            <button role="tab" aria-selected={inChain} onClick={() => setChainOnly(true)} style={seg(inChain)}><Icon name="user" size={13} />My chain</button>
            <button role="tab" aria-selected={!inChain} onClick={() => setChainOnly(false)} style={seg(!inChain)}><Icon name="tree" size={13} />Whole company</button>
          </div>
        )}

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: `1px solid ${C.line}`, borderRadius: R.sm, padding: 2 }}>
          <button onClick={() => setZoom(z => Math.max(15, z - 10))} style={iconBtn} title="Zoom out" aria-label="Zoom out"><Icon name="minus" size={14} /></button>
          <span style={{ fontSize: 12, fontWeight: W.semi, color: C.inkSoft, width: 40, textAlign: 'center' }}>{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(140, z + 10))} style={iconBtn} title="Zoom in" aria-label="Zoom in"><Icon name="plus" size={14} /></button>
          <span style={{ width: 1, height: 18, background: C.line, margin: '0 2px' }} />
          <button onClick={fitToScreen} style={iconBtn} title="Fit to screen" aria-label="Fit to screen"><Icon name="fit" size={14} /></button>
        </div>

        {!inChain && <button onClick={() => setCollapsedIds(new Set())} style={btn} title="Open every branch"><Icon name="expand" size={14} />Expand all</button>}
        {!inChain && <button onClick={resetToDefault} style={btn} title="Back to the top two levels"><Icon name="collapse" size={14} />Collapse</button>}
        {canSee(grant, 'Employees') && (
          <button onClick={() => setShowDiag(s => !s)} style={{ ...btn, marginLeft: 'auto', background: showDiag ? C.sunken : C.surface, borderColor: showDiag ? C.lineStrong : C.line }}>
            <Icon name="alert" size={14} />Diagnostics
          </button>
        )}
      </div>

      {searchMsg && <div role="status" style={{ marginBottom: 10, padding: '8px 12px', borderRadius: R.sm, background: C.sunken, border: `1px solid ${C.line}`, fontSize: 12.5, color: C.inkSoft }}>{searchMsg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
        <Legend />
        <span style={{ fontSize: 11.5, color: C.faint }}>{inChain ? 'Showing your reporting line' : 'Click a count under a card to open that team'}</span>
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div ref={outerRef} style={{
          flex: 1, minWidth: 0, background: C.sunken,
          backgroundImage: `radial-gradient(circle, ${C.line} 1px, transparent 1px)`, backgroundSize: '22px 22px',
          border: `1px solid ${C.line}`, borderRadius: R.lg, padding: 32, overflow: 'auto', maxHeight: '72vh', minHeight: 420, textAlign: 'center',
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: C.muted, padding: 60, fontSize: 13 }}>Loading the chart…</div>
          ) : forest.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.muted, padding: 60, fontSize: 13 }}>
              No reporting lines for this company yet. Import the org chart from Bulk Uploader → Org Structure &amp; Roles.
            </div>
          ) : (
            <div ref={wrapRef} style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', display: 'inline-block', paddingTop: 10 }}>
              <ul className="org-tree" style={{ justifyContent: 'center' }}>
                {viewForest.map(n => (
                  <TreeLI key={n.node.id} node={n} selfId={grant.employeeId} reportIds={reportIds} collapsedIds={viewCollapsed}
                    onToggle={toggle} registerRef={registerRef} highlightId={highlightId} />
                ))}
              </ul>
            </div>
          )}
        </div>

        {showDiag && <DiagPanel orphans={orphans} span={span} loading={diagLoading} />}
      </div>
    </div>
  )
}
