// src/features/performance/PerformanceScreen.tsx — PMS in the app (website:
// components/ess/Performance.tsx). Three audiences — Me, My team (n), My
// department — offered only for the roles you hold (derived from the org
// columns, L1 OR L2 reportees; HOD via departments.hod_employee_id or
// employees.hod_id), each with its own remembered tab. The cycle header's
// call-to-action moves both dials (GO_TO).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import type { ActionTab } from '@web/pms/cycle'
import { useEmployeeId } from '@/core/session'
import { invalidate } from '@/core/query'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Loading, Txt } from '@/ui/primitives'
import { Screen } from '@/ui/Screen'
import { loadRoles, probeModule } from './data'
import { CycleHeader } from './CycleHeader'
import { EMP_TABS, MySide, type EmpTab } from './MySide'
import { DeptSide, HOD_TABS, MGR_TABS, TeamSide, type HodTab, type MgrTab } from './Sides'
import { ModulePending } from './Pending'
import { K, TabStrip } from './ui'

type Scope = 'me' | 'team' | 'dept'

const GO_TO: Record<ActionTab, { scope: Scope; tab: string }> = {
  mine: { scope: 'me', tab: 'kras' },
  self: { scope: 'me', tab: 'self' },
  oneone: { scope: 'me', tab: 'oneToOne' },
  team: { scope: 'team', tab: 'approve' },
  dept: { scope: 'dept', tab: 'finalise' },
  fill: { scope: 'dept', tab: 'deptAnalytics' },
}

function ScopeChips({ scopes, value, onPick }: { scopes: { k: Scope; label: string }[]; value: Scope; onPick: (s: Scope) => void }) {
  const { C } = useTheme()
  return (
    <View accessibilityRole="tablist" accessibilityLabel="Which side of the review" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
      {scopes.map(s => {
        const on = s.k === value
        return (
          <Pressable key={s.k} onPress={() => onPick(s.k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, justifyContent: 'center',
              borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brand : C.surface }}>
            <Txt size={F.small} w={700} color={on ? C.onAccent : C.muted}>{s.label}</Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function PerformanceScreen() {
  const employeeId = useEmployeeId()
  const rolesQ = useQuery({ queryKey: ['pms', 'roles', employeeId], queryFn: () => loadRoles(employeeId), enabled: !!employeeId })
  const moduleQ = useQuery({ queryKey: ['pms', 'probe'], queryFn: probeModule })
  const [scope, setScope] = React.useState<Scope>('me')
  const [empTab, setEmpTab] = React.useState<EmpTab>('dashboard')
  const [mgrTab, setMgrTab] = React.useState<MgrTab>('team')
  const [hodTab, setHodTab] = React.useState<HodTab>('finalise')

  const roles = rolesQ.data
  const refresh = () => invalidate('pms')
  const frame = (body: React.ReactNode) => (
    <Screen title="Performance" subtitle="Your goals (KRAs) and the reviews you owe" onRefresh={refresh}>{body}</Screen>
  )
  if (moduleQ.data === false) return frame(<ModulePending />)
  if (!roles) return frame(<Loading />)

  const scopes: { k: Scope; label: string }[] = [
    { k: 'me', label: 'Me' },
    ...(roles.isRM ? [{ k: 'team' as const, label: `My team (${roles.reportees})` }] : []),
    ...(roles.isHOD ? [{ k: 'dept' as const, label: 'My department' }] : []),
  ]
  const tabs = scope === 'me' ? EMP_TABS : scope === 'team' ? MGR_TABS : HOD_TABS
  const activeKey = scope === 'me' ? empTab : scope === 'team' ? mgrTab : hodTab
  const pick = (k: string) => {
    if (scope === 'me') setEmpTab(k as EmpTab)
    else if (scope === 'team') setMgrTab(k as MgrTab)
    else setHodTab(k as HodTab)
  }
  const goToAction = (destination: string) => {
    const { scope: s, tab } = GO_TO[destination as ActionTab] ?? { scope: 'me' as Scope, tab: 'dashboard' }
    setScope(s)
    if (s === 'me') setEmpTab(tab as EmpTab)
    else if (s === 'team') setMgrTab(tab as MgrTab)
    else setHodTab(tab as HodTab)
  }

  return frame(
    <>
      <CycleHeader employeeId={employeeId} isRM={roles.isRM} isHOD={roles.isHOD} onGo={goToAction} />
      {scopes.length > 1 && <ScopeChips scopes={scopes} value={scope} onPick={setScope} />}
      <TabStrip tabs={tabs as { k: string; label: string }[]} active={activeKey} onPick={pick} />
      <K style={{ marginBottom: S.lg }}>{tabs.find(t => t.k === activeKey)?.blurb}</K>
      {scope === 'me' && <MySide employeeId={employeeId} tab={empTab} />}
      {scope === 'team' && <TeamSide employeeId={employeeId} tab={mgrTab} />}
      {scope === 'dept' && <DeptSide employeeId={employeeId} tab={hodTab} />}
    </>
  )
}

