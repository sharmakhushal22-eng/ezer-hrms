// src/features/social/wall/composers/PersonPicker.tsx — the phone's copy of
// components/wall/PersonPicker.tsx: find colleagues by name or code.
//
// THE QUERY IS THE WEBSITE'S, VERBATIM:
//   employees · id, full_name, emp_code, designation
//   date_of_leaving IS NULL · or(ilike full_name, emp_code) · limit 8
// ≥ 2 characters, 220 ms debounce, a stale response is discarded.
//
// Phone adaptation: the web's absolutely-positioned listbox (↑/↓/Enter/Esc)
// becomes a tappable list rendered inline under the field, so it never sits
// behind the keyboard or clips inside a ScrollView. The parent owns `picked`.
import * as React from 'react'
import { Animated, Easing, Pressable, TextInput, View } from 'react-native'
import { orIlike } from '@web/pg-search'
import { supabase } from '@/core/supabase'
import { useTheme } from '@/ui/ThemeProvider'
import { F } from '@/ui/theme'
import { Txt } from '@/ui/primitives'
import { Avatar, Icon, PersonChip, Pulse, RAD, WInput } from '../ui'

export interface Person { id: string; full_name: string; emp_code?: string | null; designation?: string | null }

/** wofOpen — 340 ms, opacity 0→1, translateY -6→0. */
function OpenIn({ children }: { children: React.ReactNode }) {
  const [v] = React.useState(() => new Animated.Value(0))
  React.useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 340, easing: Easing.bezier(0.22, 0.72, 0.28, 1), useNativeDriver: true }).start()
  }, [v])
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }}>
      {children}
    </Animated.View>
  )
}

function ResultRow({ person, added, onPick }: { person: Person; added: boolean; onPick: () => void }) {
  const { C } = useTheme()
  const meta = [person.emp_code, person.designation].filter(Boolean).join(' · ')
  return (
    <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={person.full_name}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 8, paddingHorizontal: 10, borderRadius: RAD.control, backgroundColor: pressed ? C.brandTint : 'transparent' })}>
      <Avatar name={person.full_name} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt size={F.small} w={600} numberOfLines={1}>{person.full_name}</Txt>
        {!!meta && <Txt size={F.micro} tone="muted" numberOfLines={1}>{meta}</Txt>}
      </View>
      {added && <Txt size={F.micro} w={600} tone="brand">Added</Txt>}
    </Pressable>
  )
}

export default function PersonPicker({ picked, onAdd, onRemove, inputId }: {
  picked: Person[]
  onAdd: (p: Person) => void
  onRemove: (id: string) => void
  inputId?: string
}) {
  const { C } = useTheme()
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState<Person[]>([])
  const [searching, setSearching] = React.useState(false)
  const box = React.useRef<TextInput>(null)

  React.useEffect(() => {
    const q = query.trim()
    let alive = true
    const t = setTimeout(async () => {
      if (q.length < 2) { setFound([]); setSearching(false); return }
      setSearching(true)
      const r = await supabase.from('employees')
        .select('id, full_name, emp_code, designation')
        .is('date_of_leaving', null)
        .or(orIlike(['full_name', 'emp_code'], q))
        .limit(8)
      if (!alive) return
      setSearching(false)
      if (!r.error) setFound((r.data ?? []) as unknown as Person[])
    }, 220)
    return () => { alive = false; clearTimeout(t) }
  }, [query])

  const choose = (p: Person) => {
    onAdd(p)
    setQuery(''); setFound([])
    box.current?.focus()
  }

  const open = found.length > 0
  const noMatch = query.trim().length >= 2 && !searching && found.length === 0

  return (
    <View>
      {picked.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {picked.map(p => (
            <PersonChip key={p.id} name={p.full_name} meta={p.designation ?? p.emp_code}
              onRemove={() => onRemove(p.id)} />
          ))}
        </View>
      )}

      <View style={{ justifyContent: 'center' }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 12, zIndex: 1 }}>
          <Icon name="search" size={16} color={C.faint} />
        </View>
        <WInput
          ref={box} nativeID={inputId}
          value={query} onChangeText={setQuery}
          placeholder={picked.length ? 'Add another colleague' : 'Search by name or employee code'}
          accessibilityLabel="Search for a colleague"
          autoComplete="off" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
          onSubmitEditing={() => { const p = found[0]; if (p) choose(p) }}
          style={{ paddingLeft: 38, paddingRight: searching ? 84 : 12 }}
        />
        {searching && (
          <Pulse style={{ position: 'absolute', right: 12 }}>
            <Txt size={F.micro} tone="faint">Searching</Txt>
          </Pulse>
        )}
      </View>

      {open && (
        <OpenIn>
          <View accessibilityRole="list" style={{ marginTop: 6, borderWidth: 1, borderColor: C.line, borderRadius: RAD.tile, backgroundColor: C.surface, padding: 4, shadowColor: C.ink, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 4 }}>
            {found.map(p => (
              <ResultRow key={p.id} person={p} added={picked.some(x => x.id === p.id)} onPick={() => choose(p)} />
            ))}
          </View>
        </OpenIn>
      )}

      {noMatch && (
        <Txt size={F.micro} tone="muted" style={{ marginTop: 6 }}>
          Nobody current matches “{query.trim()}”. Try a surname or the employee code.
        </Txt>
      )}
    </View>
  )
}
