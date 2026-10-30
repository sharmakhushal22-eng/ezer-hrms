// src/features/orgchart/OrgChartScreen.tsx — the Org Chart section.
//
// The website renders app/dashboard/org-chart/page.tsx inside the portal (the
// same default export the admin dashboard uses). Same data, same rules here:
//   · who the viewer is comes from /api/rms/me; "My chain" is the default
//     (ancestors → YOU → your direct reports as leaves), "whole company" opens
//     at roots + their direct reports (collapse depth ≥ 1)
//   · a non-cross-company viewer only ever sees their own company — the
//     dropdown offers "All companies" + their own, and the server pins it
//   · search walks the whole forest, opens every ancestor and highlights the hit
//   · ⚠ Diagnostics only for canSee(grant, 'Employees')
// Drawn as an indented list for a phone (see tree.tsx); zoom/fit-to-screen and
// the JPEG download are not built here.
import * as React from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { buildForest, countNodes, flatten, pathTo, type TreeNode } from '@web/rms/tree'
import { canSee, emptyGrant } from '@web/rms/resolve'
import { useEmployeeId } from '@/core/session'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Gap, Input, PickerField, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { Screen } from '@/ui/Screen'
import { IconSearch } from '@/ui/icons'
import { loadCompanies, loadDiagnostics, loadGrant, loadTree, type OrgTreeNode } from './api'
import { DiagPanel, Legend, OrgRow, visibleRows } from './tree'

type Node = TreeNode<OrgTreeNode>
const NO_COLLAPSE = new Set<string>()

export default function OrgChartScreen() {
  const { C } = useTheme()
  const me = useEmployeeId()
  const grantQ = useQuery({ queryKey: ['orgchart', 'grant', me], queryFn: () => loadGrant(me), enabled: !!me })
  const grant = grantQ.data ?? emptyGrant()
  const compQ = useQuery({ queryKey: ['orgchart', 'companies', grant.employeeId], queryFn: () => loadCompanies(grant), enabled: !!grantQ.data })

  // The viewer's pick, else the page's default (own company if listed, else the first).
  const [chosen, setCompanyId] = React.useState<string | null>(null)
  const companyId = chosen ?? compQ.data?.initial ?? null
  const companies = compQ.data?.list ?? []

  const treeQ = useQuery({ queryKey: ['orgchart', 'tree', companyId || 'ALL'], queryFn: () => loadTree(companyId || ''), enabled: companyId !== null })
  const rows = React.useMemo(() => treeQ.data ?? [], [treeQ.data])
  const loading = companyId === null || treeQ.isLoading

  const forest = React.useMemo(() => buildForest<OrgTreeNode>(rows), [rows])
  const total = React.useMemo(() => countNodes(forest), [forest])

  // Default view (resetToDefault on the website, re-run whenever rows change):
  // roots plus their direct reports, everything at depth ≥ 1 collapsed. The
  // viewer's own expand/collapse is kept against the rows it was made on.
  const defaultCollapsed = React.useMemo(() => new Set(flatten(forest).filter(n => (n.node.depth ?? 0) >= 1).map(n => n.node.id)), [forest])
  const [collapse, setCollapse] = React.useState<{ rows: OrgTreeNode[]; ids: Set<string> } | null>(null)
  const collapsedIds = collapse && collapse.rows === rows ? collapse.ids : defaultCollapsed
  const setCollapsedIds = (next: Set<string> | ((s: Set<string>) => Set<string>)) =>
    setCollapse({ rows, ids: typeof next === 'function' ? next(collapsedIds) : next })
  const [chainOnly, setChainOnly] = React.useState(true)
  const [q, setQ] = React.useState('')
  const [highlightId, setHighlightId] = React.useState<string | null>(null)
  const [showDiag, setShowDiag] = React.useState(false)
  const [pickCompany, setPickCompany] = React.useState(false)

  const selfId = grant.employeeId
  const chainForest = React.useMemo<Node[] | null>(() => {
    if (!selfId) return null
    const path = pathTo(forest, selfId)
    if (!path.length) return null
    const mine = path[path.length - 1]
    const ancestors = path.slice(0, -1)
    let node: Node = { node: mine.node, children: mine.children.map(c => ({ node: c.node, children: [] })) }
    for (let i = ancestors.length - 1; i >= 0; i--) node = { node: ancestors[i].node, children: [node] }
    return [node]
  }, [forest, selfId])
  const reportIds = React.useMemo(() => {
    if (!selfId) return new Set<string>()
    const path = pathTo(forest, selfId)
    return path.length ? new Set(path[path.length - 1].children.map(c => c.node.id)) : new Set<string>()
  }, [forest, selfId])
  const inChain = chainOnly && !!chainForest
  const viewForest = inChain ? chainForest! : forest
  const shown = React.useMemo(() => visibleRows(viewForest, inChain ? NO_COLLAPSE : collapsedIds), [viewForest, inChain, collapsedIds])

  const resetToDefault = () => setCollapse(null)

  const diagQ = useQuery({ queryKey: ['orgchart', 'diag', companyId || ''], queryFn: () => loadDiagnostics(companyId || ''), enabled: showDiag && companyId !== null })

  // ── scrolling to a search hit ──
  const scrollRef = React.useRef<ScrollView>(null)
  const rowY = React.useRef(new Map<string, number>())
  const boxY = React.useRef(0)
  const cardY = React.useRef(0)
  const onRowY = React.useCallback((id: string, y: number) => { rowY.current.set(id, y) }, [])

  const toggle = (id: string) => setCollapsedIds(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const search = () => {
    const needle = q.trim().toLowerCase()
    if (!needle) return
    const hit = flatten(forest).find(n => (n.node.fullName || '').toLowerCase().includes(needle) || (n.node.empCode || '').toLowerCase().includes(needle))
    if (!hit) return
    const path = pathTo(forest, hit.node.id)
    setCollapsedIds(s => { const n = new Set(s); path.forEach(p => n.delete(p.node.id)); return n })
    // Website gap fixed: in "My chain" a hit outside the chain was never drawn
    // and nothing happened. Here the chart switches to the whole company.
    if (inChain && chainForest && !flatten(chainForest).some(n => n.node.id === hit.node.id)) setChainOnly(false)
    setHighlightId(hit.node.id)
    setTimeout(() => {
      const y = rowY.current.get(hit.node.id)
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, cardY.current + boxY.current + y - 160), animated: true })
    }, 250)
  }

  const [refreshing, setRefreshing] = React.useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try { await Promise.all([grantQ.refetch(), compQ.refetch(), treeQ.refetch(), showDiag ? diagQ.refetch() : null]) } finally { setRefreshing(false) }
  }

  const companyLabel = companyId ? companies.find(c => c.id === companyId)?.company_name || '' : 'All companies'

  return (
    <Screen title="Org Chart" subtitle="See how the whole company fits together" scroll={false} padded={false}>
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxl + S.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.brand} colors={[C.brand]} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, flexWrap: 'wrap' }}>
          <LinearGradient colors={[C.brand, C.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={18}>🌳</Txt>
          </LinearGradient>
          <Txt size={F.title + 1} w={700}>Organisation chart</Txt>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: C.brandTint }}>
            <Txt size={F.micro} w={700} color={C.brandDeep}>{loading ? 'Loading…' : `${total} people`}</Txt>
          </View>
        </View>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm, marginBottom: S.md }}>
          Read straight from the reporting lines set on the Employee Master and the org-chart import. Moving somebody’s manager there moves them here.
        </Txt>

        <Card style={{ padding: S.md }}>
          <PickerField value={companyLabel} placeholder="All companies" onPress={() => setPickCompany(true)} style={{ marginBottom: S.sm }} />
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
            <Input value={q} onChangeText={setQ} placeholder="Find by name or employee code…" returnKeyType="search" onSubmitEditing={search}
              autoCapitalize="none" autoCorrect={false} style={{ flex: 1, marginBottom: 0 }}
              right={<View style={{ paddingRight: S.md }}><IconSearch size={16} color={C.faint} /></View>} />
            <Button title="Find" variant="outline" onPress={search} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm }}>
            {chainForest && (
              <Button size="sm" variant={inChain ? 'primary' : 'outline'} onPress={() => setChainOnly(v => !v)}
                title={inChain ? '🏢 Show whole company' : '👤 Show my chain'} />
            )}
            {!inChain && <Button size="sm" variant="outline" title="⤢ Expand all" onPress={() => setCollapsedIds(new Set())} />}
            {!inChain && <Button size="sm" variant="outline" title="⤡ Collapse to my level" onPress={resetToDefault} />}
            {canSee(grant, 'Employees') && (
              <Button size="sm" variant={showDiag ? 'primary' : 'outline'} title="⚠ Diagnostics" onPress={() => setShowDiag(s => !s)} />
            )}
          </View>
        </Card>

        <Gap h={S.md} />
        <Legend />
        <Gap h={S.md} />

        {showDiag && (
          <>
            <DiagPanel orphans={diagQ.data?.orphans ?? []} span={diagQ.data?.span ?? []} loading={diagQ.isLoading || diagQ.isFetching && !diagQ.data} />
            <Gap h={S.md} />
          </>
        )}

        <View onLayout={e => { cardY.current = e.nativeEvent.layout.y }}
          style={{ backgroundColor: C.sunken, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.sm }}>
          {loading ? (
            <Txt size={F.small} tone="brand" center style={{ padding: 48 }}>Loading the chart…</Txt>
          ) : forest.length === 0 ? (
            <Txt size={F.small} tone="muted" center style={{ padding: 40 }}>
              No reporting lines for this company yet. Import the org chart from Bulk Uploader → Org Structure &amp; Roles.
            </Txt>
          ) : (
            <View onLayout={e => { boxY.current = e.nativeEvent.layout.y }}>
              {shown.map(r => (
                <OrgRow key={r.node.node.id} row={r} isSelf={r.node.node.id === selfId} isReport={reportIds.has(r.node.node.id)}
                  highlighted={r.node.node.id === highlightId} onToggle={toggle} onLayoutY={onRowY} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <SelectSheet visible={pickCompany} onClose={() => setPickCompany(false)} title="Company"
        options={[{ value: '', label: 'All companies' }, ...companies.map(c => ({ value: c.id, label: c.company_name }))]}
        value={companyId ?? ''} onPick={v => { setCompanyId(String(v)); setHighlightId(null) }} />
    </Screen>
  )
}
