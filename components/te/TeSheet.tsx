'use client'
// components/te/TeSheet.tsx — the drawer every form of the module opens in.
// The prototype uses one native <dialog class="drawer"> (te.css styles it and
// its ::backdrop). It must be rendered INSIDE the element with class "te", or
// the stylesheet does not reach it; every caller does that.
import { useEffect, useRef, type ReactNode } from 'react'
import TeIcon from './TeIcon'

export default function TeSheet({ title, titleIcon, lead, crumb, back, bar, wide, onClose, footer, children }: {
  title: string
  /** The small coloured square before the title, e.g. the trip kind. */
  titleIcon?: ReactNode
  lead?: string
  /** The small line above the title. A node, not a string: the planner's crumb
   *  is a "Step 3 of 3" pill followed by "Domestic trip › Plan a trip". */
  crumb?: ReactNode
  /** Shows a "Back" link above the title. Given, it is the step before. */
  back?: () => void
  /** The strip under the header, for the three-step progress nav. */
  bar?: ReactNode
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
            {back || crumb ? (
              <div className="fcrumb">
                {back ? <button type="button" className="link small" onClick={back}><TeIcon name="back" size="sm" />Back</button> : null}
                {crumb ? <span className="fpath">{crumb}</span> : null}
              </div>
            ) : null}
            <h2>{titleIcon}{title}</h2>
            {lead ? <p className="muted small">{lead}</p> : null}
          </div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><TeIcon name="close" /></button>
        </header>
        {bar ? <div className="wbar">{bar}</div> : null}
        <div className="body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </dialog>
  )
}
