'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useGrant } from '@/lib/rms-client'
import { canSee, hasAdminAccess, moduleForPath, type Grant, type Module } from '@/lib/permissions'

// Every entry carries the module it belongs to, so the sidebar and the URL guard answer
// from the same source. Home has no module — anyone who can reach the dashboard at all
// can see the landing page.
const nav: { icon: string; label: string; href: string; module: Module | null }[] = [
  { icon: '🏠', label: 'Home', href: '/dashboard', module: null },
  { icon: '🎯', label: 'Recruitment', href: '/dashboard/recruitment', module: 'Recruitment' },
  { icon: '🚀', label: 'Onboarding', href: '/dashboard/onboarding', module: 'Onboarding' },
  { icon: '👥', label: 'Employees', href: '/dashboard/employees', module: 'Employees' },
  { icon: '📤', label: 'Bulk Uploader', href: '/dashboard/bulk-upload', module: 'Bulk Upload' },
  { icon: '🔄', label: 'Transfer', href: '/dashboard/transfer', module: 'Transfer' },
  { icon: '📅', label: 'Attendance & Leave', href: '/dashboard/attendance', module: 'Attendance' },
  { icon: '🕒', label: 'Attendance Reports', href: '/dashboard/attendance-reports', module: 'Attendance Reports' },
  { icon: '🌴', label: 'Leave & Holiday Config', href: '/dashboard/leave-upload', module: 'Leave Config' },
  { icon: '💰', label: 'Payroll', href: '/dashboard/payroll', module: 'Payroll' },
  { icon: '🏦', label: 'Finance Department', href: '/dashboard/finance', module: 'Finance' },
  { icon: '💳', label: 'Flexi Claims', href: '/dashboard/flexi-claims', module: 'Flexi Claims' },
  { icon: '✈️', label: 'Travel Claims', href: '/dashboard/travel-claims', module: 'Travel Claims' },
  { icon: '💸', label: 'Loans', href: '/dashboard/loans', module: 'Loans' },
  { icon: '⚖️', label: 'Compliance', href: '/dashboard/compliance', module: 'Compliance' },
  { icon: '📝', label: 'HR Letters', href: '/dashboard/letters', module: 'HR Letters' },
  { icon: '📱', label: 'ESS & Role Management', href: '/dashboard/ess', module: 'ESS & Roles' },
  { icon: '🔧', label: 'Admin Setup', href: '/dashboard/admin', module: 'Admin Setup' },
  { icon: '📜', label: 'Company Policies', href: '/dashboard/policies', module: 'Policies' },
  { icon: '🎛️', label: 'Flexi Policy', href: '/dashboard/flexi-policy', module: 'Flexi Claims' },
  { icon: '🏢', label: 'Company Profile', href: '/dashboard/company-profile', module: 'Company Profile' },
  { icon: '📊', label: 'Reports', href: '/dashboard/reports', module: 'Reports' },
  { icon: '🗄️', label: 'Database Export', href: '/dashboard/db-export', module: 'Database Export' },
  { icon: '🤖', label: 'Ezer AI', href: '/dashboard/ai', module: 'Ezer AI' },
  { icon: '🎧', label: 'Support', href: '/dashboard/support', module: 'Support' },
]

const FONT = '"DM Sans","Segoe UI",sans-serif'

// ── Sub-components live outside the parent. Declared inside, they would re-mount on
//    every render and any input in a child would lose focus after one keystroke. ──

function Splash({ text }: { text: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, color: '#7C3AED', fontSize: 13 }}>
      {text}
    </div>
  )
}

/** Shown when somebody types the URL of a module they do not hold. A silent redirect
 *  leaves people convinced the page is broken; this says what happened and who to ask. */
function NoAccess({ module, grant }: { module: Module; grant: Grant }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, background: '#F5F3FF', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid rgba(124,58,237,0.12)', boxShadow: '0 1px 4px rgba(124,58,237,0.06)', padding: '26px 28px', maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 26, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#1E1B4B', marginBottom: 6 }}>{module} is not part of your access</div>
        <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.6, marginBottom: 16 }}>
          {grant.roles.length
            ? <>You are signed in as <b style={{ color: '#1E1B4B' }}>{grant.name || 'this user'}</b> with{' '}
                {grant.roles.map(r => r.role_name).join(', ')} — that does not include {module}.</>
            : <>No role has been assigned to you yet, so only your own ESS portal is open.</>}
          <br />Ask HR to add it if you need it.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Link href="/dashboard" style={{ padding: '8px 16px', borderRadius: 7, background: '#7C3AED', color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Dashboard home</Link>
          <Link href="/ess-portal" style={{ padding: '8px 16px', borderRadius: 7, border: '1px solid #DDD6FE', background: '#fff', color: '#6D28D9', fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>My ESS portal</Link>
        </div>
      </div>
    </div>
  )
}

/** Whose session this is, pinned to the bottom of the sidebar. The dashboard is entered
 *  from ESS now, so "which of us is this" and "how do I get back" are questions people
 *  actually have. */
function SidebarFooter({ grant, open }: { grant: Grant; open: boolean }) {
  const initials = (grant.name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  const subtitle = grant.isSuperAdmin ? 'Super Admin'
    : grant.roles.length ? grant.roles.map(r => r.role_name).join(', ')
    : grant.legacy ? 'Legacy login' : 'No role'
  return (
    <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: open ? 'stretch' : 'center', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: open ? '0 4px' : 0, justifyContent: open ? 'flex-start' : 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
        {open && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#fff', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{grant.name || 'Signed in'}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
        )}
      </div>
      <Link href="/ess-portal" style={{ textDecoration: 'none', width: '100%' }}>
        <div style={{ height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, padding: open ? '0 10px' : 0, justifyContent: open ? 'flex-start' : 'center', background: 'rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 13, width: 20, textAlign: 'center', flexShrink: 0 }}>↩</span>
          {open && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>Back to my ESS</span>}
        </div>
      </Link>
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const path = usePathname()
  const { grant, loading } = useGrant()

  // The door. Nobody signed in goes to the ESS login, which is the front door now;
  // somebody signed in with no admin access at all goes back to their own portal rather
  // than staring at an empty sidebar.
  useEffect(() => {
    if (loading) return
    // The answer never arrived — a timed-out request, say. Somebody holding a token
    // should not be thrown out because of that, so they stay where they are and the
    // sidebar behaves as it did before roles existed.
    if (!grant.resolved) return
    if (!grant.employeeId && !grant.legacy) { window.location.href = '/ess-login'; return }
    if (!hasAdminAccess(grant)) { window.location.href = '/ess-portal' }
  }, [loading, grant])

  if (loading) return <Splash text="Checking access…" />
  if (grant.resolved && !grant.employeeId && !grant.legacy) return <Splash text="Taking you to sign in…" />
  if (grant.resolved && !hasAdminAccess(grant)) return <Splash text="Taking you to your ESS portal…" />

  const items = nav.filter(n => canSee(grant, n.module))
  const current = moduleForPath(path || '')
  const blocked = current !== null && !canSee(grant, current)

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: FONT }}>
      <div style={{ width: open ? '220px' : '56px', transition: 'width 0.25s', background: '#1E1B4B', display: 'flex', flexDirection: 'column', alignItems: open ? 'flex-start' : 'center', padding: open ? '14px 10px' : '14px 0', gap: '2px', flexShrink: 0, overflow: 'hidden', position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100 }}>
        <div onClick={() => setOpen(!open)} style={{ width: '36px', height: '36px', background: '#7C3AED', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '14px', marginBottom: '14px', cursor: 'pointer', flexShrink: 0 }}>
          {open ? '←' : 'Ez'}
        </div>
        {/* Scrollable nav list — keeps every item reachable on short screens while the toggle stays pinned */}
        <div className="scroll-on-dark" style={{ flex: 1, minHeight: 0, width: '100%', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: open ? 'flex-start' : 'center', gap: '2px' }}>
          {items.map((n) => (
            <Link key={n.href} href={n.href} style={{ textDecoration: 'none', width: open ? '100%' : '36px', flexShrink: 0 }}>
              <div style={{ height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px', padding: open ? '0 10px' : '0', justifyContent: open ? 'flex-start' : 'center', background: path === n.href ? '#7C3AED' : 'transparent', transition: 'background .15s', width: '100%' }}>
                <span style={{ fontSize: '16px', flexShrink: 0, width: '20px', textAlign: 'center' }}>{n.icon}</span>
                {open && <span style={{ fontSize: '12px', fontWeight: path === n.href ? 500 : 400, color: path === n.href ? '#fff' : 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap' }}>{n.label}</span>}
              </div>
            </Link>
          ))}
        </div>
        <SidebarFooter grant={grant} open={open} />
      </div>
      <div style={{ flex: 1, marginLeft: open ? '220px' : '56px', transition: 'margin-left 0.25s', minWidth: 0 }}>
        {blocked ? <NoAccess module={current as Module} grant={grant} /> : children}
      </div>
    </div>
  )
}
