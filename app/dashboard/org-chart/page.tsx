'use client'
// app/dashboard/org-chart/page.tsx — the whole company, one query, one tree.
//
// Reads /api/rms/orgchart, which reads v_org_tree (migration 060) — a single recursive
// query over employee_relationships, the same table the Employee Master's Manager
// Information panel reads. Nothing here is a second source of truth: move somebody's
// manager anywhere in the app and this chart moves with it.
//
// Card colour is derived from the data, not hand-tagged: root (nobody above them, per
// employee_relationships), HOD (named as somebody's department head), manager (has
// direct reports), or individual contributor. Nobody has to remember to label anyone.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useGrant, authToken } from '@/lib/rms/client'
import { buildForest, flatten, pathTo, countNodes, type TreeNode } from '@/lib/rms/tree'
import type { OrgTreeNode } from '@/lib/rms/server'

const P = {
  navy: '#1E1B4B', purple: '#7C3AED', purpleDark: '#3C3489',
  purpleBg: '#EEEDFE', purpleLight: '#F5F3FF',
  border: '#E9E7F5', card: '#FFFFFF', page: '#F5F3FF',
  text: '#1E1B4B', muted: '#6B6B7B',
  green: '#059669', greenBg: '#ECFDF5',
  red: '#DC2626', redBg: '#FEF2F2',
  amber: '#B45309', amberBg: '#FFFBEB',
  blue: '#1D4ED8', blueBg: '#EFF6FF',
}

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

const TIER_STYLE: Record<Tier, { bar: string; label: string }> = {
  root:    { bar: P.amber, label: 'Top of chain' },
  hod:     { bar: P.blue,  label: 'Department Head' },
  manager: { bar: P.purple, label: 'Manager' },
  ic:      { bar: '#9CA3AF', label: 'Individual Contributor' },
}

function initials(name: string | null): string {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
}

function OrgCard({ node, isSelf, onToggle, collapsed, hasChildren, registerRef, highlighted }: {
  node: TreeNode<Row>
  isSelf: boolean
  onToggle: () => void
  collapsed: boolean
  hasChildren: boolean
  registerRef: (id: string, el: HTMLDivElement | null) => void
  highlighted: boolean
}) {
  const n = node.node
  const tier = tierOf(n)
  const style = TIER_STYLE[tier]
  return (
    <div
      ref={el => registerRef(n.id, el)}
      className="org-node"
      style={{
        width: 168, background: P.card, borderRadius: 8,
        border: `1px solid ${highlighted ? P.purple : P.border}`,
        boxShadow: highlighted ? `0 0 0 3px ${P.purpleBg}, 0 4px 14px rgba(124,58,237,0.18)` : '0 1px 4px rgba(30,27,75,0.06)',
        overflow: 'hidden', flexShrink: 0,
      }}
      title={`${n.fullName || '—'} · ${n.designation || '—'}${n.department ? ' · ' + n.department : ''}`}
    >
      <div style={{ height: 6, background: style.bar }} />
      <div style={{ padding: '10px 10px 8px', textAlign: 'center', position: 'relative' }}>
        {n.directReports > 0 && (
          <div style={{
            position: 'absolute', top: 6, right: 6, fontSize: 9.5, fontWeight: 700,
            background: P.purpleBg, color: P.purpleDark, borderRadius: 99, padding: '1px 6px',
          }}>{n.directReports}</div>
        )}
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: style.bar + '22',
          color: style.bar, fontSize: 13, fontWeight: 700, margin: '0 auto 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials(n.fullName)}</div>
        <div style={{
          fontSize: 12, fontWeight: 700, color: P.text, lineHeight: 1.25,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{n.fullName || '—'}</div>
        <div style={{ fontSize: 10, color: P.muted, fontFamily: 'monospace', marginTop: 2 }}>{n.empCode || '—'}</div>
        <div style={{
          fontSize: 10.5, color: P.muted, marginTop: 3, lineHeight: 1.3,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{n.designation || '—'}</div>
      </div>
      {isSelf && (
        <div style={{ fontSize: 9, fontWeight: 700, color: '#fff', background: P.purple, textAlign: 'center', padding: '2px 0' }}>YOU</div>
      )}
      {hasChildren && (
        <button
          onClick={onToggle}
          style={{
            width: '100%', border: 'none', borderTop: `1px solid ${P.border}`,
            background: P.purpleLight, color: P.purpleDark, fontSize: 11, fontWeight: 700,
            padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >{collapsed ? `+ ${n.directReports}` : '− collapse'}</button>
      )}
    </div>
  )
}

function TreeLI({ node, selfId, collapsedIds, onToggle, registerRef, highlightId }: {
  node: TreeNode<Row>
  selfId: string | null
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
        node={node} isSelf={node.node.id === selfId}
        onToggle={() => onToggle(node.node.id)}
        collapsed={collapsed} hasChildren={hasChildren}
        registerRef={registerRef}
        highlighted={node.node.id === highlightId}
      />
      {hasChildren && !collapsed && (
        <ul>
          {node.children.map(c => (
            <TreeLI key={c.node.id} node={c} selfId={selfId} collapsedIds={collapsedIds}
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
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {items.map(t => (
        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: P.muted }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: TIER_STYLE[t].bar, flexShrink: 0 }} />
          {TIER_STYLE[t].label}
        </div>
      ))}
    </div>
  )
}

function DiagPanel({ orphans, span, loading }: {
  orphans: { emp_code: string; full_name: string; designation: string | null; department: string | null }[]
  span: { emp_code: string; full_name: string; direct_reports: number; department: string | null }[]
  loading: boolean
}) {
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: P.red, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
          ⚠ No one to approve for them
        </div>
        {loading ? <div style={{ fontSize: 12, color: P.muted }}>Loading…</div> : orphans.length === 0 ? (
          <div style={{ fontSize: 12, color: P.muted }}>Nobody — every active employee has a manager or is a named department head.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {orphans.map(o => (
              <div key={o.emp_code} style={{ fontSize: 11.5, padding: '6px 8px', background: P.redBg, borderRadius: 6 }}>
                <b style={{ color: P.text }}>{o.full_name}</b> <span style={{ color: P.muted, fontFamily: 'monospace' }}>{o.emp_code}</span>
                <div style={{ color: P.muted }}>{o.designation}{o.department ? ' · ' + o.department : ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: P.amber, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
          Widest inboxes
        </div>
        {loading ? <div style={{ fontSize: 12, color: P.muted }}>Loading…</div> : span.slice(0, 8).map(s => (
          <div key={s.emp_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${P.border}`, fontSize: 11.5 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: P.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.full_name}</div>
              <div style={{ color: P.muted, fontSize: 10.5 }}>{s.department || '—'}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: s.direct_reports >= 15 ? P.red : P.purpleDark, flexShrink: 0, marginLeft: 8 }}>{s.direct_reports}</span>
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

  useEffect(() => {
    supabase.from('companies').select('id, company_name').eq('status', 'Active').order('company_name')
      .then(({ data }) => { setCompanies(data || []); if (data?.length && !companyId) setCompanyId(data[0].id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const token = await authToken()
    const res = await fetch(`/api/rms/orgchart?company_id=${companyId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store',
    }).then(r => r.json()).catch(() => ({ tree: [] }))
    const tree: OrgTreeNode[] = res.tree || []
    setRows(tree.map(n => ({ ...n, id: n.id, managerId: n.managerId, fullName: n.fullName })))
    setLoading(false)
  }, [companyId])
  useEffect(() => { load() }, [load])

  const forest = useMemo(() => buildForest<Row>(rows), [rows])
  const allIds = useMemo(() => flatten(forest).map(n => n.node.id), [forest])
  const total = useMemo(() => countNodes(forest), [forest])

  // Default view: the root plus its direct reports, everything deeper collapsed —
  // the same "collapse to my level" starting point the reference layout describes.
  const resetToDefault = useCallback(() => {
    const depthOf = new Map(flatten(forest).map(n => [n.node.id, n.node.depth]))
    setCollapsedIds(new Set(allIds.filter(id => (depthOf.get(id) ?? 0) >= 1)))
  }, [forest, allIds])
  useEffect(() => { resetToDefault() }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scale the whole tree down until it fits the visible frame in both directions,
  // so opening the page — or expanding a big branch — shows the full shape at once
  // instead of handing back a chart you can only see one scroll-page of at a time.
  // Measured against the tree's own natural size (transform briefly cleared), never
  // upscaled past 100% for a small chart.
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
    const id = setTimeout(fitToScreen, 60)
    return () => clearTimeout(id)
  }, [forest, collapsedIds, fitToScreen])

  const downloadJpeg = useCallback(async () => {
    const wrap = wrapRef.current
    if (!wrap || downloading) return
    setDownloading(true)
    const prevTransform = wrap.style.transform
    wrap.style.transform = 'none'
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const { default: html2canvas } = await import('html2canvas')
      const canvas = await html2canvas(wrap, { backgroundColor: P.page, scale: 2, useCORS: true })
      const companyName = companies.find(c => c.id === companyId)?.company_name || 'company'
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
    if (!showDiag || !companyId) return
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

  const search = () => {
    const needle = q.trim().toLowerCase()
    if (!needle) return
    const hit = flatten(forest).find(n =>
      (n.node.fullName || '').toLowerCase().includes(needle) ||
      (n.node.empCode || '').toLowerCase().includes(needle))
    if (!hit) return
    const path = pathTo(forest, hit.node.id)
    setCollapsedIds(s => { const n = new Set(s); path.forEach(p => n.delete(p.node.id)); return n })
    setHighlightId(hit.node.id)
    setTimeout(() => refs.current.get(hit.node.id)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 60)
  }

  const btn: React.CSSProperties = { padding: '7px 13px', borderRadius: 7, border: `1px solid ${P.border}`, background: '#fff', color: P.purpleDark, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: 20, background: P.page, minHeight: '100vh', fontFamily: font, color: P.text }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 19, fontWeight: 700 }}>🌳 Organisation chart</div>
        <span style={{ fontSize: 12, color: P.muted }}>{loading ? 'Loading…' : `${total} people`}</span>
      </div>
      <div style={{ fontSize: 12, color: P.muted, marginBottom: 14 }}>
        Read straight from the reporting lines set on the Employee Master and the org-chart import — moving somebody’s manager there moves them here.
      </div>

      <div style={{ background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={companyId} onChange={e => setCompanyId(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 7, border: `1px solid ${P.border}`, fontSize: 12, background: '#FAFAFE', color: P.text, fontFamily: font }}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>

        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Find by name or employee code…"
          style={{ flex: '1 1 200px', minWidth: 160, padding: '7px 10px', borderRadius: 7, border: `1px solid ${P.border}`, fontSize: 12, background: '#FAFAFE', color: P.text, fontFamily: font }} />
        <button onClick={search} style={btn}>🔍 Find</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setZoom(z => Math.max(15, z - 10))} style={{ ...btn, padding: '7px 10px' }}>−</button>
          <span style={{ fontSize: 11.5, color: P.muted, width: 38, textAlign: 'center' }}>{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(140, z + 10))} style={{ ...btn, padding: '7px 10px' }}>+</button>
        </div>

        <button onClick={fitToScreen} style={btn}>⛶ Fit to screen</button>
        <button onClick={() => setCollapsedIds(new Set())} style={btn}>⤢ Expand all</button>
        <button onClick={resetToDefault} style={btn}>⤡ Collapse to my level</button>
        <button onClick={() => setShowDiag(s => !s)} style={{ ...btn, background: showDiag ? P.purple : '#fff', color: showDiag ? '#fff' : P.purpleDark, borderColor: showDiag ? P.purple : P.border }}>
          ⚠ Diagnostics
        </button>
        <button onClick={downloadJpeg} disabled={downloading || forest.length === 0}
          style={{ ...btn, marginLeft: 'auto', background: P.purple, color: '#fff', borderColor: P.purple, opacity: downloading || forest.length === 0 ? 0.6 : 1, cursor: downloading || forest.length === 0 ? 'default' : 'pointer' }}>
          {downloading ? 'Preparing…' : '⬇ Download JPEG'}
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
        <Legend />
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div ref={outerRef} style={{ flex: 1, minWidth: 0, background: P.card, border: `1px solid ${P.border}`, borderRadius: 10, padding: 20, overflow: 'auto', maxHeight: '75vh', textAlign: 'center' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: P.purple, padding: 60, fontSize: 13 }}>Loading the chart…</div>
          ) : forest.length === 0 ? (
            <div style={{ textAlign: 'center', color: P.muted, padding: 60, fontSize: 13 }}>
              No reporting lines for this company yet. Import the org chart from Bulk Uploader → Org Structure &amp; Roles.
            </div>
          ) : (
            <div ref={wrapRef} style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center', display: 'inline-block' }}>
              <ul className="org-tree" style={{ justifyContent: 'center' }}>
                {forest.map(n => (
                  <TreeLI key={n.node.id} node={n} selfId={grant.employeeId} collapsedIds={collapsedIds}
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
