// src/features/orgchart/tree.tsx — the org chart drawn for a phone.
//
// The website lays the tree out as nested flex rows with CSS connectors on a
// pannable, zoomable canvas (app/dashboard/org-chart/page.tsx + globals.css
// .org-tree). A phone cannot read a 2-D canvas at 380px, so the same tree is
// drawn as an indented, collapsible list: depth-first, connectors as guide
// lines, every card carrying what the web card carries — tier bar and label,
// initials, name, code, designation, the 👥 N badge, the YOU ARE HERE /
// REPORTS TO YOU ribbons, the green report tint, the search highlight and the
// "+ N" / "−" toggle. Tapping a card opens nothing, as on the website.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import type { TreeNode } from '@web/rms/tree'
import { useTheme } from '@/ui/ThemeProvider'
import type { Palette } from '@/ui/theme'
import { F, R, S } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import type { OrgTreeNode, Orphan, SpanRow } from './api'

export type Tier = 'root' | 'hod' | 'manager' | 'ic'

export function tierOf(n: OrgTreeNode): Tier {
  if (!n.managerId) return 'root'
  if (n.isHod) return 'hod'
  if (n.directReports > 0) return 'manager'
  return 'ic'
}

export const TIER_LABEL: Record<Tier, string> = {
  root: 'Top of chain', hod: 'Department Head', manager: 'Manager', ic: 'Individual Contributor',
}
/** The web's hex palette P re-tokenised: amber→warning, blue→info, purple→brand, grey→faint. */
export const tierColour = (C: Palette, t: Tier) =>
  t === 'root' ? C.warning : t === 'hod' ? C.info : t === 'manager' ? C.brand : C.faint

/** '#RRGGBB' + alpha, for the tier pill wash. Leaves any other colour alone. */
const alpha = (hex: string, a: number) =>
  /^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex

function initials(name: string | null): string {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
}

// ── the visible rows ──────────────────────────────────────────────────────
export interface VisibleRow {
  node: TreeNode<OrgTreeNode>
  /** For each ancestor level (root excluded), whether that ancestor was the last of its siblings. */
  trail: boolean[]
  hasChildren: boolean
  collapsed: boolean
}

export function visibleRows(forest: TreeNode<OrgTreeNode>[], collapsed: Set<string>): VisibleRow[] {
  const out: VisibleRow[] = []
  const walk = (n: TreeNode<OrgTreeNode>, trail: boolean[]) => {
    const hasChildren = n.children.length > 0
    const isCollapsed = collapsed.has(n.node.id)
    out.push({ node: n, trail, hasChildren, collapsed: isCollapsed })
    if (hasChildren && !isCollapsed) n.children.forEach((c, i) => walk(c, [...trail, i === n.children.length - 1]))
  }
  forest.forEach(r => walk(r, []))
  return out
}

/** Indentation stops growing past this many levels so a deep chain still fits a phone. */
const MAX_GUIDES = 7
const GUIDE_W = 14

function Guides({ trail }: { trail: boolean[] }) {
  const { C } = useTheme()
  const shown = trail.slice(-MAX_GUIDES)
  const line = C.brandEdge
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'stretch' }}>
      {shown.map((last, i) => {
        const mine = i === shown.length - 1
        return (
          <View key={i} style={{ width: GUIDE_W, alignSelf: 'stretch' }}>
            {mine ? (
              <>
                <View style={{ position: 'absolute', left: 6, top: 0, height: last ? '50%' : '100%', width: 1.5, backgroundColor: line }} />
                <View style={{ position: 'absolute', left: 6, top: '50%', width: GUIDE_W - 6, height: 1.5, backgroundColor: line }} />
              </>
            ) : !last ? (
              <View style={{ position: 'absolute', left: 6, top: 0, bottom: 0, width: 1.5, backgroundColor: line }} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

export function OrgRow({ row, isSelf, isReport, highlighted, onToggle, onLayoutY }: {
  row: VisibleRow; isSelf: boolean; isReport: boolean; highlighted: boolean
  onToggle: (id: string) => void
  onLayoutY: (id: string, y: number) => void
}) {
  const { C } = useTheme()
  const n = row.node.node
  const tier = tierOf(n)
  const bar = tierColour(C, tier)
  const edge = isReport ? C.positive : highlighted ? C.brand : C.line
  return (
    <View onLayout={e => onLayoutY(n.id, e.nativeEvent.layout.y)} style={{ flexDirection: 'row', alignItems: 'stretch', paddingVertical: 4 }}>
      <Guides trail={row.trail} />
      <View
        accessibilityLabel={`${n.fullName || '-'} · ${n.designation || '-'}${n.department ? ' · ' + n.department : ''}`}
        style={{
          flex: 1, minWidth: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: isReport ? C.positiveTint : C.surface,
          borderWidth: highlighted || isReport ? 2 : 1, borderColor: edge,
        }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 5, backgroundColor: bar }} />
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, paddingVertical: 10, paddingLeft: 10, paddingRight: 6 }}>
            <LinearGradient colors={[bar, alpha(bar, 0.6)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
              <Txt size={12.5} w={700} color={C.onAccent}>{initials(n.fullName)}</Txt>
            </LinearGradient>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.small} w={700} numberOfLines={2}>{n.fullName || '-'}</Txt>
              <Txt size={10.5} tone="muted" style={{ fontVariant: ['tabular-nums'] }}>{n.empCode || '-'}</Txt>
              <Txt size={11} tone="muted" numberOfLines={2}>{n.designation || '-'}</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: alpha(bar, 0.1) }}>
                  <Txt size={9} w={700} color={bar} upper>{TIER_LABEL[tier]}</Txt>
                </View>
                {n.directReports > 0 && (
                  <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.brandTint }}>
                    <Txt size={9.5} w={700} color={C.brandDeep}>👥 {n.directReports}</Txt>
                  </View>
                )}
              </View>
            </View>
            {row.hasChildren && (
              <Pressable onPress={() => onToggle(n.id)} hitSlop={6} accessibilityRole="button"
                accessibilityLabel={row.collapsed ? `Show ${n.directReports} direct report${n.directReports === 1 ? '' : 's'}` : 'Collapse this branch'}
                style={({ pressed }) => ({
                  minWidth: 44, height: 36, paddingHorizontal: 8, borderRadius: R.pill, borderWidth: 1.5, borderColor: C.line,
                  backgroundColor: pressed ? C.brandTint : C.surface, alignItems: 'center', justifyContent: 'center',
                })}>
                <Txt size={F.tiny} w={700} color={C.brandDeep}>{row.collapsed ? `+ ${n.directReports}` : '−'}</Txt>
              </Pressable>
            )}
          </View>
        </View>
        {isSelf && (
          <LinearGradient colors={[C.brand, C.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 3 }}>
            <Txt size={9} w={700} color={C.onAccent} center>YOU ARE HERE</Txt>
          </LinearGradient>
        )}
        {isReport && !isSelf && (
          <View style={{ paddingVertical: 3, backgroundColor: C.positive }}>
            <Txt size={9} w={700} color={C.onAccent} center>REPORTS TO YOU</Txt>
          </View>
        )}
      </View>
    </View>
  )
}

export function Legend() {
  const { C } = useTheme()
  const items: Tier[] = ['root', 'hod', 'manager', 'ic']
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
      {items.map(t => (
        <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 8, paddingRight: 10, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tierColour(C, t) }} />
          <Txt size={F.micro} w={500}>{TIER_LABEL[t]}</Txt>
        </View>
      ))}
    </View>
  )
}

function DiagHead({ glyph, title, fg, bg }: { glyph: string; title: string; fg: string; bg: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginBottom: 10 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Txt size={12} color={fg}>{glyph}</Txt>
      </View>
      <Txt size={F.micro} w={700} color={fg} upper>{title}</Txt>
    </View>
  )
}

export function DiagPanel({ orphans, span, loading }: { orphans: Orphan[]; span: SpanRow[]; loading: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ gap: 10 }}>
      <Card padded style={{ padding: 14 }}>
        <DiagHead glyph="⚠" title="No one to approve for them" fg={C.critical} bg={C.criticalTint} />
        {loading ? <Txt size={F.tiny} tone="muted">Loading…</Txt> : orphans.length === 0 ? (
          <Txt size={F.tiny} tone="muted">Nobody: every active employee has a manager or is a named department head.</Txt>
        ) : (
          <View style={{ gap: 6 }}>
            {orphans.map(o => (
              <View key={o.emp_code} style={{ padding: 8, borderRadius: 6, backgroundColor: C.criticalTint }}>
                <Txt size={11.5}><Txt size={11.5} w={700}>{o.full_name}</Txt>  <Txt size={11.5} tone="muted">{o.emp_code}</Txt></Txt>
                <Txt size={11.5} tone="muted">{o.designation}{o.department ? ' · ' + o.department : ''}</Txt>
              </View>
            ))}
          </View>
        )}
      </Card>
      <Card padded style={{ padding: 14 }}>
        <DiagHead glyph="📊" title="Widest inboxes" fg={C.warning} bg={C.warningTint} />
        {loading ? <Txt size={F.tiny} tone="muted">Loading…</Txt> : span.slice(0, 8).map(s => (
          <View key={s.emp_code} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={11.5} w={600} numberOfLines={1}>{s.full_name}</Txt>
              <Txt size={10.5} tone="muted">{s.department || '-'}</Txt>
            </View>
            <Txt size={F.micro} w={700} color={s.direct_reports >= 15 ? C.critical : C.brandDeep} style={{ marginLeft: 8 }}>{s.direct_reports}</Txt>
          </View>
        ))}
      </Card>
    </View>
  )
}
