'use client'
// components/wall/PersonPicker.tsx — find colleagues by name or code.
//
// v8: extracted. Both composers carried an identical copy of this search —
// the same query, the same 220 ms debounce, the same leaver exclusion — and
// it now lives once. THE QUERY IS UNCHANGED:
//
//   employees · id, full_name, emp_code, designation
//   date_of_leaving IS NULL · or(ilike full_name, emp_code) · limit 8
//
// Anyone who has left is excluded here because the database refuses them
// anyway; offering a name that cannot be submitted is a dead end.
//
// The parent still owns `picked` and the draft's receiverIds. This file only
// finds people and reports a choice.

import { useEffect, useRef, useState } from 'react'
import { orIlike } from '@/lib/pg-search'
import { supabase } from '@/lib/supabase'
import { C, F, W } from '@/lib/ui'
import { Avatar, Icon, PersonChip, RAD, inputStyle } from '@/components/wall/ui'

export interface Person { id: string; full_name: string; emp_code?: string | null; designation?: string | null }

export default function PersonPicker({ picked, onAdd, onRemove, inputId }: {
  picked: Person[]
  onAdd: (p: Person) => void
  onRemove: (id: string) => void
  inputId?: string
}) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Person[]>([])
  const [searching, setSearching] = useState(false)
  const [cursor, setCursor] = useState(0)
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setFound([]); setSearching(false); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await supabase.from('employees')
        .select('id, full_name, emp_code, designation')
        .is('date_of_leaving', null)
        .or(orIlike(['full_name', 'emp_code'], q))
        .limit(8)
      if (!alive) return
      setSearching(false)
      if (!r.error) { setFound((r.data ?? []) as unknown as Person[]); setCursor(0) }
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
  const listId = `${inputId ?? 'wof-person'}-list`

  return (
    <div>
      {picked.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {picked.map(p => (
            <PersonChip key={p.id} name={p.full_name} meta={p.designation ?? p.emp_code}
              onRemove={() => onRemove(p.id)} />
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                       color: C.faint, pointerEvents: 'none' }}>
          <Icon name="search" size={16} />
        </span>
        <input
          ref={box} id={inputId}
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (!open) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % found.length) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + found.length) % found.length) }
            else if (e.key === 'Enter') { e.preventDefault(); const p = found[cursor]; if (p) choose(p) }
            else if (e.key === 'Escape') { setFound([]) }
          }}
          placeholder={picked.length ? 'Add another colleague' : 'Search by name or employee code'}
          aria-label="Search for a colleague"
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          autoComplete="off"
          style={{ ...inputStyle, paddingLeft: 38 }}
        />
        {searching && (
          <span className="wof-skel" style={{ position: 'absolute', right: 12, top: '50%',
                                              transform: 'translateY(-50%)', fontSize: F.micro,
                                              color: C.faint }}>Searching</span>
        )}

        {open && (
          <div id={listId} role="listbox" className="wof-open" style={{
            position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 6px)',
            border: `1px solid ${C.line}`, borderRadius: RAD.tile, background: C.surface,
            boxShadow: '0 14px 34px rgba(15,23,42,.14)', overflow: 'hidden', padding: 4,
          }}>
            {found.map((p, i) => {
              const already = picked.some(x => x.id === p.id)
              return (
                <button key={p.id} type="button" role="option" aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)} onClick={() => choose(p)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                           textAlign: 'left', cursor: 'pointer', padding: '8px 10px',
                           border: 'none', borderRadius: RAD.control, fontFamily: 'inherit',
                           background: i === cursor ? C.brandTint : 'transparent' }}>
                  <Avatar name={p.full_name} size={30} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontSize: F.small, fontWeight: W.semi, color: C.ink }}>
                      {p.full_name}
                    </span>
                    <span style={{ display: 'block', fontSize: F.micro, color: C.muted }}>
                      {[p.emp_code, p.designation].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {already && <span style={{ fontSize: F.micro, color: C.brand, fontWeight: W.semi }}>Added</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {noMatch && (
        <div style={{ fontSize: F.micro, color: C.muted, marginTop: 6 }}>
          Nobody current matches &ldquo;{query.trim()}&rdquo;. Try a surname or the employee code.
        </div>
      )}
    </div>
  )
}
