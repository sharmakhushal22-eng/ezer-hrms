// src/features/social/WishSheet.tsx — writing a wish, a greeting or a welcome
// (components/ess/social/WishSheet.tsx). Inline under the post or row, as on
// the web. The six "GIFs" are the website's own pack: emoji drawn on an
// hsl(hue 70% 92%) tile, keyed by media_ref — there are no image files to load
// and no third-party GIF search, so nothing here needs expo-image.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import { GIF_GLYPH, GIF_PACK, Gif, REACTIONS, Send, WISH_SUGGESTIONS, hsl, useKind, type SocialKind, type SocialMedia } from './shared'

const VERB: Record<string, { cta: string; placeholder: string }> = {
  birthday: { cta: 'Send birthday wishes', placeholder: 'Write something for their birthday…' },
  anniversary: { cta: 'Send your congratulations', placeholder: 'Say something about working with them…' },
  joiner: { cta: 'Send your welcome', placeholder: 'Welcome them to the company…' },
  shoutout: { cta: 'Post it', placeholder: 'Say what they did, and why it mattered…' },
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <Txt size={11} w={700} tone="muted" upper style={{ marginBottom: 6 }}>{children}</Txt>
}

function Chip({ label, onPress, big, a11y }: { label: string; onPress: () => void; big?: boolean; a11y?: string }) {
  const { C } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={({ pressed }) => ({ minHeight: 40, justifyContent: 'center', paddingHorizontal: big ? 11 : 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderStyle: pressed ? 'solid' : 'dashed', borderColor: pressed ? C.brand : C.lineStrong, backgroundColor: C.surface })}>
      <Txt size={big ? 17 : 12.5} w={500} tone="soft">{label}</Txt>
    </Pressable>
  )
}

function GifTile({ g, on, onPick }: { g: (typeof GIF_PACK)[number]; on: boolean; onPick: () => void }) {
  const { C, isDark } = useTheme()
  return (
    <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={g.label} accessibilityState={{ selected: on }}
      style={{ width: '31%', minWidth: 92, aspectRatio: 1, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? C.brand : C.line, backgroundColor: isDark ? hsl(g.hue, 30, 22) : hsl(g.hue, 70, 92), alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Txt size={34} style={{ lineHeight: 42 }}>{GIF_GLYPH[g.ref] ?? '🎉'}</Txt>
      <Txt size={11} w={600} tone="soft">{g.label}</Txt>
    </Pressable>
  )
}

export function WishSheet({ kind, name, onSend, onCancel }: { kind: SocialKind; name: string; onSend: (message: string, media: SocialMedia | null) => void; onCancel: () => void }) {
  const { C } = useTheme()
  const k = useKind(kind)
  const [text, setText] = React.useState('')
  const [media, setMedia] = React.useState<SocialMedia | null>(null)
  const [showGifs, setShowGifs] = React.useState(false)
  const v = VERB[kind] ?? VERB.shoutout
  const suggestions = WISH_SUGGESTIONS[kind] ?? []
  const off = !text.trim() && !media
  return (
    <View style={{ marginTop: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: k.ink2, backgroundColor: C.surface, gap: 14 }}>
      <View>
        <Lbl>To {name}</Lbl>
        <TextInput autoFocus value={text} onChangeText={setText} placeholder={v.placeholder} placeholderTextColor={C.faint} maxLength={500} multiline
          style={[{ minHeight: 96, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, padding: 12, fontFamily: FONT[400], fontSize: F.body, color: C.ink, textAlignVertical: 'top' }, webNoOutline]} />
        <Txt size={11.5} tone="faint" style={{ marginTop: 6 }}>{text.length}/500</Txt>
      </View>

      {suggestions.length > 0 && !text && (
        <View>
          <Lbl>Or start from one of these</Lbl>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {suggestions.map(s => <Chip key={s} label={s} onPress={() => setText(s)} />)}
          </View>
        </View>
      )}

      <View>
        <Lbl>Add an emoji</Lbl>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {REACTIONS.map(e => <Chip key={e} big label={e} a11y={`Add ${e}`} onPress={() => setText(t => (t + ' ' + e).trimStart())} />)}
        </View>
      </View>

      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setShowGifs(s => !s)} accessibilityRole="button" accessibilityState={{ expanded: showGifs }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
            <Gif size={16} color={C.inkSoft} />
            <Txt size={F.tiny} w={600} tone="soft">{media ? `GIF: ${media.label}` : 'Add a GIF'}</Txt>
          </Pressable>
          {media && (
            <Pressable onPress={() => setMedia(null)} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' }}>
              <Txt size={F.tiny} w={600} tone="muted">Remove</Txt>
            </Pressable>
          )}
        </View>
        {showGifs && (
          <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {GIF_PACK.map(g => <GifTile key={g.ref} g={g} on={media?.ref === g.ref} onPick={() => setMedia(media?.ref === g.ref ? null : { kind: 'gif', ref: g.ref, label: g.label })} />)}
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10 }}>
          <Txt size={F.small} w={600} tone="muted">Cancel</Txt>
        </Pressable>
        <Pressable onPress={() => onSend(text.trim(), media)} disabled={off} accessibilityRole="button" accessibilityState={{ disabled: off }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 10, backgroundColor: k.ink, opacity: off ? 0.5 : 1 }}>
          <Send size={15} color={C.onAccent} />
          <Txt size={F.small} w={600} color={C.onAccent}>{v.cta}</Txt>
        </Pressable>
      </View>
    </View>
  )
}
