// src/features/expenses/claims/parts.tsx — read-only display pieces of a claim and its lines.
//
// Shared by Other expenses / Claim for one trip, My claims and Claim detail, and
// generic enough for the approvals screens to reuse (they take plain props, no
// navigation and no queries inside). Every string is the website's
// (components/te/TeClaims.tsx, TeOtherExpenses.tsx, TeExpenseForm.tsx).
import * as React from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import type { TeClaim, TeExpense, TeLeg, TeStep, TeTimelineEntry } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Button, Txt } from '@/ui/primitives'
import { claimChip, claimHolder, day, plural, rs, when } from '../api'
import { teHref } from '../nav'
import { MONO } from '../tones'
import { Chip, Flag, Ico, Li, ListCard, KvRow, TeCard } from '../ui/kit'
import { FileLink } from '../ui/FilePick'
import { TeIcon } from '../ui/TeIcon'

/** TeClaimDetail's onBack: the "My claims" view. Pops to it when it is under this
 *  screen, otherwise replaces this screen with it (same shape as nav.toTrip). */
export function toClaims() {
  try { router.dismissTo(teHref.claims as never) } catch { router.replace(teHref.claims as never) }
}

// ── flags ───────────────────────────────────────────────────────────────────
/** `<b><span class="code">{code}</span> {title}</b>` */
export function CodeTitle({ code, title }: { code: string; title: string }) {
  return (
    <Txt size={F.small} w={700}>
      <Txt size={F.tiny} w={700} style={{ fontFamily: MONO }}>{code}</Txt>{' '}{title}
    </Txt>
  )
}

/** One flag block: `div.flag(crit|warn)` + icon warn + code/title + one paragraph. */
export function FlagBlock({ code, title, text, block, style }: { code: string; title: string; text?: string | null; block: boolean; style?: object }) {
  return (
    <Flag tone={block ? 'crit' : 'warn'} icon="warn" title={<CodeTitle code={code} title={title} />} style={style}>
      {text ? <Txt size={12.5} tone="soft">{text}</Txt> : null}
    </Flag>
  )
}

/** `div.flag.crit[role=alert]` with `<b>{text}</b>` and optional extra lines. */
export function ErrorFlag({ text, lines, style }: { text: string; lines?: string[]; style?: object }) {
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Flag tone="crit" icon="warn" title={text} style={style}>
        {lines?.length ? lines.map((l, i) => <Txt key={`${l}-${i}`} size={12.5} tone="soft">{l}</Txt>) : null}
      </Flag>
    </View>
  )
}

// ── tiles (.tile .l / .v / .s) ──────────────────────────────────────────────
export function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  const { C } = useTheme()
  return (
    <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 140, backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md }}>
      <Txt size={F.micro} w={700} tone="muted" upper numberOfLines={2}>{label}</Txt>
      <Txt size={F.title + 2} w={700} style={{ marginTop: 4, fontVariant: ['tabular-nums'] }}>{value}</Txt>
      {!!note && <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>{note}</Txt>}
    </View>
  )
}

// ── My claims rows ──────────────────────────────────────────────────────────
/** One row of TeClaimList. `tripName` = the trip's name or '' (→ "Other expenses"). */
export function ClaimRow({ claim: c, tripName, onPress, last }: { claim: TeClaim; tripName?: string | null; onPress?: () => void; last?: boolean }) {
  const chip = claimChip(c)
  const holder = claimHolder(c)
  return (
    <Li onPress={onPress} last={last} left={<Ico name="other" />}
      accessibilityLabel={`${tripName || 'Other expenses'} ${c.no}, ${chip.label}`}
      right={(
        <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: '45%' }}>
          <Txt size={F.small} w={700} style={{ fontVariant: ['tabular-nums'] }}>{rs(c.net ?? c.approved ?? c.claimed)}</Txt>
          <Chip label={chip.label} tone={chip.tone} />
        </View>
      )}>
      <Txt size={F.small} w={700}>
        {tripName || 'Other expenses'}{' '}
        <Txt size={F.tiny} tone="muted" style={{ fontFamily: MONO }}>{c.no}</Txt>
      </Txt>
      {!!holder && <Txt size={F.tiny} tone="muted">{holder}</Txt>}
    </Li>
  )
}

// ── tracker (.trk) ──────────────────────────────────────────────────────────
type StepState = 'done' | 'now' | 'todo' | 'bad'

function TrackStep({ state, title, sub, last }: { state: StepState; title: string; sub: string; last?: boolean }) {
  const { C } = useTheme()
  const dot = state === 'done' ? C.positive : state === 'now' ? C.warning : state === 'bad' ? C.critical : C.lineStrong
  const icon = state === 'done' ? 'check' : state === 'bad' ? 'close' : null
  return (
    <View style={{ flexDirection: 'row', gap: S.md }}>
      <View style={{ alignItems: 'center', width: 20 }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: state === 'todo' ? C.surface : dot, borderWidth: 2, borderColor: dot, alignItems: 'center', justifyContent: 'center' }}>
          {icon ? <TeIcon name={icon} px={11} color={C.onAccent} /> : state === 'now' ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.onAccent }} /> : null}
        </View>
        {!last && <View style={{ flex: 1, width: 2, minHeight: 14, backgroundColor: state === 'done' ? C.positive : C.line }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 12 }}>
        <Txt size={F.small} w={700} color={state === 'todo' ? C.muted : state === 'bad' ? C.critical : C.ink}>{title}</Txt>
        {!!sub.trim() && <Txt size={F.tiny} tone="muted">{sub}</Txt>}
      </View>
    </View>
  )
}

/** The tracker under the title: submitted, each approval level, each finance level, payout, settled. */
export function ClaimTracker({ c }: { c: TeClaim }) {
  const steps: TeStep[] = [...c.chain, ...c.fin]
  const firstPending = steps.findIndex(s => s.status === 'pending')
  const stopped = c.status === 'REJECTED' || c.status === 'CANCELLED' || c.status === 'SENT_BACK'
  const paidOut = c.status === 'SETTLED'
  return (
    <View style={{ marginTop: S.md }}>
      <TrackStep state="done" title="Submitted" sub={when(c.submittedAt)} />
      {steps.map((s, i) => {
        const state: StepState = s.status === 'approved' ? 'done'
          : s.status === 'pending' ? (i === firstPending && !stopped ? 'now' : 'todo')
          : s.status === 'skipped' ? 'todo' : 'bad'
        return <TrackStep key={s.id} state={state} title={s.role} sub={`${s.byName || s.whoName || ''}${s.at ? ` · ${when(s.at)}` : ''}`} />
      })}
      <TrackStep state={paidOut ? 'done' : c.status === 'VERIFIED' ? 'now' : 'todo'} title="Payout" sub={c.paidRef || ' '} />
      <TrackStep state={paidOut ? 'done' : 'todo'} title="Settled" sub={paidOut ? when(c.settledAt) : ' '} last />
    </View>
  )
}

// ── lines (table.tbl, as cards) ─────────────────────────────────────────────
function Money({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Txt size={F.micro} w={700} tone="muted" upper>{label}</Txt>
      <Txt size={F.small} w={bold ? 700 : 500} style={{ fontVariant: ['tabular-nums'] }}>{value}</Txt>
    </View>
  )
}

/** One claim line: Date · Expense · Claimed · Approved · Why. `tr.bad` when `x.fix`. */
export function ClaimLine({ x, catName, claimId, onFix, last }: {
  x: TeExpense
  catName: Map<string, string>
  /** Passed to the bill link. The website passes none here (spec Part 5 "Known gaps"); see ClaimLines. */
  claimId?: string
  /** "Fix this line" — shown only when given (the caller decides fix && own). */
  onFix?: () => void
  last?: boolean
}) {
  const { C } = useTheme()
  const company = x.pay === 'company'
  const why = x.dreason || (x.fix ? 'Needs your correction' : '')
  return (
    <View style={{ paddingHorizontal: S.lg, paddingVertical: S.md, gap: 6, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.line, backgroundColor: x.fix ? C.criticalTint : 'transparent' }}>
      <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.tiny} tone="muted">{day(x.date)}</Txt>
          <Txt size={F.small} w={700}>{x.merchant || catName.get(x.cat) || x.cat}</Txt>
          <Txt size={F.tiny} tone="muted">{catName.get(x.cat) || x.cat}{company ? ' · paid by company' : ''}</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <Money label="Claimed" value={company ? '—' : rs(x.claimed)} />
          <Money label="Approved" bold value={company ? '—' : x.approved === null ? '…' : rs(x.approved)} />
        </View>
      </View>
      {!!why && <Txt size={F.tiny} color={x.fix && !x.dreason ? C.critical : C.inkSoft}>{why}</Txt>}
      {(!!x.file?.path || !!onFix) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
          {x.file?.path ? <FileLink path={x.file.path} name={x.file.name} kind={x.file.kind} claimId={claimId} small /> : null}
          {onFix ? <Button title="Fix this line" size="sm" onPress={onFix} icon={<TeIcon name="receipt" size="sm" color={C.onAccent} />} /> : null}
        </View>
      )}
    </View>
  )
}

export function ClaimLines({ lines, catName, claimId, fixFor }: {
  lines: TeExpense[]
  catName: Map<string, string>
  claimId?: string
  /** Returns the "Fix this line" action for a line, or undefined for none. */
  fixFor?: (x: TeExpense) => (() => void) | undefined
}) {
  return (
    <ListCard>
      {lines.map((x, i) => (
        <ClaimLine key={x.id} x={x} catName={catName} claimId={claimId} onFix={fixFor?.(x)} last={i === lines.length - 1} />
      ))}
    </ListCard>
  )
}

/** Totals card (aside dl.kv). */
export function ClaimTotals({ c }: { c: TeClaim }) {
  return (
    <TeCard>
      <KvRow label="Claimed" value={rs(c.claimed)} />
      <KvRow label="Approved" value={rs(c.approved)} />
      {c.advanceAdjusted > 0 ? <KvRow label="Advance adjusted" value={rs(-c.advanceAdjusted)} /> : null}
      <KvRow tot last label={c.status === 'SETTLED' ? 'Paid' : 'To be paid'} value={rs(c.net ?? c.approved)} />
    </TeCard>
  )
}

/** "Travel on this claim": one row per leg, opening its evidence. */
export function LegRows({ legs, onOpen, head = 'Travel on this claim' }: { legs: TeLeg[]; onOpen: (legId: string) => void; head?: string }) {
  const { C } = useTheme()
  if (!legs.length) return null
  return (
    <ListCard head={head} headRight={String(legs.length)}>
      {legs.map((l, i) => (
        <Li key={l.id} onPress={() => onOpen(l.id)} last={i === legs.length - 1} left={<Ico name="route" />}
          right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Txt size={F.tiny} w={600} tone="brand">Evidence</Txt><TeIcon name="go" size="sm" color={C.brand} /></View>}>
          <Txt size={F.small} w={700}>Journey {l.n}</Txt>
          <Txt size={F.tiny} tone="muted">
            {[
              l.mode,
              `${l.payKm ?? l.plannedKm} km`,
              l.gps === 'checkin' ? 'check-ins' : null,
              l.stats?.gaps ? plural(l.stats.gaps, 'gap') : null,
              l.manual ? 'added without GPS' : null,
            ].filter(Boolean).join(' · ')}
          </Txt>
        </Li>
      ))}
    </ListCard>
  )
}

/** History card: newest first, as returned. */
export function ClaimHistory({ timeline }: { timeline: TeTimelineEntry[] }) {
  return (
    <ListCard head="History" headRight={String(timeline.length)}>
      {timeline.map((h, i) => (
        <Li key={`${h.at}-${i}`} last={i === timeline.length - 1}>
          <Txt size={F.tiny} tone="muted">{when(h.at)}{h.name ? ` · ${h.name}` : ''}{h.internal ? ' · internal' : ''}</Txt>
          <Txt size={F.small}>{h.text}</Txt>
        </Li>
      ))}
    </ListCard>
  )
}
