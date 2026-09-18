'use client'
// components/wall/RecognitionPicker.tsx — choosing the badge and the tags.
//
// v8 REDESIGN, same behaviour. Two tabs (Badge · Tags), grouped by the
// catalogue's category, one search that covers names, descriptions and
// categories. Badges are radios — picking a second replaces the first — and
// tags are checkboxes capped at MAX_TAGS. The shape of each control says
// which is which: badges are cornered tiles, tags are pills.
//
// What changed visually: the current selection sits in a summary bar at the
// top (so it stays visible while the list scrolls), and each selected item
// can be cleared from that bar directly.

import { useState, useMemo } from 'react'
import { C, F, W, S } from '@/lib/ui'
import { BADGES, TAGS, byCategory, search, checkSelection, describe,
         badgeByRef, tagByRef,
         MAX_TAGS, type CatalogueItem, type Selection } from '@/lib/wall/catalogue'
import { Icon, RAD, inputStyle } from '@/components/wall/ui'

// ── module scope ─────────────────────────────────────────────────────────

function TabButton({ on, label, count, onClick }: {
  on: boolean; label: string; count: number; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} role="tab" aria-selected={on}
      className="wof-btn"
      style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: F.small,
               fontWeight: on ? W.bold : W.semi, padding: '10px 4px', background: 'none',
               border: 'none', borderBottom: `2px solid ${on ? C.brand : 'transparent'}`,
               color: on ? C.ink : C.muted, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      {label}
      <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999,
                     display: 'inline-grid', placeItems: 'center', fontSize: 11, fontWeight: W.bold,
                     background: count ? C.brand : C.sunken, color: count ? C.onAccent : C.faint }}>
        {count}
      </span>
    </button>
  )
}

function Chip({ item, on, blocked, disabled, kind, onPick }: {
  item: CatalogueItem; on: boolean; blocked?: boolean; disabled?: boolean
  kind: 'BADGE' | 'TAG'; onPick: () => void
}) {
  const off = disabled || blocked
  const badge = kind === 'BADGE'
  return (
    <button type="button" onClick={onPick} disabled={off}
      role={badge ? 'radio' : 'checkbox'} aria-checked={on}
      title={item.description}
      className="wof-tile"
      style={{ cursor: off ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
               display: 'inline-flex', alignItems: 'center', gap: 7,
               padding: badge ? '7px 11px 7px 7px' : '5px 12px 5px 8px',
               borderRadius: badge ? RAD.control : RAD.pill,
               fontSize: F.tiny, fontWeight: on ? W.bold : W.medium,
               border: `1.5px solid ${on ? C.brand : C.line}`,
               background: on ? C.brandTint : C.surface,
               color: off ? C.faint : on ? C.brandDeep : C.inkSoft,
               opacity: blocked ? .5 : 1 }}>
      <span aria-hidden="true" style={badge ? {
        width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center',
        background: on ? C.surface : C.sunken, fontSize: 14,
      } : { fontSize: 13 }}>{item.glyph}</span>
      {item.name}
      {on && !badge && <Icon name="check" size={12} stroke={2.6} />}
    </button>
  )
}

function Selected({ item, onClear }: { item: CatalogueItem; onClear: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 4px 3px 9px',
                   borderRadius: RAD.pill, background: C.surface, border: `1px solid ${C.brandEdge}`,
                   fontSize: F.micro, fontWeight: W.semi, color: C.brandDeep }}>
      <span aria-hidden="true">{item.glyph}</span>{item.name}
      <button type="button" onClick={onClear} aria-label={`Remove ${item.name}`}
        style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted,
                 padding: 2, display: 'grid', placeItems: 'center' }}>
        <Icon name="close" size={11} stroke={2.6} />
      </button>
    </span>
  )
}

// ── the picker ───────────────────────────────────────────────────────────

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

  const badge = value.badgeRef ? badgeByRef(value.badgeRef) : null
  const tags = value.tagRefs.map(r => tagByRef(r)).filter(Boolean) as CatalogueItem[]
  const summary = describe(value)

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: RAD.tile, overflow: 'hidden',
                  background: C.surface }}>
      {/* what is chosen, always in view */}
      <div aria-live="polite" style={{ padding: '10px 12px', background: C.sunken,
                                       borderBottom: `1px solid ${C.line}`,
                                       display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                                       minHeight: 44, boxSizing: 'border-box' }}>
        {summary ? (
          <>
            {badge && <Selected item={badge} onClear={() => pickBadge(badge.ref)} />}
            {tags.map(t => <Selected key={t.ref} item={t} onClear={() => toggleTag(t.ref)} />)}
          </>
        ) : (
          <span style={{ fontSize: F.micro, color: C.muted }}>
            Optional. Pick one badge, and up to {MAX_TAGS} tags that say why.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: S.md, padding: '0 12px', borderBottom: `1px solid ${C.line}`,
                    flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="tablist" aria-label="Badge or tags" style={{ display: 'flex', gap: S.md }}>
          <TabButton on={tab === 'BADGE'} label="Badge" count={value.badgeRef ? 1 : 0}
            onClick={() => setTab('BADGE')} />
          <TabButton on={tab === 'TAG'} label="Tags" count={value.tagRefs.length}
            onClick={() => setTab('TAG')} />
        </div>
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0, margin: '8px 0' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                         color: C.faint, pointerEvents: 'none' }}>
            <Icon name="search" size={14} />
          </span>
          <input value={q} onChange={e => setQ(e.target.value)} disabled={disabled}
            placeholder={tab === 'BADGE' ? 'Search badges, e.g. "helps others"' : 'Search tags'}
            aria-label={tab === 'BADGE' ? 'Search badges' : 'Search tags'}
            style={{ ...inputStyle, padding: '7px 10px 7px 32px', fontSize: F.tiny }} />
        </div>
      </div>

      <div style={{ maxHeight: 300, overflowY: 'auto', padding: '12px 12px 4px' }}>
        {groups.length === 0 && (
          <div style={{ fontSize: F.small, color: C.muted, padding: '14px 4px' }}>
            Nothing matches &ldquo;{q}&rdquo;. The search covers names, descriptions and
            categories.
          </div>
        )}
        {groups.map(g => (
          <div key={g.category} style={{ marginBottom: S.md }}>
            <div style={{ fontSize: F.micro, fontWeight: W.bold, color: C.faint, marginBottom: 7 }}>
              {g.category}
            </div>
            <div role={tab === 'BADGE' ? 'radiogroup' : 'group'} aria-label={g.category}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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

      {((tab === 'TAG' && atLimit) || !check.ok) && (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: '9px 12px', fontSize: F.micro,
                      lineHeight: 1.55 }}>
          {tab === 'TAG' && atLimit && (
            <div style={{ color: C.warning }}>
              {MAX_TAGS} tags is the limit — past that they stop telling anybody anything.
            </div>
          )}
          {!check.ok && (
            <div style={{ color: C.critical, marginTop: 3 }}>{check.faults.join(' ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
