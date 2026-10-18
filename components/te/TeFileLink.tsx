'use client'
// components/te/TeFileLink.tsx — opening a stored bill or RC photo.
//
// Every upload path in this module worked and nothing could read the files
// back: te.fileUrl had no caller anywhere, so a bill was write-only. That is
// worst for an approver, who is asked to agree to an amount with the evidence
// for it on the other side of a wall.
//
// WHY A BUTTON AND NOT A LINK. The file lives in a private bucket. There is no
// durable URL to put in an href — the server mints a signed one that lasts an
// hour, and minting it is a request. So the href does not exist until after a
// click.
//
// WHY THE TAB IS OPENED FIRST. A browser only allows window.open during the
// click that caused it. Opening after the await would be blocked as a popup,
// so a blank tab is claimed synchronously and pointed at the file once the
// link arrives. If the browser blocks even that, the tab is null and we say so
// rather than failing silently.
import { useState } from 'react'
import { te } from '@/lib/te/client'
import { errorText } from '@/lib/te/format'
import type { Uuid } from '@/lib/te/types'
import TeIcon from './TeIcon'

export default function TeFileLink({ path, name, claimId, kind, small }: {
  /** te_expense_files.storage_path, or a vehicle's rc_file_url. */
  path: string | null | undefined
  /** What to call it on the button. */
  name?: string | null
  /** Needed for a file that is not the caller's own: the server checks the
   *  file really is a bill of this claim before it signs anything. */
  claimId?: Uuid
  kind?: string | null
  small?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A line the Travel Desk booked carries a stand-in "file" with no path: the
  // booking itself is the proof. There is nothing to open, so offer nothing.
  if (!path) return null

  // AN EXTERNAL LINK IS NOT A STORED FILE. A requested stay carries the page
  // the employee found it on — makemytrip.com/… — in the same slot a bill
  // uses. Handing that to te.fileUrl would get "That is not a Travel and
  // Expenses file", because the route only signs paths under te/bills/. So an
  // http(s) address is rendered as what it is: a link out.
  if (/^https?:\/\//i.test(path)) {
    return (
      <a className={small ? 'btn sm' : 'btn'} href={path} target="_blank" rel="noopener noreferrer">
        <TeIcon name="go" size="sm" />
        {name || 'Open the booking page'}
      </a>
    )
  }

  async function open() {
    // Claimed during the click, before any await.
    const tab = window.open('', '_blank', 'noopener,noreferrer')
    setBusy(true); setError('')
    try {
      const r = await te.fileUrl(path!, claimId)
      if (tab) tab.location.href = r.url
      else setError('Your browser blocked the new tab. Allow pop-ups for this site to open the file.')
    } catch (e) {
      tab?.close()
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={small ? 'btn sm' : 'btn'} disabled={busy} onClick={open}>
        <TeIcon name="file" size="sm" />
        {busy ? 'Opening…' : name || (kind === 'RC' ? 'Open the RC photo' : 'Open the bill')}
      </button>
      {error ? <p className="small muted">{error}</p> : null}
    </>
  )
}
