// src/features/performance/RateTab.tsx — §4.3 Team Ratings (website:
// components/pms/ManagerTabs.tsx RateTab). A record, not a form: what each
// rung of the chain scored each KRA, side by side, with every comment.
// Ratings are given while approving, in KRA Approval & One-to-One. Nothing
// on this screen writes.
import * as React from 'react'
import { View } from 'react-native'
import { teamQueue, type TeamMember } from '@web/pms/team'
import { heldBy, STAGE_SHORT, type Stage } from '@web/pms/chain'
import { bandFor, score, DEFAULT_BANDS, type Band, type Line, type RaterRole } from '@web/pms/scoring'
import type { FlagRules } from '@web/pms/employment'
import { DEFAULT_RULES, type Rules } from '@web/pms/cycle'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { B, Banner, K, PCard, PStat, RDot, StatGrid } from './ui'
import { QueueList } from './MgrTabs'
import { CHAIN_RATERS, type RateRow } from './logic'

export function RateTab({ member, rows, bands = DEFAULT_BANDS, members, onPick, today, rules = DEFAULT_RULES, flagRules, loadingRows }: {
  member: TeamMember | null; rows: RateRow[]; bands?: Band[]
  members?: TeamMember[]; onPick?: (employeeId: string | null) => void; today?: string
  rules?: Rules; flagRules?: FlagRules; loadingRows?: boolean
}) {
  const { C } = useTheme()
  if (!member) {
    const pickable = members && today ? teamQueue(members, today, flagRules) : []
    return (
      <PCard title="Whose ratings do you want to see?" sub="Every rating the chain has given, side by side. Nothing on this screen can be changed — ratings are given while approving the KRA set.">
        {!onPick ? <K>Picking is not available on this screen.</K> : (
          <QueueList rules={rules} rows={pickable} empty="Nobody is with you yet. Ratings appear here as the chain gives them."
            extra={r => (
              <View style={{ marginTop: S.sm }}>
                <Button size="sm" variant="ghost" title="View" style={{ alignSelf: 'flex-start' }} onPress={() => onPick(r.member.employeeId)} />
              </View>
            )} />
        )}
      </PCard>
    )
  }

  // Which rungs this employee has — held, or holding a real rating somebody gave.
  const held = heldBy(member)
  const raters = CHAIN_RATERS.filter(r => held(r as Stage) || rows.some(x => x.by[r]?.rating != null))
  const lines = (who: RaterRole): Line[] => rows.map(r => ({ goalId: r.goalId, title: r.title, category: r.category, weightage: r.weightage, final: r.by[who]?.rating ?? null }))
  const scoreOf = (who: RaterRole) => score(lines(who), 'final')
  const selfScore = scoreOf('SELF')
  // Phone adaptation: a way back to the list (the website has none once somebody is picked).
  const back = onPick ? <Button size="sm" variant="ghost" title="← Choose somebody else" onPress={() => onPick(null)} style={{ alignSelf: 'flex-start', marginBottom: S.md }} /> : null

  return (
    <>
      {back}
      <Banner tone="blue" glyph="ℹ️">
        <B>This screen is a record, not a form.</B> Ratings are given while approving the KRA set, in <B>KRA Approval &amp; One-to-One</B> — one reading, one score, one approval. What each rung settled on appears here as they do it.
      </Banner>
      <StatGrid>
        <PStat tone="accent" label="Ratings for" value={member.name} note={member.code} />
        <PStat label="They rated themselves" value={selfScore === null ? '—' : selfScore.toFixed(2)}
          note={bandFor(selfScore === null ? null : Math.round(selfScore), bands)?.label ?? ''} />
        {raters.map(r => {
          const sc = scoreOf(r)
          const given = rows.filter(x => x.by[r]?.rating != null).length
          return <PStat key={r} label={STAGE_SHORT[r as Stage]} value={sc === null ? '—' : sc.toFixed(2)} note={sc === null ? 'Not rated yet' : `${given} of ${rows.length} rated`} />
        })}
      </StatGrid>
      <PCard title="Every rating, KRA by KRA" sub={`${rows.length} KRAs. A blank means that rung has not rated it yet.`}>
        {loadingRows ? <K>Loading…</K> : !rows.length ? <K>No KRAs on record for this period.</K> : rows.map((r, i) => {
          const said = (['SELF', ...raters] as RaterRole[]).filter(w => r.by[w]?.comment?.trim())
          return (
            <View key={r.goalId} style={{ paddingVertical: S.md, borderTopWidth: i ? 1 : 0, borderTopColor: C.line, gap: S.sm }}>
              <View style={{ flexDirection: 'row', gap: S.sm }}>
                <Txt size={F.small} w={600} style={{ flex: 1 }}>{r.title}</Txt>
                <Txt size={F.tiny} tone="muted">Wt {r.weightage}</Txt>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.md }}>
                {(['SELF', ...raters] as RaterRole[]).map(w => (
                  <View key={w} style={{ alignItems: 'flex-start', gap: 3, minWidth: 56 }}>
                    <Txt size={F.micro} w={700} tone="muted" upper>{w === 'SELF' ? 'Self' : STAGE_SHORT[w as Stage]}</Txt>
                    <RDot v={r.by[w]?.rating ?? null} bands={bands} />
                  </View>
                ))}
              </View>
              {said.length ? said.map(w => (
                <K key={w}><B>{w === 'SELF' ? 'Them' : STAGE_SHORT[w as Stage]}:</B> {r.by[w]!.comment}</K>
              )) : <K>—</K>}
            </View>
          )
        })}
      </PCard>
    </>
  )
}
