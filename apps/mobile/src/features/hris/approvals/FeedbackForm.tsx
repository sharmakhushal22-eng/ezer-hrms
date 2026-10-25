// The interview feedback form (fill mode) — components/recruitment/InterviewFeedbackForm.tsx.
// FEEDBACK_PARAMS, scoreFeedback, bandOf and the recommendation text are copied
// from that DOM file; DECISION_LABEL is imported from the pure lib module.
// Eight parameters, 1–10 each, a mandatory remark per parameter, a mandatory
// written assessment, then Hold / Reject (remark required) / Shortlist.
// The web's right-hand live-score panel sits above the parameters on a phone.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { DECISION_LABEL, type Decision } from '@web/recruitment/interview-decision'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT, R, S } from '@/ui/theme'
import { Button, Txt, webNoOutline } from '@/ui/primitives'
import type { Palette } from '@/ui/theme'
import { SolidButton } from '../ui'

export const FEEDBACK_PARAMS = [
  { k: 'TECH', n: 'Technical / Functional Knowledge', d: 'Depth in the skills this role actually needs' },
  { k: 'EXP', n: 'Relevant Experience', d: 'How closely past work maps to this position' },
  { k: 'PROB', n: 'Problem Solving & Analytical Ability', d: 'How they break down and reason through a problem' },
  { k: 'COMM', n: 'Communication & Articulation', d: 'Clarity of expression, listening, structure of answers' },
  { k: 'OWN', n: 'Ownership & Accountability', d: 'Drives things to closure, owns outcomes and mistakes' },
  { k: 'TEAM', n: 'Team Fit & Collaboration', d: 'Works with others, aligns with how this team operates' },
  { k: 'LEARN', n: 'Learning Agility & Adaptability', d: 'Picks up new things, handles change and ambiguity' },
  { k: 'STAB', n: 'Stability & Intent', d: 'Job-change pattern, and genuine interest in this role' },
] as const

export interface Feedback {
  params: Record<string, number>; remarks: Record<string, string>; overall: string; recommendation: string
  total: number; pct: number; band: string; decision?: Decision | null; decision_remark?: string | null
}
const RECOMM_FOR: Record<Decision, string> = { HOLD: 'Borderline — needs another view', REJECT: 'Do Not Recommend', SHORTLIST: 'Recommend' }

type ToneKey = 'positive' | 'info' | 'warning' | 'critical'
export function bandOf(pct: number): [string, ToneKey] {
  if (pct >= 80) return ['Strong Hire', 'positive']
  if (pct >= 65) return ['Hire', 'info']
  if (pct >= 50) return ['Borderline', 'warning']
  return ['No Hire', 'critical']
}
export function scoreFeedback(params: Record<string, number>) {
  const total = FEEDBACK_PARAMS.reduce((a, p) => a + (params[p.k] || 0), 0)
  const pct = Math.round((total / 80) * 100)
  return { total, pct, band: bandOf(pct)[0] }
}
const toneKey = (v: number): ToneKey => (v >= 8 ? 'positive' : v >= 5 ? 'warning' : 'critical')
const fg = (C: Palette, t: ToneKey) => C[t]
const tint = (C: Palette, t: ToneKey) => C[`${t}Tint` as const]
const edge = (C: Palette, t: ToneKey) => C[`${t}Edge` as const]
const DTONE: Record<Decision, ToneKey> = { HOLD: 'warning', REJECT: 'critical', SHORTLIST: 'positive' }

function Box({ children, style }: { children: React.ReactNode; style?: any }) {
  const { C } = useTheme()
  return <View style={[{ backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, marginBottom: 12 }, style]}>{children}</View>
}
function Cap({ children }: { children: React.ReactNode }) {
  return <Txt size={F.tiny} w={800} tone="muted" upper>{children}</Txt>
}
function Area({ value, onChange, placeholder, minHeight = 88, danger }: { value: string; onChange: (v: string) => void; placeholder: string; minHeight?: number; danger?: boolean }) {
  const { C } = useTheme()
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.faint} multiline
      style={[{ minHeight, borderWidth: 1, borderColor: danger ? C.critical : C.line, borderRadius: 8, padding: 10, fontFamily: FONT[400], fontSize: F.small, color: C.ink, backgroundColor: C.surface, textAlignVertical: 'top' }, webNoOutline]} />
  )
}

function ParamCard({ i, p, v, remark, onRate, onRemark, flagged }: { i: number; p: typeof FEEDBACK_PARAMS[number]; v?: number; remark: string; onRate: (n: number) => void; onRemark: (t: string) => void; flagged: boolean }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: v ? edge(C, toneKey(v)) : C.line, borderRadius: 11, padding: 12, marginBottom: 10, backgroundColor: v ? C.sunken : C.surface }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: v ? C.positive : C.sunken, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={11} w={800} color={v ? C.onAccent : C.muted}>{v ? '✓' : i + 1}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{p.n}</Txt>
          <Txt size={11} tone="muted">{p.d}</Txt>
        </View>
        <Txt size={20} w={800} color={v ? fg(C, toneKey(v)) : C.faint}>{v ? `${v}/10` : '-'}</Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
        {Array.from({ length: 10 }, (_, n) => n + 1).map(n => {
          const on = v === n
          return (
            <Pressable key={n} onPress={() => onRate(n)} accessibilityRole="button" accessibilityLabel={`${p.n}: ${n}`} accessibilityState={{ selected: on }}
              style={{ width: '18.4%', height: 40, borderRadius: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: on ? 'transparent' : C.line, backgroundColor: on ? fg(C, toneKey(n)) : C.surface }}>
              <Txt size={F.small} w={700} color={on ? C.onAccent : C.muted}>{n}</Txt>
            </Pressable>
          )
        })}
      </View>
      <TextInput value={remark} onChangeText={onRemark} placeholder="Remarks for this parameter (mandatory)" placeholderTextColor={C.faint}
        style={[{ marginTop: 9, minHeight: 44, borderWidth: 1, borderColor: flagged ? C.critical : C.line, borderRadius: 8, paddingHorizontal: 10, fontFamily: FONT[400], fontSize: 12.5, color: C.ink, backgroundColor: C.surface }, webNoOutline]} />
    </View>
  )
}

export function FeedbackForm({ candidate, round, questions, submitting, onSubmit, onClose }: {
  candidate: { name: string; sub?: string }; round: string; questions?: string[] | null; submitting?: boolean
  onSubmit: (f: Feedback) => void; onClose: () => void
}) {
  const { C } = useTheme()
  const [params, setParams] = React.useState<Record<string, number>>({})
  const [remarks, setRemarks] = React.useState<Record<string, string>>({})
  const [overall, setOverall] = React.useState('')
  const [pending, setPending] = React.useState<Decision | null>(null)
  const [dRemark, setDRemark] = React.useState('')
  const [err, setErr] = React.useState<string | null>(null)

  const { total, pct, band } = React.useMemo(() => scoreFeedback(params), [params])
  const done = FEEDBACK_PARAMS.filter(p => params[p.k]).length
  const [bandLabel, bandTone] = bandOf(pct)

  function ready(): boolean {
    const missing = FEEDBACK_PARAMS.filter(p => !params[p.k])
    if (missing.length) { setErr(`${missing.length} parameter(s) not rated. All 8 must be rated.`); return false }
    const noRemark = FEEDBACK_PARAMS.filter(p => !(remarks[p.k] || '').trim())
    if (noRemark.length) { setErr(`Remarks are mandatory for every parameter: ${noRemark.length} missing: ${noRemark.map(p => p.n).join(', ')}.`); return false }
    if (!overall.trim()) { setErr('Detailed feedback is mandatory.'); return false }
    setErr(null); return true
  }
  function choose(d: Decision) {
    if (!ready()) return
    if (d === 'SHORTLIST') { finish(d); return }
    setPending(d)
  }
  function finish(d: Decision) {
    const remark = dRemark.trim()
    if (d !== 'SHORTLIST' && !remark) { setErr(`A remark is required to ${d === 'HOLD' ? 'put the candidate on hold' : 'reject the candidate'}.`); return }
    setErr(null)
    onSubmit({ params, remarks, overall: overall.trim(), recommendation: RECOMM_FOR[d], total, pct, band, decision: d, decision_remark: remark || null })
  }

  return (
    <View>
      <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Txt size={14} w={800} color={C.onAccent}>{candidate.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}</Txt>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={14} w={800}>{candidate.name}</Txt>
          <Txt size={F.tiny} tone="muted" numberOfLines={1}>{[round, candidate.sub].filter(Boolean).join(' · ')}</Txt>
        </View>
      </Box>

      {/* live score (the web's right column) */}
      <Box>
        <Cap>Live score</Cap>
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Txt size={42} w={800} color={done ? fg(C, bandTone) : C.faint} style={{ lineHeight: 46 }}>{done ? total : '-'}</Txt>
          <Txt size={F.small} w={600} tone="faint">out of 80</Txt>
          {done > 0 && <View style={{ marginTop: 8, paddingHorizontal: 11, paddingVertical: 3, borderRadius: 20, backgroundColor: tint(C, bandTone) }}><Txt size={11} w={800} color={fg(C, bandTone)}>{bandLabel}</Txt></View>}
        </View>
        <View accessibilityRole="progressbar" accessibilityLabel={`Interview score: ${done ? total : 0} out of 80`}
          style={{ height: 8, backgroundColor: C.sunken, borderRadius: 5, overflow: 'hidden', marginVertical: 6 }}>
          <View style={{ height: '100%', width: `${(total / 80) * 100}%`, backgroundColor: done ? fg(C, bandTone) : C.faint, borderRadius: 5 }} />
        </View>
        <Txt size={11} tone="faint" center style={{ marginBottom: 8 }}>{done ? `${pct}%${done < 8 ? ` · ${8 - done} to rate` : ''}` : 'Not started'}</Txt>
        {FEEDBACK_PARAMS.map(p => {
          const v = params[p.k]
          return (
            <View key={p.k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <Txt size={F.tiny} tone="muted" numberOfLines={1} style={{ flex: 1, paddingRight: 8 }}>{p.n}</Txt>
              <Txt size={F.tiny} w={800} color={v ? fg(C, toneKey(v)) : C.faint}>{v || '-'}</Txt>
            </View>
          )
        })}
      </Box>

      {Array.isArray(questions) && questions.length > 0 && (
        <View style={{ backgroundColor: C.infoTint, borderWidth: 1, borderColor: C.infoEdge, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <Txt size={F.tiny} w={800} tone="info" upper style={{ marginBottom: 8 }}>Questions to ask (from the requisition)</Txt>
          {questions.map((q, i) => <Txt key={i} size={12.5} style={{ lineHeight: 19 }}>{i + 1}. {q}</Txt>)}
        </View>
      )}

      <Box>
        <View style={{ marginBottom: 12, gap: 6 }}>
          <Txt size={F.tiny} w={800} tone="muted">RATE ALL 8 PARAMETERS<Txt size={F.tiny} w={600} tone="critical">: score and remark are both mandatory</Txt></Txt>
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 20, backgroundColor: done === 8 ? C.positiveTint : C.sunken, borderWidth: done === 8 ? 0 : 1, borderColor: C.line }}>
            <Txt size={10} w={800} color={done === 8 ? C.positive : C.muted}>{done} of 8 rated</Txt>
          </View>
        </View>
        {FEEDBACK_PARAMS.map((p, i) => (
          <ParamCard key={p.k} i={i} p={p} v={params[p.k]} remark={remarks[p.k] || ''} flagged={!!err && !(remarks[p.k] || '').trim()}
            onRate={n => setParams(x => ({ ...x, [p.k]: n }))} onRemark={t => setRemarks(r => ({ ...r, [p.k]: t }))} />
        ))}
      </Box>

      <Box>
        <View style={{ marginBottom: 12 }}><Cap>Overall assessment</Cap></View>
        <Txt size={11} w={700} tone="muted" style={{ marginBottom: 4 }}>Detailed feedback<Txt size={11} w={700} tone="critical"> (mandatory)</Txt></Txt>
        <Area value={overall} onChange={setOverall} placeholder="Your full written assessment: what stood out, where the gaps are, and anything the next round should probe." />
        <Txt size={11} w={700} tone="muted" style={{ marginTop: 16, marginBottom: 6 }}>Your decision <Txt size={11} w={500} tone="faint">(Hold and Reject need a remark)</Txt></Txt>
        {!pending ? (
          <View style={{ gap: S.sm }}>
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <SolidButton title="Hold" tone="warning" disabled={submitting} onPress={() => choose('HOLD')} style={{ flex: 1 }} />
              <SolidButton title="Reject" tone="critical" disabled={submitting} onPress={() => choose('REJECT')} style={{ flex: 1 }} />
            </View>
            <SolidButton title={submitting ? 'Submitting…' : 'Shortlist'} tone="positive" disabled={submitting} onPress={() => choose('SHORTLIST')} full />
            <Button title="Cancel" variant="outline" onPress={onClose} full />
          </View>
        ) : (
          <View style={{ borderWidth: 1, borderColor: edge(C, DTONE[pending]), backgroundColor: tint(C, DTONE[pending]), borderRadius: 11, padding: 12 }}>
            <Txt size={F.small} w={800} color={fg(C, DTONE[pending])} style={{ marginBottom: 8 }}>{pending === 'HOLD' ? 'Put the candidate on hold' : 'Reject the candidate'}: add your remark</Txt>
            <Area value={dRemark} onChange={setDRemark} minHeight={70}
              placeholder={pending === 'HOLD' ? 'Why on hold, and what would change the call (e.g. waiting on a comparison, notice period, budget)…' : 'Why the candidate is not a fit for this role…'} />
            <View style={{ flexDirection: 'row', gap: S.sm, marginTop: 10 }}>
              <SolidButton title={submitting ? 'Submitting…' : `Confirm ${DECISION_LABEL[pending] === 'On hold' ? 'Hold' : 'Reject'}`} tone={DTONE[pending]} disabled={submitting} onPress={() => finish(pending)} style={{ flex: 1 }} />
              <Button title="Back" variant="outline" disabled={submitting} onPress={() => { setPending(null); setErr(null) }} />
            </View>
          </View>
        )}
        {!!err && (
          <View style={{ marginTop: 12, backgroundColor: C.criticalTint, borderWidth: 1, borderColor: C.criticalEdge, borderRadius: 8, padding: 10 }}>
            <Txt size={12.5} w={600} tone="critical">{err}</Txt>
          </View>
        )}
      </Box>
      <View style={{ height: R.md }} />
    </View>
  )
}
