'use client'
/**
 * Team Directory — redesigned.
 *
 * DATA IS UNCHANGED: loadDirectory() is the same call the old screen made, and
 * the filtering is the same client-side logic — the search splits on
 * [ , ; newline ] and matches ANY term against name, designation, department,
 * code, location or office email, so a list pasted out of a spreadsheet works.
 * A rejected query throws rather than rendering an empty roster, because an
 * empty array reads identically to "nobody found".
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadDirectory } from '@/lib/supabase-ess'
import type { DirectoryRow } from './types'
import { Ic } from './icons'
import { avatarStyle, initials, riseStyle } from './ui'
import { PersonModal } from './PersonModal'

interface Props {
  /** Driven by the header's global search, so the two boxes stay one value. */
  query: string
  onQuery: (q: string) => void
}

export function TeamDirectory({ query, onQuery }: Props) {
  const [rows, setRows] = useState<DirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [dept, setDept] = useState('')
  const [loc, setLoc] = useState('')
  const [open, setOpen] = useState<DirectoryRow | null>(null)
  const animated = useRef(false)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadDirectory()
      .then(r => { if (alive) { setRows(r as unknown as DirectoryRow[]); setErr('') } })
      .catch(e => { if (alive) setErr(e?.message || 'Could not load the directory.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const depts = useMemo(() => [...new Set(rows.map(r => r.dept_name).filter(Boolean))].sort() as string[], [rows])
  const locs = useMemo(() => [...new Set(rows.map(r => r.location_name).filter(Boolean))].sort() as string[], [rows])

  const filtered = useMemo(() => {
    const terms = query.split(/[,;\n]+/).map(t => t.trim().toLowerCase()).filter(Boolean)
    return rows.filter(e => {
      if (dept && e.dept_name !== dept) return false
      if (loc && e.location_name !== loc) return false
      if (!terms.length) return true
      return terms.some(t =>
        e.full_name.toLowerCase().includes(t)
        || (e.designation || '').toLowerCase().includes(t)
        || (e.dept_name || '').toLowerCase().includes(t)
        || (e.emp_code || '').toLowerCase().includes(t)
        || (e.location_name || '').toLowerCase().includes(t)
        || (e.office_email || '').toLowerCase().includes(t))
    })
  }, [rows, query, dept, loc])

  const hasFilter = !!(query || dept || loc)
  const count = loading ? 'Loading colleagues…'
    : `${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ''} colleague${filtered.length === 1 ? '' : 's'}`

  const animate = !animated.current && !loading
  if (!loading) animated.current = true

  return (
    <>
      <div className="hx-card pad" style={{ marginBottom: 0 }}>
        <div className="hx-dir-head">
          <div className="hx-dir-ic"><Ic k="users" /></div>
          <div>
            <div className="t">Employee Directory</div>
            <div className="c">{count}</div>
          </div>
        </div>
        <div className="hx-filters">
          <input className="hx-input grow" value={query} autoComplete="off"
            placeholder="Search name, code, designation, department or email"
            onChange={e => onQuery(e.target.value)} aria-label="Search the directory" />
          <select className="hx-select" value={dept} onChange={e => setDept(e.target.value)} aria-label="Filter by department">
            <option value="">All departments</option>
            {depts.map(d => <option key={d}>{d}</option>)}
          </select>
          <select className="hx-select" value={loc} onChange={e => setLoc(e.target.value)} aria-label="Filter by location">
            <option value="">All locations</option>
            {locs.map(l => <option key={l}>{l}</option>)}
          </select>
          {hasFilter && (
            <button className="hx-btn o" onClick={() => { onQuery(''); setDept(''); setLoc('') }}>Clear filters</button>
          )}
        </div>
      </div>

      {err ? (
        <div className="hx-note d" style={{ marginTop: 14 }}>{err}</div>
      ) : (
        <div className="hx-grid">
          {loading && Array.from({ length: 6 }, (_, i) => (
            <div className="hx-skel" key={i}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="b" style={{ width: 46, height: 46, borderRadius: '50%' }} />
                <div style={{ flex: 1 }}>
                  <div className="b" style={{ height: 12, width: '60%', marginBottom: 8 }} />
                  <div className="b" style={{ height: 9, width: '42%' }} />
                </div>
              </div>
            </div>
          ))}

          {!loading && filtered.length === 0 && (
            <div className="hx-empty">
              <Ic k="search" sw={1.5} />
              <div className="hd">No colleagues match that search</div>
              <div>Try a different name, code or department{(dept || loc) ? ', or clear the filters' : ''}.</div>
            </div>
          )}

          {!loading && filtered.map((e, i) => (
            <PersonCard key={e.id} e={e} animate={animate} i={i}
              onOpen={el => { returnTo.current = el; setOpen(e) }} />
          ))}
        </div>
      )}

      <PersonModal
        person={open}
        onClose={() => { setOpen(null); returnTo.current?.focus() }}
      />
    </>
  )
}

function PersonCard({ e, animate, i, onOpen }: {
  e: DirectoryRow; animate: boolean; i: number; onOpen: (el: HTMLElement) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const digits = (e.mobile || '').replace(/\D/g, '').slice(-10)
  // A click on a contact link is a click on the link, not on the card.
  const stop = (ev: React.MouseEvent) => ev.stopPropagation()
  return (
    <div
      ref={ref}
      className={`hx-person${animate ? ' hx-rise' : ''}`}
      style={animate ? riseStyle(i) : undefined}
      tabIndex={0} role="button" aria-label={`Open ${e.full_name}`}
      onClick={ev => { if (!(ev.target as HTMLElement).closest('[data-stop]')) onOpen(ref.current!) }}
      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(ref.current!) } }}
    >
      <div className="row1">
        <div className="hx-av" style={avatarStyle(e.full_name)}>{initials(e.full_name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="nm">{e.full_name}</div>
          <div className="dg">{e.designation || '—'}</div>
        </div>
      </div>
      {/* Code, department and location share one row at the card's own left
          edge. The code used to sit in the text column beside the avatar, which
          gave the card two competing left edges — an indented header over a
          flush-left body — and made the avatar centre against three lines
          instead of two. */}
      <div className="hx-tags">
        <span className="hx-tag code"><span>{e.emp_code}</span></span>
        {e.dept_name && <span className="hx-tag dept"><span>{e.dept_name}</span></span>}
        {e.location_name && (
          <span className="hx-tag loc"><Ic k="pin" /><span>{e.location_name}</span></span>
        )}
      </div>
      <div className="hx-contacts" data-stop onClick={stop}>
        {e.office_email && <a href={`mailto:${e.office_email}`} title={e.office_email}><Ic k="mail" />Email</a>}
        {e.mobile && <a href={`tel:${e.mobile}`} title={e.mobile}><Ic k="phone" />Call</a>}
        {digits && <a href={`https://wa.me/91${digits}`} target="_blank" rel="noreferrer"><Ic k="chat" />WhatsApp</a>}
      </div>
    </div>
  )
}
