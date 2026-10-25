// src/features/profile/Identity.tsx — the top of Profile360: cover actions,
// identity card, KPI strip, and the rail's completeness and reporting-chain
// cards (the website's ≤1040px layout stacks the rail above the tabs).
import * as React from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import type { ProfilePayload } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Avatar, Button, Card, Hero, Txt } from '@/ui/primitives'
import { ini, pretty, val } from './format'
import { CardHead, Pill } from './bits'
import { ChainRow } from './TabPanels'

function CoverBtn({ label, onPress }: { label: string; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: S.md, borderRadius: R.pill, justifyContent: 'center', borderWidth: 1, borderColor: C.brandEdge, backgroundColor: pressed ? C.brandTint : C.surface })}>
      <Txt size={F.tiny} w={600} color={C.brandDeep}>{label}</Txt>
    </Pressable>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return <Txt size={F.tiny} tone="soft"><Txt size={F.tiny} tone="muted">{k}</Txt> {v}</Txt>
}

export function IdentityCard({ p, self, photo, onRecords, onDigitalId, onEdit, onRequest, onPhoto }: {
  p: ProfilePayload; self: boolean; photo: string | null
  onRecords: () => void; onDigitalId: () => void; onEdit: () => void; onRequest: () => void; onPhoto: () => void
}) {
  const { C } = useTheme()
  const emp = p.employee
  return (
    <Hero>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm, marginBottom: S.md }}>
        <CoverBtn label="Records" onPress={onRecords} />
        <CoverBtn label="Digital ID" onPress={onDigitalId} />
      </View>

      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
        <View>
          <Avatar name={String(emp.full_name || '')} uri={photo} size={76} />
          {self && (
            <Pressable onPress={onPhoto} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={photo ? 'Change your profile photo' : 'Add a profile photo'}
              style={{ position: 'absolute', right: -4, bottom: -4, width: 32, height: 32, borderRadius: 16, backgroundColor: C.brand, borderWidth: 2, borderColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={15} height={15} viewBox="0 0 20 20" fill="none">
                <Path d="M3.5 6.8h2.4l1.1-1.7h5.9l1.1 1.7h2.5v8.2h-13z" stroke={C.onAccent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                <Circle cx={10} cy={10.9} r={2.6} stroke={C.onAccent} strokeWidth={1.8} />
              </Svg>
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.title + 2} w={700}>{val(emp.full_name)}</Txt>
          <Txt size={F.small} tone="soft" style={{ marginTop: 2 }}>
            {val(emp.designation)}{emp.department_name ? <> · <Txt size={F.small} w={700} tone="soft">{val(emp.department_name)}</Txt></> : null}
          </Txt>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.md }}>
        <Pill kind="brand" label={val(emp.employee_code)} />
        <Pill kind="good" label={val(emp.status)} />
        {emp.grade ? <Pill label={`${val(emp.grade)}${emp.job_level ? ` · ${val(emp.job_level)}` : ''}`} /> : null}
        {emp.employment_type ? <Pill label={val(emp.employment_type)} /> : null}
        {!self && <Pill kind="warn" label={`Viewing as ${p.viewer_role}`} />}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: S.md, rowGap: 4, marginTop: S.md }}>
        {emp.company_name ? <Fact k="Company" v={val(emp.company_name)} /> : null}
        {emp.location_name ? <Fact k="Location" v={val(emp.location_name)} /> : null}
        {emp.date_of_joining ? <Fact k="Joined" v={pretty(emp.date_of_joining)} /> : null}
        {emp.tenure_years !== undefined ? <Fact k="Tenure" v={`${val(emp.tenure_years)}y ${val(emp.tenure_months)}m`} /> : null}
        {emp.workstation ? <Fact k="Seat" v={val(emp.workstation)} /> : null}
      </View>

      {self && (
        <View style={{ gap: S.sm, marginTop: S.lg }}>
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Edit profile" style={{ flex: 1 }} onPress={onEdit} />
            <Button title="Request an update" variant="outline" style={{ flex: 1 }} onPress={onRequest} />
          </View>
          <Button title="Change history" variant="ghost" size="sm" onPress={onRecords} style={{ alignSelf: 'flex-start' }} />
        </View>
      )}
    </Hero>
  )
}

export function KpiStrip({ p }: { p: ProfilePayload }) {
  const { C } = useTheme()
  const emp = p.employee
  const pending = p.completeness.pending ?? []
  const kpis: { k: string; v: string; unit?: string; pc: number }[] = [
    { k: 'Tenure', v: String(emp.tenure_years ?? '-'), unit: 'yrs', pc: Math.min(100, (Number(emp.tenure_years) || 0) * 10) },
    { k: 'Profile score', v: String(p.completeness.score), unit: '%', pc: p.completeness.score },
    { k: 'Reportees', v: String(emp.reportee_count ?? 0), unit: 'people', pc: Math.min(100, (Number(emp.reportee_count) || 0) * 20) },
    { k: 'Open items', v: String(pending.length), unit: 'pending', pc: pending.length ? Math.min(100, pending.length * 20) : 0 },
  ]
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, marginTop: S.md }}>
      {kpis.map(s => (
        <Card key={s.k} style={{ width: '48.6%', padding: S.md }}>
          <Txt size={F.micro} w={700} tone="muted" upper>{s.k}</Txt>
          <Txt size={F.title + 2} w={700} style={{ marginTop: 4 }}>{s.v}{!!s.unit && <Txt size={F.tiny} w={500} tone="muted"> {s.unit}</Txt>}</Txt>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: C.sunken, overflow: 'hidden', marginTop: S.sm }}>
            <View style={{ width: `${Math.max(0, Math.min(100, s.pc))}%`, height: '100%', backgroundColor: C.brand }} />
          </View>
        </Card>
      ))}
    </View>
  )
}

function Ring({ pc }: { pc: number }) {
  const { C } = useTheme()
  const r = 32, c = 2 * Math.PI * r
  return (
    <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={76} height={76} viewBox="0 0 76 76" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={38} cy={38} r={r} fill="none" strokeWidth={8} stroke={C.sunken} />
        <Circle cx={38} cy={38} r={r} fill="none" strokeWidth={8} stroke={C.brand} strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, pc))) / 100} ${c}`} />
      </Svg>
      <Txt size={F.lead} w={800}>{pc}%</Txt>
      <Txt size={9} tone="muted" style={{ marginTop: -2 }}>complete</Txt>
    </View>
  )
}

export function CompletenessCard({ p, onFix }: { p: ProfilePayload; onFix: () => void }) {
  const { C } = useTheme()
  const pending = p.completeness.pending ?? []
  return (
    <Card>
      <CardHead title="Profile completeness" right={pending.length ? <Pill kind="warn" label={`${pending.length} pending`} /> : null} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <Ring pc={p.completeness.score} />
        <Txt size={F.small} tone="soft" style={{ flex: 1 }}>Finishing these keeps payroll and statutory records clean.</Txt>
      </View>
      {pending.length > 0 && (
        <View style={{ marginTop: S.sm }}>
          {pending.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.warning }} />
              <Txt size={F.small} style={{ flex: 1 }}>{item}</Txt>
              <Button title="Fix" variant="soft" size="sm" onPress={onFix} />
            </View>
          ))}
        </View>
      )}
    </Card>
  )
}

const CHAIN = [['rm_l1_name', 'Reporting Manager L1'], ['rm_l2_name', 'Reporting Manager L2'], ['hod_name', 'Head of Department'], ['md_name', 'Managing Director']] as const

export function ChainCard({ p, self }: { p: ProfilePayload; self: boolean }) {
  const emp = p.employee
  const chain = CHAIN.filter(([k]) => emp[k])
  return (
    <Card>
      <CardHead title="Reporting chain" right={<Txt size={F.tiny} tone="muted">{val(emp.reportee_count)} reportees</Txt>} />
      {!chain.length ? <Txt size={F.small} tone="faint">No reporting chain recorded.</Txt> : (
        <>
          {chain.map(([k, label], i) => <ChainRow key={k} first={i === 0} tile={ini(emp[k])} n={val(emp[k])} r={label} />)}
          <ChainRow me tile={ini(emp.full_name)} n={val(emp.full_name)} r={`${self ? 'You' : 'Subject'} · ${val(emp.designation)}`} />
        </>
      )}
    </Card>
  )
}
