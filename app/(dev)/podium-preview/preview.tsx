'use client'
// app/(dev)/podium-preview/preview.tsx — the harness around the podium.
//
// It mounts <Leaderboard> at four row counts with no network and no Supabase.
// Same shape and purpose as the social preview, and it mirrors the same two
// things from the portal so the preview cannot flatter the design:
//
//   * <UIKeyframes/>, which carries `button { border-radius:10px !important }`.
//   * the --ez-* token surface, via var() on a real canvas background.
//
// FIVE rows shows the podium plus the ranks-4-and-5 list, which is where a
// numbering mistake would show. TWO is what the live board actually has. ONE
// is the case the podium deliberately declines to draw.
import { useEffect, useState } from 'react'
import { Leaderboard, type LeaderRow } from '@/components/wall/Spotlight'
import { UIKeyframes } from '@/lib/ui'

const PEOPLE: LeaderRow[] = [
  { employeeId: 'e1', name: 'Aadhar Mehta', designation: 'Senior Analyst', recognitionCount: 9 },
  { employeeId: 'e2', name: 'Amit Bose', designation: 'Plant Supervisor', recognitionCount: 7 },
  { employeeId: 'e3', name: 'Priya Raghavan', designation: 'Quality Lead', recognitionCount: 5 },
  { employeeId: 'e4', name: 'Shreya Reddy', designation: 'Accounts Executive', recognitionCount: 3 },
  { employeeId: 'e5', name: 'Imran Qureshi', designation: 'Logistics Coordinator', recognitionCount: 2 },
]

const CASES = [
  { label: 'Five — podium plus ranks 4 and 5', n: 5 },
  { label: 'Three — the full plinth', n: 3 },
  { label: 'Two — what your live board has', n: 2 },
  { label: 'One — no podium, just a row', n: 1 },
]

const WIDTHS = [
  { label: 'Desktop', w: 1100 },
  { label: 'Portal column', w: 900 },
  { label: 'Tablet', w: 680 },
  { label: 'Phone', w: 390 },
]

export default function Preview() {
  const [w, setW] = useState(900)
  const [dark, setDark] = useState(false)

  // The same attribute ThemeToggle writes, so the gold palette's dark branch
  // is exercised through the real path rather than a private one.
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute('data-ez-theme', dark ? 'dark' : 'light')
    return () => el.removeAttribute('data-ez-theme')
  }, [dark])

  const pill = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--ez-brand)' : 'var(--ez-line)'}`,
    background: on ? 'var(--ez-brand-tint)' : 'var(--ez-surface)',
    color: on ? 'var(--ez-brand)' : 'var(--ez-muted)',
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ez-canvas)', paddingBottom: 60,
                  fontFamily: '"DM Sans","Segoe UI",system-ui,sans-serif' }}>
      <UIKeyframes />
      <div style={{
        position: 'sticky', top: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--ez-surface)',
        borderBottom: '1px solid var(--ez-line)', fontSize: 12.5,
      }}>
        <strong style={{ fontSize: 13, color: 'var(--ez-ink)' }}>Podium — design preview</strong>
        <span style={{ color: 'var(--ez-faint)' }}>mock rows · no network</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WIDTHS.map(x => (
            <button key={x.w} type="button" onClick={() => setW(x.w)} style={pill(w === x.w)}>
              {x.label}
            </button>
          ))}
          <button
            type="button" onClick={() => setDark(d => !d)}
            style={{ ...pill(false), borderColor: 'var(--ez-line-strong)', color: 'var(--ez-ink)' }}
          >{dark ? 'Light' : 'Dark'}</button>
        </span>
      </div>

      <div style={{ width: w, maxWidth: '100%', margin: '18px auto', display: 'grid', gap: 18 }}>
        {CASES.map(c => (
          <div key={c.n} style={{
            border: '1px solid var(--ez-line)', borderRadius: 14, overflow: 'hidden',
            background: 'var(--ez-surface)', boxShadow: 'var(--ez-shadow-raised)',
            padding: '14px 18px 18px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                          textTransform: 'uppercase', color: 'var(--ez-muted)', marginBottom: 12 }}>
              {c.label}
            </div>
            <Leaderboard rows={PEOPLE.slice(0, c.n)} enabled />
          </div>
        ))}

        <div style={{
          border: '1px solid var(--ez-line)', borderRadius: 14,
          background: 'var(--ez-surface)', padding: '14px 18px 18px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
                        textTransform: 'uppercase', color: 'var(--ez-muted)', marginBottom: 12 }}>
            Switched off
          </div>
          <Leaderboard rows={PEOPLE} enabled={false} />
        </div>
      </div>
    </div>
  )
}
