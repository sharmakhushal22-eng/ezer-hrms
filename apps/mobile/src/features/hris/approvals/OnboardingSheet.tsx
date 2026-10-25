// The heads' onboarding approval sheet — components/ess/OnboardingApprovals.tsx
// (the open form): letterhead and stamps, "Acting as", the team's checklist,
// Payroll's live salary structure, the documents (10-minute signed links, opened
// in the in-app browser and re-fetched when older than 9 minutes), the
// candidate's form section by section, and the decision bar.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { CHECKLISTS, missingItems, type ChecklistField, type HeadTeam } from '@web/onboarding/checklists'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { SelectSheet } from '@/ui/overlays'
import { FullModal, SolidButton } from '../ui'
import { DocCard, SCHEMA, SectionView, SheetHeading, TEAM, day, type Doc } from './formSections'
import { rebuildFor, type SalaryBreakdown } from './salary'

export type Approval = { team: string; status: 'PENDING' | 'APPROVED' | 'RETURNED'; acted_by_name: string | null; remark: string | null; acted_at: string | null }
const inr = (n: number | null | undefined) => n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`
const TEAM_BLURB: Record<HeadTeam, string> = {
  IT: 'What the joiner walks in to on day one — tick each item once it is actually ready.',
  ADMIN: 'What Admin has arranged for the joiner — tick each item once it is actually ready.',
  PAYROLL: 'The structure the joiner will be paid on. Check the breakdown below; correct the CTC if the offer changed and the structure follows.',
}

function ChecklistInput({ f, v, need, readOnly, onChange }: { f: ChecklistField; v: any; need: boolean; readOnly: boolean; onChange: (k: string, v: any) => void }) {
  const { C } = useTheme()
  const [open, setOpen] = React.useState(false)
  const label = `${f.label}${f.required ? ' *' : ''}`
  if (f.kind === 'select') {
    const cur = f.options?.find(o => o.value === v)?.label
    return (
      <View style={{ marginBottom: S.md }}>
        <Txt size={10} w={600} tone="muted" upper style={{ marginBottom: 4 }}>{label}</Txt>
        <Pressable disabled={readOnly} onPress={() => setOpen(true)} accessibilityRole="button"
          style={{ minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: readOnly ? C.sunken : C.surface, paddingHorizontal: 11, justifyContent: 'center' }}>
          <Txt size={F.small} color={cur ? C.ink : C.faint}>{cur || '—'}</Txt>
        </Pressable>
        <SelectSheet visible={open} onClose={() => setOpen(false)} title={f.label} value={v ?? ''}
          options={[{ value: '', label: '—' }, ...(f.options || [])]} onPick={x => onChange(f.key, x)} />
      </View>
    )
  }
  return (
    <View style={{ marginBottom: S.md }}>
      <Txt size={10} w={600} tone="muted" upper style={{ marginBottom: 4 }}>{label}</Txt>
      <Input value={v == null ? '' : String(v)} editable={!readOnly} onChangeText={t => onChange(f.key, t)} placeholder={f.hint || ''}
        keyboardType={f.kind === 'number' ? 'numeric' : 'default'} style={{ marginBottom: 0 }} />
      {need && <View style={{ height: 2, backgroundColor: C.warning, borderRadius: 1, marginTop: -2 }} />}
    </View>
  )
}

function Checklist({ team, values, onChange, readOnly }: { team: HeadTeam; values: Record<string, any>; onChange: (k: string, v: any) => void; readOnly: boolean }) {
  const { C } = useTheme()
  const def = CHECKLISTS[team]
  const missing = new Set(missingItems(team, values))
  const bools = def.fields.filter(f => f.kind === 'bool'), inputs = def.fields.filter(f => f.kind !== 'bool')
  const total = def.fields.filter(f => f.required).length
  const done = total - def.fields.filter(f => f.required && missing.has(f.label)).length
  return (
    <View style={{ marginTop: 14 }}>
      <Txt size={12.5} tone="soft">{TEAM_BLURB[team]}</Txt>
      <Txt size={11.5} w={700} color={done === total ? C.positive : C.muted} style={{ marginTop: 6 }}>{done} of {total} confirmed</Txt>
      <View style={{ height: 6, borderRadius: 99, backgroundColor: C.sunken, overflow: 'hidden', marginTop: 6, marginBottom: 14 }}>
        <View style={{ height: '100%', width: `${total ? (done / total) * 100 : 0}%`, backgroundColor: C.positive, borderRadius: 99 }} />
      </View>
      {inputs.map(f => <ChecklistInput key={f.key} f={f} v={values[f.key]} need={!readOnly && missing.has(f.label)} readOnly={readOnly} onChange={onChange} />)}
      <View style={{ gap: 10 }}>
        {bools.map(f => {
          const on = values[f.key] === true
          const need = !readOnly && missing.has(f.label)
          return (
            <Pressable key={f.key} disabled={readOnly} onPress={() => onChange(f.key, !on)} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: readOnly }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56, borderRadius: R.md, borderWidth: 1, borderColor: on ? C.positiveEdge : need ? C.warningEdge : C.line, backgroundColor: on ? C.positiveTint : C.surface }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? C.positive : C.lineStrong, backgroundColor: on ? C.positive : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {on && <Txt size={14} w={800} color={C.onAccent}>✓</Txt>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt size={F.small} w={600}>{f.label}{f.required && !on ? <Txt size={F.small} tone="critical"> *</Txt> : null}</Txt>
                <Txt size={11} w={on ? 700 : 400} color={on ? C.positive : C.muted}>{on ? 'Ready' : readOnly ? 'Not confirmed' : 'Click when ready'}</Txt>
              </View>
            </Pressable>
          )
        })}
      </View>
      {!readOnly && missing.size > 0 && <Txt size={11.5} tone="warning" style={{ marginTop: 10 }}>To approve, still needed: {[...missing].join(', ')}.</Txt>}
    </View>
  )
}

function SalaryTable({ s, annual }: { s: SalaryBreakdown; annual: number }) {
  const { C } = useTheme()
  const b = React.useMemo(() => rebuildFor(s, annual), [s, annual])
  const srcLabel = b.source === 'negotiation' ? 'From the negotiation' : b.source === 'stipend' ? 'Fees / stipend' : b.source === 'offer_letter' ? 'From the offer letter' : 'Computed'
  return (
    <View style={{ marginTop: 12 }}>
      <Txt size={11} tone="muted">{b.label}</Txt>
      <Txt size={22} w={700}>{inr(b.annual_ctc)} <Txt size={F.tiny} w={500} tone="muted">a year{b.basic_monthly ? ` · basic ${inr(b.basic_monthly)} a month (${b.basic_pct}%)` : ''}</Txt></Txt>
      {b.source !== 'none' && (
        <View style={{ alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, backgroundColor: b.source === 'computed' ? C.warningTint : C.infoTint }}>
          <Txt size={11} w={700} color={b.source === 'computed' ? C.warning : C.info}>{srcLabel}</Txt>
        </View>
      )}
      {!!b.too_low && <View style={{ padding: 10, backgroundColor: C.criticalTint, borderRadius: 8, marginTop: 8 }}><Txt size={12.5} tone="critical">{b.note}</Txt></View>}
      {b.rows.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.lineStrong }}>
            <Txt size={10} w={600} tone="muted" upper style={{ flex: 1.4 }}>Component</Txt>
            <Txt size={10} w={600} tone="muted" upper style={{ flex: 1, textAlign: 'right' }}>Monthly</Txt>
            <Txt size={10} w={600} tone="muted" upper style={{ flex: 1, textAlign: 'right' }}>Annual</Txt>
          </View>
          {b.rows.map((r, i) => {
            if (r.kind === 'head' || r.kind === 'note') {
              return <Txt key={i} size={r.kind === 'head' ? 10.5 : 11} w={r.kind === 'head' ? 700 : 400} tone="muted" upper={r.kind === 'head'} style={{ paddingTop: r.kind === 'head' ? 14 : 8, paddingBottom: 6, borderBottomWidth: r.kind === 'head' ? 1 : 0, borderBottomColor: C.lineStrong }}>{r.label}</Txt>
            }
            const bold = r.kind === 'sum' || r.kind === 'total' || r.kind === 'net'
            const color = r.kind === 'total' ? C.brandDeep : r.kind === 'net' ? C.positive : r.kind === 'ded' ? C.critical : ['emp', 'grat', 'bonus'].includes(r.kind) ? C.inkSoft : r.kind === 'muted' ? C.muted : C.ink
            const bg = r.kind === 'total' ? C.brandTint : r.kind === 'net' ? C.positiveTint : 'transparent'
            return (
              <View key={i} style={{ flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: bg }}>
                <View style={{ flex: 1.4 }}>
                  <Txt size={12} w={bold ? 700 : 400} color={color}>{r.label}</Txt>
                  {!!r.basis && <Txt size={10.5} tone="muted">{r.basis}</Txt>}
                </View>
                <Txt size={12} w={bold ? 700 : 400} color={color} style={{ flex: 1, textAlign: 'right' }}>{inr(r.monthly)}</Txt>
                <Txt size={12} w={bold ? 700 : 400} color={color} style={{ flex: 1, textAlign: 'right' }}>{inr(r.annual)}</Txt>
              </View>
            )
          })}
        </View>
      )}
      {!b.too_low && !!b.note && <Txt size={11.5} tone="muted" style={{ marginTop: 8 }}>{b.note}</Txt>}
    </View>
  )
}

export interface OpenState { teams: string[]; item: any; approvals: Approval[]; documents: Doc[]; checklists: Record<string, Record<string, any>>; salary: SalaryBreakdown | null; openedAt: number }

export function OnboardingSheet({ open, teams, team, setTeam, check, setField, busy, onClose, onDecide, onRefreshDocs }: {
  open: OpenState; teams: string[]; team: HeadTeam; setTeam: (t: HeadTeam) => void
  check: Record<string, Record<string, any>>; setField: (k: string, v: any) => void; busy: boolean
  onClose: () => void; onDecide: (a: 'approve' | 'return' | 'save') => void; onRefreshDocs: () => Promise<Doc[] | null>
}) {
  const { C } = useTheme()
  const item = open.item
  const mine = open.approvals.find(a => a.team === team) || null
  const decided = mine?.status === 'APPROVED'
  const missingNow = missingItems(team, check[team])
  const docs = open.documents || []
  const salary = open.salary
  let sec = 0

  async function openDoc(d: Doc) {
    let url = d.url
    if (Date.now() - open.openedAt > 9 * 60_000) {
      const fresh = await onRefreshDocs()
      url = fresh?.find(x => x.doc_code === d.doc_code)?.url || url
    }
    if (url) void WebBrowser.openBrowserAsync(url)
  }

  const footer = item.status === 'EMPLOYEE_CREATED' || decided ? (
    <View style={{ gap: S.sm }}>
      <Txt size={12.5} tone="soft">{decided ? `Already approved for ${TEAM[team]}.` : 'The employee code is already generated.'}</Txt>
      <Button title="Close" variant="outline" onPress={onClose} full />
    </View>
  ) : (
    <View style={{ gap: S.sm }}>
      <Txt size={F.tiny} color={missingNow.length ? C.warning : C.muted}>{missingNow.length ? `${missingNow.length} item${missingNow.length === 1 ? '' : 's'} still to confirm` : 'Checklist complete'}</Txt>
      <SolidButton title={busy ? 'Saving…' : `✓ Approve for ${TEAM[team]}`} tone={missingNow.length ? 'faint' : 'positive'} disabled={busy || missingNow.length > 0} onPress={() => onDecide('approve')} full />
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Button title="Save checklist" variant="outline" disabled={busy} onPress={() => onDecide('save')} style={{ flex: 1 }} />
        <Button title="Return to candidate…" variant="outline" disabled={busy} onPress={() => onDecide('return')} style={{ flex: 1 }} />
      </View>
    </View>
  )

  return (
    <FullModal visible onClose={() => { if (!busy) onClose() }} title={`Onboarding approval · ${CHECKLISTS[team].title}`} closeLabel="✕ Close" footer={footer}>
      <Txt size={24} w={700} style={{ lineHeight: 28 }}>{item.full_name}</Txt>
      {!!(item.designation || item.department) && <Txt size={F.small} tone="soft" style={{ marginTop: 4 }}>{[item.designation, item.department].filter(Boolean).join(' · ')}</Txt>}
      <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{item.employment_type || 'Employee'} · joining {day(item.date_of_joining)} · submitted {day(item.submitted_at)}{item.email ? ` · ${item.email}` : ''}{item.mobile ? ` · ${item.mobile}` : ''}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {open.approvals.map(a => {
          const c = a.status === 'APPROVED' ? C.positive : a.status === 'RETURNED' ? C.critical : C.muted
          const bg = a.status === 'APPROVED' ? C.positiveTint : a.status === 'RETURNED' ? C.criticalTint : C.sunken
          return (
            <View key={a.team} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99, borderWidth: 1, borderColor: c, backgroundColor: bg }}>
              <Txt size={10.5} w={700} color={c}>{TEAM[a.team]} {a.status === 'APPROVED' ? '✓' : a.status === 'RETURNED' ? '↩' : '·'} {a.status === 'APPROVED' ? (a.acted_by_name || 'approved') : a.status === 'RETURNED' ? 'returned' : 'pending'}</Txt>
            </View>
          )
        })}
      </View>
      {teams.length > 1 && (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Txt size={F.tiny} tone="muted">Acting as</Txt>
          {teams.map(t => <Button key={t} title={TEAM[t]} size="sm" variant={team === t ? 'primary' : 'outline'} onPress={() => setTeam(t as HeadTeam)} />)}
        </View>
      )}
      {decided
        ? <View style={{ marginTop: 14, padding: 10, borderRadius: 8, backgroundColor: C.positiveTint }}><Txt size={12.5} w={600} tone="positive">Approved for {TEAM[team]} by {mine?.acted_by_name || '—'} on {day(mine?.acted_at)}.</Txt></View>
        : <Txt size={12.5} tone="soft" style={{ marginTop: 14 }}>Confirm your checklist, look through what the candidate filled in, then <Txt size={12.5} w={700}>approve for {TEAM[team]}</Txt>. If something is wrong in the form, return it to the candidate with a remark.</Txt>}

      <SheetHeading n={++sec} title={`${CHECKLISTS[team].title} · your checklist`} />
      <Checklist team={team} values={check[team] || {}} onChange={setField} readOnly={decided} />

      {team === 'PAYROLL' && salary && <>
        <SheetHeading n={++sec} title="Salary structure" />
        <SalaryTable s={salary} annual={Number(check.PAYROLL?.annual_ctc) || salary.annual_ctc} />
      </>}

      <SheetHeading n={++sec} title="Documents" right={`${docs.length} uploaded`} />
      {docs.length === 0 && <Txt size={F.tiny} tone="muted" style={{ marginTop: 8 }}>No documents uploaded.</Txt>}
      {docs.map(d => <DocCard key={d.doc_code} doc={d} onOpen={x => void openDoc(x)} />)}

      {SCHEMA.map(s => item.form_data?.[s.step] ? <SectionView key={s.step} n={++sec} sec={s} obj={item.form_data[s.step]} /> : null)}
      <View style={{ height: S.lg }} />
    </FullModal>
  )
}
