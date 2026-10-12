'use client'
// app/ess-portal/page.tsx — the portal's old address. Every screen now lives under /ess
// (lib/ess/routes.ts); links that still say /ess-portal?tab=… or ?module=…&tab=… are
// forwarded to the canonical path, with the module's own params kept. `replace`, so the
// old address never sits in history.
import { useEffect } from 'react'
import { ESS_BASE } from '@/lib/ess/routes'

export default function EssPortalRedirect() {
  useEffect(() => {
    const q = window.location.search
    // The portal reads the legacy query itself and rewrites the address once mounted.
    window.location.replace(`${ESS_BASE}${q}`)
  }, [])
  return null
}
