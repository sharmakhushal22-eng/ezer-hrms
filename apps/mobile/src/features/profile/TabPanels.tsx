// src/features/profile/TabPanels.tsx — what each Profile360 tab shows besides
// its field groups, in the website's order:
//   overview cards → field groups → tab extras → RECORD_CARDS for the tab.
//
// Tabs (lib/profile/model.ts TABS): Overview, Personal, Family & nominees,
// Employment, Statutory, Payroll, Documents, Growth. 'Time & Leave' and
// 'Records' are gone from the website; family and nominations have their own
// tab with editors, Records became Documents.
import * as React from 'react'
import { View } from 'react-native'
import { CARD_COLUMNS, MODEL, RECORD_CARDS } from '@web/profile/model'
import { SCHEME_LABEL, type Scheme } from '@web/profile/self-service'
import type { ProfileField, ProfilePayload, Row, TabId } from '@web/profile/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Card, Txt } from '@/ui/primitives'
import { dm, inDays, ini, money, nextOf, pretty, val } from './format'
import { CardHead, ChainRow, EmptyCard, EmptyText, Lnk, Pill, Section } from './bits'
import { FieldGroups, KVList, RecordTable } from './Fields'
import { DocumentsPanel } from './Documents'
import { NIL } from './rules'

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const total = (rows: Row[]) => Math.round(rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0) * 100) / 100

function NomState({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Pill kind="warn" label="Not added" />
  const t = rows.reduce((a, r) => a + (Number(r.share_percent) || 0), 0)
  return t === 100 ? <Pill kind="good" label={`${rows.length} nominee${rows.length === 1 ? '' : 's'} · 100%`} /> : <Pill kind="warn" label={`${t}% assigned`} />
}

function NomRow({ rows, self, onPress }: { rows: Row[]; self: boolean; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
      <NomState rows={rows} />
      {self && <Lnk label={rows.length ? 'Edit' : 'Add'} onPress={onPress} />}
    </View>
  )
}

function Overview({ p, self, onAction, openTab }: { p: ProfilePayload; self: boolean; onAction: (a: string) => void; openTab: (t: TabId) => void }) {
  const emp = p.employee
  const ann = nextOf(emp.date_of_joining), bday = emp.date_of_birth ? nextOf(emp.date_of_birth) : null
  const pf = p.nominations.filter(n => String(n.scheme) === 'pf')
  const gr = p.nominations.filter(n => String(n.scheme) === 'gratuity')
  const e1 = emp.emergency_contact_1
  const contact: [string, React.ReactNode][] = [
    ['Work email', val(emp.official_email)],
    ['Mobile', has(emp, 'mobile') ? val(emp.mobile) : 'Restricted'],
    ['Personal email', has(emp, 'personal_email') ? val(emp.personal_email) : 'Restricted'],
    ['Location', [emp.location_name, emp.workstation].filter(Boolean).map(String).join(' · ') || NIL],
  ]
  if (self) contact.push(['Emergency', e1 ? String(e1) : <Lnk label="Add an emergency contact" onPress={() => onAction('emergency')} />])
  const dates: [string, string][] = [
    ['Joined', emp.date_of_joining ? `${pretty(emp.date_of_joining)} · ${val(emp.tenure_years)}y ${val(emp.tenure_months)}m` : NIL],
  ]
  if (ann && emp.date_of_joining) dates.push(['Work anniversary', `${ann.years} year${ann.years === 1 ? '' : 's'} on ${dm(ann.date)} · ${inDays(ann.days)}`])
  if (bday) dates.push(['Birthday', `${dm(bday.date)} · ${inDays(bday.days)}`])
  dates.push(['Confirmed', emp.confirmation_date ? pretty(emp.confirmation_date) : emp.probation_months ? `On probation (${val(emp.probation_months)} months)` : NIL])

  return (
    <View style={{ gap: S.sm, marginTop: S.lg }}>
      <Card>
        <CardHead title="Contact" right={self ? <Lnk label="All details" onPress={() => openTab('personal')} /> : null} />
        <KVList rows={contact} />
      </Card>
      <Card>
        <CardHead title="Key dates" />
        <KVList rows={dates} />
      </Card>
      <Card>
        <CardHead title="Employment" right={<Lnk label="More" onPress={() => openTab('job')} />} />
        <KVList rows={[
          ['Type', [emp.employment_type, emp.employee_category].filter(Boolean).map(String).join(' · ') || NIL],
          ['Grade', [emp.grade, emp.job_level].filter(Boolean).map(String).join(' · ') || NIL],
          ['Notice period', emp.notice_period_days ? `${val(emp.notice_period_days)} days` : NIL],
          ['Weekly off', val(emp.weekly_off)],
        ]} />
      </Card>
      <Card>
        <CardHead title="Family & nominees" right={<Lnk label="Open" onPress={() => openTab('family')} />} />
        <KVList rows={[
          ['Family members', p.family.length ? `${p.family.length} recorded` : NIL],
          ['PF nominee', <NomRow key="pf" rows={pf} self={self} onPress={() => onAction('nominee_pf')} />],
          ['Gratuity nominee', <NomRow key="gr" rows={gr} self={self} onPress={() => onAction('nominee_gratuity')} />],
          ['Insurance', p.insurance.length ? `${p.insurance.length} active polic${p.insurance.length === 1 ? 'y' : 'ies'}` : NIL],
        ]} />
      </Card>
    </View>
  )
}

function NomineeCard({ scheme, rows, self, onEdit }: { scheme: Scheme; rows: Row[]; self: boolean; onEdit: () => void }) {
  const { C } = useTheme()
  const t = total(rows)
  const ok = t === 100
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{SCHEME_LABEL[scheme]}</Txt>
          <Txt size={F.tiny} tone="muted">{rows.length ? rows.map(r => `${val(r.nominee_name)} (${val(r.relation)}) ${Number(r.share_percent)}%`).join(' · ') : 'No nominee yet.'}</Txt>
        </View>
        {rows.length > 0 && <Txt size={F.lead} w={700} tone={ok ? 'positive' : 'warning'}>{t}%</Txt>}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: C.sunken, overflow: 'hidden', marginTop: S.sm }}>
        <View style={{ width: `${Math.min(100, t)}%`, height: '100%', backgroundColor: ok ? C.positive : C.warning }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: 6 }}>
        <Txt size={F.tiny} tone="muted" style={{ flex: 1 }}>
          {!rows.length ? 'Required for the statutory form' : ok ? (rows.some(r => r.is_filed) ? 'Filed' : 'Ready for HR to file') : `Adds up to ${t}%, not 100%`}
        </Txt>
        {self && <Button title={rows.length ? 'Edit nominees' : 'Add nominee'} variant="outline" size="sm" onPress={onEdit} />}
      </View>
    </Card>
  )
}

/** A `.pc` person/policy card. */
function PCard({ tile, n, s, pills }: { tile?: string; n: string; s: string; pills?: React.ReactNode }) {
  const { C } = useTheme()
  return (
    <Card style={{ flexDirection: 'row', gap: S.md }}>
      {!!tile && (
        <View style={{ width: 40, height: 40, borderRadius: R.md, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
          <Txt size={F.body} w={700} tone="brand">{tile}</Txt>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700}>{n}</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{s}</Txt>
        {!!pills && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: S.sm }}>{pills}</View>}
      </View>
    </Card>
  )
}

function FamilyTab({ p, self, onAction }: { p: ProfilePayload; self: boolean; onAction: (a: string) => void }) {
  return (
    <>
      <Section title="Nominations" sub="Who receives your PF and gratuity. Each must total exactly 100%; HR files the form from it.">
        <View style={{ gap: S.sm }}>
          {(['pf', 'gratuity'] as Scheme[]).map(s => (
            <NomineeCard key={s} scheme={s} rows={p.nominations.filter(n => String(n.scheme) === s)} self={self}
              onEdit={() => onAction(s === 'pf' ? 'nominee_pf' : 'nominee_gratuity')} />
          ))}
        </View>
      </Section>

      <Section title="Family" sub="Adding a nominee adds them here. HR verifies a member before insurance can cover them.">
        {!p.family.length ? <EmptyCard>No family members recorded.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {p.family.map((m, i) => (
              <PCard key={String(m.id ?? i)} tile={ini(m.member_name)} n={val(m.member_name)}
                s={`${val(m.relation)}${m.date_of_birth ? ` · ${pretty(m.date_of_birth)}` : ''}`}
                pills={<>
                  {m.is_verified ? <Pill kind="good" label="Verified" /> : <Pill kind="warn" label="Proof pending" />}
                  {m.is_insured ? <Pill kind="brand" label="Insured" /> : null}
                  {m.is_dependent ? <Pill label="Dependent" /> : null}
                </>} />
            ))}
          </View>
        )}
      </Section>

      <Section title="Insurance" sub="Enrolment is handled by HR during the policy window.">
        {!p.insurance.length ? <EmptyCard>No active policy recorded.</EmptyCard> : (
          <View style={{ gap: S.sm }}>
            {p.insurance.map((x, i) => (
              <PCard key={String(x.id ?? i)} n={`${val(x.policy_type)}${x.policy_name ? ` · ${val(x.policy_name)}` : ''}`}
                s={`Sum insured ${money(x.sum_insured)}${x.valid_to ? ` · valid to ${pretty(x.valid_to)}` : ''}`} />
            ))}
          </View>
        )}
      </Section>
    </>
  )
}

function JobExtras({ p }: { p: ProfilePayload }) {
  const emp = p.employee
  const access = p.app_access ?? []
  return (
    <>
      <Section title="Movement history">
        <Card>
          {!emp.date_of_joining && !emp.confirmation_date ? <EmptyText>No dates recorded.</EmptyText> : (
            <>
              {emp.confirmation_date ? <ChainRow first tile="" n="Confirmed in service" r={pretty(emp.confirmation_date)} /> : null}
              {emp.date_of_joining ? <ChainRow first={!emp.confirmation_date} tile="" n={`Joined ${val(emp.company_name)}`} r={`${pretty(emp.date_of_joining)} · ${val(emp.designation)}`} /> : null}
            </>
          )}
        </Card>
      </Section>
      {access.length > 0 && (
        <Section title="Application access">
          <Card>
            <KVList rows={access.map(a => [val(a.app_name), `${val(a.access_role)}${a.granted_on ? ` · since ${pretty(a.granted_on)}` : ''}`] as [string, string])} />
          </Card>
        </Section>
      )}
    </>
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

function FootNote({ children }: { children: React.ReactNode }) {
  return <Txt size={F.small} tone="muted" style={{ marginTop: S.lg }}>{children}</Txt>
}

function PayrollExtras({ p }: { p: ProfilePayload }) {
  const s = p.salary
  if (!s) return <FootNote>No salary structure is on file yet. Payslips and tax are in the Payroll section of ESS.</FootNote>
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
      <Section title="Performance" sub="From the PMS cycle.">
        <Card>
          {!perf ? <EmptyText>No appraisal recorded yet.</EmptyText> : (
            <KVList rows={[['Cycle', val(period?.period_name)],
              ['Stage', val(period?.status)],
              ['Rating', perf.final_rating_code ? `${val(perf.final_rating_code)} · ${val(perf.final_rating)}` : 'Not finalised'],
              ['Score', val(perf.final_score)],
              ['KRAs', val(perf.kra_count)],
              ['One to ones', val(perf.one_to_one_count)],
              ['Acknowledged', perf.employee_ack ? 'Yes' : 'Not yet']]} />
          )}
        </Card>
      </Section>
      {rec.length > 0 && (
        <Section title="Recognition">
          <View style={{ gap: S.sm }}>
            {rec.map((r, i) => (
              <PCard key={String(r.id ?? i)} n={`${val(r.kind)}${r.cycle_label ? ` · ${val(r.cycle_label)}` : ''}`}
                s={String(r.message ?? '').slice(0, 110) || NIL} pills={<Pill label={pretty(r.created_at)} />} />
            ))}
          </View>
        </Section>
      )}
    </>
  )
}

/** Everything under the tab strip for one tab. */
export function TabPanel({ tab, p, self, onAct, onAction, openTab, onDocsChanged }: {
  tab: TabId; p: ProfilePayload; self: boolean
  onAct: (f: ProfileField) => void; onAction: (a: string) => void; openTab: (t: TabId) => void; onDocsChanged: (m: string) => void
}) {
  const groups = MODEL[tab] ?? []
  const hasBank = !!p.self?.ids?.has_bank
  return (
    <>
      {tab === 'overview' && <Overview p={p} self={self} onAction={onAction} openTab={openTab} />}
      <FieldGroups groups={groups} payload={p} self={self} onAct={onAct}
        rightOf={g => (tab === 'payroll' && g.title === 'Salary account' && self
          ? <Button title={hasBank ? 'Request change' : 'Add account'} variant="outline" size="sm" onPress={() => onAction('bank')} /> : null)} />
      {tab === 'family' && <FamilyTab p={p} self={self} onAction={onAction} />}
      {tab === 'job' && <JobExtras p={p} />}
      {tab === 'statutory' && (
        <FootNote>A missing PAN, UAN or Aadhaar you can add yourself; once on file they are kept by HR, because payroll and statutory returns use them. Only HR and Payroll see a full PAN.</FootNote>
      )}
      {tab === 'payroll' && <PayrollExtras p={p} />}
      {tab === 'documents' && (self
        ? <Section title="Documents" sub="Upload what is asked for. HR verifies each one; you can replace an upload at any time."><Card><DocumentsPanel onChanged={onDocsChanged} /></Card></Section>
        : <RecordTable title="Documents" rows={p.documents ?? []} columns={CARD_COLUMNS.documents ?? []} empty="Nothing uploaded yet." />)}
      {tab === 'growth' && <GrowthExtras p={p} />}
      {RECORD_CARDS.filter(c => c.tab === tab).map(c => (
        <RecordTable key={c.key as string} title={c.title}
          rows={(p[c.key as keyof ProfilePayload] as Row[]) ?? []}
          columns={CARD_COLUMNS[c.key as string] ?? []} empty={c.empty} />
      ))}
    </>
  )
}
