'use client'
// components/pms/AdminOverview.tsx — how far the organisation has got.
//
// HR Admin is not a step in the approval chain. The chain is
//   Employee -> RM L1 -> RM L2 -> HOD
// and this screen sits across all of it: chasing the people who have not
// written KRAs, watching where the cycle is jammed, and correcting sets that
// were raised wrongly. So the question it answers is never "what do I
// approve" — it is "who is holding this up, and what does it block".
//
// That is why the headline is a COUNT and not a percentage. "62% complete"
// is not something anybody can act on; "23 of 302 have not written a single
// KRA, and they cannot be rated at all" is.

import { FILL_ORDER, FILL_LABEL, FILL_MEANING, type FillStatus } from '@/lib/pms/status'
import { readiness, distribution, type Rollup, type DeptRollup } from '@/lib/pms/rollup'
import { C, F, W, S, R, IconCheck, IconAlert, IconClock } from '@/lib/ui'

const TONE: Record<FillStatus, string> = {
  NOT_STARTED: C.critical,
  DRAFT_SAVED: C.warning,
  SUBMITTED:   C.info,
  IN_REVIEW:   C.brand,
  FINALISED:   C.positive,
}

// Edges are real tokens. They were `${C.positive}33` — `var(--ez-positive)33`
// is not a colour, so the browser dropped the border altogether.
const HEAD_TONE = {
  good: { bg: C.positiveTint, ink: C.positive, edge: C.positiveEdge },
  warn: { bg: C.warningTint,  ink: C.warning,  edge: C.warningEdge },
  bad:  { bg: C.criticalTint, ink: C.critical, edge: C.criticalEdge },
  neutral: { bg: C.sunken,    ink: C.inkSoft,  edge: C.line },
}

export function ReadinessBanner({ r }: { r: Rollup }) {
  const v = readiness(r)
  const t = HEAD_TONE[v.tone]
  const Ico = v.tone === 'good' ? IconCheck : v.tone === 'neutral' ? IconClock : IconAlert
  return (
    <div style={{ position: 'relative', overflow: 'hidden',
                  background: `linear-gradient(90deg, ${t.bg}, ${C.surface})`,
                  border: `1px solid ${t.edge}`, borderRadius: 16,
                  padding: `${S.lg}px ${S.lg + 2}px`, marginBottom: S.md,
                  display: 'flex', gap: S.md, alignItems: 'flex-start',
                  boxShadow: '0 8px 24px -18px rgba(16,36,100,.35)' }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: t.ink }} />
      <span aria-hidden style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0,
                                 display: 'grid', placeItems: 'center', background: C.surface,
                                 color: t.ink, boxShadow: `inset 0 0 0 1px ${t.edge}` }}>
        <Ico size={19} strokeWidth={2} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: 0,
                       color: t.ink, marginBottom: 4 }}>
          Where this cycle stands
        </div>
        <div style={{ fontSize: F.title, fontWeight: W.bold, color: C.ink, lineHeight: 1.25,
                      letterSpacing: '-.015em' }}>
          {v.headline}
        </div>
        <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 5, lineHeight: 1.55, maxWidth: '78ch' }}>
          {v.detail}
        </div>
        {r.unknown > 0 && (
          <div style={{ fontSize: F.small, color: C.warning, marginTop: 8, fontWeight: W.semi }}>
            {r.unknown} {r.unknown === 1 ? 'row has' : 'rows have'} a status this screen does not
            recognise. They are counted separately rather than guessed at.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The five fill states as one segmented bar and five stage tiles, in the
 * order the work happens. Each tile carries its count, its share and what
 * the state MEANS — the meaning is what tells HR whether to nudge or chase.
 */
export function FillDistribution({ r }: { r: Rollup }) {
  const rows = distribution(r)
  if (!r.total) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
                  padding: `${S.lg}px ${S.lg + 2}px ${S.lg + 2}px`,
                  boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px -16px rgba(16,36,100,.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    gap: S.md, flexWrap: 'wrap', marginBottom: S.md }}>
        <div>
          <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink, letterSpacing: '-.01em' }}>
            Everyone in this cycle, by where they have got to
          </div>
          <div style={{ fontSize: F.tiny, color: C.muted, marginTop: 2 }}>
            {r.total} {r.total === 1 ? 'person' : 'people'} · left to right is the order the work happens
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 3, height: 14, borderRadius: 8, overflow: 'hidden',
                    background: C.sunken, marginBottom: S.lg }}>
        {rows.map(x => x.n > 0 && (
          <div key={x.key} title={`${x.label}: ${x.n}`}
               style={{ width: `${x.share * 100}%`, background: TONE[x.key], borderRadius: 4 }} />
        ))}
      </div>

      <div style={{ display: 'grid', gap: S.sm,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {rows.map(x => (
          <div key={x.key} style={{
            padding: `${S.md}px ${S.md}px ${S.md - 2}px`, borderRadius: 14,
            background: x.n ? `color-mix(in oklab, ${TONE[x.key]} 7%, ${C.surface})` : C.surface,
            border: `1px solid ${x.n ? `color-mix(in oklab, ${TONE[x.key]} 28%, ${C.line})` : C.line}`,
            minWidth: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                                         background: x.n ? TONE[x.key] : C.line }} />
              <span style={{ fontSize: F.small, fontWeight: W.semi, color: x.n ? C.ink : C.faint }}>
                {x.label}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: F.display, fontWeight: W.bold, letterSpacing: '-.02em',
                             color: x.n ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums',
                             lineHeight: 1.1 }}>{x.n}</span>
              <span style={{ fontSize: F.micro, fontWeight: W.semi, color: C.muted,
                             fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(x.share * 100)}%
              </span>
            </div>
            <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>
              {FILL_MEANING[x.key]}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DepartmentTable({
  rows, nameOf,
}: { rows: DeptRollup[]; nameOf: (id: string | null) => string }) {
  if (!rows.length) return null
  return (
    // minWidth:0 is load-bearing. A grid or flex child defaults to
    // min-width:auto, which refuses to shrink below its content — so the
    // 460px table pushed the CARD wider than the phone rather than scrolling
    // inside it, and the whole page picked up 210px of sideways scroll at
    // 320px. The overflow container below cannot do its job until its
    // ancestors are allowed to be narrower than what they hold.
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
                  padding: `${S.lg}px ${S.lg + 2}px ${S.lg + 2}px`, minWidth: 0,
                  boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px -16px rgba(16,36,100,.3)' }}>
      <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, marginBottom: 3 }}>
        By department: most people not started first
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginBottom: S.md }}>
        An hour of chasing buys the most at the top of this list.
      </div>
      <div style={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
          <thead>
            <tr>
              {['Department', 'People', 'Not started', 'Finalised', ''].map((h, i) => (
                <th key={h || i} style={{
                  textAlign: i === 0 || i === 4 ? 'left' : 'right',
                  fontSize: F.micro, fontWeight: W.bold, letterSpacing: 0,
                   color: C.muted,
                  padding: '0 10px 8px', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(d => (
              <tr key={String(d.departmentId)} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: '9px 10px', fontSize: F.small, fontWeight: W.semi, color: C.ink }}>
                  {nameOf(d.departmentId)}
                </td>
                <td style={{ padding: '9px 10px', fontSize: F.small, color: C.inkSoft,
                             textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.total}</td>
                <td style={{ padding: '9px 10px', fontSize: F.small, textAlign: 'right',
                             fontVariantNumeric: 'tabular-nums', fontWeight: d.notStarted ? W.bold : W.regular,
                             color: d.notStarted ? C.critical : C.faint }}>{d.notStarted}</td>
                <td style={{ padding: '9px 10px', fontSize: F.small, textAlign: 'right',
                             fontVariantNumeric: 'tabular-nums', color: C.inkSoft }}>
                  {d.counts.FINALISED}
                </td>
                <td style={{ padding: '9px 10px', width: 132 }}>
                  <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 5, overflow: 'hidden',
                                background: C.sunken }} aria-hidden>
                    {FILL_ORDER.map(k => d.counts[k] > 0 && (
                      <div key={k} style={{ width: `${(d.counts[k] / d.total) * 100}%`, background: TONE[k] }} />
                    ))}
                  </div>
                  <span className="ez-sr">
                    {FILL_ORDER.map(k => `${FILL_LABEL[k]} ${d.counts[k]}`).join(', ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style>{`.ez-sr{position:absolute;width:1px;height:1px;overflow:hidden;
                clip-path:inset(50%);white-space:nowrap}`}</style>
    </div>
  )
}
