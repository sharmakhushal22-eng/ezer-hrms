// src/features/expenses/plan/PlanTrip.tsx — step 1 of the planner: what the trip
// is and who is going (components/te/plan/TePlanTrip.tsx).
//
// The only thing worked out here is whether a typed employee code is somebody:
// a lookup in the snapshot. Whether the roster is acceptable is the server's
// answer and arrives as an issue on `pax`.
import * as React from 'react'
import { Pressable, View } from 'react-native'
import type { Snapshot, TripIssue, TripPreview, TripScope } from '@web/te/types'
import { errorFor, MAX_NAME, MAX_PEOPLE, PURPOSES, type DraftPerson, type PlannerDraft } from '@web/te/trip-draft'
import { needsExplanation, whyLabel, whyProblem } from '@web/te/other-reason'
import { useTheme } from '@/ui/ThemeProvider'
import { F, R, S } from '@/ui/theme'
import { Input, Txt } from '@/ui/primitives'
import { TeIcon } from '../ui/TeIcon'
import { Chip, H4, KindSquare, LinkBtn, Opt } from '../ui/kit'
import { MONO } from '../tones'
import { ContactFields, type ContactValue } from '../contact/ContactFields'
import { Ferr, Sec, Stepper } from './parts'

type Found = { name: string; grade: string } | null
/** Is this employee code somebody? The preview first (it resolves exactly the codes
 *  in this draft), then the snapshot (TePlanTrip.lookup). */
export function lookupPerson(snap: Snapshot, preview: TripPreview | null, code: string): Found {
  const up = code.trim().toUpperCase()
  const said = preview?.people?.find(q => (q.code || '').trim().toUpperCase() === up)
  if (said) return said.id ? { name: said.name, grade: said.grade } : null
  const id = snap.codes[up]
  return id ? snap.emp[id] ?? null : null
}

export type Edit = (patch: Partial<PlannerDraft> | ((d: PlannerDraft) => PlannerDraft)) => void

export const KIND: Record<string, { name: string; tag: string; desc: string }> = {
  local: { name: 'Local trip', tag: 'Any travel except flight', desc: 'In the city or nearby, back the same day' },
  domestic: { name: 'Domestic trip', tag: 'Flight or any travel', desc: 'Another city in India, or a night away' },
  international: { name: 'International trip', tag: 'Any country', desc: 'Any country, city and address' },
}

const NAME_HINT: Record<string, string> = {
  local: 'Like Manesar plant audit',
  domestic: 'Like Mumbai client review',
  international: 'Like Dubai distributor summit',
}

function ScopeCard({ s, on, onPress }: { s: TripScope; on: boolean; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.lg, borderWidth: 1.5, borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : pressed ? C.sunken : C.surface })}>
      <KindSquare kind={s} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.body} w={700}>{KIND[s].name.replace(' trip', '')}</Txt>
        <Txt size={F.tiny} tone="soft">{KIND[s].desc}</Txt>
        <Txt size={F.micro} tone="muted">{KIND[s].tag}</Txt>
      </View>
    </Pressable>
  )
}

function PersonRow({ i, p, snap, preview, onSet, onRemove }: {
  i: number; p: DraftPerson; snap: Snapshot; preview: TripPreview | null; onSet: (patch: { id?: string; name?: string }) => void; onRemove: () => void
}) {
  const { C } = useTheme()
  const code = (p.id || '').trim().toUpperCase()
  const found = code ? lookupPerson(snap, preview, code) : null
  const isMe = !!code && code === snap.emp[snap.me]?.code
  return (
    <View style={{ paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Txt size={F.small} w={700} tone="muted" style={{ width: 18, paddingTop: 30 }}>{i + 2}</Txt>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Input label="Employee ID" value={p.id} autoCapitalize="characters" autoComplete="off" autoCorrect={false} placeholder="SRS0533"
            onChangeText={v => onSet({ id: v })} style={{ marginBottom: S.sm }} />
          <Input label="Name" value={p.name} autoComplete="off" placeholder="Full name" onChangeText={v => onSet({ name: v })} style={{ marginBottom: 4 }} />
        </View>
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove person ${i + 2}`} hitSlop={6}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, marginTop: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.sunken : 'transparent' })}>
          <TeIcon name="close" size="sm" color={C.muted} />
        </Pressable>
      </View>
      {!!code && (
        <View style={{ marginLeft: 26, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {isMe ? <Txt size={F.tiny} w={600} tone="critical">That is you. You are already counted.</Txt>
            : found ? (
              <>
                <TeIcon name="check" size="sm" color={C.positive} />
                <Txt size={F.tiny} w={600} tone="positive" style={{ flexShrink: 1 }}>{`${found.name} · ${found.grade} · found in EZER`}</Txt>
              </>
            ) : <Txt size={F.tiny} w={600} tone="warning">Not found in EZER. Your approver will check.</Txt>}
        </View>
      )}
    </View>
  )
}

/** One of the two step-1 questions (div.askq): a heading, a hint, Yes / No. */
function AskQ({ icon, title, hint, value, bad, missing, onYes, onNo }: {
  icon: string; title: string; hint: string; value: boolean | undefined; bad: boolean; missing: string; onYes: () => void; onNo: () => void
}) {
  const { C } = useTheme()
  return (
    <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: bad ? C.critical : C.line, padding: S.md, backgroundColor: C.surface, gap: S.sm }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
          <TeIcon name={icon} color={C.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt size={F.small} w={700}>{title}</Txt>
          <Txt size={F.tiny} tone="muted">{hint}</Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Opt label="Yes" on={value === true} onPress={onYes} /></View>
        <View style={{ flex: 1 }}><Opt label="No" on={value === false} onPress={onNo} /></View>
      </View>
      {bad ? <Ferr>{missing}</Ferr> : null}
    </View>
  )
}

export function PlanTrip({ snap, draft, issues, edit, setScope, preview, offersHub }: {
  snap: Snapshot
  draft: PlannerDraft
  issues: TripIssue[]
  edit: Edit
  setScope: (s: TripScope) => void
  preview: TripPreview | null
  offersHub: boolean
}) {
  const { C } = useTheme()
  const k = KIND[draft.scope]
  const err = (key: string) => errorFor(issues, key, draft.tried)
  const me = snap.emp[snap.me]

  const lookup = (code: string) => lookupPerson(snap, preview, code)
  const tried = !!draft.tried
  const why = whyLabel('purpose')
  const purposeProblem = whyProblem(draft.purpose, draft.purposeNote)
  const setPerson = (i: number, patch: { id?: string; name?: string }) => edit(d => {
    const people = [...d.people]
    const was = people[i] ?? { id: '', name: '' }
    const now = { ...was, ...patch }
    // Typing a code fills the name in, but never over a name typed by hand.
    if (patch.id !== undefined) {
      const found = lookup(patch.id)
      if (found && (!now.name || was.autoName)) { now.name = found.name; now.autoName = true }
    }
    if (patch.name !== undefined) now.autoName = false
    people[i] = now
    return { ...d, people }
  })
  const setPax = (delta: 1 | -1) => edit(d => ({ ...d, pax: d.pax + delta }))

  return (
    <View>
      <Sec>
        <Input label="Trip name" value={draft.name} maxLength={MAX_NAME} autoComplete="off" placeholder={NAME_HINT[draft.scope]}
          onChangeText={v => edit({ name: v, nameTouched: !!v.trim() })} style={{ marginBottom: 4 }} />
        <Txt size={F.tiny} tone="muted">{draft.nameTouched ? 'Your own name for the trip.' : 'Filled in from where you go. Type to change it.'}</Txt>
        <Ferr>{err('name')}</Ferr>
      </Sec>

      <Sec>
        {draft.lockScope ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: R.lg, backgroundColor: C.sunken }}>
            <KindSquare kind={draft.scope} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.body} w={700}>{k.name}{draft.origin === 'POST_FACTO' ? ', already travelled' : ''}</Txt>
              <Txt size={F.tiny} tone="muted">{k.tag} · {k.desc}</Txt>
            </View>
          </View>
        ) : (
          <>
            <H4 style={{ marginTop: 0 }}>What kind of trip</H4>
            <View style={{ gap: S.sm }}>
              {(['local', 'domestic', 'international'] as const).map(s => (
                <ScopeCard key={s} s={s} on={draft.scope === s} onPress={() => setScope(s)} />
              ))}
            </View>
          </>
        )}
        <Ferr>{err('scope')}</Ferr>
      </Sec>

      <Sec>
        <H4 style={{ marginTop: 0 }}>Why</H4>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PURPOSES.map(p => <Opt key={p} label={p} on={draft.purpose === p} onPress={() => edit({ purpose: p })} />)}
        </View>
        <Ferr>{err('purpose')}</Ferr>
        {needsExplanation(draft.purpose) ? (
          <View style={{ marginTop: S.md }}>
            <Input label={why.label} value={draft.purposeNote} multiline autoFocus placeholder="Supplier arbitration hearing in Indore"
              onChangeText={v => edit({ purposeNote: v })} help={why.hint} style={{ marginBottom: 4 }} />
            {tried && purposeProblem ? <Ferr>{purposeProblem}</Ferr> : null}
          </View>
        ) : null}
        <Input label="Client or project" value={draft.project} placeholder="Optional" onChangeText={v => edit({ project: v })} style={{ marginTop: S.md }} />
      </Sec>

      <Sec>
        <View style={{ borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: S.md, backgroundColor: C.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.brandTint }}>
              <TeIcon name="people" color={C.brand} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt size={F.body} w={700}>Who is travelling</Txt>
              <Txt size={F.micro} tone="muted">Count yourself too. Each person claims their own expenses.</Txt>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', marginTop: S.sm }}>
            <Stepper value={draft.pax} min={1} max={MAX_PEOPLE} onStep={setPax} unit={draft.pax === 1 ? 'person' : 'people'} label="People travelling" />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: S.sm, marginTop: S.sm, borderTopWidth: 1, borderTopColor: C.line }}>
            <Txt size={F.small} w={700} tone="muted" style={{ width: 18 }}>1</Txt>
            <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6 }}>
              <Txt size={F.small} w={700}>{me?.name}</Txt>
              <Txt size={F.tiny} tone="muted" style={{ fontFamily: MONO }}>{me?.code}</Txt>
            </View>
            <Chip label="You" tone="t-brand" plain />
          </View>
          {draft.people.map((p, i) => (
            <PersonRow key={i} i={i} p={p} snap={snap} preview={preview} onSet={patch => setPerson(i, patch)}
              onRemove={() => edit(d => ({ ...d, people: d.people.filter((_, j) => j !== i), pax: Math.max(1, d.pax - 1) }))} />
          ))}
          <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 4 }}>
            <LinkBtn label="Add a person" icon="plus" disabled={draft.pax >= MAX_PEOPLE} onPress={() => setPax(1)} />
          </View>
        </View>
        <Ferr>{err('pax')}</Ferr>
      </Sec>

      <ContactFields
        value={draft}
        prefilled={snap.contact ? { mobile: snap.contact.mobile, altMobile: snap.contact.altMobile, email: snap.contact.email } : undefined}
        onChange={patch => edit(patch as Partial<PlannerDraft>)}
        error={(k: keyof ContactValue) => err(k)}
      />

      <Sec style={{ marginTop: S.lg }}>
        <View style={{ gap: S.sm }}>
          <AskQ icon="home"
            title={draft.origin === 'POST_FACTO' ? 'Did you stay overnight, or spend on food?' : 'Do you need a hotel or a food allowance?'}
            hint={draft.origin === 'POST_FACTO'
              ? 'Say no for a trip out and back the same day. Saying yes lets you claim the hotel and food bills against this trip.'
              : 'Say no for a trip out and back the same day. Saying yes adds a step for the hotels you would accept.'}
            value={draft.stayWanted} bad={draft.stayWanted === undefined && tried}
            missing="Say whether you need a hotel or a food allowance."
            onYes={() => edit({ stayWanted: true })} onNo={() => edit({ stayWanted: false, foodWanted: false })} />
          {offersHub ? (
            <AskQ icon="plane" title="Is a flight or a train part of this trip?"
              hint="Saying no leaves them out of how you travel, so you are not offered a ticket you are not taking."
              value={draft.flightOrTrain} bad={draft.flightOrTrain === undefined && tried}
              missing="Say whether a flight or a train is part of this trip."
              onYes={() => edit({ flightOrTrain: true })} onNo={() => edit({ flightOrTrain: false })} />
          ) : null}
        </View>
      </Sec>
    </View>
  )
}
