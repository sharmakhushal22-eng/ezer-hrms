'use client'
// app/dashboard/learning/page.tsx — People → Learning. EZER Learn now opens as a product of its
// own at /learning (app/learning), so this address only forwards there: to the Studio, the HR and
// L&D workspace. It stays because the sidebar, the module map (lib/rms/modules.ts), old
// notification links and the ESS admin host (components/ess/AdminModules.tsx) all point here.
import { useEffect } from 'react'

export default function LearningPage() {
  useEffect(() => { window.location.replace('/learning/studio') }, [])
  return <div style={{ padding: 32, fontSize: 14, opacity: 0.7 }}>Opening EZER Learn…</div>
}
