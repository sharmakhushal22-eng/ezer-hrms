'use client';
// app/dashboard/layout.tsx — the shell every dashboard page sits inside.
//
// The rail used to be 25 flat items labelled with emoji. At that length a flat
// list stops being navigation and becomes a search problem: nothing is where
// you expect, and on a short screen half of it is below the fold.
//
// It is now six labelled groups following how the work actually divides —
// people, then their time, then their money, then the paperwork, then setup.
// Every route is unchanged; only the grouping and the iconography moved.
//
// Collapsed, the rail keeps just the icons and each group becomes a hairline,
// so the shape of the menu survives at 60px and muscle memory still works.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { C, F, W, S, R, E, M, UIKeyframes } from '@/lib/ui';
import { ThemeToggle } from '@/lib/ui/ThemeToggle';
import { PageTransition, RouteProgress } from '@/lib/ui/PageTransition';
import {
  IconHome, IconRecruitment, IconOnboarding, IconEmployees, IconUpload, IconTransfer,
  IconCalendar, IconClock, IconLeave, IconPayroll, IconFinance, IconCard, IconTravel,
  IconLoans, IconCompliance, IconLetters, IconMobile, IconAdmin, IconPolicies,
  IconSliders, IconBuilding, IconReports, IconDatabase, IconAi, IconSupport,
  IconChevron, IconLogout, type IconProps,
} from '@/lib/ui/icons';

interface NavItem { label: string; href: string; Icon: (p: IconProps) => React.ReactElement }
interface NavGroup { group: string; items: NavItem[] }

// Every href here is identical to the previous flat list. Nothing moved.
const NAV: NavGroup[] = [
  { group: '', items: [
    { label: 'Home', href: '/dashboard', Icon: IconHome },
  ]},
  { group: 'People', items: [
    { label: 'Recruitment',   href: '/dashboard/recruitment', Icon: IconRecruitment },
    { label: 'Onboarding',    href: '/dashboard/onboarding',  Icon: IconOnboarding },
    { label: 'Employees',     href: '/dashboard/employees',   Icon: IconEmployees },
    { label: 'Bulk Uploader', href: '/dashboard/bulk-upload', Icon: IconUpload },
    { label: 'Transfer',      href: '/dashboard/transfer',    Icon: IconTransfer },
  ]},
  { group: 'Time & Attendance', items: [
    { label: 'Attendance & Leave',     href: '/dashboard/attendance',         Icon: IconCalendar },
    { label: 'Attendance Reports',     href: '/dashboard/attendance-reports', Icon: IconClock },
    { label: 'Leave & Holiday Config', href: '/dashboard/leave-upload',       Icon: IconLeave },
  ]},
  { group: 'Money', items: [
    { label: 'Payroll',            href: '/dashboard/payroll',       Icon: IconPayroll },
    { label: 'Finance Department', href: '/dashboard/finance',       Icon: IconFinance },
    { label: 'Flexi Claims',       href: '/dashboard/flexi-claims',  Icon: IconCard },
    { label: 'Travel Claims',      href: '/dashboard/travel-claims', Icon: IconTravel },
    { label: 'Loans',              href: '/dashboard/loans',         Icon: IconLoans },
  ]},
  { group: 'Compliance & Docs', items: [
    { label: 'Compliance',       href: '/dashboard/compliance', Icon: IconCompliance },
    { label: 'HR Letters',       href: '/dashboard/letters',    Icon: IconLetters },
    { label: 'Company Policies', href: '/dashboard/policies',   Icon: IconPolicies },
    { label: 'Reports',          href: '/dashboard/reports',    Icon: IconReports },
  ]},
  { group: 'Setup', items: [
    { label: 'ESS & Role Management', href: '/dashboard/ess',             Icon: IconMobile },
    { label: 'Admin Setup',           href: '/dashboard/admin',           Icon: IconAdmin },
    { label: 'Flexi Policy',          href: '/dashboard/flexi-policy',    Icon: IconSliders },
    { label: 'Company Profile',       href: '/dashboard/company-profile', Icon: IconBuilding },
    { label: 'Database Export',       href: '/dashboard/db-export',       Icon: IconDatabase },
  ]},
  { group: 'Help', items: [
    { label: 'Ezer AI', href: '/dashboard/ai',      Icon: IconAi },
    { label: 'Support', href: '/dashboard/support', Icon: IconSupport },
  ]},
];

const OPEN_W = 244;
const SHUT_W = 60;

/**
 * Is this the page being viewed?
 *
 * Exact match, plus any child route — so /dashboard/payroll/flexi-approval
 * keeps Payroll lit rather than leaving the rail looking like nothing is
 * selected. '/dashboard' is excluded from the prefix test, since every route
 * starts with it.
 */
function isActive(path: string, href: string): boolean {
  if (path === href) return true;
  return href !== '/dashboard' && path.startsWith(href + '/');
}

// Declared at module level, never inside Layout: a component defined inside
// another is a fresh type on every render, which remounts it and drops focus.
function RailItem({ item, open, active }: { item: NavItem; open: boolean; active: boolean }) {
  const { Icon } = item;
  return (
    <Link href={item.href} title={open ? undefined : item.label}
      style={{ textDecoration: 'none', width: '100%', flexShrink: 0 }}>
      <div className="ez-nav" style={{
        height: 36, borderRadius: R.md, display: 'flex', alignItems: 'center',
        gap: 10, padding: open ? '0 10px' : 0,
        justifyContent: open ? 'flex-start' : 'center',
        background: active ? C.railActiveBg : 'transparent',
        color: active ? C.railActiveText : C.railMuted,
        transition: `background ${M.quick}, color ${M.quick}`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* The bar carries the selection when the tint alone is too quiet —
            and it survives at 60px wide, where the label does not. */}
        {active && (
          <span aria-hidden style={{
            position: 'absolute', left: 0, top: 6, bottom: 6, width: 3,
            borderRadius: '0 3px 3px 0', background: C.brand,
          }} />
        )}
        <Icon size={16} strokeWidth={active ? 1.9 : 1.6} />
        {open && (
          <span style={{
            fontSize: F.small, fontWeight: active ? W.semi : W.regular,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{item.label}</span>
        )}
      </div>
    </Link>
  );
}

function GroupLabel({ label, open }: { label: string; open: boolean }) {
  if (!label) return null;
  // Collapsed, the words would not fit — the grouping survives as a rule, so
  // the rail keeps its rhythm instead of becoming one undifferentiated column.
  if (!open) {
    return <div style={{ height: 1, background: C.railLine, margin: '7px 12px', flexShrink: 0 }} />;
  }
  return (
    <div style={{
      fontSize: F.micro, fontWeight: W.bold, letterSpacing: '.1em',
      textTransform: 'uppercase', color: C.railFaint,
      padding: '14px 10px 5px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>{label}</div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const path = usePathname();

  // Auth guard: /dashboard is admin-only. Reads the Supabase session
  // (localStorage) and bounces to the login page if not signed in. Client-side
  // so it works with the existing signInWithPassword session — a cookie-based
  // server middleware would lock everyone out.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) window.location.href = '/';
      else setAuthed(true);
    });
  }, []);

  // Remember the rail. Read after mount so the server and client first paint
  // agree; a value read during render would hydrate mismatched.
  useEffect(() => {
    const saved = localStorage.getItem('ezer_rail_open');
    if (saved !== null) setOpen(saved === '1');
  }, []);
  const toggle = () => setOpen(v => {
    localStorage.setItem('ezer_rail_open', v ? '0' : '1');
    return !v;
  });

  if (authed === null) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: S.md,
        fontFamily: F.family, color: C.muted, fontSize: F.small, background: C.canvas,
      }}>
        <UIKeyframes />
        <div style={{
          width: 38, height: 38, borderRadius: R.md,
          background: `linear-gradient(180deg,${C.brand},${C.brandDeep})`,
          color: C.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: W.bold, fontSize: F.body, boxShadow: E.brand,
        }}>Ez</div>
        Checking access…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: F.family, background: C.canvas }}>
      <UIKeyframes />
      <style>{`
        .ez-nav:hover{background:${C.railHover};color:${C.railText}}
        .ez-brand:hover .ez-brand-chev{transform:translateX(2px)}
      `}</style>

      <nav aria-label="Main" className="ez-scroll" style={{
        width: open ? OPEN_W : SHUT_W,
        transition: `width ${M.slow}`,
        background: C.rail,
        display: 'flex', flexDirection: 'column',
        padding: open ? '12px 10px' : '12px 8px',
        flexShrink: 0, overflow: 'hidden',
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 100,
        borderRight: `1px solid ${C.railLine}`,
      }}>
        {/* Brand, and the collapse control. One target, so the rail never
            needs a second button competing for the same corner. */}
        <button onClick={toggle} className="ez-brand"
          aria-label={open ? 'Collapse menu' : 'Expand menu'}
          title={open ? 'Collapse menu' : 'Expand menu'}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6,
            padding: open ? '4px 4px' : 0, border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
            justifyContent: open ? 'flex-start' : 'center', width: '100%',
          }}>
          <div style={{
            width: 34, height: 34, borderRadius: R.md, flexShrink: 0,
            background: `linear-gradient(180deg,${C.brand},${C.brandDeep})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.onAccent, fontWeight: W.bold, fontSize: F.body, letterSpacing: '-.02em',
            boxShadow: E.brand,
          }}>Ez</div>
          {open && (
            <>
              <span style={{
                fontSize: F.lead, fontWeight: W.bold, color: C.railText,
                letterSpacing: '-.02em', whiteSpace: 'nowrap',
              }}>EZER</span>
              <span className="ez-brand-chev" style={{
                marginLeft: 'auto', color: C.railFaint, display: 'flex',
                transform: 'rotate(180deg)', transition: `transform ${M.quick}`,
              }}><IconChevron size={16} /></span>
            </>
          )}
        </button>

        <div className="ez-scroll" style={{
          flex: 1, minHeight: 0, width: '100%',
          overflowY: 'auto', overflowX: 'hidden',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {NAV.map(g => (
            <div key={g.group || 'root'} style={{ display: 'contents' }}>
              <GroupLabel label={g.group} open={open} />
              {g.items.map(item => (
                <RailItem key={item.href} item={item} open={open}
                  active={isActive(path, item.href)} />
              ))}
            </div>
          ))}
        </div>

        {/* Theme lives with the account controls rather than in a page
            header — it is a preference, not part of any one screen. */}
        <div style={{
          flexShrink: 0, padding: open ? '10px 4px 8px' : '10px 0 8px',
          display: 'flex', justifyContent: open ? 'flex-start' : 'center',
        }}>
          <ThemeToggle compact={!open} />
        </div>

        {/* Eye comfort sits with the theme: both are display preferences that
            belong to the person, not to any one screen. */}
        <div style={{
          flexShrink: 0, padding: open ? '0 4px 8px' : '0 0 8px',
          display: 'flex', justifyContent: open ? 'flex-start' : 'center',
        }}>
        </div>

        <button
          onClick={() => { supabase.auth.signOut().then(() => { window.location.href = '/'; }); }}
          className="ez-nav"
          title="Sign out"
          style={{
            height: 36, marginTop: 8, flexShrink: 0, borderRadius: R.md,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: open ? '0 10px' : 0, justifyContent: open ? 'flex-start' : 'center',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: C.railMuted, fontFamily: 'inherit', fontSize: F.small,
            borderTop: `1px solid ${C.railLine}`, borderTopLeftRadius: 0, borderTopRightRadius: 0,
          }}>
          <IconLogout size={16} />
          {open && <span>Sign out</span>}
        </button>
      </nav>

      <main style={{
        flex: 1, marginLeft: open ? OPEN_W : SHUT_W,
        transition: `margin-left ${M.slow}`, minWidth: 0,
      }}>
        {/* A route can take a moment to resolve, and in that gap the old page
            is still on screen with nothing to say it is working. */}
        <RouteProgress />
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
