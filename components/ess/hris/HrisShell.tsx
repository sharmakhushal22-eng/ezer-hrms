'use client'
/**
 * HrisShell — the HRIS section, redesigned.
 *
 * Replaces the render layer of the four screens that were split across
 * EmployeePortal.tsx (Directory, Requests) and RoleTabs.tsx (Approvals, Exit).
 * Every endpoint, payload and rule underneath is unchanged.
 *
 * NAVIGATION STAYS THE PORTAL'S. The shell draws its own sub-tabs because the
 * design calls for a sliding indicator and per-tab counts, but the active tab is
 * the portal's `view` and picking one calls `go()`. So the sidebar, deep links
 * from Home ("pending on you" → approvals) and the travel-claims hand-off all
 * keep working, and there is still one source of truth for where you are.
 *
 * All four stay mounted once opened: switching tabs must not throw away a
 * half-written request or a filtered roster.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './hris.css'
// The same token helper RoleTabs used, so these calls are byte-identical.
import { authToken } from '@/lib/rms/client'
import type { HrisTab } from './types'
import { Ic } from './icons'
import { ToastHost } from './ui'
import { TeamDirectory } from './TeamDirectory'
import { RaiseRequest } from './RaiseRequest'
import { TasksApprovals } from './TasksApprovals'
import { ExitProcess } from './ExitProcess'

const TABS: { k: HrisTab; label: string }[] = [
  { k: 'directory', label: 'Team Directory' },
  { k: 'requests', label: 'Raise a Request' },
  { k: 'approvals', label: 'Tasks & Approvals' },
  { k: 'exit', label: 'Exit Process' },
]

interface Props {
  employeeId: string
  tab: HrisTab
  /** The portal's navigator — keeps `view` and the sidebar in step. */
  go: (k: string) => void
  /** False when /api/ess/menu says this login cannot approve. */
  canApprove: boolean
}

export function HrisShell({ employeeId, tab, go, canApprove }: Props) {
  return (
    <ToastHost>
      <Shell employeeId={employeeId} tab={tab} go={go} canApprove={canApprove} />
    </ToastHost>
  )
}

function Shell({ employeeId, tab, go, canApprove }: Props) {
  const tabs = useMemo(() => TABS.filter(t => t.k !== 'approvals' || canApprove), [canApprove])
  const [query, setQuery] = useState('')
  const [reqCount, setReqCount] = useState(0)
  const [apprCount, setApprCount] = useState(0)
  const [seen, setSeen] = useState<Set<HrisTab>>(() => new Set([tab]))

  const rootRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const indRef = useRef<HTMLSpanElement>(null)

  useEffect(() => { setSeen(s => (s.has(tab) ? s : new Set(s).add(tab))) }, [tab])

  /** The indicator is measured off the live tab, so it survives font swaps. */
  const moveIndicator = useCallback(() => {
    const nav = navRef.current, ind = indRef.current
    if (!nav || !ind) return
    const on = nav.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!on) return
    ind.style.width = `${on.offsetWidth}px`
    ind.style.transform = `translateX(${on.offsetLeft}px)`
  }, [])

  useLayoutEffect(() => {
    moveIndicator()
    const nav = navRef.current
    if (!nav) return
    const ro = new ResizeObserver(moveIndicator)
    ro.observe(nav)
    if (document.fonts?.ready) void document.fonts.ready.then(moveIndicator)
    return () => ro.disconnect()
  }, [moveIndicator, tab, tabs.length])

  /** The same authorized fetch RoleTabs used — session token + employee_id. */
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await authToken()
    const sep = path.includes('?') ? '&' : '?'
    const res = await fetch(`${path}${sep}employee_id=${encodeURIComponent(employeeId)}`, {
      ...init, cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    return body
  }, [employeeId])

  function onTabKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length
    go(tabs[next].k)
  }

  return (
    <div className="hx" ref={rootRef}>
      <div className="hx-app">
        <header className="hx-head">
          <div className="hx-head-in">
            <div className="hx-head-top">
              <div className="hx-mark" aria-hidden="true"><Ic k="doc" /></div>
              <div className="hx-title">
                <h1>HRIS <span className="hx-badge">Partly available</span></h1>
                <span className="desc">Directory, requests, approvals and the exit process</span>
              </div>
              <div className="hx-head-tools">
                <label className="hx-search" title="Search the directory">
                  <Ic k="search" />
                  <input value={query} placeholder="Search directory…" aria-label="Search directory"
                    onChange={e => { setQuery(e.target.value); if (tab !== 'directory') go('directory') }} />
                </label>
              </div>
            </div>

            <nav className="hx-nav" aria-label="HRIS screens" ref={navRef}>
              <div className="hx-nav-track" role="tablist">
                {tabs.map((t, i) => (
                  <button key={t.k} className="hx-tab" role="tab" id={`hx-tab-${t.k}`}
                    aria-controls={`hx-pane-${t.k}`} aria-selected={tab === t.k}
                    onClick={() => go(t.k)} onKeyDown={e => onTabKey(e, i)}>
                    {t.label}
                    {t.k === 'requests' && reqCount > 0 && <span className="ct">{reqCount}</span>}
                    {t.k === 'approvals' && apprCount > 0 && <span className="ct warn">{apprCount}</span>}
                  </button>
                ))}
              </div>
              <span className="hx-ind" ref={indRef} aria-hidden="true" />
            </nav>
          </div>
        </header>

        <main className="hx-main">
          {/* Mounted on first visit and kept, so a half-written request or a
              filtered roster survives a detour to another tab. */}
          <Pane k="directory" tab={tab} seen={seen}>
            <TeamDirectory query={query} onQuery={setQuery} />
          </Pane>
          <Pane k="requests" tab={tab} seen={seen}>
            <RaiseRequest employeeId={employeeId} onCount={setReqCount} />
          </Pane>
          {canApprove && (
            <Pane k="approvals" tab={tab} seen={seen}>
              <TasksApprovals employeeId={employeeId} api={api} go={go} onCount={setApprCount} />
            </Pane>
          )}
          <Pane k="exit" tab={tab} seen={seen}>
            <ExitProcess api={api} />
          </Pane>
        </main>
      </div>
    </div>
  )
}

function Pane({ k, tab, seen, children }: {
  k: HrisTab; tab: HrisTab; seen: Set<HrisTab>; children: React.ReactNode
}) {
  if (!seen.has(k)) return null
  return (
    <section className={`hx-pane${tab === k ? ' on enter' : ''}`} id={`hx-pane-${k}`}
      role="tabpanel" aria-labelledby={`hx-tab-${k}`} tabIndex={0}>
      {children}
    </section>
  )
}
