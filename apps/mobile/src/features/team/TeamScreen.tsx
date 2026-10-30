// src/features/team/TeamScreen.tsx — the Team section, "one line" (website:
// components/ess/team/MyTeam.tsx).
//
// Your chain above, a highlighted YOU band holding your team-mates, your direct
// reports below; the RM/HOD roster underneath, gated on /api/ess/menu is_rm ||
// is_hod exactly like the website. Nodes and chips open nothing, as on the web.
import * as React from 'react'
import { View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { useEmployeeId } from '@/core/session'
import { useMenu } from '@/core/menu'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Card, Gap, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { loadChain, loadPeers, loadReports, type Peer } from './api'
import { EmptyLine, LineIcon, LineNode, LineSkeleton, PanelHead, Rail, SectionLabel, TeamAvatar, YouDot } from './ui'
import { TeamRoster } from './TeamRoster'

function MateChip({ p }: { p: Peer }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 5, paddingLeft: 5, paddingRight: 12, borderRadius: R.pill, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: C.surface, maxWidth: '100%' }}>
      <TeamAvatar name={p.full_name} size={24} />
      <View style={{ flexShrink: 1 }}>
        <Txt size={F.tiny} w={600} numberOfLines={1}>{p.full_name || '-'}</Txt>
        <Txt size={11} tone="muted" numberOfLines={1}>
          {p.designation || '-'}
          {p.direct_reports > 0 ? ` · ${p.direct_reports} ${p.direct_reports === 1 ? 'report' : 'reports'}` : ''}
        </Txt>
      </View>
    </View>
  )
}

export default function TeamScreen() {
  const { C } = useTheme()
  const id = useEmployeeId()
  const { menu, refetch: refetchMenu } = useMenu()
  const chainQ = useQuery({ queryKey: ['team', 'chain', id], queryFn: () => loadChain(id), enabled: !!id })
  const peersQ = useQuery({ queryKey: ['team', 'peers', id], queryFn: () => loadPeers(id), enabled: !!id })
  const reportsQ = useQuery({ queryKey: ['team', 'reports', id], queryFn: () => loadReports(id), enabled: !!id })

  const busy = !chainQ.data || !peersQ.data || !reportsQ.data
  const mates = (peersQ.data || []).filter(p => !p.isSelf)
  // Display order only — senior-most at the top.
  const chain = (chainQ.data || []).slice().reverse()
  const reports = reportsQ.data || []

  const refresh = () => Promise.all([chainQ.refetch(), peersQ.refetch(), reportsQ.refetch(), refetchMenu()])

  return (
    <Screen title="Team" subtitle="Your manager, your peers and the people who report to you" onRefresh={refresh}>
      <Card style={{ borderColor: C.brandEdge }}>
        <PanelHead icon={<LineIcon color={C.brand} />} title="Where you sit"
          sub="Above you, beside you, below you, read from the reporting lines HR maintains" />

        {busy ? <LineSkeleton /> : (
          <View>
            <SectionLabel>Reporting line above you</SectionLabel>
            {chain.length === 0 ? (
              <EmptyLine>Nobody above you. You are at the top of your chain.</EmptyLine>
            ) : (
              <Rail>
                {chain.map(m => (
                  <LineNode key={m.relationship_type}
                    name={m.manager?.full_name ?? null}
                    sub={m.manager?.designation ?? null}
                    rank={m.relationship_type === 'HOD' ? 'Head of Department' : m.relationship_type} />
                ))}
              </Rail>
            )}

            <View style={{ marginVertical: S.sm, padding: S.md, borderRadius: R.lg, borderWidth: 1, borderColor: C.brandEdge, backgroundColor: C.brandTint }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
                <YouDot />
                <View style={{ flex: 1 }}>
                  <Txt size={F.body} w={700}>You</Txt>
                  <Txt size={11.5} tone="muted">Managers above you, your team below</Txt>
                </View>
              </View>
              <Txt size={F.micro} w={700} tone="muted" upper style={{ marginTop: S.md, marginBottom: S.sm }}>
                Your team-mates{mates.length ? ` (${mates.length})` : ''}
              </Txt>
              {mates.length === 0 ? (
                <EmptyLine>Nobody else shares your reporting manager, or you have no manager on record.</EmptyLine>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                  {mates.map(p => <MateChip key={p.id} p={p} />)}
                </View>
              )}
            </View>

            <SectionLabel indent>Your team</SectionLabel>
            {reports.length === 0 ? (
              <View style={{ paddingLeft: 26 }}><EmptyLine>Nobody reports to you directly.</EmptyLine></View>
            ) : (
              <Rail indent>
                {reports.map(r => (
                  <LineNode key={r.id} name={r.full_name} sub={[r.designation, r.department].filter(Boolean).join(' · ')} />
                ))}
              </Rail>
            )}
          </View>
        )}
      </Card>

      {(menu.is_rm || menu.is_hod) && (
        <>
          <Gap h={S.lg} />
          <TeamRoster employeeId={id} isRm={menu.is_rm} isHod={menu.is_hod} />
        </>
      )}
    </Screen>
  )
}
