'use client'
// components/te/TeSheet.tsx — the drawer every form of the module opens in.
// The prototype uses one native <dialog class="drawer"> (te.css styles it and
// its ::backdrop). It must be rendered INSIDE the element with class "te", or
// the stylesheet does not reach it; every caller does that.
import { useEffect, useRef, type ReactNode } from 'react'
import TeIcon from './TeIcon'

export default function TeSheet({ title, lead, crumb, wide, onClose, footer, children }: {
  title: string
  lead?: string
  /** The small line above the title, e.g. "Other expense › Add a bill". */
  crumb?: string
  wide?: boolean
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement | null>(null)

  // showModal() gives the focus trap, the backdrop and Escape for free.
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => { if (d?.open) d.close() }
  }, [])

  return (
    <dialog
      ref={ref}
      className={wide ? 'drawer wide' : 'drawer'}
      aria-label={title}
      onCancel={e => { e.preventDefault(); onClose() }}
    >
      <div className="dl">
        <header>
          <div>
            {crumb ? <div className="fcrumb"><span className="fpath">{crumb}</span></div> : null}
            <h2>{title}</h2>
            {lead ? <p className="muted small">{lead}</p> : null}
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><TeIcon name="close" /></button>
        </header>
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </dialog>
  )
}
