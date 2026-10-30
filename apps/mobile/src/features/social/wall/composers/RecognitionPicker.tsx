// src/features/social/wall/composers/RecognitionPicker.tsx — the phone's copy
// of components/wall/RecognitionPicker.tsx: one badge, up to MAX_TAGS tags.
//
// Same behaviour: two tabs (Badge · Tags) with count bubbles, one search
// shared by both tabs, items grouped by catalogue category, badges are radios
// (tapping the selected one clears it), tags are checkboxes capped at
// MAX_TAGS, the selection sits in a summary bar with removable pills.
// No network calls — everything comes from lib/wall/catalogue.
//
// Phone adaptation: the web's hover tooltip (`title` = description) has no
// touch equivalent. Tapping or long-pressing a chip shows its description in
// a strip under the list (long-press shows it without changing the
// selection); screen readers get it as the accessibility hint.
import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  BADGES, TAGS, byCategory, search, checkSelection, describe, badgeByRef, tagByRef,
  MAX_TAGS, type CatalogueItem, type Selection,
} from '@web/wall/catalogue'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Icon, RAD, WInput } from '../ui'

type Tab = 'BADGE' | 'TAG'

function TabButton({ on, label, count, onPress }: { on: boolean; label: string; count: number; onPress: () => void }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 4, borderBottomWidth: 2, borderBottomColor: on ? C.brand : 'transparent' }}>
      <Txt size={F.small} w={on ? 700 : 600} color={on ? C.ink : C.muted}>{label}</Txt>
      <View style={{ minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: count ? C.brand : C.sunken }}>
        <Txt size={11} w={700} color={count ? C.onAccent : C.faint}>{count}</Txt>
      </View>
    </Pressable>
  )
}

function Chip({ item, on, blocked, disabled, kind, onPick, onPeek }: {
  item: CatalogueItem; on: boolean; blocked?: boolean; disabled?: boolean
  kind: Tab; onPick: () => void; onPeek: () => void
}) {
  const { C } = useTheme()
  const off = disabled || blocked
  const badge = kind === 'BADGE'
  const fg = off ? C.faint : on ? C.brandDeep : C.inkSoft
  return (
    <Pressable onPress={() => { onPeek(); if (!off) onPick() }} onLongPress={onPeek} delayLongPress={350}
      accessibilityRole={badge ? 'radio' : 'checkbox'} accessibilityState={{ checked: on, disabled: !!off }}
      accessibilityLabel={item.name} accessibilityHint={item.description}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44,
               paddingVertical: badge ? 7 : 5, paddingLeft: badge ? 7 : 8, paddingRight: badge ? 11 : 12,
               borderRadius: badge ? RAD.control : RAD.pill, borderWidth: 1.5,
               borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandTint : C.surface,
               opacity: blocked ? 0.5 : 1 }}>
      {badge ? (
        <View style={{ width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.surface : C.sunken }}>
          <Txt size={14} style={{ lineHeight: 20 }}>{item.glyph}</Txt>
        </View>
      ) : (
        <Txt size={13}>{item.glyph}</Txt>
      )}
      <Txt size={F.tiny} w={on ? 700 : 500} color={fg}>{item.name}</Txt>
      {on && !badge && <Icon name="check" size={12} stroke={2.6} color={fg} />}
    </Pressable>
  )
}

function Selected({ item, onClear }: { item: CatalogueItem; onClear: () => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 9, paddingRight: 2, borderRadius: RAD.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.brandEdge }}>
      <Txt size={F.micro} w={600} color={C.brandDeep}>{item.glyph} {item.name}</Txt>
      <Pressable onPress={onClear} accessibilityLabel={`Remove ${item.name}`} hitSlop={8}
        style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="close" size={11} stroke={2.6} color={C.muted} />
      </Pressable>
    </View>
  )
}

export default function RecognitionPicker({ value, onChange, disabled }: {
  value: Selection
  onChange: (s: Selection) => void
  disabled?: boolean
}) {
  const { C } = useTheme()
  const [q, setQ] = React.useState('')
  const [tab, setTab] = React.useState<Tab>('BADGE')
  const [peek, setPeek] = React.useState<CatalogueItem | null>(null)

  const items = tab === 'BADGE' ? BADGES : TAGS
  const groups = React.useMemo(() => byCategory(search(items, q)), [items, q])
  const check = checkSelection(value)
  const atLimit = value.tagRefs.length >= MAX_TAGS

  const pickBadge = (ref: string) =>
    onChange({ ...value, badgeRef: value.badgeRef === ref ? null : ref })

  const toggleTag = (ref: string) => {
    const has = value.tagRefs.includes(ref)
    if (!has && atLimit) return
    onChange({ ...value, tagRefs: has ? value.tagRefs.filter(r => r !== ref) : [...value.tagRefs, ref] })
  }

  const switchTab = (t: Tab) => { setTab(t); setPeek(null) }

  const badge = value.badgeRef ? badgeByRef(value.badgeRef) : null
  const tags = value.tagRefs.map(r => tagByRef(r)).filter(Boolean) as CatalogueItem[]
  const summary = describe(value)

  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile, overflow: 'hidden', backgroundColor: C.surface }}>
      {/* what is chosen, always in view */}
      <View accessibilityLiveRegion="polite" style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: C.sunken, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 44 }}>
        {summary ? (
          <>
            {badge && <Selected item={badge} onClear={() => pickBadge(badge.ref)} />}
            {tags.map(t => <Selected key={t.ref} item={t} onClear={() => toggleTag(t.ref)} />)}
          </>
        ) : (
          <Txt size={F.micro} tone="muted">Optional. Pick one badge, and up to {MAX_TAGS} tags that say why.</Txt>
        )}
      </View>

      <View style={{ paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <View accessibilityRole="tablist" accessibilityLabel="Badge or tags" style={{ flexDirection: 'row', gap: 12 }}>
          <TabButton on={tab === 'BADGE'} label="Badge" count={value.badgeRef ? 1 : 0} onPress={() => switchTab('BADGE')} />
          <TabButton on={tab === 'TAG'} label="Tags" count={value.tagRefs.length} onPress={() => switchTab('TAG')} />
        </View>
        <View style={{ justifyContent: 'center', marginVertical: 8 }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, zIndex: 1 }}>
            <Icon name="search" size={14} color={C.faint} />
          </View>
          <WInput value={q} onChangeText={setQ} editable={!disabled}
            placeholder={tab === 'BADGE' ? 'Search badges, e.g. "helps others"' : 'Search tags'}
            accessibilityLabel={tab === 'BADGE' ? 'Search badges' : 'Search tags'}
            autoCorrect={false} autoCapitalize="none"
            style={{ paddingLeft: 32, fontSize: F.tiny }} />
        </View>
      </View>

      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}
        contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 12, paddingBottom: 4 }}>
        {groups.length === 0 && (
          <Txt size={F.small} tone="muted" style={{ paddingVertical: 14, paddingHorizontal: 4 }}>
            Nothing matches “{q}”. The search covers names, descriptions and categories.
          </Txt>
        )}
        {groups.map(g => (
          <View key={g.category} style={{ marginBottom: 12 }}>
            <Txt size={F.micro} w={700} tone="faint" style={{ marginBottom: 7 }}>{g.category}</Txt>
            <View accessibilityRole={tab === 'BADGE' ? 'radiogroup' : undefined} accessibilityLabel={g.category}
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {g.items.map(i => (
                <Chip key={i.ref} item={i} disabled={disabled} kind={tab}
                  on={tab === 'BADGE' ? value.badgeRef === i.ref : value.tagRefs.includes(i.ref)}
                  blocked={tab === 'TAG' && atLimit && !value.tagRefs.includes(i.ref)}
                  onPeek={() => setPeek(i)}
                  onPick={() => tab === 'BADGE' ? pickBadge(i.ref) : toggleTag(i.ref)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {peek && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 9, paddingLeft: 12, paddingRight: 4, backgroundColor: C.sunken }}>
          <Txt size={F.micro} tone="soft" style={{ flex: 1, lineHeight: 17 }}>
            <Txt size={F.micro} w={700}>{peek.glyph} {peek.name}</Txt>{'  '}{peek.description}
          </Txt>
          <Pressable onPress={() => setPeek(null)} accessibilityLabel="Close" hitSlop={8}
            style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={11} stroke={2.6} color={C.muted} />
          </Pressable>
        </View>
      )}

      {((tab === 'TAG' && atLimit) || !check.ok) && (
        <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingVertical: 9, paddingHorizontal: 12 }}>
          {tab === 'TAG' && atLimit && (
            <Txt size={F.micro} tone="warning" style={{ lineHeight: 17 }}>
              {MAX_TAGS} tags is the limit. Past that they stop telling anybody anything.
            </Txt>
          )}
          {!check.ok && (
            <Txt size={F.micro} tone="critical" style={{ marginTop: 3, lineHeight: 17 }}>{check.faults.join(' ')}</Txt>
          )}
        </View>
      )}
    </View>
  )
}
