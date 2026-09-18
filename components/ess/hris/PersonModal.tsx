'use client'
/**
 * The colleague detail dialog.
 *
 * Focus is trapped while it is open and returned to the card that opened it on
 * close — a modal that drops focus to the top of the document makes a keyboard
 * user walk the whole page back to where they were.
 */
import { useEffect, useRef } from 'react'
import type { DirectoryRow } from './types'
import { Ic } from './icons'
import { avatarStyle, initials } from './ui'

export function PersonModal({ person, onClose }: { person: DirectoryRow | null; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const open = !!person

  useEffect(() => { if (open) closeBtn.current?.focus() }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { onClose(); return }
      if (ev.key !== 'Tab' || !box.current) return
      const f = Array.from(box.current.querySelectorAll<HTMLElement>(
        'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])',
      )).filter(x => !(x as HTMLButtonElement).disabled && x.offsetParent !== null)
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus() }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const e = person
  const digits = (e?.mobile || '').replace(/\D/g, '').slice(-10)

  return (
    <div className={`hx-scrim${open ? ' open' : ''}`} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div className="hx-modal" role="dialog" aria-modal="true" aria-label="Colleague details" ref={box}>
        {e && (
          <>
            <div className="mh">
              <div className="hx-av" style={{ ...avatarStyle(e.full_name), width: 48, height: 48, fontSize: 15 }}>
                {initials(e.full_name)}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{e.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ez-muted)' }}>{e.designation || '—'} · {e.emp_code}</div>
              </div>
              <button className="cl" ref={closeBtn} onClick={onClose} aria-label="Close"><Ic k="x" /></button>
            </div>
            <div className="mb">
              <Row l="Department" v={e.dept_name} />
              <Row l="Location" v={e.location_name} />
              <Row l="Office email" v={e.office_email} />
              <Row l="Mobile" v={e.mobile} />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                {e.office_email && <a className="hx-btn o" style={{ textDecoration: 'none', flex: 1 }} href={`mailto:${e.office_email}`}><Ic k="mail" />Email</a>}
                {e.mobile && <a className="hx-btn o" style={{ textDecoration: 'none', flex: 1 }} href={`tel:${e.mobile}`}><Ic k="phone" />Call</a>}
                {digits && <a className="hx-btn o" style={{ textDecoration: 'none', flex: 1 }} href={`https://wa.me/91${digits}`} target="_blank" rel="noreferrer"><Ic k="chat" />WhatsApp</a>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ l, v }: { l: string; v: string | null | undefined }) {
  return <div className="hx-drow"><span className="l">{l}</span><span className="v">{v || '—'}</span></div>
}
