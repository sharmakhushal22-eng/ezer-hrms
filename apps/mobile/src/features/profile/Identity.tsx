// src/features/profile/Identity.tsx — the top of Profile360: the identity
// header (photo, name, chips, facts and the four actions) and the side
// column's completeness and reporting-chain cards (the website's narrow
// layout stacks the side column above the tabs).
//
// The KPI strip and the Direct / Request / Locked / Event legend are gone, as
// on the website: each field now says what pressing it does, and the rule is
// one tap away under "How editing works".
import * as React from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import type { ProfilePayload } from '@web/profile/types'
import { fixActionFor } from '@web/profile/self-service'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Avatar, Button, Card, Hero, Txt } from '@/ui/primitives'
import { ini, pretty, tidy, val } from './format'
import { CardHead, ChainRow, Lnk, Pill } from './bits'
import { chainOf, fixLabel } from './rules'
import { LockGlyph } from './Fields'

function Fact({ k, v }: { k: string; v: string }) {
  return <Txt size={F.tiny} tone="soft"><Txt size={F.tiny} tone="muted">{k}</Txt> {v}</Txt>
}

export function IdentityCard({ p, self, photo, pendingReqs, onEdit, onRequest, onDigitalId, onHistory, onPhoto }: {
  p: ProfilePayload; self: boolean; photo: string | null; pendingReqs: number
  onEdit: () => void; onRequest: () => void; onDigitalId: () => void; onHistory: () => void; onPhoto: () => void
}) {
  const { C } = useTheme()
  const emp = p.employee
  const name = emp.display_name && emp.display_name !== emp.full_name ? `${emp.full_name} (${String(emp.display_name)})` : emp.full_name
  return (
    <Hero>
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
          <Txt size={F.title + 2} w={700}>{val(name)}</Txt>
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
        {emp.tenure_years !== undefined && emp.tenure_years !== null ? <Fact k="Tenure" v={`${val(emp.tenure_years)}y ${val(emp.tenure_months)}m`} /> : null}
      </View>

      <View style={{ gap: S.sm, marginTop: S.lg }}>
        {self && (
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <Button title="Edit profile" style={{ flex: 1 }} onPress={onEdit} />
            <Button title="Request a change" variant="outline" style={{ flex: 1 }} onPress={onRequest} />
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <Button title="Digital ID" variant="outline" style={self ? { flex: 1 } : undefined} full={!self} onPress={onDigitalId} />
          {self && (
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Lnk label={`Change history${pendingReqs ? ` · ${pendingReqs} open` : ''}`} onPress={onHistory} />
            </View>
          )}
        </View>
      </View>
    </Hero>
  )
}

function Ring({ pc }: { pc: number }) {
  const { C } = useTheme()
  const r = 26, c = 2 * Math.PI * r
  return (
    <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={64} height={64} viewBox="0 0 64 64" style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={32} cy={32} r={r} fill="none" strokeWidth={7} stroke={C.sunken} />
        <Circle cx={32} cy={32} r={r} fill="none" strokeWidth={7} stroke={C.brand} strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, pc))) / 100} ${c}`} />
      </Svg>
      <Txt size={F.body} w={800}>{pc}%</Txt>
    </View>
  )
}

/** A completeness to-do row (`ul.todo li`), used here and in the Edit profile sheet. */
export function TodoRow({ sentence, first, onFix }: { sentence: string; first?: boolean; onFix?: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6, borderTopWidth: first ? 0 : 1, borderTopColor: C.line }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.warning }} />
      <Txt size={F.small} style={{ flex: 1 }}>{tidy(sentence)}</Txt>
      {onFix && <Button title={fixLabel(fixActionFor(sentence))} variant="soft" size="sm" onPress={onFix} />}
    </View>
  )
}

export function CompletenessCard({ p, self, onFix }: { p: ProfilePayload; self: boolean; onFix: (sentence: string) => void }) {
  const [all, setAll] = React.useState(false)
  const pending = p.completeness.pending ?? []
  const list = all ? pending : pending.slice(0, 3)
  return (
    <Card>
      <CardHead title="Profile completeness" right={pending.length ? <Pill kind="warn" label={`${pending.length} to do`} /> : <Pill kind="good" label="Complete" />} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <Ring pc={p.completeness.score} />
        <Txt size={F.small} tone="soft" style={{ flex: 1 }}>
          {pending.length ? 'A complete profile keeps payroll, PF and tax filings right.' : 'Everything payroll and statutory filings need is on file.'}
        </Txt>
      </View>
      {pending.length > 0 && (
        <View style={{ marginTop: S.sm }}>
          {list.map((item, i) => <TodoRow key={item} sentence={item} first={i === 0} onFix={self ? () => onFix(item) : undefined} />)}
          {pending.length > 3 && <Lnk label={all ? 'Show fewer' : `Show all ${pending.length}`} onPress={() => setAll(x => !x)} />}
        </View>
      )}
    </Card>
  )
}

export function ChainCard({ p, self }: { p: ProfilePayload; self: boolean }) {
  const emp = p.employee
  const people = chainOf(emp)
  const above = people.filter(x => !x.me)
  const myRoles = people.find(x => x.me)?.roles ?? []
  const n = Number(emp.reportee_count) || 0
  return (
    <Card>
      <CardHead title="Reporting chain" right={n ? <Txt size={F.tiny} tone="muted">{n} reportee{n === 1 ? '' : 's'}</Txt> : null} />
      {!above.length && !myRoles.length ? <Txt size={F.small} tone="faint">No reporting chain recorded.</Txt> : (
        <>
          {above.map((x, i) => <ChainRow key={x.key} first={i === 0} tile={ini(x.name)} n={x.name} r={x.roles.join(' · ')} />)}
          <ChainRow me first={!above.length} tile={ini(emp.full_name)} n={val(emp.full_name)}
            r={[self ? 'You' : val(emp.designation), ...myRoles].join(' · ')} />
        </>
      )}
    </Card>
  )
}

function HowRow({ t, tone, lock, d }: { t: string; tone: 'brand' | 'warning' | 'muted'; lock?: boolean; d: string }) {
  const { C } = useTheme()
  return (
    <View style={{ paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {lock && <LockGlyph color={C.muted} />}
        <Txt size={F.small} w={700} tone={tone}>{t}</Txt>
      </View>
      <Txt size={F.small} tone="soft" style={{ marginTop: 2 }}>{d}</Txt>
    </View>
  )
}

/** Profile360 HowEditing, as the body of a sheet. */
export function HowEditingBody() {
  return (
    <View>
      <HowRow t="Edit · Add" tone="brand" d="Saves straight away: contact details, emergency contacts, blood group, nominees, a missing PAN, UAN, Aadhaar or address." />
      <HowRow t="Request change" tone="warning" d="Goes for approval and says to whom. Changing an address, spouse or marital status goes to HR; the salary account goes to Payroll." />
      <HowRow t="Locked" tone="muted" lock d="Maintained by HR: your name, date of birth, job details. Ask HR to correct these." />
    </View>
  )
}
