'use client'
// components/broadcast/Channel.tsx — what an employee sees.
//
// A notice board, not an inbox thread. There is no reply control anywhere in
// this file, and that absence is the feature: everybody in the company sees
// these, and a company-wide announcement with a comment section under it
// stops being an announcement.
//
// There IS a way to answer — privately, to the person who published it. It is
// deliberately labelled so nobody sends a private note thinking they are
// posting publicly, or the reverse. That mistake is only made once, but it is
// made in front of the whole company.

import { useState } from 'react'
import { C, F, W, S, R, E } from '@/lib/ui'
import { ordered, canRespond, REPLIES_DISABLED, PRIORITY_LABEL,
         type Broadcast, type Priority } from '@/lib/broadcast/channel'

const TONE: Record<Priority, { fg: string; bg: string }> = {
  URGENT:    { fg: C.critical, bg: C.criticalTint },
  IMPORTANT: { fg: C.warning,  bg: C.warningTint },
  NORMAL:    { fg: C.info,     bg: C.infoTint },
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`
}

export default function Channel({ employeeId, items, readIds, onRead, onRespond, busy }: {
  employeeId: string
  items: Broadcast[]
  readIds: Set<string>
  onRead?: (id: string) => void
  onRespond?: (id: string, body: string) => void
  busy?: string | null
}) {
  const list = ordered(items)

  if (list.length === 0) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: R.lg,
                    padding: '28px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: F.body, fontWeight: W.bold, color: C.ink, marginBottom: 6 }}>
          Nothing has been announced
        </div>
        <div style={{ fontSize: F.small, color: C.muted, lineHeight: 1.7, maxWidth: 460,
                      margin: '0 auto' }}>
          Company-wide notices appear here — policy changes, closures, deadlines. You
          will get a notification when one arrives, so there is no need to keep checking.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: S.sm }}>
      <div style={{ fontSize: F.micro, color: C.muted, lineHeight: 1.6,
                    background: C.sunken, borderRadius: R.sm, padding: '9px 12px' }}>
        {REPLIES_DISABLED}
      </div>

      {list.map(b => (
        <Item key={b.id} b={b} employeeId={employeeId}
              unread={!readIds.has(b.id)}
              onRead={onRead} onRespond={onRespond}
              busy={busy === b.id} />
      ))}
    </div>
  )
}

function Item({ b, employeeId, unread, onRead, onRespond, busy }: {
  b: Broadcast; employeeId: string; unread: boolean
  onRead?: (id: string) => void
  onRespond?: (id: string, body: string) => void
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const tone = TONE[b.priority]
  const may = canRespond(employeeId, b)

  return (
    <article
      onMouseEnter={() => { if (unread) onRead?.(b.id) }}
      style={{ background: C.surface, borderRadius: R.lg, padding: '14px 16px',
               border: `1px solid ${b.priority === 'URGENT' ? C.critical : C.line}`,
               boxShadow: unread ? E.raised : E.flat }}>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                    marginBottom: 6 }}>
        <span style={{ fontSize: F.micro, fontWeight: W.bold, padding: '2px 9px',
                       borderRadius: 999, background: tone.bg, color: tone.fg }}>
          {PRIORITY_LABEL[b.priority]}
        </span>
        {b.isPinned && (
          <span style={{ fontSize: F.micro, fontWeight: W.semi, padding: '2px 9px',
                         borderRadius: 999, background: C.brandTint, color: C.brandDeep }}>
            Pinned
          </span>
        )}
        {unread && (
          <span style={{ fontSize: F.micro, fontWeight: W.bold, color: C.brand }}>New</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: F.micro, color: C.faint }}>
          {when(b.publishedAt)}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: F.lead, fontWeight: W.bold, color: C.ink,
                   lineHeight: 1.35 }}>{b.title}</h3>

      <div style={{ fontSize: F.micro, color: C.muted, marginTop: 3 }}>
        {b.publisherName ?? 'Company'}
        {b.sourceDepartment ? ` · ${b.sourceDepartment}` : ''}
      </div>

      <div style={{ fontSize: F.small, color: C.inkSoft, lineHeight: 1.75, marginTop: 10,
                    whiteSpace: 'pre-wrap' }}>{b.body}</div>

      {/* The ONLY way to answer, and it says what it does before you use it. */}
      {onRespond && may.allowed && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
          {!open ? (
            <button type="button" onClick={() => setOpen(true)}
              style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: F.tiny,
                       fontWeight: W.semi, padding: '6px 12px', borderRadius: R.sm,
                       border: `1px solid ${C.line}`, background: C.surface, color: C.inkSoft }}>
              Reply privately to {b.publisherName ?? 'the sender'}
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <label htmlFor={`r-${b.id}`} style={{ fontSize: F.micro, color: C.muted,
                                                    lineHeight: 1.6 }}>
                Only <strong style={{ color: C.ink }}>{b.publisherName ?? 'the sender'}</strong>{' '}
                will see this. It is not posted to the channel, and nobody else in the
                company can read it.
              </label>
              <textarea id={`r-${b.id}`} value={text} rows={3}
                onChange={e => setText(e.target.value)}
                placeholder="A question, or something that needs correcting"
                style={{ width: '100%', padding: '9px 11px', borderRadius: R.sm,
                         border: `1px solid ${C.line}`, background: C.surface,
                         color: C.ink, fontSize: F.small, fontFamily: 'inherit',
                         resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" disabled={!text.trim() || busy}
                  onClick={() => { onRespond(b.id, text.trim()); setText(''); setOpen(false) }}
                  style={{ cursor: text.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                           fontSize: F.tiny, fontWeight: W.bold, padding: '7px 14px',
                           borderRadius: R.sm, border: 'none',
                           background: text.trim() ? C.brand : C.sunken,
                           color: text.trim() ? C.onAccent : C.faint }}>
                  {busy ? 'Sending…' : 'Send privately'}
                </button>
                <button type="button" onClick={() => { setOpen(false); setText('') }}
                  style={{ cursor: 'pointer', fontFamily: 'inherit', fontSize: F.tiny,
                           fontWeight: W.semi, padding: '7px 12px', borderRadius: R.sm,
                           border: `1px solid ${C.line}`, background: C.surface,
                           color: C.muted }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
