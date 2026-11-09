// src/features/expenses/plan/PlanStay.tsx — step 4 of the planner v2, shown only when
// step 1 said a hotel or food is wanted (components/te/plan/TePlanStay.tsx).
// A trip recorded after travel asks the questions in the past tense and names no hotels.
//
// Nothing here decides money: the hotel estimate stays the engine's, the prices
// typed against the three hotels are for the desk and the approver to read.
// Saying no to a stay removes the hotel line on the server.
//
// platformOf (lib/te/trip-stay.ts) uses new URL(...).hostname; safePlatformOf
// (parts.tsx) falls back to a regex when this runtime's URL cannot do that.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { PlannerDraft } from '@web/te/trip-draft'
import { platformOf, stayOptionsNote, STAY_OPTIONS_WANTED, type StayOption } from '@web/te/trip-stay'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { rs } from '../api'
import { Chip, Flag, Note, TeCard } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'
import { safePlatformOf } from './parts'

const siteOf = (url: string) => safePlatformOf(platformOf, url)
/** badUrl() (lib/te/trip-stay.ts) with the same fallback: non-blank and no host can be read. */
const isBadUrl = (url: string) => !!url.trim() && siteOf(url) === null

function CardHead({ title, chip }: { title: string; chip?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap', marginBottom: S.sm }}>
      <Txt size={F.body} w={700} style={{ flexShrink: 1 }}>{title}</Txt>
      {chip ? <Chip label={chip} plain /> : null}
    </View>
  )
}

/** A choice card (button.qcard): the answer and what it means, on the card. */
function QCard({ icon, title, sub, on, onPress }: { icon: string; title: string; sub: string; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        flex: 1, minWidth: 140, flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: R.md, minHeight: 64,
        borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : pressed ? C.sunken : C.surface,
      })}>
      <TeIcon name={icon} color={on ? C.brand : C.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={700} color={on ? C.brandDeep : C.ink}>{title}</Txt>
        <Txt size={F.micro} tone="muted">{sub}</Txt>
      </View>
    </Pressable>
  )
}

function QCards({ label, children }: { label: string; children: React.ReactNode }) {
  return <View accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: S.sm }}>{children}</View>
}

function HotelCard({ i, o, onSet }: { i: number; o: StayOption; onSet: (patch: Partial<StayOption>) => void }) {
  const { C } = useTheme()
  const site = siteOf(o.url)
  return (
    <View style={{ borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: S.md }}>
      <CardHead title={`Hotel ${i + 1}${i === 0 ? ' — your first choice' : ''}`} chip={site} />
      <Input label="Hotel" value={o.name} placeholder="The name of the hotel" onChangeText={v => onSet({ name: v })} />
      <Input label="Where it is" value={o.location} placeholder="Area, or near what" onChangeText={v => onSet({ location: v })} />
      <Input label="Link" value={o.url} placeholder="https://www.makemytrip.com/hotels/…" autoCapitalize="none" autoCorrect={false} keyboardType="url"
        onChangeText={v => onSet({ url: v })} style={{ marginBottom: 4 }} />
      {isBadUrl(o.url)
        ? <Txt size={F.tiny} tone="critical" style={{ marginBottom: S.md }}>That does not look like a web address. Paste the whole link, starting with https://</Txt>
        : <Txt size={F.tiny} tone="muted" style={{ marginBottom: S.md }}>Any booking site. The desk and your approver can open it.</Txt>}
      <Input label="A night, roughly (₹)" value={o.price === '' || o.price == null ? '' : String(o.price)} keyboardType="numeric"
        onChangeText={v => { const t = v.replace(/[^0-9.]/g, ''); onSet({ price: t === '' ? '' : Number(t) }) }}
        help="Optional. For the desk to compare; it does not change the trip estimate." style={{ marginBottom: 0 }} />
    </View>
  )
}

export function PlanStay({ draft, foodBudget, nights, edit }: {
  draft: PlannerDraft
  foodBudget: number
  nights: number
  edit: (patch: Partial<PlannerDraft>) => void
}) {
  const past = draft.origin === 'POST_FACTO'
  const note = draft.stayWanted && !past ? stayOptionsNote(draft.stayOptions) : null
  const setOption = (i: number, patch: Partial<StayOption>) =>
    edit({ stayOptions: draft.stayOptions.map((o, j) => (j === i ? { ...o, ...patch } : o)) })
  const answered = draft.stayWanted !== undefined && draft.foodWanted !== undefined

  return (
    <View>
      <View style={{ marginBottom: S.md }}>
        <Txt size={F.body} w={700}>Stay and food</Txt>
        <Txt size={F.tiny} tone="muted" style={{ marginTop: 2 }}>
          {past
            ? 'Two questions about a trip that is already over: the hotel you paid for goes on the trip as a bill, and the food budget is what those bills are measured against.'
            : 'Two questions, and neither commits you to anything: the hotel is picked and booked by the Travel Desk, and the food budget is only spent against bills you add while the trip is on.'}
        </Txt>
      </View>

      <TeCard tint>
        <CardHead title="Do you need a place to stay?" chip={nights > 0 ? (nights === 1 ? '1 night away' : `${nights} nights away`) : null} />
        <QCards label="Do you need a stay">
          <QCard icon="home" on={draft.stayWanted === true} onPress={() => edit({ stayWanted: true })}
            title={past ? 'Yes, I stayed overnight' : 'Yes, I need a hotel'}
            sub={past ? 'Add the hotel bill to the trip' : 'Name a few and the desk books one'} />
          <QCard icon="close" on={draft.stayWanted === false} onPress={() => edit({ stayWanted: false })}
            title={past ? 'No stay' : 'No stay needed'}
            sub={past ? 'Back the same day, or stayed privately' : 'Back the same day, or staying privately'} />
        </QCards>
        {draft.stayWanted === false ? <Txt size={F.tiny} tone="muted">No hotel on this trip, so none is estimated for it.</Txt> : null}
        {draft.stayWanted && past ? (
          <Txt size={F.tiny} tone="muted">
            The hotel is already paid for, so there is nothing for the desk to book. Add the bill to this trip once it is saved and it is claimed with the trip.
          </Txt>
        ) : null}
        {draft.stayWanted && !past ? (
          <View style={{ gap: S.sm }}>
            <Txt size={F.tiny} tone="muted">
              {`Name ${STAY_OPTIONS_WANTED} hotels you would be happy with and paste the page you found each on. The Travel Desk picks one and books it.`}
            </Txt>
            {draft.stayOptions.map((o, i) => <HotelCard key={i} i={i} o={o} onSet={patch => setOption(i, patch)} />)}
            {note ? <Note icon={note.warn ? 'warn' : 'check'} warn={note.warn}>{note.text}</Note> : null}
          </View>
        ) : null}
      </TeCard>

      {answered ? (
        <Flag tone="ok" title="Both answered" style={{ marginBottom: S.md }}>
          {`${draft.stayWanted
            ? 'The Travel Desk sees your hotels once the plan is approved, picks one and books it.'
            : 'No hotel on this trip.'}${draft.foodWanted ? ' Food is claimed against bills you add while the trip is on.' : ' No food budget on this trip.'}`}
        </Flag>
      ) : null}

      <TeCard tint>
        <CardHead title="Will you spend on food?" />
        <QCards label="Will you spend on food">
          <QCard icon="receipt" on={draft.foodWanted === true} onPress={() => edit({ foodWanted: true })}
            title="Yes, I will" sub="Add each bill while the trip is on" />
          <QCard icon="close" on={draft.foodWanted === false} onPress={() => edit({ foodWanted: false })}
            title="No food bills" sub="Meals are covered, or none expected" />
        </QCards>
        {draft.foodWanted ? (
          foodBudget > 0 ? (
            <TeCard flat>
              <Txt size={F.title} w={800}>{rs(foodBudget)}</Txt>
              <Txt size={F.tiny} tone="soft">set aside for food on this trip</Txt>
              <Txt size={F.tiny} tone="muted" style={{ marginTop: S.sm }}>
                Your company’s daily food limit for your grade, for each day you are away. There is nothing to fill in now — add each food and drink bill while you are travelling, with a remark, and it comes off this budget as you go.
              </Txt>
            </TeCard>
          ) : (
            <Note>No food budget applies to this trip yet. It is worked out from your company’s daily food limit once the dates and places are set.</Note>
          )
        ) : null}
        {draft.foodWanted === false ? <Txt size={F.tiny} tone="muted">No food bills expected. You can still add one later if that changes.</Txt> : null}
      </TeCard>
    </View>
  )
}
