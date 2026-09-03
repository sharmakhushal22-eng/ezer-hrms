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
import { C, F, W, S, R } from '@/lib/ui'

const TONE: Record<FillStatus, string> = {
  NOT_STARTED: C.critical,
  DRAFT_SAVED: C.warning,
  SUBMITTED:   C.info,
  IN_REVIEW:   C.brand,
  FINALISED:   C.positive,
}

const HEAD_TONE = {
  good: { bg: C.positiveTint, ink: C.positive, edge: `${C.positive}33` },
  warn: { bg: C.warningTint,  ink: C.warning,  edge: `${C.warning}44` },
  bad:  { bg: C.criticalTint, ink: C.critical, edge: `${C.critical}44` },
  neutral: { bg: C.sunken,    ink: C.inkSoft,  edge: C.line },
}

export function ReadinessBanner({ r }: { r: Rollup }) {
  const v = readiness(r)
  const t = HEAD_TONE[v.tone]
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.edge}`, borderRadius: R.sm,
                  padding: `${S.md}px ${S.lg}px`, marginBottom: S.sm }}>
      <div style={{ fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.12em',
                    textTransform: 'uppercase', color: t.ink, marginBottom: 5 }}>
        Where this cycle stands
      </div>
      <div style={{ fontSize: F.lead, fontWeight: W.bold, color: C.ink, lineHeight: 1.25 }}>
        {v.headline}
      </div>
      <div style={{ fontSize: F.small, color: C.inkSoft, marginTop: 5, lineHeight: 1.55, maxWidth: '72ch' }}>
        {v.detail}
      </div>
      {r.unknown > 0 && (
        // Never folded into another bucket to make the arithmetic tidy — a
        // status the app does not recognise is a thing somebody must look at.
        <div style={{ fontSize: F.small, color: C.warning, marginTop: 8, fontWeight: W.semi }}>
          {r.unknown} {r.unknown === 1 ? 'row has' : 'rows have'} a status this screen does not
          recognise. They are counted separately rather than guessed at.
        </div>
      )}
    </div>
  )
}

/** One bar, five segments, each labelled. A stacked bar with a legend makes
 *  the reader do a colour lookup; labelling in place does not. */
export function FillDistribution({ r }: { r: Rollup }) {
  const rows = distribution(r)
  if (!r.total) return null
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm,
                  padding: `${S.md}px ${S.lg}px ${S.lg}px` }}>
      <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, marginBottom: 3 }}>
        Everyone in this cycle, by where they have got to
      </div>
      <div style={{ fontSize: F.micro, color: C.muted, marginBottom: S.md }}>
        {r.total} {r.total === 1 ? 'person' : 'people'} · left to right is the order the work happens
      </div>

      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden',
                    background: C.sunken, marginBottom: S.md }}>
        {rows.map(x => x.n > 0 && (
          <div key={x.key} title={`${x.label}: ${x.n}`}
               style={{ width: `${x.share * 100}%`, background: TONE[x.key] }} />
        ))}
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        {rows.map(x => (
          <div key={x.key} style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0,
                                       background: x.n ? TONE[x.key] : C.line, transform: 'translateY(1px)' }} />
            <span style={{ fontSize: F.small, fontWeight: W.semi, color: x.n ? C.ink : C.faint,
                           minWidth: 92 }}>{x.label}</span>
            <span style={{ fontSize: F.small, fontWeight: W.bold, color: x.n ? C.ink : C.faint,
                           fontVariantNumeric: 'tabular-nums', minWidth: 34 }}>{x.n}</span>
            <span style={{ fontSize: F.micro, color: C.muted, flex: 1, minWidth: 200 }}>
              {FILL_MEANING[x.key]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Departments, worst first. The list exists to be worked down, so the one
 *  with the most people who have not started sorts to the top. */
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
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.sm,
                  padding: `${S.md}px ${S.lg}px ${S.lg}px`, minWidth: 0 }}>
      <div style={{ fontSize: F.small, fontWeight: W.bold, color: C.ink, marginBottom: 3 }}>
        By department — most people not started first
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
                  fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.08em',
                  textTransform: 'uppercase', color: C.muted,
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
                  <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden',
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
