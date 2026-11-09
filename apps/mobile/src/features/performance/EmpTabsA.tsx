// src/features/performance/EmpTabsA.tsx — the chain banner and My Dashboard
// (website: components/pms/EmployeeTabs.tsx ChainBanner, §3.1). The KRA form
// is EmpKras.tsx.
import * as React from 'react'
import { View } from 'react-native'
import { STAGES, DEFAULT_RULES, type Rules, type StageKey, type StageState } from '@web/pms/cycle'
import { bandFor, DEFAULT_BANDS, type Band } from '@web/pms/scoring'
import { F, S } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Ava, B, Banner, Bar, K, PCard, PStat, StatGrid } from './ui'
import type { Who } from './data'

// ── where it is in the chain, and why it came back ───────────────────────
const WITH: Record<string, string> = {
  RM_L1: 'your reporting manager', RM_L2: 'your second-level manager',
  HOD: 'your head of department', HR: 'HR, to publish',
}
export function ChainBanner({ stage, sentBackReason, sentBackAt }: { stage?: string | null; sentBackReason?: string | null; sentBackAt?: string | null }) {
  if (!stage || stage === 'DONE') return null
  if (stage === 'EMPLOYEE' && sentBackReason) {
    return (
      <Banner tone="red" glyph="↩️">
        <B>Sent back to you{sentBackAt ? ` on ${sentBackAt.slice(0, 10)}` : ''}.</B> Change what is asked for below and send it again.
        {'\n'}<Txt size={F.tiny} tone="critical" style={{ fontStyle: 'italic' }}>“{sentBackReason}”</Txt>
      </Banner>
    )
  }
  if (stage === 'EMPLOYEE') {
    return <Banner tone="amber" glyph="↩️">This is back with you. No reason was recorded — ask your manager what they want changed.</Banner>
  }
  return <Banner tone="blue" glyph="⏳">Your KRAs and ratings are with {WITH[stage] ?? stage} for approval.</Banner>
}

// ── §3.1 My Dashboard ────────────────────────────────────────────────────
export function DashboardTab({ who, stages, current, kraCount, weightage, frequency, periodLabel, lastRating, lastScore, actionLabel, actionNote, bands = DEFAULT_BANDS, rules = DEFAULT_RULES }: {
  who: Who
  stages: { key: StageKey; state: StageState; detail?: string }[]
  current: StageKey
  kraCount: number; weightage: number; frequency: string; periodLabel: string
  lastRating: number | null; lastScore: number | null
  actionLabel: string; actionNote: string
  bands?: Band[]; rules?: Rules
}) {
  const setOk = kraCount >= rules.minKra && weightage === rules.totalWeightage
  const band = bandFor(lastRating, bands)
  // The cycle track is drawn once, in the header; this card says where the person stands in one line.
  const done = stages.filter(x => x.state === 'done').length
  const now = STAGES.find(x => x.key === current)
  return (
    <>
      <PCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Ava name={who.name} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt size={F.lead} w={700}>{who.name} <Txt size={F.small} w={600} tone="muted">{who.code}</Txt></Txt>
            {!!who.designation && <K>{who.designation}</K>}
          </View>
        </View>
        <View style={{ marginTop: S.md, gap: 4 }}>
          <Txt size={F.small} w={700}>{now ? `Now: ${now.label}` : 'Cycle'}</Txt>
          <K>{done} of {STAGES.length} stages done</K>
          <Bar pct={Math.round((done / STAGES.length) * 100)} tone="green" />
        </View>
      </PCard>

      <StatGrid>
        <PStat tone="accent" label="Owed from you" value={actionLabel} note={actionNote} />
        <PStat label="My KRAs" value={kraCount} tone={setOk ? undefined : 'warn'}
          note={setOk ? `Totalling ${weightage}. The set is valid`
            : `Totalling ${weightage}. Needs ${rules.minKra}–${rules.maxKra} KRAs at exactly ${rules.totalWeightage}`} />
        <PStat label="How often" value={frequency} note={periodLabel} />
        <PStat label="Last time" value={lastRating === null ? '-' : `${lastRating}${band ? ` · ${band.label}` : ''}`}
          note={lastScore === null ? 'No previous period on record' : `Weighted score ${lastScore}`} />
      </StatGrid>

      <Banner tone="blue" glyph="ℹ️">
        This is a <B>developmental</B> review. The rating is not linked to any increment, variable pay, bonus or CTC. It exists to give you feedback and to decide what support you get next. Recognition here is a certificate, a nomination or an award, never a cash component.
      </Banner>
    </>
  )
}
