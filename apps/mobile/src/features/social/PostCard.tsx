// src/features/social/PostCard.tsx — one post, whatever kind it is
// (components/ess/social/PostCard.tsx): header, removed block, body, the
// six-emoji reaction bar, the comment thread and its composer.
//
// Differences from the web, each a bug fix that changes no rule:
//  · A comment's GIF is drawn (the web never renders comment media, so a
//    GIF-only wish shows an empty bubble).
//  · Comment reactions are SAVED through the route's `react_comment` action
//    (the web toggles them in memory only and never sends them). The parent
//    owns that write; a just-posted local comment is toggled locally until the
//    reload gives it a real id.
import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useTheme } from '@/ui/ThemeProvider'
import { F, FONT } from '@/ui/theme'
import { Txt, webNoOutline } from '@/ui/primitives'
import {
  AddReaction, Bubble, CoChip, GIF_GLYPH, KindIcon, REACTIONS, RemovedBlock, SocAvatar, ago, useKind,
  type Reaction, type SocialComment, type SocialKind, type SocialPerson, type SocialPost,
} from './shared'

function ReactionBar({ list, onToggle, compact, kind }: { list: Reaction[]; onToggle: (emoji: string) => void; compact?: boolean; kind: SocialKind }) {
  const { C } = useTheme()
  const k = useKind(kind)
  const [open, setOpen] = React.useState(false)
  const h = compact ? 30 : 36
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {list.map(r => (
          <Pressable key={r.emoji} onPress={() => onToggle(r.emoji)} accessibilityRole="button" accessibilityState={{ selected: r.mine }}
            accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`} hitSlop={4}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: h, paddingHorizontal: compact ? 8 : 11, borderRadius: 999, borderWidth: 1, borderColor: r.mine ? k.ink : C.line, backgroundColor: r.mine ? k.tint : C.surface, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Txt size={compact ? 12 : 13}>{r.emoji}</Txt>
            <Txt size={12} w={600} color={r.mine ? k.ink : C.muted}>{r.count}</Txt>
          </Pressable>
        ))}
        <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel="Add a reaction" accessibilityState={{ expanded: open }} hitSlop={4}
          style={{ height: h, paddingHorizontal: 9, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, justifyContent: 'center' }}>
          <AddReaction size={16} color={C.faint} />
        </Pressable>
      </View>
      {open && (
        <View accessibilityRole="menu" style={{ flexDirection: 'row', gap: 3, padding: 7, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignSelf: 'flex-start' }}>
          {REACTIONS.map(e => (
            <Pressable key={e} accessibilityRole="menuitem" accessibilityLabel={e} onPress={() => { onToggle(e); setOpen(false) }}
              style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.sunken : 'transparent' })}>
              <Txt size={22} style={{ lineHeight: 28 }}>{e}</Txt>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

function CommentRow({ c, kind, onReact }: { c: SocialComment; kind: SocialKind; onReact: (emoji: string) => void }) {
  const { C } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <SocAvatar person={c.author} size={31} />
      <View style={{ flex: 1, minWidth: 0, backgroundColor: C.sunken, borderRadius: 12, padding: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Txt size={F.small} w={600}>{c.author.name}</Txt>
          {!!c.author.company && <CoChip name={c.author.company} />}
          <Txt size={11.5} tone="faint" style={{ marginLeft: 'auto' }}>{ago(c.at)}</Txt>
        </View>
        {c.removed ? (
          <View style={{ marginTop: 7 }}><RemovedBlock remark={c.removed.remark} mine={c.mine} /></View>
        ) : (
          <>
            {!!c.body && <Txt size={13.5} tone="soft" style={{ marginTop: 4, lineHeight: 21 }} selectable>{c.body}</Txt>}
            {!!c.media && (
              <View accessibilityRole="image" accessibilityLabel={c.media.label} style={{ marginTop: 6 }}>
                <Txt size={40} style={{ lineHeight: 48 }}>{GIF_GLYPH[c.media.ref] ?? '🎉'}</Txt>
              </View>
            )}
            <View style={{ marginTop: 8 }}><ReactionBar list={c.reactions} onToggle={onReact} compact kind={kind} /></View>
          </>
        )}
      </View>
    </View>
  )
}

function CommentComposer({ me, onSend }: { me: SocialPerson; onSend: (body: string) => void }) {
  const { C } = useTheme()
  const [text, setText] = React.useState('')
  const send = () => { const body = text.trim(); if (!body) return; onSend(body); setText('') }
  const off = !text.trim()
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
      <SocAvatar person={me} size={31} />
      <TextInput value={text} onChangeText={setText} placeholder="Write a comment…" placeholderTextColor={C.faint} multiline
        style={[{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 10, borderWidth: 1, borderColor: C.lineStrong, backgroundColor: C.surface, paddingHorizontal: 12, paddingVertical: 10, fontFamily: FONT[400], fontSize: F.small, color: C.ink }, webNoOutline]} />
      <Pressable onPress={send} disabled={off} accessibilityRole="button" accessibilityState={{ disabled: off }}
        style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: C.brand, opacity: off ? 0.5 : 1 }}>
        <Txt size={F.small} w={600} color={C.onAccent}>Post</Txt>
      </Pressable>
    </View>
  )
}

export function PostCard({ post, me, action, onReact, onComment, onReactComment }: {
  post: SocialPost; me: SocialPerson; action?: React.ReactNode
  onReact: (emoji: string) => void; onComment: (body: string) => void; onReactComment: (commentId: string, emoji: string) => void
}) {
  const { C } = useTheme()
  const k = useKind(post.kind)
  const [showThread, setShowThread] = React.useState(post.comments.length > 0)
  const n = post.comments.length
  const role = [post.subject.designation, post.subject.department].filter(Boolean).join(' · ') || '-'
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SocAvatar person={post.subject} mark={post.kind} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {post.kind === 'shoutout' && post.author
            ? <Txt size={14.5} w={400}><Txt size={14.5} w={600}>{post.author.name}</Txt> recognised <Txt size={14.5} w={600}>{post.subject.name}</Txt></Txt>
            : <Txt size={14.5} w={600}>{post.subject.name}</Txt>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 2 }}>
            <Txt size={12.5} tone="muted">{role}</Txt>
            {!!post.subject.company && <CoChip name={post.subject.company} />}
          </View>
        </View>
        <Txt size={11.5} tone="faint" style={{ alignSelf: 'flex-start' }}>{ago(post.at)}</Txt>
      </View>

      {post.removed ? (
        <RemovedBlock remark={post.removed.remark} mine={post.mine} />
      ) : (
        <>
          {!!post.category && (
            <View style={{ flexDirection: 'row' }}>
              <View style={{ height: 25, paddingHorizontal: 10, borderRadius: 999, justifyContent: 'center', backgroundColor: k.tint, borderWidth: 1, borderColor: k.ink2 }}>
                <Txt size={11.5} w={600} color={k.ink}>{post.category.glyph} {post.category.label}</Txt>
              </View>
            </View>
          )}
          {!!post.body && <Txt size={13.5} tone="soft" style={{ lineHeight: 22 }} selectable>{post.body}</Txt>}
          {!!post.media && (
            <View accessibilityRole="image" accessibilityLabel={post.media.label} style={{ alignSelf: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: k.tint }}>
              <Txt size={56} style={{ lineHeight: 66 }}>{GIF_GLYPH[post.media.ref] ?? '🎉'}</Txt>
            </View>
          )}

          <View style={{ paddingTop: 11, borderTopWidth: 1, borderTopColor: C.line, gap: 8 }}>
            <ReactionBar list={post.reactions} onToggle={onReact} kind={post.kind} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Pressable onPress={() => setShowThread(s => !s)} accessibilityRole="button" accessibilityState={{ expanded: showThread }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 10, borderRadius: 8, backgroundColor: pressed ? C.sunken : 'transparent' })}>
                <Bubble size={15} color={C.muted} />
                <Txt size={F.tiny} w={600} tone="muted">{`${n || ''} ${n === 1 ? 'comment' : 'comments'}`.trim()}</Txt>
              </Pressable>
              {!!action && <View style={{ marginLeft: 'auto' }}>{action}</View>}
            </View>
          </View>

          {showThread && (
            <View style={{ gap: 10 }}>
              {post.comments.map(c => <CommentRow key={c.id} c={c} kind={post.kind} onReact={e => onReactComment(c.id, e)} />)}
              <CommentComposer me={me} onSend={onComment} />
            </View>
          )}
        </>
      )}
    </View>
  )
}

export { KindIcon }
