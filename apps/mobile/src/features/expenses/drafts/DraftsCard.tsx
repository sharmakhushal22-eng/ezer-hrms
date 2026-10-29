// src/features/expenses/drafts/DraftsCard.tsx — unfinished plans and expenses
// (components/te/TeDrafts.tsx). Renders nothing when there are no drafts.
//
// Same rows, copy and rules as the website: Resume / Discard per row, "Select"
// (only with more than one) for discarding several, "Only you can see these",
// and the "only copy of this work" warning before anything is thrown away. The
// web's inline confirm card is the app's confirm() dialog, with the same words.
import * as React from 'react'
import { View } from 'react-native'
import { savedAgo } from '@web/te/autosave'
import type { TeDraft, TeDraftKind } from '@web/te/types'
import { useTheme } from '@/ui/ThemeProvider'
import { F, S } from '@/ui/theme'
import { Button, Checkbox, Txt } from '@/ui/primitives'
import { useOverlay } from '@/ui/overlays'
import { errorText, te } from '../api'
import { queryClient } from '@/core/query'
import { useDrafts } from '../data'
import { FieldErr, Ico, Note, TeCard } from '../ui/kit'
import { TeIcon } from '../ui/TeIcon'

/** What kind of thing this draft is (TeDrafts.kindLabel). */
export function draftKindLabel(d: TeDraft): string {
  if (d.kind === 'trip') {
    const scope = d.scope === 'local' ? 'Local' : d.scope === 'international' ? 'International' : 'Domestic'
    return `${scope} trip`
  }
  return d.kind === 'expense' ? 'Expense' : 'Reply'
}

function DraftRow({ d, now, picking, picked, busy, onToggle, onDiscard, onResume }: {
  d: TeDraft; now: number; picking: boolean; picked: boolean; busy: boolean
  onToggle: () => void; onDiscard: () => void; onResume: () => void
}) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: picking && picked ? C.brandTint : 'transparent' }}>
      {picking ? <Checkbox checked={picked} onChange={onToggle} /> : null}
      <Ico name={d.kind === 'trip' ? 'route' : d.kind === 'expense' ? 'receipt' : 'claims'} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        {d.title
          ? <Txt size={F.small} w={600} numberOfLines={2}>{d.title}</Txt>
          : <Txt size={F.small} tone="muted" style={{ fontStyle: 'italic' }}>Not named yet</Txt>}
        <Txt size={F.tiny} tone="muted">{`${draftKindLabel(d)} · ${savedAgo(new Date(d.updated_at).getTime(), Math.max(now, new Date(d.updated_at).getTime()))}`}</Txt>
      </View>
      {!picking ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Button size="sm" variant="outline" title={busy ? 'Discarding…' : 'Discard'} disabled={busy} onPress={onDiscard} />
          <Button size="sm" title="Resume" onPress={onResume} />
        </View>
      ) : null}
    </View>
  )
}

export function DraftsCard({ kind, title, onResume }: {
  kind?: TeDraftKind
  title?: string
  onResume: (d: TeDraft) => void
}) {
  const { C } = useTheme()
  const { confirm } = useOverlay()
  const q = useDrafts(kind)
  const drafts = React.useMemo(() => q.data ?? [], [q.data])
  // "Saved 3 minutes ago" is measured from when the list arrived (refetched on focus).
  const now = q.dataUpdatedAt
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [picking, setPicking] = React.useState(false)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())

  const stopPicking = () => { setPicking(false); setPicked(new Set()) }
  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  async function discard(d: TeDraft) {
    const ok = await confirm({
      title: 'Discard this draft?',
      message: 'This is the only copy of this work. Discarding it cannot be undone.',
      confirm: 'Discard', cancel: 'Keep it', destructive: true,
    })
    if (!ok) return
    setBusy(d.id); setNotice(''); setError('')
    try {
      await te.drafts.remove(d.id)
      void queryClient.invalidateQueries({ queryKey: ['te', 'drafts'] })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  async function discardMany() {
    const ids = [...picked]
    const ok = await confirm({
      title: `Discard ${ids.length} ${ids.length === 1 ? 'draft' : 'drafts'}?`,
      message: ids.length === 1
        ? 'This is the only copy of that work. Discarding it cannot be undone.'
        : `These are the only copies of that work. Discarding ${ids.length} drafts cannot be undone.`,
      confirm: `Discard ${ids.length}`, cancel: 'Keep them', destructive: true,
    })
    if (!ok) return
    setBusy('many'); setError('')
    try {
      const r = await te.drafts.removeMany(ids)
      stopPicking()
      setNotice(r.deleted < r.asked ? `${r.deleted} of ${r.asked} drafts were discarded. The rest had already gone.` : '')
      void queryClient.invalidateQueries({ queryKey: ['te', 'drafts'] })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  const loadError = q.error ? errorText(q.error) : ''
  if (!drafts.length && !error && !notice && !loadError) return null
  const allPicked = drafts.length > 0 && picked.size === drafts.length

  return (
    <TeCard>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TeIcon name="file" size="sm" color={C.ink} />
          <Txt size={F.body} w={700}>{title ?? 'Drafts'}</Txt>
        </View>
        {picking ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Txt size={F.tiny} tone="muted">{`${picked.size} of ${drafts.length}`}</Txt>
            <Button size="sm" variant="outline" title="Done" onPress={stopPicking} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Txt size={F.tiny} tone="muted">Only you can see these</Txt>
            {drafts.length > 1 ? <Button size="sm" variant="outline" title="Select" onPress={() => setPicking(true)} /> : null}
          </View>
        )}
      </View>
      {picking ? (
        <Checkbox checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(drafts.map(d => d.id)))}
          label={allPicked ? 'Clear all' : 'Select all'} />
      ) : null}
      {error || loadError ? <View style={{ marginTop: S.sm }}><FieldErr>{error || loadError}</FieldErr></View> : null}
      {notice ? (
        <Note style={{ marginTop: S.sm }}>
          <Txt size={12.5} tone="soft">{notice}</Txt>
          <View style={{ marginTop: 6, alignSelf: 'flex-start' }}><Button size="sm" variant="outline" title="Dismiss" onPress={() => setNotice('')} /></View>
        </Note>
      ) : null}
      {picking && picked.size ? (
        <View style={{ marginTop: S.sm }}>
          <Button size="sm" variant="danger" icon={<TeIcon name="bin" size="sm" color={C.critical} />}
            title={busy === 'many' ? 'Discarding…' : `Discard ${picked.size} ${picked.size === 1 ? 'draft' : 'drafts'}`}
            disabled={busy === 'many'} onPress={() => void discardMany()} />
        </View>
      ) : null}
      <View style={{ marginTop: S.sm }}>
        {drafts.map(d => (
          <DraftRow key={d.id} d={d} now={now} picking={picking} picked={picked.has(d.id)} busy={busy === d.id}
            onToggle={() => toggle(d.id)} onDiscard={() => void discard(d)} onResume={() => onResume(d)} />
        ))}
      </View>
    </TeCard>
  )
}
