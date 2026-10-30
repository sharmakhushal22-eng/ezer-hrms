// src/features/team/TeamRoster.tsx — the scope-aware roster (RM / HOD only).
//
// components/ess/team/TeamRoster.tsx on the website: same call, same initial
// scope (isRm ? TEAM : DEPT), the toggle only for somebody who is BOTH, the
// DEPT-only "Reports to you" column, both footnotes and the empty state word
// for word. The table becomes one card per person on a phone.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S, toneOf, type Tone } from '@/ui/theme'
import { Card, Txt } from '@/ui/primitives'
import { loadRoster, type RosterRow } from './api'
import { PanelHead, RosterIcon } from './ui'

const TONE: Record<RosterRow['tone'], Tone> = { ok: 'positive', warn: 'warning', info: 'info' }

function StatusPill({ row }: { row: RosterRow }) {
  const { C } = useTheme()
  const t = toneOf(C, TONE[row.tone] ?? 'positive')
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: t.bg }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.fg }} />
      <Txt size={11} w={600} color={t.fg}>{row.status}</Txt>
    </View>
  )
}

function ScopeSeg({ scope, onChange }: { scope: 'TEAM' | 'DEPT'; onChange: (s: 'TEAM' | 'DEPT') => void }) {
  const { C } = useTheme()
  const items: { k: 'TEAM' | 'DEPT'; label: string }[] = [{ k: 'TEAM', label: 'Direct reports' }, { k: 'DEPT', label: 'Whole department' }]
  return (
    <View accessibilityLabel="Roster scope" style={{ flexDirection: 'row', padding: 3, borderRadius: R.md, backgroundColor: C.sunken, borderWidth: 1, borderColor: C.line, marginBottom: S.md }}>
      {items.map(it => {
        const on = scope === it.k
        return (
          <Pressable key={it.k} onPress={() => onChange(it.k)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: C.brandEdge }}>
            <Txt size={F.small} w={600} color={on ? C.brandDeep : C.muted}>{it.label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

function RosterCard({ r, dept }: { r: RosterRow; dept: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: S.md, borderTopWidth: 1, borderTopColor: C.line, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Txt size={F.small} w={700} style={{ flex: 1 }} numberOfLines={2}>{r.name}</Txt>
        <Txt size={F.micro} tone="faint" style={{ fontVariant: ['tabular-nums'] }}>{r.code || '-'}</Txt>
      </View>
      <Txt size={F.tiny} tone="soft">{r.designation || '-'}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap', marginTop: 2 }}>
        <StatusPill row={r} />
        {dept && (
          <Txt size={F.micro} tone={r.direct ? 'ink' : 'faint'} w={r.direct ? 600 : 400}>
            Reports to you: {r.direct ? 'Direct' : '-'}
          </Txt>
        )}
      </View>
    </View>
  )
}

export function TeamRoster({ employeeId, isRm, isHod }: { employeeId: string; isRm: boolean; isHod: boolean }) {
  const { C } = useTheme()
  const [scope, setScope] = React.useState<'TEAM' | 'DEPT'>(isRm ? 'TEAM' : 'DEPT')
  const q = useQuery({
    queryKey: ['team', 'roster', employeeId, scope],
    queryFn: () => loadRoster(employeeId, scope),
    enabled: !!employeeId,
    placeholderData: keepPreviousData,
  })
  if (!isRm && !isHod) return null
  const rows = q.data ?? null
  const dept = scope === 'DEPT'
  const warn = toneOf(C, 'warning')

  return (
    <Card>
      <PanelHead
        icon={<RosterIcon color={C.brand} />}
        title={dept ? 'My department' : 'My team: direct reports'}
        sub={dept ? 'Everyone in the department you head' : 'People whose reporting line ends with you'}
        right={!(isRm && isHod) && rows ? (
          <View style={{ minWidth: 28, paddingHorizontal: 8, height: 24, borderRadius: R.pill, backgroundColor: C.brandTint, borderWidth: 1, borderColor: C.brandEdge, alignItems: 'center', justifyContent: 'center' }}>
            <Txt size={F.micro} w={700} tone="brand">{rows.length}</Txt>
          </View>
        ) : undefined}
      />
      {isRm && isHod && <ScopeSeg scope={scope} onChange={setScope} />}

      {!!q.error && (
        <View style={{ padding: S.md, borderRadius: R.md, backgroundColor: warn.bg, marginBottom: S.md }}>
          <Txt size={F.tiny} color={warn.fg}>{(q.error as Error).message}</Txt>
        </View>
      )}

      {rows && rows.length === 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.lg, justifyContent: 'center' }}>
          <RosterIcon color={C.faint} />
          <Txt size={F.small} tone="muted">Nobody in this scope yet.</Txt>
        </View>
      )}
      {rows && rows.length > 0 && <View>{rows.map(r => <RosterCard key={r.id} r={r} dept={dept} />)}</View>}

      <View style={{ marginTop: S.md, padding: S.md, borderRadius: R.md, backgroundColor: C.sunken, borderLeftWidth: 3, borderLeftColor: C.brandEdge }}>
        <Txt size={F.tiny} tone="muted">
          {dept
            ? 'DEPT scope: everyone in the department(s) you head. Company-wide headcount is under the Company tab.'
            : 'TEAM scope: your direct reports only. Your HOD sees this list plus every other team in the department.'}
        </Txt>
      </View>
    </Card>
  )
}
