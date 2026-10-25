// src/features/performance/EmpTabsB.tsx — Self Rating, My Result, My Analytics
// (website: components/pms/EmployeeTabs.tsx §3.4–3.6).
import * as React from 'react'
import { View } from 'react-native'
import { score, gap, byCategory, bandForScore, bandFor, type Line } from '@web/pms/scoring'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Input, Txt } from '@/ui/primitives'
import { ABar, B, Banner, Chips, EmptyBlock, Field, K, PCard, PStat, StatGrid } from './ui'
import type { SelfRow } from './data'

// ── §3.4 Self Rating ─────────────────────────────────────────────────────
function SelfCard({ r, i, submitted, onSet }: { r: SelfRow; i: number; submitted: boolean; onSet: (i: number, p: Partial<SelfRow>) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: S.md, marginBottom: S.md }}>
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.sm }}>
        <Txt size={F.small} w={600} style={{ flex: 1 }}>{r.title}</Txt>
        <Txt size={F.tiny} tone="muted">Wt {r.weightage}</Txt>
      </View>
      <Input label="What you delivered" value={r.achievement} editable={!submitted} placeholder="The number you actually hit"
        accessibilityLabel={`Achievement for ${r.title}`} onChangeText={t => onSet(i, { achievement: t })} />
      <Txt size={F.micro} w={700} tone="muted" upper style={{ marginBottom: 6 }}>Your rating</Txt>
      <Chips value={r.rating} disabled={submitted} name={`Rating for ${r.title}`} onPick={n => onSet(i, { rating: n })} />
      <Input label="Comment" value={r.comment} editable={!submitted} placeholder="Evidence a manager could check" style={{ marginTop: S.md, marginBottom: 0 }}
        accessibilityLabel={`Comment for ${r.title}`} onChangeText={t => onSet(i, { comment: t })} />
    </View>
  )
}

export function SelfRatingTab({ rows, onChange, submitted, onSubmit, saving }: {
  rows: SelfRow[]; onChange: (next: SelfRow[]) => void; submitted: boolean; onSubmit: () => void; saving?: boolean
}) {
  const set = (i: number, patch: Partial<SelfRow>) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
  const unrated = rows.filter(r => r.rating === null).length
  const lines: Line[] = rows.map(r => ({ goalId: r.goalId, title: r.title, category: r.category, weightage: r.weightage, self: r.rating }))
  const mine = score(lines, 'self')
  return (
    <>
      {submitted ? (
        <Banner tone="amber" glyph="🔒">
          Your self rating is <B>submitted and locked</B>, and your manager’s rating is now open. It locks at submission on purpose: a self assessment edited after seeing a manager’s number is not a self assessment.
        </Banner>
      ) : (
        <Banner tone="blue" glyph="ℹ️">
          Rate your own delivery on each KRA. Once you submit, this <B>locks</B> and your manager can rate. They cannot rate before you.
        </Banner>
      )}
      <StatGrid>
        <PStat label="KRAs rated" value={`${rows.length - unrated} of ${rows.length}`} note={unrated ? `${unrated} still to do` : 'All done'} tone={unrated ? 'warn' : 'good'} />
        <PStat label="Your weighted score" value={mine === null ? '-' : mine.toFixed(2)} note="Weighted by the weightage on each KRA" />
        <PStat label="That lands at" value={bandForScore(mine)?.label ?? '-'} note={mine === null ? 'Rate every KRA to see this' : 'What your own ratings average to'} />
      </StatGrid>
      <PCard title="Self rating" sub="Your achievement, your rating, and a comment on each KRA. It locks when you submit.">
        {rows.length === 0
          ? <EmptyBlock title="No KRAs to rate" note="Your KRA set has to be locked before self rating opens." />
          : rows.map((r, i) => <SelfCard key={r.goalId} r={r} i={i} submitted={submitted} onSet={set} />)}
        {!submitted && rows.length > 0 && (
          <Button full disabled={unrated > 0 || saving} onPress={onSubmit} style={{ marginTop: S.sm }}
            title={saving ? 'Submitting…' : unrated > 0 ? `${unrated} KRA${unrated === 1 ? '' : 's'} still unrated` : 'Submit (this locks it)'} />
        )}
      </PCard>
    </>
  )
}

// ── §3.5 My Result ───────────────────────────────────────────────────────
const fmt = (v: number | null | undefined) => v === null || v === undefined ? '-' : String(v)

export function ResultTab({ published, lines, finalRating, appreciation, improvement, publishGate }: {
  published: boolean; lines: Line[]; finalRating: number | null
  appreciation?: string | null; improvement?: string | null
  publishGate: { open: boolean; because: string }
}) {
  const { C } = useTheme()
  if (!published) {
    return (
      <PCard title="Your result is not published yet">
        <Txt size={F.small} tone="muted" style={{ lineHeight: 22 }}>
          Nothing is shown here until the result is published: no rating, no scores, no manager comments. That is deliberate: a rating that reaches you before the conversation does turns a review into a notification.
          {!publishGate.open ? <>{'\n\n'}<B>What is outstanding:</B> {publishGate.because}</> : null}
        </Txt>
      </PCard>
    )
  }
  const selfScore = score(lines, 'self')
  const finalScore = score(lines, 'final')
  const g = gap(selfScore, finalScore)
  const band = bandFor(finalRating)
  // ESS passes finalisedBy / finalisedOn / deptAverage as null and no benefits.
  return (
    <>
      <Banner tone="green" glyph="✓">Published.</Banner>
      <StatGrid>
        <PStat tone="accent" label="Final rating" value={finalRating === null ? '-' : `${finalRating}${band ? ` · ${band.label}` : ''}`}
          note={finalScore === null ? '' : `Weighted score ${finalScore.toFixed(2)}`} />
        <PStat label="Your own score" value={selfScore === null ? '-' : selfScore.toFixed(2)}
          note={g.delta === null ? '' : `${g.delta > 0 ? '+' : ''}${g.delta.toFixed(2)} against the final`} />
        <PStat label="Department average" value="-" note="Not available" />
        <PStat label="Finalised by" value="-" />
      </StatGrid>
      <PCard title="KRA by KRA" sub="Every rating in the chain, and what each one contributed.">
        {lines.map((l, i) => (
          <View key={l.goalId} style={{ paddingVertical: S.sm, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
            <Txt size={F.small} w={600} style={{ marginBottom: 4 }}>{l.title}</Txt>
            <Field label="Wt">{l.weightage}</Field>
            <Field label="You">{fmt(l.self)}</Field>
            <Field label="RM L1">{fmt(l.rmL1)}</Field>
            <Field label="RM L2">{fmt(l.rmL2)}</Field>
            <Field label="Final"><Txt size={F.tiny} w={700}>{fmt(l.final)}</Txt></Field>
            <Field label="Contributed">{l.final === null || l.final === undefined ? '-' : ((l.final * l.weightage) / 100).toFixed(2)}</Field>
          </View>
        ))}
      </PCard>
      <PCard title="🏆 Appreciation">
        {appreciation ? <Txt size={F.small} tone="soft">{appreciation}</Txt> : <K>Nothing written for this period.</K>}
      </PCard>
      <PCard title="📈 Where to improve">
        {improvement ? <Txt size={F.small} tone="soft">{improvement}</Txt> : <K>Nothing written for this period.</K>}
      </PCard>
      <PCard title="🎁 Recognition">
        <K>Nothing recorded for this period.</K>
        <K style={{ marginTop: 8 }}>Recognition only: a certificate, a nomination or an award. Never a cash component.</K>
      </PCard>
    </>
  )
}

// ── §3.6 My Analytics ────────────────────────────────────────────────────
export function AnalyticsTab({ lines, published }: { lines: Line[]; published: boolean }) {
  if (!published) {
    return (
      <PCard title="Nothing to compare yet">
        <K>These charts compare your ratings with your manager’s, so they only appear once a result has been published. Before that there is nothing to put beside your own numbers.</K>
      </PCard>
    )
  }
  const cats = byCategory(lines, 'final')
  const overall = gap(score(lines, 'self'), score(lines, 'final'))
  const major = lines.filter(l => gap(l.self, l.final).flag === 'MAJOR_GAP')
  return (
    <>
      <PCard title="How you and your manager saw the same work" sub="The pale bar is your rating, the solid one is the final. A wide difference is a conversation, not a verdict.">
        {lines.map(l => {
          const g = gap(l.self, l.final)
          return <ABar key={l.goalId} name={l.title} self={(l.self ?? 0) / 5} final={(l.final ?? 0) / 5}
            value={`${l.self ?? '-'} → ${l.final ?? '-'}${g.flag === 'MAJOR_GAP' ? ' ‼' : g.delta === 0 ? ' =' : ''}`} />
        })}
        {major.length
          ? <Banner tone="amber" glyph="!" style={{ marginTop: 6, marginBottom: 0 }}>Two points or more apart on <B>{major.map(l => l.title).join(', ')}</B>. {gap(0, 2).says}</Banner>
          : <Banner tone="green" glyph="✓" style={{ marginTop: 6, marginBottom: 0 }}>Overall {overall.says.toLowerCase()}</Banner>}
      </PCard>
      <PCard title="Where your strengths are" sub="By category, weighted. A low category is where development goes, not a mark against you.">
        {cats.map(c => <ABar key={c.category} name={c.label} final={(c.score ?? 0) / 5} solidOnly value={c.score === null ? '-' : c.score.toFixed(2)} />)}
      </PCard>
      <PCard title="How this has moved" sub="Your weighted score over the last few periods.">
        <K>This is your first completed period, so there is nothing to compare it against yet.</K>
      </PCard>
    </>
  )
}

