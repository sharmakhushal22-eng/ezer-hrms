'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const nav = [
  { icon: '🏠', label: 'Home', href: '/dashboard' },
  { icon: '🎯', label: 'Recruitment', href: '/dashboard/recruitment' },
  { icon: '🚀', label: 'Onboarding', href: '/dashboard/onboarding' },
  { icon: '👥', label: 'Employees', href: '/dashboard/employees' },
  { icon: '📅', label: 'Attendance & Leave', href: '/dashboard/attendance' },
  { icon: '🌴', label: 'Leave & Holiday Config', href: '/dashboard/leave-upload' },
  { icon: '💰', label: 'Payroll', href: '/dashboard/payroll' },
  { icon: '⚖️', label: 'Compliance', href: '/dashboard/compliance' },
  { icon: '📝', label: 'HR Letters', href: '/dashboard/letters' },
  { icon: '📱', label: 'ESS & Role Management', href: '/dashboard/ess' },
  { icon: '🔧', label: 'Admin Setup', href: '/dashboard/admin' },
  { icon: '📜', label: 'Company Policies', href: '/dashboard/policies' },
  { icon: '🏢', label: 'Company Profile', href: '/dashboard/company-profile' },
  { icon: '📊', label: 'Reports', href: '/dashboard/reports' },
  { icon: '🤖', label: 'Ezer AI', href: '/dashboard/ai' },
  { icon: '🎧', label: 'Support', href: '/dashboard/support' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [authed, setAuthed] = useState<boolean | null>(null)
  const path = usePathname()
  // Auth guard: /dashboard is admin-only. Reads the Supabase session (localStorage) and
  // bounces to the login page if not signed in. (Client-side so it works with the existing
  // signInWithPassword session — a cookie-based server middleware would lock everyone out.)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.href = '/'
      else setAuthed(true)
    })
  }, [])
  if (authed === null) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"DM Sans","Segoe UI",sans-serif', color: '#7C3AED' }}>Checking access…</div>
  )
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: '"DM Sans","Segoe UI",sans-serif' }}>
      <div style={{ width: open ? '220px' : '56px', transition: 'width 0.25s', background: '#1E1B4B', display: 'flex', flexDirection: 'column', alignItems: open ? 'flex-start' : 'center', padding: open ? '14px 10px' : '14px 0', gap: '2px', flexShrink: 0, overflow: 'hidden', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100 }}>
        <div onClick={() => setOpen(!open)} style={{ width: '36px', height: '36px', background: '#7C3AED', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '14px', cursor: 'pointer', flexShrink: 0 }}>
          {open ? '←' : 'Ez'}
        </div>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} style={{ textDecoration: 'none', width: open ? '100%' : '36px' }}>
            <div style={{ height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px', padding: open ? '0 10px' : '0', justifyContent: open ? 'flex-start' : 'center', background: path === n.href ? '#7C3AED' : 'transparent', transition: 'background .15s', width: '100%' }}>
              <span style={{ fontSize: '16px', flexShrink: 0, width: '20px', textAlign: 'center' }}>{n.icon}</span>
              {open && <span style={{ fontSize: '12px', fontWeight: path === n.href ? 500 : 400, color: path === n.href ? '#fff' : 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap' }}>{n.label}</span>}
            </div>
          </Link>
        ))}
      </div>
      <div style={{ flex: 1, marginLeft: open ? '220px' : '56px', transition: 'margin-left 0.25s', minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}