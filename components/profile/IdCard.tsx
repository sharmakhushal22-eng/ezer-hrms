'use client'
// components/profile/IdCard.tsx — the digital ID card, with a live QR.
//
// The card flips. The front is the printed-badge face: photo, name,
// designation, code, joining date, blood group, emergency number. The back
// is the scannable code and a countdown.
//
// THE ROTATION IS THE POINT. A token lives 30 seconds and the card asks for
// a fresh one every 15, so there is always a live overlap and the guard
// never meets a dead code. Refresh pauses while the tab is hidden and fires
// the moment it is visible again — a phone in a pocket should not burn
// through the rate limit, and a phone pulled out at the gate should show a
// live code immediately rather than a stale one for a beat.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { authHeaders } from '@/lib/auth-headers'

interface Issued {
  token: string; url: string; expiresAt: number
  ttl: number; refresh: number
  cardNo: string; validTill: string | null; accessZones: string[]
}

const ini = (n: string) => n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const pretty = (v?: string | null) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? v
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function IdCard({ name, designation, company, code, doj, blood, emergency }: {
  name: string; designation: string; company: string
  code: string; doj?: string | null; blood?: string | null; emergency?: string | null
}) {
  const [back, setBack] = useState(false)
  const [tok, setTok] = useState<Issued | null>(null)
  const [png, setPng] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchToken = useCallback(async () => {
    try {
      const res = await fetch('/api/ess/id-card/token', { headers: await authHeaders() })
      const body = await res.json().catch(() => null)
      if (!res.ok) { setErr(body?.error ?? `Could not get a code (${res.status}).`); return }
      setErr(null); setTok(body as Issued)
      // The QR encodes the URL a phone camera opens, not the bare token —
      // pointing a camera at it should land on the verify screen, not paste
      // a string into a search box.
      setPng(await QRCode.toDataURL((body as Issued).url, {
        width: 460, margin: 1, errorCorrectionLevel: 'M',
        color: { dark: '#0F172A', light: '#FFFFFF' },
      }))
    } catch {
      setErr('Could not reach the server.')
    }
  }, [])

  // Only while the back is showing. A card sitting on its front face has no
  // business minting gate codes.
  useEffect(() => {
    if (!back) { if (timer.current) clearTimeout(timer.current); return }
    let live = true
    const cycle = async () => {
      if (!live) return
      if (document.visibilityState === 'visible') await fetchToken()
      timer.current = setTimeout(cycle, 15_000)
    }
    cycle()
    const onVis = () => { if (document.visibilityState === 'visible') fetchToken() }
    document.addEventListener('visibilitychange', onVis)
    return () => { live = false; document.removeEventListener('visibilitychange', onVis)
                   if (timer.current) clearTimeout(timer.current) }
  }, [back, fetchToken])

  useEffect(() => {
    if (!tok) return
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((tok.expiresAt - Date.now()) / 1000))), 250)
    return () => clearInterval(t)
  }, [tok])

  return (
    <div className="dig">
      <div className="brandline"><span className="mark">EZ</span>{company}</div>

      {!back ? (
        <>
          <div className="top">
            <div className="ph">{ini(name)}</div>
            <div style={{ minWidth: 0 }}>
              <div className="nm">{name}</div>
              <div className="ds">{designation}</div>
            </div>
          </div>
          <div className="grid2">
            <div><div className="lb">Employee code</div><div className="vv">{code}</div></div>
            <div><div className="lb">Date of joining</div><div className="vv">{pretty(doj)}</div></div>
            <div><div className="lb">Blood group</div><div className="vv">{blood || '—'}</div></div>
            <div><div className="lb">Emergency</div>
                 <div className="vv">{(emergency || '').split('·').pop()?.trim() || '—'}</div></div>
          </div>
        </>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', gap: 10, padding: '4px 0 2px' }}>
          {err ? (
            <div className="note" style={{ background: 'rgba(255,255,255,.16)', textAlign: 'center' }}>{err}</div>
          ) : png ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={png} alt="Scan at the gate" width={172} height={172}
                   style={{ borderRadius: 10, display: 'block', background: '#fff', padding: 6 }} />
              <div style={{ fontSize: 11, opacity: .9, textAlign: 'center' }}>
                {left > 0
                  ? <>Valid for <b>{left}s</b> · single use</>
                  : <>Refreshing…</>}
              </div>
              <div style={{ fontSize: 10, opacity: .75, textAlign: 'center' }}>
                Card {tok?.cardNo}{tok?.accessZones?.length ? ` · ${tok.accessZones.join(', ')}` : ''}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, opacity: .85, padding: '28px 0' }}>Getting a code…</div>
          )}
        </div>
      )}

      <button className="btn wide" style={{ marginTop: 12, background: 'rgba(255,255,255,.18)',
                                            borderColor: 'rgba(255,255,255,.3)' }}
              onClick={() => setBack(b => !b)}>
        {back ? 'Show card' : 'Show QR'}
      </button>
    </div>
  )
}
