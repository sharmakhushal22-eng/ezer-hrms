// src/features/performance/RateTab.tsx — §4.3 Rate My Team (website:
// components/pms/ManagerTabs.tsx RateTab). The tab chooses its own subject
// from the team queue; once picked, their KRAs, what they delivered and their
// own rating sit beside yours. Settled (finalised) rows offer no Rate button.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, type TeamMember } from '@web/pms/team'
import { canManagerRate, checkFeedback, score, gap, bandFor, DEFAULT_BANDS, type Band, type Line } from '@web/pms/scoring'
import type { FlagRules } from '@web/pms/employment'
import { DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { Banner, Chips, K, PCard, Pill, PStat, StatGrid } from './ui'
import { QueueList } from './MgrTabs'
import type { RateRow } from './data'

function RateCard({ r, i, bands, onSet }: { r: RateRow; i: number; bands: Band[]; onSet: (i: number, p: Partial<RateRow>) => void }) {
  const { C } = useTheme()
  const rg = gap(r.selfRating, r.myRating)
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.sm }}>
        <Txt size={F.small} w={600} style={{ flex: 1 }}>{r.title}</Txt>
        <Txt size={F.tiny} tone="muted">Wt {r.weightage}</Txt>
      </View>
      <Txt size={F.micro} w={700} tone="muted" upper>What they delivered</Txt>
      {r.achievement ? <Txt size={F.tiny} style={{ marginTop: 2 }}>{r.achievement}</Txt> : <K>nothing written</K>}
      {!!r.selfComment && <K>{r.selfComment}</K>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm, marginBottom: S.sm }}>
        <Txt size={F.micro} w={700} tone="muted" upper>Theirs</Txt>
        <Txt size={F.small} w={700}>{r.selfRating ?? '-'}</Txt>
        {rg.flag === 'MAJOR_GAP' && <Pill kind="amber" label="gap" />}
      </View>
      <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Yours</Txt>
      <Chips bands={bands} value={r.myRating} name={`Your rating for ${r.title}`} onPick={n => onSet(i, { myRating: n })} />
      <Input value={r.myComment} placeholder="What you saw, specifically" style={{ marginTop: S.md, marginBottom: 0 }}
        accessibilityLabel={`Your comment on ${r.title}`} onChangeText={t => onSet(i, { myComment: t })} />
    </View>
  )
}

export function RateTab({ member, rows, onChange, onSubmit, saving, overallComment, onOverallComment, bands = DEFAULT_BANDS, members, onPick, today, rules = DEFAULT_RULES, flagRules, loadingRows }: {
  member: TeamMember | null; rows: RateRow[]; onChange: (next: RateRow[]) => void
  onSubmit: () => void; saving?: boolean
  overallComment: string; onOverallComment: (s: string) => void
  bands?: Band[]; members?: TeamMember[]; onPick?: (employeeId: string | null) => void; today?: string
  rules?: Rules; flagRules?: FlagRules; loadingRows?: boolean
}) {
  if (!member) {
    const pickable = members && today ? teamQueue(members, today, flagRules) : []
    return (
      <PCard title="Who are you rating?" sub="Their KRAs and their own ratings appear beside yours once you choose.">
        {!onPick ? <K>Picking is not available on this screen.</K> : (
          <QueueList rules={rules} rows={pickable}
            empty="Nobody is with you yet. A rating opens once their weightages are locked and they have submitted their own rating."
            extra={r => (
              <View style={{ marginTop: S.sm }}>
                {r.member.finalised
                  ? <Pill kind="green" label="settled" />
                  : <Button size="sm" title={r.member.selfSubmitted ? 'Rate' : 'Open'} onPress={() => onPick(r.member.employeeId)} />}
              </View>
            )} />
        )}
      </PCard>
    )
  }

  // Phone adaptation: the website has no way back to the list once somebody is picked.
  const back = onPick ? <Button size="sm" variant="ghost" title="← Choose somebody else" onPress={() => onPick(null)} style={{ alignSelf: 'flex-start', marginBottom: S.md }} /> : null
  const canRate = canManagerRate(member.selfSubmitted)
  if (!canRate.open) {
    return (
      <>
        {back}
        <PCard title={`${member.name}: not yet`}>
          <Banner tone="amber" glyph="⏳" style={{ marginBottom: 0 }}>{canRate.because}</Banner>
        </PCard>
      </>
    )
  }
  const lines: Line[] = rows.map(r => ({ goalId: r.goalId, title: r.title, category: r.category, weightage: r.weightage, self: r.selfRating, final: r.myRating }))
  const mine = score(lines, 'final')
  const theirs = score(lines, 'self')
  const g = gap(theirs, mine)
  const unrated = rows.filter(r => r.myRating === null).length
  const band = bandFor(mine === null ? null : Math.round(mine), bands)
  const fb = checkFeedback(mine === null ? null : Math.round(mine), { appreciation: overallComment }, bands)
  const set = (i: number, patch: Partial<RateRow>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))

  return (
    <>
      {back}
      <StatGrid>
        <PStat tone="accent" label="Rating" value={member.name} note={member.code} />
        <PStat label="They rated themselves" value={theirs === null ? '-' : theirs.toFixed(2)} />
        <PStat label="Your score so far" value={mine === null ? '-' : mine.toFixed(2)} note={band ? band.label : `${unrated} still unrated`} />
        <PStat tone={g.flag === 'MAJOR_GAP' ? 'warn' : undefined} label="Difference" value={g.delta === null ? '-' : g.delta.toFixed(2)}
          note={g.flag === 'MAJOR_GAP' ? 'Worth raising with them' : ''} />
      </StatGrid>
      <PCard title="Rate each KRA" sub="Their achievement and their own rating are shown so you are rating the same thing they did.">
        {loadingRows ? <K>Loading…</K> : rows.map((r, i) => <RateCard key={r.goalId} r={r} i={i} bands={bands} onSet={set} />)}
        <Input label="Overall comment" value={overallComment} onChangeText={onOverallComment} multiline
          placeholder="Evidence, not adjectives. This is what they read." />
        {!fb.ok && overallComment.trim().length > 0 && (
          <Banner tone="amber" glyph="!" style={{ marginBottom: S.md }}>{fb.faults.join(' ')}</Banner>
        )}
        <Button full disabled={unrated > 0 || saving} onPress={onSubmit}
          title={saving ? 'Saving…' : unrated > 0 ? `${unrated} KRA${unrated === 1 ? '' : 's'} still to rate` : 'Submit my rating'} />
      </PCard>
    </>
  )
}
