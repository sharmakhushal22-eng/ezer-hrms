'use client'
// components/profile/EssProfile360.tsx — mounts Tushar's Profile 360 inside the
// ESS portal. The vendor shipped it as standalone /ess/profile server pages that
// read a Supabase-auth cookie; this app's ESS is a client SPA on an HMAC bearer
// token, so the data is fetched here with authHeaders and handed to the same
// presentational ProfileShell.
import { useEffect, useState } from 'react'
import { authHeaders } from '@/lib/auth-headers'
import ProfileShell from './ProfileShell'
import './profile.css'
import { C as TK } from '@/lib/ui'

export default function EssProfile360({ code = 'me' }: { code?: string }) {
  const [state, setState] = useState<{ loading: boolean; data: any; error: string | null }>({ loading: true, data: null, error: null })

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await fetch(`/api/ess/profile/${encodeURIComponent(code)}`, { headers: await authHeaders(), cache: 'no-store' })
        const j = await r.json().catch(() => null)
        if (!live) return
        if (!r.ok) { setState({ loading: false, data: null, error: j?.message ?? j?.error ?? `Could not load the profile (${r.status}).` }); return }
        setState({ loading: false, data: j, error: null })
      } catch (e: any) {
        if (live) setState({ loading: false, data: null, error: e?.message ?? 'Could not reach the server.' })
      }
    })()
    return () => { live = false }
  }, [code])

  if (state.loading) return <div style={{ padding: 40, textAlign: 'center', color: TK.muted, fontSize: 13 }}>Loading profile…</div>
  if (state.error) return <div style={{ padding: 20, fontSize: 13, color: TK.critical, background: TK.criticalTint, borderRadius: 10 }}>{state.error}</div>

  const { photoUrl, isSelf, ...data } = state.data
  return <ProfileShell data={data} photoUrl={photoUrl ?? null} isSelf={!!isSelf} />
}
