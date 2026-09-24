'use client'
// components/employees/IdCardsTab.tsx — HR downloads an employee's ID card.
//
// The list, the scope banner, the readiness pills, the preview and the bulk
// export. Every authorisation decision is made on the SERVER (app/api/idcard/*
// and lib/idcard/authz.ts); nothing here is a security control. If this file
// showed a button it should not, the route would still refuse — which is the
// only arrangement worth having, because a hidden button stops nobody who can
// open devtools.
//
// The card is rendered here rather than server-side on purpose: it is drawn on
// a canvas, and the employee's own ESS download already uses this exact code.
// One implementation, so the printed card and the digital one cannot drift.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { authToken } from '@/lib/rms/client'
import {
  buildIdCardsPdf, idCardsFileName, idCardFileName, drawFront, drawBack,
  type IdCardData,
} from '@/lib/profile/id-card-pdf'
import {
  Button, Person, Th, Td, Tr, Empty, SkeletonRows,
  C, F, W, S, R, E, IconDownload, IconSearch,
} from '@/lib/ui'
// From tokens directly: the barrel re-exports the palette, but Z is the layer
// scale and the ratchet in lib/ui/__tests__/zindex-ratchet.test.ts exists to
// stop exactly the raw `zIndex: 1000` this file had a moment ago.
import { Z } from '@/lib/ui/tokens'

type Gap = 'EMERGENCY' | 'BLOOD' | 'PHOTO'

interface Row {
  id: string
  emp_code: string | null
  full_name: string | null
  designation: string | null
  department_name: string | null
  location_name: string | null
  location_id: string | null
  employment_status: string | null
  gaps: Gap[]
  cardNo: string | null
  validTill: string | null
  /** Null when downloadable; a sentence when not. */
  blocked: string | null
}

interface LogRow {
  id: string
  downloaded_at: string
  actor_label: string | null
  actor_role_codes: string[] | null
  subject_emp_code: string | null
  format: string
  batch_size: number
}

/** Same helper PayslipDownload and IdCardDownload each keep privately — it is
 *  four lines and exporting it from one of them would make an unrelated
 *  component a dependency of this one. */
function saveBlob(name: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.style.display = 'none'
  document.body.appendChild(a); a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1000)
}

/** A signed photo URL drawn onto a canvas taints it, and toDataURL() then
 *  throws SecurityError. Fetching the bytes first keeps the canvas clean. A
 *  failure is not fatal: the card falls back to initials. */
async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>(resolve => {
      const fr = new FileReader()
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null)
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch { return null }
}

const GAP_LABEL: Record<Gap, string> = {
  EMERGENCY: 'No emergency contact',
  BLOOD: 'No blood group',
  PHOTO: 'No photo',
}

function pill(text: string, bg: string, fg: string) {
  return (
    <span key={text} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: R.pill,
      fontSize: F.micro, fontWeight: W.semi, background: bg, color: fg,
      whiteSpace: 'nowrap', marginRight: 4,
    }}>{text}</span>
  )
}

export default function IdCardsTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [scope, setScope] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState<LogRow[]>([])
  const [logErr, setLogErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ row: Row; front: string; back: string } | null>(null)
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abort.current?.abort()
    const ac = new AbortController(); abort.current = ac
    // Yield before touching state. This is called straight from an effect, and
    // a setState in the synchronous body of one cascades a second render
    // before the first has painted — react-hooks/set-state-in-effect. `loading`
    // already starts true, so the first paint is correct without it.
    await Promise.resolve()
    setLoading(true); setErr(null)
    try {
      const token = await authToken()
      if (!token) { setErr('Your session has expired — sign in again.'); return }
      const res = await fetch('/api/idcard/employees', {
        headers: { Authorization: `Bearer ${token}` }, signal: ac.signal,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j?.error || `Could not load (${res.status}).`); return }
      setRows(j.employees || []); setScope(j.scope || '')
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setErr((e as Error)?.message || 'Network error')
    } finally { setLoading(false) }
  }, [])

  // A mount-time fetch — the case react's own guidance allows, because this
  // effect synchronises the component with an external system (the API) and
  // every setState inside load() runs after its first await. The rule flags
  // any setState reachable through the callee and cannot see across that
  // await, so it is silenced with the reason rather than by restructuring
  // into something harder to read purely to satisfy a linter.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return () => abort.current?.abort() }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => `${r.full_name || ''} ${r.emp_code || ''}`.toLowerCase().includes(q))
  }, [rows, search])

  const stats = useMemo(() => {
    const open = rows.filter(r => !r.blocked)
    return {
      inScope: rows.length,
      ready: open.filter(r => r.gaps.length === 0).length,
      noEmg: open.filter(r => r.gaps.includes('EMERGENCY')).length,
      noPhoto: open.filter(r => r.gaps.includes('PHOTO')).length,
    }
  }, [rows])

  const selectedIds = useMemo(
    () => shown.filter(r => sel[r.id] && !r.blocked).map(r => r.id),
    [shown, sel],
  )

  /** Fetch card payloads, turn the photos into data URLs, render, save. The
   *  server writes the audit row; `logged` coming back short of what was asked
   *  for is worth surfacing rather than swallowing. */
  const download = useCallback(async (ids: string[], label: string) => {
    if (!ids.length) return
    setBusy(label); setErr(null); setFlash(null)
    try {
      const token = await authToken()
      if (!token) { setErr('Your session has expired — sign in again.'); return }
      const res = await fetch('/api/idcard/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j?.error || `Download failed (${res.status}).`); return }

      const payload = (j.cards || []) as { id: string; photoUrl: string | null; card: IdCardData }[]
      if (!payload.length) {
        setErr(j.skipped?.[0]?.reason || 'Nothing could be downloaded.')
        return
      }
      const cards: IdCardData[] = []
      for (const p of payload) {
        cards.push({ ...p.card, photoDataUrl: await toDataUrl(p.photoUrl) })
      }
      const bytes = await buildIdCardsPdf(cards)
      saveBlob(cards.length === 1 ? idCardFileName(cards[0]) : idCardsFileName(cards.length),
        bytes, 'application/pdf')

      const skipped = (j.skipped || []) as { reason: string }[]
      setFlash(
        `${cards.length} card${cards.length === 1 ? '' : 's'} downloaded and recorded.` +
        (skipped.length ? ` ${skipped.length} skipped — ${skipped[0].reason}` : ''),
      )
      setSel({})
    } catch (e) {
      setErr((e as Error)?.message || 'Download failed.')
    } finally { setBusy(null) }
  }, [])

  /** Preview renders the real card through the real renderer, so what is shown
   *  is what a printer would produce — not an approximation of it. */
  const openPreview = useCallback(async (row: Row) => {
    setBusy(`preview:${row.id}`); setErr(null)
    try {
      const token = await authToken()
      if (!token) { setErr('Your session has expired — sign in again.'); return }
      const res = await fetch('/api/idcard/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [row.id] }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(j?.error || 'Could not build a preview.'); return }
      const p = (j.cards || [])[0] as { photoUrl: string | null; card: IdCardData } | undefined
      if (!p) { setErr(j.skipped?.[0]?.reason || 'Nothing to preview.'); return }
      const card = { ...p.card, photoDataUrl: await toDataUrl(p.photoUrl) }
      const [f, b] = [await drawFront(card), await drawBack(card)]
      setPreview({ row, front: f.toDataURL('image/png'), back: b.toDataURL('image/png') })
    } catch (e) {
      setErr((e as Error)?.message || 'Preview failed.')
    } finally { setBusy(null) }
  }, [])

  const loadLog = useCallback(async () => {
    setLogErr(null)
    const token = await authToken()
    if (!token) { setLogErr('Your session has expired — sign in again.'); return }
    const res = await fetch('/api/idcard/log', { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setLogErr(j?.error || `Could not load the log (${res.status}).`); return }
    setLog(j.rows || [])
  }, [])

  // No effect for this: the log is fetched by the button that opens it. An
  // effect keyed on `showLog` would call setState in its own body, and a click
  // handler is where a fetch caused by a click belongs anyway.

  const card: React.CSSProperties = {
    background: C.surface, borderRadius: R.lg, border: `1px solid ${C.line}`,
    marginBottom: S.md, boxShadow: E.raised,
  }

  if (err && !rows.length && !loading) {
    return (
      <div style={{ ...card, padding: S.xl }}>
        <Empty
          icon={<IconDownload size={20} />}
          title="ID Cards are not part of your access"
          hint={err}
        />
      </div>
    )
  }

  return (
    <div>
      {/* Scope — said out loud. A Branch HR seeing 40 of 398 people should be
          told why, or the screen looks broken rather than restricted. */}
      {scope && scope !== 'all' && (
        <div style={{
          ...card, padding: `${S.sm}px ${S.md}px`, fontSize: F.small, color: C.muted,
          borderLeft: `3px solid ${C.brand}`,
        }}>
          {scope === 'locations'
            ? 'You can download cards for employees at your assigned location only. The limit comes from how your role was assigned, not from the role itself.'
            : 'You can download cards for employees in your own company.'}
        </div>
      )}

      <div style={{ display: 'flex', gap: S.sm, marginBottom: S.md, flexWrap: 'wrap' }}>
        {[
          { k: 'In your scope', v: stats.inScope, c: C.ink },
          { k: 'Cards ready', v: stats.ready, c: C.positive },
          { k: 'No emergency contact', v: stats.noEmg, c: stats.noEmg ? C.critical : C.ink },
          { k: 'No photo', v: stats.noPhoto, c: stats.noPhoto ? C.warning : C.ink },
        ].map(s2 => (
          <div key={s2.k} style={{ ...card, flex: '1 1 150px', padding: `${S.sm}px ${S.md}px`, marginBottom: 0 }}>
            <div style={{ fontSize: F.micro, color: C.muted, fontWeight: W.semi }}>{s2.k}</div>
            <div style={{ fontSize: 20, fontWeight: W.bold, color: s2.c }}>{loading ? '—' : s2.v}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, display: 'flex', gap: S.sm, alignItems: 'center', flexWrap: 'wrap', padding: `${S.sm}px ${S.md}px` }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint, display: 'flex', pointerEvents: 'none' }}>
            <IconSearch size={16} />
          </span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Name or employee code…"
            style={{
              width: '100%', height: 34, paddingLeft: 30, fontSize: F.small,
              border: `1px solid ${C.lineStrong}`, borderRadius: R.md,
              background: C.surface, color: C.ink, fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
        <Button size="sm" onClick={() => {
          const next = !showLog
          setShowLog(next)
          if (next) void loadLog()
        }}>
          {showLog ? 'Hide download log' : 'Download log'}
        </Button>
        <Button size="sm" onClick={() => void load()}>Refresh</Button>
      </div>

      {flash && (
        <div style={{ ...card, padding: `${S.sm}px ${S.md}px`, fontSize: F.small, color: C.positive, borderLeft: `3px solid ${C.positive}` }}>
          {flash}
        </div>
      )}
      {err && rows.length > 0 && (
        <div style={{ ...card, padding: `${S.sm}px ${S.md}px`, fontSize: F.small, color: C.critical, borderLeft: `3px solid ${C.critical}` }}>
          {err}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div style={{
          ...card, padding: `${S.sm}px ${S.md}px`, display: 'flex', alignItems: 'center',
          gap: S.sm, flexWrap: 'wrap', borderLeft: `3px solid ${C.brand}`,
        }}>
          <b style={{ fontSize: F.small }}>{selectedIds.length} selected</b>
          <span style={{ fontSize: F.micro, color: C.muted }}>
            Bulk export is one PDF — a browser blocks a burst of separate downloads.
          </span>
          <span style={{ flex: 1 }} />
          <Button size="sm" onClick={() => setSel({})}>Clear</Button>
          <Button size="sm" variant="primary" disabled={!!busy}
                  onClick={() => void download(selectedIds, 'bulk')}>
            {busy === 'bulk' ? 'Preparing…' : 'Download as one PDF'}
          </Button>
        </div>
      )}

      {showLog && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: `${S.sm}px ${S.md}px`, fontSize: F.small, fontWeight: W.semi }}>
            Download log
            <span style={{ fontWeight: W.medium, color: C.muted }}> — who downloaded whose card, and when</span>
          </div>
          {logErr && <div style={{ padding: `${S.sm}px ${S.md}px`, fontSize: F.small, color: C.critical }}>{logErr}</div>}
          {!logErr && (
            <div style={{ overflowX: 'auto', maxHeight: 280, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.small }}>
                <thead><tr><Th>When</Th><Th>Who</Th><Th>Whose card</Th><Th>Format</Th><Th>Batch</Th></tr></thead>
                <tbody>
                  {log.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: S.lg, textAlign: 'center', color: C.faint, fontSize: F.small }}>
                      Nothing downloaded yet.
                    </td></tr>
                  )}
                  {log.map(l => (
                    <Tr key={l.id}>
                      <Td>{new Date(l.downloaded_at).toLocaleString('en-IN')}</Td>
                      <Td>{l.actor_label || '—'}
                        <div style={{ fontSize: F.micro, color: C.faint }}>{(l.actor_role_codes || []).join(', ')}</div>
                      </Td>
                      <Td mono>{l.subject_emp_code || '—'}</Td>
                      <Td>{String(l.format || '').toUpperCase()}</Td>
                      <Td>{l.batch_size}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: F.small }}>
            <thead>
              <tr>
                <Th style={{ width: 34 }}>
                  <input type="checkbox"
                         checked={selectedIds.length > 0 && selectedIds.length === shown.filter(r => !r.blocked).length}
                         onChange={e => {
                           const on = e.target.checked
                           const next: Record<string, boolean> = {}
                           for (const r of shown) if (!r.blocked) next[r.id] = on
                           setSel(on ? next : {})
                         }} />
                </Th>
                <Th>Employee</Th><Th>Designation</Th><Th>Department</Th>
                <Th>Location</Th><Th>Card data</Th><Th style={{ textAlign: 'right' }}>Card</Th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ padding: 0 }}><SkeletonRows rows={8} /></td></tr>}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={7}>
                  <Empty icon={<IconSearch size={20} />} title="No employees match"
                         hint="Try a different name or code." />
                </td></tr>
              )}
              {!loading && shown.map(r => (
                <Tr key={r.id}>
                  <Td>
                    {!r.blocked && (
                      <input type="checkbox" checked={!!sel[r.id]}
                             onChange={() => setSel(s2 => ({ ...s2, [r.id]: !s2[r.id] }))} />
                    )}
                  </Td>
                  <Td><Person name={r.full_name || '—'} meta={r.emp_code || '—'} /></Td>
                  <Td>{r.designation || '—'}</Td>
                  <Td>{r.department_name || '—'}</Td>
                  <Td>{r.location_name || '—'}</Td>
                  <Td>
                    {r.gaps.length === 0
                      ? pill('Complete', C.positiveTint, C.positive)
                      : r.gaps.map(g => pill(
                          GAP_LABEL[g],
                          g === 'EMERGENCY' ? C.criticalTint : C.sunken,
                          g === 'EMERGENCY' ? C.critical : C.muted,
                        ))}
                  </Td>
                  <Td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.blocked
                      ? <span style={{ fontSize: F.micro, color: C.faint }}>{r.blocked}</span>
                      : <>
                          <Button size="sm" disabled={!!busy} onClick={() => void openPreview(r)}>
                            {busy === `preview:${r.id}` ? '…' : 'Preview'}
                          </Button>{' '}
                          <Button size="sm" variant="primary" disabled={!!busy}
                                  onClick={() => void download([r.id], `row:${r.id}`)}>
                            {busy === `row:${r.id}` ? 'Preparing…' : 'PDF'}
                          </Button>
                        </>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: Z.modal,
            display: 'grid', placeItems: 'center', padding: S.lg,
          }}>
          <div style={{ ...card, marginBottom: 0, padding: S.lg, maxWidth: 560, width: '100%' }}>
            <div style={{ fontSize: F.body, fontWeight: W.bold, marginBottom: 2 }}>
              {preview.row.full_name}
            </div>
            <div style={{ fontSize: F.small, color: C.muted, marginBottom: S.md }}>
              {preview.row.emp_code} · this is the card as it will print
            </div>
            <div style={{ display: 'flex', gap: S.md, justifyContent: 'center', flexWrap: 'wrap' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.front} alt="Front" style={{ width: 190, borderRadius: 10, boxShadow: E.raised }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.back} alt="Back" style={{ width: 190, borderRadius: 10, boxShadow: E.raised }} />
            </div>
            <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end', marginTop: S.lg }}>
              <Button onClick={() => setPreview(null)}>Close</Button>
              <Button variant="primary" disabled={!!busy}
                      onClick={() => { const id = preview.row.id; setPreview(null); void download([id], `row:${id}`) }}>
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
