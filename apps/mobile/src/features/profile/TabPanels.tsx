// src/features/profile/TabPanels.tsx — what each Profile360 tab shows besides
// its field groups, in the website's order:
//   overview block → field groups → tab extras → RECORD_CARDS for the tab.
import * as React from 'react'
import { View } from 'react-native'
import { CARD_COLUMNS, MODEL, RECORD_CARDS } from '@web/profile/model'
import type { ProfileField, ProfilePayload, Row, TabId } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Card, Notice, Txt } from '@/ui/primitives'
import { ini, money, pretty, val } from './format'
import { CardHead, Elsewhere, EmptyCard, Pill, Section } from './bits'
import { FieldGroups, PlainField, RecordTable, StateText } from './Fields'

/** A `.chain` row: a round tile (initials or an emoji), a name and a line under it. */
export function ChainRow({ tile, n, r, me, first }: { tile: string; n: string; r: string; me?: boolean; first?: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: me ? C.brand : C.brandTint, borderWidth: 1, borderColor: C.brandEdge }}>
        <Txt size={F.small} w={700} color={me ? C.onAccent : C.brandDeep}>{tile}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={600}>{n}</Txt>
        <Txt size={F.tiny} tone="muted">{r}</Txt>
      </View>
    </View>
  )
}

/** A `.pc` person/policy card. */
function PCard({ tile, n, s, pills }: { tile: string; n: string; s: string; pills: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <Card style={{ flexDirection: 'row', gap: S.md }}>
      <View style={{ width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
        <Txt size={F.body} w={700} tone="brand">{tile}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700}>{n}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{s}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>{pills}</View>
      </View>
    </Card>
  )
}

function Overview({ p }: { p: ProfilePayload }) {
  const emp = p.employee
  return (
    <>
      <Section title="At a glance" sub="The things you would otherwise open four screens to find.">
        <View style={{ gap: S.sm }}>
          <Card>
            <CardHead title="Coming up" />
            {emp.date_of_joining ? <ChainRow first tile="🎉" n="Work anniversary" r={`${pretty(emp.date_of_joining)} · ${val(emp.tenure_years)} years`} /> : null}
            {emp.date_of_birth ? <ChainRow first={!emp.date_of_joining} tile="🎂" n="Birthday" r={pretty(emp.date_of_birth)} /> : null}
            <ChainRow first={!emp.date_of_joining && !emp.date_of_birth} tile="💰" n="Payroll cut-off" r="25th of every month" />
          </Card>
          <Card>
            <CardHead title="Employment" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <PlainField k="Employment type" v={val(emp.employment_type)} />
              <PlainField k="Category" v={val(emp.employee_category)} />
              <PlainField k="Notice period" v={emp.notice_period_days ? `${val(emp.notice_period_days)} days` : '-'} />
              <PlainField k="Weekly off" v={val(emp.weekly_off)} />
            </View>
          </Card>
        </View>
      </Section>
      <Elsewhere title="Attendance and leave" owner="Time & Attendance and the Leave section of ESS" />
    </>
  )
}

function PersonalExtras({ p }: { p: ProfilePayload }) {
  const { C } = useTheme()
  const by = new Map<string, Row[]>()
  for (const n of p.nominations) {
    const k = String(n.scheme ?? 'Other')
    by.set(k, [...(by.get(k) ?? []), n])
  }
  return (
    <>
      <Section title="Family" sub="A family member has to be verified before insurance or a nomination can point at them.">
        {!p.family.length ? <EmptyCard>No family members recorded.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {p.family.map((m, i) => (
              <PCard key={String(m.id ?? i)} tile={ini(m.member_name)} n={val(m.member_name)}
                s={`${val(m.relation)}${m.date_of_birth ? ` · ${pretty(m.date_of_birth)}` : ''}`}
                pills={<>
                  {m.is_verified ? <Pill kind="good" label="Verified" /> : <Pill kind="warn" label="Proof pending" />}
                  {m.is_insured ? <Pill kind="brand" label="Insured" /> : <Pill label="Not insured" />}
                  {m.is_dependent ? <Pill label="Dependent" /> : null}
                </>} />
            ))}
          </View>
        )}
      </Section>

      <Section title="Nominations" sub="Each record is separate and must total exactly 100% before it can be filed.">
        {!p.nominations.length ? <EmptyCard>No nominee recorded. PF and gratuity both need one.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {[...by.entries()].map(([scheme, rows]) => {
              const total = rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0)
              const ok = total === 100
              return (
                <Card key={scheme}>
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt size={F.small} w={700}>{scheme}</Txt>
                      <Txt size={F.tiny} tone="muted">{rows.map(r => `${val(r.nominee_name)} ${val(r.share_percent)}%`).join(' · ')}</Txt>
                    </View>
                    <Txt size={F.lead} w={700} tone={ok ? 'positive' : 'warning'}>{total}%</Txt>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden', marginTop: S.sm }}>
                    <View style={{ width: `${Math.min(100, total)}%`, height: '100%', backgroundColor: ok ? C.positive : C.warning }} />
                  </View>
                  <Txt size={F.tiny} tone="muted" style={{ marginTop: 6 }}>{ok ? 'Ready to file' : `Adds up to ${total}%, not 100%`}</Txt>
                </Card>
              )
            })}
          </View>
        )}
      </Section>

      <Section title="Insurance" sub="Enrolment is separate from adding a family member.">
        {!p.insurance.length ? <EmptyCard>No active policy recorded.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {p.insurance.map((pol, i) => (
              <PCard key={String(pol.id ?? i)} tile="🛡️" n={val(pol.policy_type)} s={money(pol.sum_insured)}
                pills={<>
                  {pol.policy_name ? <Pill label={val(pol.policy_name)} /> : null}
                  {pol.valid_to ? <Pill kind="good" label={`to ${pretty(pol.valid_to)}`} /> : null}
                </>} />
            ))}
          </View>
        )}
      </Section>
    </>
  )
}

function JobExtras({ p }: { p: ProfilePayload }) {
  const emp = p.employee
  return (
    <Section title="Movement history" sub="What the employee record itself holds.">
      <Card>
        {emp.confirmation_date ? <ChainRow first tile="✓" n="Confirmed in service" r={`${pretty(emp.confirmation_date)} · probation closed`} /> : null}
        {emp.date_of_joining ? <ChainRow first={!emp.confirmation_date} tile="→" n={`Joined ${val(emp.company_name)}`} r={`${pretty(emp.date_of_joining)} · ${val(emp.designation)}`} /> : null}
        {!emp.date_of_joining && <Txt size={F.small} tone="faint">No dates recorded.</Txt>}
      </Card>
    </Section>
  )
}

const SALARY_HEADS = [['Basic', 'basic_monthly'], ['House rent allowance', 'hra_monthly'], ['Conveyance', 'conveyance'], ['Gratuity', 'gratuity_monthly'],
  ['Provident fund (employee)', 'employee_pf'], ['Provident fund (employer)', 'employer_pf']] as const

function SalaryRow({ head, m, a, bold, first }: { head: string; m: string; a: string; bold?: boolean; first?: boolean }) {
  const { C } = useTheme()
  const w = bold ? 700 : 500
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderTopWidth: first ? 0 : 1, borderTopColor: C.line, gap: S.sm }}>
      <Txt size={F.small} w={w} style={{ flex: 1.4 }}>{head}</Txt>
      <Txt size={F.small} w={w} style={{ flex: 1, textAlign: 'right' }}>{m}</Txt>
      <Txt size={F.small} w={w} style={{ flex: 1, textAlign: 'right' }}>{a}</Txt>
    </View>
  )
}

function PayrollExtras({ p }: { p: ProfilePayload }) {
  const s = p.salary
  if (!s) return <Elsewhere title="Salary structure" owner="the Payroll section of ESS" />
  return (
    <Section title="Salary structure" sub={`Head wise, effective ${pretty(s.effective_date)}${s.fy ? ` · FY ${val(s.fy)}` : ''}.`}>
      <Card>
        <View style={{ flexDirection: 'row', paddingBottom: 6, gap: S.sm }}>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1.4 }}>Head</Txt>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1, textAlign: 'right' }}>Monthly</Txt>
          <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1, textAlign: 'right' }}>Annual</Txt>
        </View>
        {SALARY_HEADS.filter(([, k]) => s[k] !== null && s[k] !== undefined).map(([label, k]) => (
          <SalaryRow key={k} head={label} m={money(s[k])} a={money(Number(s[k]) * 12)} />
        ))}
        <SalaryRow head="Gross" m={money(s.gross_monthly)} a={money(s.gross_annual)} bold />
      </Card>
    </Section>
  )
}

function GrowthExtras({ p }: { p: ProfilePayload }) {
  const perf = p.performance
  const period = (perf?.period as Row | null) ?? null
  const rec = p.recognition ?? []
  return (
    <>
      <Section title="Performance" sub="From the PMS cycle, not entered here.">
        <Card>
          {!perf ? <Txt size={F.small} tone="faint">No appraisal recorded yet.</Txt> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {([['Cycle', val(period?.period_name)],
                ['Stage', val(period?.status)],
                ['Rating', perf.final_rating_code ? `${val(perf.final_rating_code)} · ${val(perf.final_rating)}` : 'Not finalised'],
                ['Score', val(perf.final_score)],
                ['KRAs', val(perf.kra_count)],
                ['One to one', val(perf.one_to_one_count)],
                ['Acknowledged', perf.employee_ack ? 'Yes' : 'Not yet'],
                ['Finalised', pretty(perf.finalised_at)]] as const).map(([k, v]) => <PlainField key={k} k={k} v={v} />)}
            </View>
          )}
        </Card>
      </Section>

      <Section title="Recognition" sub="Shoutouts and awards from the Wall of Fame.">
        {!rec.length ? <EmptyCard>Nothing on the wall yet.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {rec.map((r, i) => (
              <PCard key={String(r.id ?? i)} tile="🏆" n={`${val(r.kind)}${r.cycle_label ? ` · ${val(r.cycle_label)}` : ''}`}
                s={String(r.message ?? '').slice(0, 110) || '-'}
                pills={<>
                  <Pill label={pretty(r.created_at)} />
                  {r.badge_ref ? <Pill kind="brand" label={val(r.badge_ref)} /> : null}
                </>} />
            ))}
          </View>
        )}
      </Section>
    </>
  )
}

function AppAccess({ p }: { p: ProfilePayload }) {
  const { C } = useTheme()
  const rows = p.app_access ?? []
  if (!rows.length) return null
  return (
    <Section title="Application access" sub="What this person can sign in to.">
      <View style={{ gap: S.sm }}>
        {rows.map((a, i) => (
          <View key={String(a.id ?? i)} style={{ padding: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
            <View style={{ flexDirection: 'row' }}>
              <Txt size={F.micro} w={700} tone="muted" upper style={{ flex: 1 }}>{val(a.app_name)}</Txt>
              <StateText state="locked" />
            </View>
            <Txt size={F.body} w={600} style={{ marginTop: 4 }}>{val(a.access_role)}</Txt>
            {a.granted_on ? <Txt size={F.tiny} tone="muted" style={{ marginTop: 4 }}>Since {pretty(a.granted_on)}</Txt> : null}
          </View>
        ))}
      </View>
    </Section>
  )
}

/** Everything under the tab strip for one tab. */
export function TabPanel({ tab, p, self, onAct }: { tab: TabId; p: ProfilePayload; self: boolean; onAct: (f: ProfileField) => void }) {
  const groups = MODEL[tab] ?? []
  return (
    <>
      {tab === 'overview' && <Overview p={p} />}
      <FieldGroups groups={groups} payload={p} self={self} onAct={onAct} />
      {tab === 'personal' && <PersonalExtras p={p} />}
      {tab === 'job' && <JobExtras p={p} />}
      {tab === 'statutory' && (
        <Notice tone="warning" style={{ marginTop: S.lg }}>
          Full PAN and passport are readable only by HR, Payroll and Admin. Everybody else sees the last four digits, in reports and exports too, not just on this screen.
        </Notice>
      )}
      {tab === 'payroll' && <PayrollExtras p={p} />}
      {tab === 'time' && <Elsewhere title="Attendance, punches and leave" owner="Time & Attendance" />}
      {tab === 'growth' && <GrowthExtras p={p} />}
      {tab === 'records' && <AppAccess p={p} />}
      {RECORD_CARDS.filter(c => c.tab === tab && c.key !== 'app_access').map(c => (
        <RecordTable key={c.key as string} title={c.title}
          rows={(p[c.key as keyof ProfilePayload] as Row[]) ?? []}
          columns={CARD_COLUMNS[c.key as string] ?? []} empty={c.empty} />
      ))}
    </>
  )
}
