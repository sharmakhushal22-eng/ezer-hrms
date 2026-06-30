'use client'
// app/ess-portal/page.tsx — Renders the ESS portal for the logged-in employee (localStorage session).
import { useState, useEffect } from 'react'
import EmployeePortal from '@/components/ess/EmployeePortal'

type Session = { employee_id: string; name?: string; email?: string }

export default function ESSPortalPage() {
  const [mounted, setMounted] = useState(false)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    setMounted(true)
    let parsed: Session | null = null
    try {
      const raw = localStorage.getItem('ezer_ess_session')
      if (raw) {
        const obj = JSON.parse(raw)
        if (obj && obj.employee_id) parsed = obj
      }
    } catch { parsed = null }

    if (!parsed) {
      window.location.href = '/ess-login'
      return
    }
    setSession(parsed)
  }, [])

  const onExit = () => {
    localStorage.removeItem('ezer_ess_session')
    window.location.href = '/ess-login'
  }

  if (!mounted || !session) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F5F3FF', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: '#6B7280', fontSize: 14,
      }}>
        Loading your portal…
      </div>
    )
  }

  return <EmployeePortal employeeId={session.employee_id} onExit={onExit} />
}
