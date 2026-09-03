'use client'
// app/pms-preview/page.tsx — a test harness, not a product screen.
//
// The real PMS sits behind auth and behind migration 066, so neither a
// screenshot nor an overflow probe can reach the tabs through it. This mounts
// each one directly, in a <section data-case> the harnesses key off.
//
// It is kept rather than deleted after use, because deleting it makes
// scripts/pms-overflow.py and scripts/pms-ux.py unrunnable — a suite you
// cannot re-run is a suite that stops being true. It renders nothing outside
// development, so no unauthenticated route ships.

import { ConfigTab, PolicyTab, FillTab, UploadTab, PipTab, ReportsTab,
         FlowTab } from '@/components/pms/AdminTabs'
import '@/components/pms/pms.css'

const CASES: [string, React.ReactNode][] = [
  ['config',   <ConfigTab key="c" freq="QUARTERLY" onFreq={() => {}}
                          fyStart="2026-04-01" fyLabel="2026-27" today="2026-09-03" />],
  ['policies', <PolicyTab key="p" policies={[]} people={[]} />],
  ['fill',     <FillTab key="f" rows={[]} deptNames={{}} loading={false} />],
  ['upload',   <UploadTab key="u" />],
  ['pip',      <PipTab key="i" queue={[]} />],
  ['reports',  <ReportsTab key="r" />],
  ['flow',     <FlowTab key="h" />],
]

export default function PmsPreview() {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div className="pms" style={{ padding: 24, maxWidth: 1440, margin: '0 auto' }}>
      {CASES.map(([name, node]) => (
        <section key={name} data-case={name} style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em',
                       color: 'var(--ez-faint)', marginBottom: 10 }}>{name}</h2>
          {node}
        </section>
      ))}
    </div>
  )
}
