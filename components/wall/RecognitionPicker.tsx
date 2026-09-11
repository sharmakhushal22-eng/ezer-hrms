'use client'
// components/wall/RecognitionPicker.tsx — choosing the badge and the tags.
//
// Seventy-four items is too many for a flat list and too few to need a modal
// search-first flow. So: two panels, grouped by category, with a search that
// covers descriptions as well as names — somebody thinking "helps others"
// should find Supportive and Knowledge Sharer without knowing either name.
//
// ONE BADGE, SEVERAL TAGS. The controls say which is which by their shape: the
// badge row behaves as a radio (picking a second replaces the first), the tags
// as checkboxes. Nobody should have to read a caption to learn that.

import { useState, useMemo } from 'react'
import { C, F, W, S, R } from '@/lib/ui'
import { BADGES, TAGS, byCategory, search, checkSelection, describe,
         MAX_TAGS, type CatalogueItem, type Selection } from '@/lib/wall/catalogue'

export default function RecognitionPicker({ value, onChange, disabled }: {
  value: Selection
  onChange: (s: Selection) => void
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'BADGE' | 'TAG'>('BADGE')

  const items = tab === 'BADGE' ? BADGES : TAGS
  const groups = useMemo(() => byCategory(search(items, q)), [items, q])
  const check = checkSelection(value)
  const atLimit = value.tagRefs.length >= MAX_TAGS

  const pickBadge = (ref: string) =>
    onChange({ ...value, badgeRef: value.badgeRef === ref ? null : ref })

  const toggleTag = (ref: string) => {
    const has = value.tagRefs.includes(ref)
    if (!has && atLimit) return
    onChange({ ...value, tagRefs: has
      ? value.tagRefs.filter(r => r !== ref)
      : [...value.tagRefs, ref] })
  }

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R.lg, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, padding: 8, borderBottom: `1px solid ${C.line}`,
                    background: C.sunken, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['BADGE', 'TAG'] as const).map(k => {
          const on = tab === k
          const n = k === 'BADGE' ? (value.badgeRef ? 1 : 0) : value.tagRefs.length
          return (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={on}
              style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: F.tiny,
                       fontWeight: W.bold, padding: '6px 12px', borderRadius: R.sm,
                       border: `1px solid ${on ? C.brand : C.line}`,
                       background: on ? C.brand : C.surface,
                       color: on ? C.onAccent : C.inkSoft }}>
              {k === 'BADGE' ? 'Badge' : 'Tags'}
              {n > 0 && <span style={{ marginLeft: 6, opacity: .85 }}>{n}</span>}
            </button>
          )
        })}
        <input value={q} onChange={e => setQ(e.target.value)} disabled={disabled}
          placeholder={tab === 'BADGE' ? 'Search badges' : 'Search tags'}
          aria-label={tab === 'BADGE' ? 'Search badges' : 'Search tags'}
          style={{ flex: '1 1 160px', minWidth: 0, padding: '6px 10px', borderRadius: R.sm,
                   border: `1px solid ${C.line}`, background: C.surface, color: C.ink,
                   fontSize: F.tiny, fontFamily: 'inherit' }} />
      </div>

      <div style={{ maxHeight: 280, overflowY: 'auto', padding: 10 }}>
        {groups.length === 0 && (
          <div style={{ fontSize: F.small, color: C.muted, padding: '14px 4px' }}>
            Nothing matches &ldquo;{q}&rdquo;. The search covers names, descriptions and
            categories.
          </div>
        )}
        {groups.map(g => (
          <div key={g.category} style={{ marginBottom: S.md }}>
            <div style={{ fontSize: F.micro, fontWeight: W.bold, textTransform: 'uppercase',
                          letterSpacing: '.06em', color: C.faint, marginBottom: 6 }}>
              {g.category}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {g.items.map(i => (
                <Chip key={i.ref} item={i} disabled={disabled}
                  kind={tab}
                  on={tab === 'BADGE' ? value.badgeRef === i.ref
                                      : value.tagRefs.includes(i.ref)}
                  blocked={tab === 'TAG' && atLimit && !value.tagRefs.includes(i.ref)}
                  onPick={() => tab === 'BADGE' ? pickBadge(i.ref) : toggleTag(i.ref)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${C.line}`, padding: '9px 12px',
                    background: C.surface, fontSize: F.micro, color: C.muted,
                    lineHeight: 1.6 }}>
        {describe(value)
          ? <><strong style={{ color: C.ink }}>{describe(value)}</strong></>
          : <>Pick one badge, and up to {MAX_TAGS} tags that say why.</>}
        {tab === 'TAG' && atLimit && (
          <div style={{ color: C.warning, marginTop: 3 }}>
            {MAX_TAGS} tags is the limit — past that they stop telling anybody anything.
          </div>
        )}
        {!check.ok && (
          <div style={{ color: C.critical, marginTop: 3 }}>{check.faults.join(' ')}</div>
        )}
      </div>
    </div>
  )
}

function Chip({ item, on, blocked, disabled, kind, onPick }: {
  item: CatalogueItem; on: boolean; blocked?: boolean; disabled?: boolean
  kind: 'BADGE' | 'TAG'; onPick: () => void
}) {
  const off = disabled || blocked
  return (
    <button type="button" onClick={onPick} disabled={off}
      role={kind === 'BADGE' ? 'radio' : 'checkbox'} aria-checked={on}
      title={item.description}
      style={{ cursor: off ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
               display: 'inline-flex', alignItems: 'center', gap: 6,
               padding: '6px 11px', borderRadius: kind === 'BADGE' ? R.sm : 999,
               fontSize: F.tiny, fontWeight: on ? W.bold : W.medium,
               border: `1px solid ${on ? C.brand : C.line}`,
               background: on ? C.brandTint : C.surface,
               color: off ? C.faint : on ? C.brandDeep : C.inkSoft,
               opacity: blocked ? .55 : 1 }}>
      <span aria-hidden="true">{item.glyph}</span>
      {item.name}
    </button>
  )
}
