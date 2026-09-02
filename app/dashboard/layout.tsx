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
//
// Every entry also carries the module it belongs to, so the sidebar and the
// direct-URL guard answer from the same place (RMS — see lib/rms). A route
// with module: null (Home) is open to anyone who can reach the dashboard at
// all; anything else is filtered through canSee() before it ever renders.

import { useState, useEffect, useId } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useGrant } from '@/lib/rms/client';
import { moduleForPath, type Module } from '@/lib/rms/modules';
import { canSee, hasAdminAccess, type Grant } from '@/lib/rms/resolve';
import { C, F, W, S, R, E, M, UIKeyframes } from '@/lib/ui';
import { ThemeToggle } from '@/lib/ui/ThemeToggle';
import { Logo, LogoStyles } from '@/lib/ui/Logo';
import { PageTransition, RouteProgress } from '@/lib/ui/PageTransition';
import {
  IconHome, IconRecruitment, IconOnboarding, IconEmployees, IconOrgChart, IconUpload, IconTransfer,
  IconPerformance,
  IconCalendar, IconClock, IconLeave, IconPayroll, IconFinance, IconCard, IconTravel,
  IconLoans, IconCompliance, IconLetters, IconMobile, IconAdmin, IconPolicies,
  IconSliders, IconBuilding, IconReports, IconDatabase, IconAi, IconSupport,
  IconChevron, IconLogout, type IconProps,
} from '@/lib/ui/icons';

interface NavItem { label: string; href: string; Icon: (p: IconProps) => React.ReactElement; module: Module | null }

// ── One hue per destination ─────────────────────────────────────────────────
// Twenty-seven rows all drawn in C.railMuted on a transparent ground is why
// the rail read as a list of words on paper: nothing distinguished Payroll
// from Policies except reading them. Each item now owns a colour, carried on
// its icon tile.
//
// The palette is not twenty-seven arbitrary colours. It walks the wheel BY
// GROUP — People in blues and indigos, Time in cyans, Money in greens and
// ambers, Compliance in violets and roses, Setup in slates, Help in warm —
// so every item is distinct AND the groups still read as families. A random
// assignment would differentiate the items and destroy the grouping.
// ── One blue ──────────────────────────────────────────────────────────────
// This rail used to carry twenty-seven hues, one per module, plus six more
// for the section headings. It was replaced on request with the product's
// own blue, used everywhere.
//
// What did the work before was COLOUR; what does it now is SHAPE. Every row
// is a button — a surface, a hairline, a shadow — and the selected one is
// lifted off the rail rather than merely tinted. That is a stronger signal
// than hue was, and it survives for people who cannot separate twenty-seven
// colours anyway.
//
// Every value comes from the theme tokens (--ez-brand, --ez-brand-deep,
// --ez-brand-tint), so the rail follows the product's blue rather than
// keeping a private copy of it. Measured on both themes: resting label
// 8.2:1 light / 12.9:1 dark, selected label 5.2:1 against the lighter end of
// the gradient, icons 4.0:1 on their tile.

interface NavGroup { group: string; items: NavItem[] }

// Every href here is identical to the previous flat list. Nothing moved except
// Org Chart, which did not exist when this grouping was first drawn.
const NAV: NavGroup[] = [
  { group: '', items: [
    { label: 'Home', href: '/dashboard', Icon: IconHome, module: null },
  ]},
  { group: 'People', items: [
    { label: 'Recruitment',   href: '/dashboard/recruitment', Icon: IconRecruitment, module: 'Recruitment' },
    { label: 'Onboarding',    href: '/dashboard/onboarding',  Icon: IconOnboarding,  module: 'Onboarding' },
    { label: 'Employees',     href: '/dashboard/employees',   Icon: IconEmployees,   module: 'Employees' },
    { label: 'Org Chart',     href: '/dashboard/org-chart',   Icon: IconOrgChart,    module: 'Employees' },
    { label: 'Bulk Uploader', href: '/dashboard/bulk-upload', Icon: IconUpload,      module: 'Bulk Upload' },
    { label: 'Transfer',      href: '/dashboard/transfer',    Icon: IconTransfer,    module: 'Transfer' },
    { label: 'Performance',   href: '/dashboard/pms',         Icon: IconPerformance, module: 'Performance' },
  ]},
  { group: 'Time & Attendance', items: [
    { label: 'Attendance & Leave',     href: '/dashboard/attendance',         Icon: IconCalendar, module: 'Attendance' },
    { label: 'Attendance Reports',     href: '/dashboard/attendance-reports', Icon: IconClock,    module: 'Attendance Reports' },
    { label: 'Leave & Holiday Config', href: '/dashboard/leave-upload',       Icon: IconLeave,    module: 'Leave Config' },
  ]},
  { group: 'Money', items: [
    { label: 'Payroll',            href: '/dashboard/payroll',       Icon: IconPayroll, module: 'Payroll' },
    { label: 'Finance Department', href: '/dashboard/finance',       Icon: IconFinance, module: 'Finance' },
    { label: 'Flexi Claims',       href: '/dashboard/flexi-claims',  Icon: IconCard,    module: 'Flexi Claims' },
    { label: 'Travel Claims',      href: '/dashboard/travel-claims', Icon: IconTravel,  module: 'Travel Claims' },
    { label: 'Loans',              href: '/dashboard/loans',         Icon: IconLoans,   module: 'Loans' },
  ]},
  { group: 'Compliance & Docs', items: [
    { label: 'Compliance',       href: '/dashboard/compliance', Icon: IconCompliance, module: 'Compliance' },
    { label: 'HR Letters',       href: '/dashboard/letters',    Icon: IconLetters,    module: 'HR Letters' },
    { label: 'Company Policies', href: '/dashboard/policies',   Icon: IconPolicies,   module: 'Policies' },
    { label: 'Reports',          href: '/dashboard/reports',    Icon: IconReports,    module: 'Reports' },
  ]},
  { group: 'Setup', items: [
    { label: 'ESS & Role Management', href: '/dashboard/ess',             Icon: IconMobile,   module: 'ESS & Roles' },
    { label: 'Admin Setup',           href: '/dashboard/admin',           Icon: IconAdmin,    module: 'Admin Setup' },
    { label: 'Flexi Policy',          href: '/dashboard/flexi-policy',    Icon: IconSliders,  module: 'Flexi Claims' },
    { label: 'Company Profile',       href: '/dashboard/company-profile', Icon: IconBuilding, module: 'Company Profile' },
    { label: 'Database Export',       href: '/dashboard/db-export',       Icon: IconDatabase, module: 'Database Export' },
  ]},
  { group: 'Help', items: [
    { label: 'Ezer AI', href: '/dashboard/ai',      Icon: IconAi,      module: 'Ezer AI' },
    { label: 'Support', href: '/dashboard/support', Icon: IconSupport, module: 'Support' },
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
function RailItem({ item, open, active, n }: {
  item: NavItem; open: boolean; active: boolean;
  /** Position within its section, so the unfold can deal the rows out in order. */
  n: number;
}) {
  const { Icon } = item;
  return (
    <Link href={item.href} title={open ? undefined : item.label}
      style={{ textDecoration: 'none', width: '100%', flexShrink: 0,
               ['--n' as string]: n }}>
      {/* Colour, depth and motion are all in CSS — an inline background wins
          the cascade, and the dark theme has to be able to change these.
          Only geometry is set here. */}
      <div className={`ez-nav${active ? ' ez-nav-on' : ''}`} style={{
        height: 40, display: 'flex', alignItems: 'center',
        gap: 10, padding: open ? '0 8px' : 0,
        justifyContent: open ? 'flex-start' : 'center',
        position: 'relative',
      }}>
        {/* Collapsed to 60px there is no label and no room for the button to
            grow, so the selection needs something that reads at that width.
            Coloured in CSS, because on a filled blue button it has to be the
            accent's own ink rather than blue on blue. */}
        {active && (
          <span className="ez-nav-bar" aria-hidden style={{
            position: 'absolute', left: 3, top: 8, bottom: 8, width: 3,
            borderRadius: 3,
          }} />
        )}

        {/* The icon tile. A glyph on its own reads as grey at 15px; a filled
            tile behind it is a solid block, which is what gives the button
            something to be built around. */}
        <span className="ez-nav-tile" aria-hidden style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} strokeWidth={active ? 2 : 1.7} />
        </span>

        {open && (
          <span style={{
            // 13.5/600, not 13/500. The module name is the thing being read on
            // this rail, and at medium weight in a secondary grey it was losing
            // to its own icon tile — the colour arrived first and the word came
            // second. Measured against the 172px of label width the rail has:
            // 13.5/600 renders the longest name, "ESS & Role Management", at
            // 160px. 14/600 comes to 166px, which fits but leaves 6px, and that
            // is not enough margin for a face whose metrics differ from the one
            // measured. Selected rows go to 700 and one ink darker.
            fontSize: 13.5,
            fontWeight: active ? W.bold : W.semi,
            letterSpacing: '-.005em',
            color: active ? C.railText : C.railItem,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{item.label}</span>
        )}
      </div>
    </Link>
  );
}

/**
 * A section: its heading, which is also the control that opens and closes it,
 * and its items.
 *
 * The heading keeps the three devices it already had — the RULE above it says
 * a section ended, the DOT and ink say which section this is, the SPINE says
 * how far it reaches. What is new is that it now folds.
 *
 * WHEN A SECTION IS SHUT it still has to answer "is the page I am on in
 * there?", or closing a section means losing your place. So a shut section
 * shows how many rows it is hiding, and — if the current route is one of them
 * — a rotating ring around its dot. That is the whole reason the fold is safe
 * to use: nothing is hidden without being accounted for.
 */
function GroupBlock({ group, index, items, railOpen, path, expanded, onToggle }: {
  group: string; index: number; items: NavItem[]; railOpen: boolean;
  path: string; expanded: boolean; onToggle: () => void;
}) {
  // Stable across server and client. A module-level counter is not, and that
  // is exactly how the logo produced a hydration mismatch earlier.
  const rid = useId();
  const panelId = 'ezsec' + rid.replace(/[^a-zA-Z0-9]/g, '');

  const hasActive = items.some(it => isActive(path, it.href));
  // Only meaningful once the section is shut — open, the active row is right
  // there and saying it twice is noise.
  const here = hasActive && Boolean(group) && railOpen && !expanded;
  // Collapsed to 60px there is no heading to click, so nothing can be folded
  // shut — a rail with no labels and no way to reopen a section would be a
  // trap. The root group has no heading either, so it never folds.
  const foldable = Boolean(group) && railOpen;
  const shown = foldable ? expanded : true;

  return (
    <div className={`ez-group${shown ? ' ez-open' : ''}${group ? '' : ' ez-group-plain'}`}
      style={{ ['--i' as string]: index }}>
      {foldable && (
        <button type="button" className={`ez-group-head${here ? ' ez-here-head' : ''}`}
          onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}
          title={here ? `${group} — you are on a page in here. Click to show it.`
                      : `${expanded ? 'Hide' : 'Show'} ${group}`}>
          <span className="ez-dotwrap" aria-hidden>
            <span className="ez-group-dot" />
          </span>
          <span className="ez-group-name">{group}</span>
          {!expanded && (
            <span className={`ez-count${here ? ' ez-count-here' : ''}`}>
              {items.length}
              {/* The wash and the pill are colour, and colour alone is not a
                  message. Screen readers get the words. */}
              <span className="ez-sr">
                {here ? ' hidden items, including the page you are on' : ' hidden items'}
              </span>
            </span>
          )}
          <span className="ez-fold" aria-hidden>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                 stroke="currentColor" strokeWidth="1.8"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4.5 6 7.8 9 4.5" />
            </svg>
          </span>
        </button>
      )}
      {Boolean(group) && !railOpen && <div className="ez-group-rule-shut" aria-hidden />}

      {/* Height is animated in CSS — see .ez-group-panel for why it is
          grid-template-rows and not anything else. */}
      <div id={panelId} className="ez-group-panel" inert={foldable && !expanded ? true : undefined}>
        <div className="ez-group-panel-inner">
          <div className={Boolean(group) && railOpen ? 'ez-group-items' : 'ez-group-items ez-group-bare'}>
            {items.map((item, n) => (
              <RailItem key={item.href} item={item} open={railOpen} n={n}
                active={isActive(path, item.href)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FONT = '"DM Sans","Segoe UI",sans-serif'

// Geist is already downloaded, self-hosted and variable-fonted by next/font in
// app/layout.tsx; --font-geist-sans is the family name it publishes. The stack
// behind it is what shows if that variable is ever removed.
const RAIL_FONT = 'var(--font-geist-sans), "Segoe UI", system-ui, -apple-system, sans-serif'

// ── Sub-components live outside the parent. Declared inside, they re-mount on every
//    render and any input in a child loses focus after one keystroke. ──

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

/** Whose session this is, pinned to the bottom of the sidebar, with the way back to ESS.
 *  Both are questions people started having once the dashboard stopped being one shared
 *  login. */
function SidebarFooter({ grant, open }: { grant: Grant; open: boolean }) {
  const initials = (grant.name || '?').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  const subtitle = grant.isSuperAdmin ? 'Super Admin'
    : grant.roles.length ? grant.roles.map(r => r.role_name).join(', ')
    : grant.legacy ? 'Legacy login' : 'No role'
  return (
    <div style={{ width: '100%', borderTop: `1px solid ${C.railLine}`, paddingTop: 10, marginTop: 6, display: 'flex', flexDirection: 'column', alignItems: open ? 'stretch' : 'center', gap: 8, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: open ? '0 4px' : 0, justifyContent: open ? 'flex-start' : 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: 99, background: C.railActiveBg, color: C.railActiveText, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{initials}</div>
        {open && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.railText, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{grant.name || 'Signed in'}</div>
            <div style={{ fontSize: 10, color: C.railFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
        )}
      </div>
      <Link href="/ess-portal" className="ez-nav" style={{ textDecoration: 'none', width: '100%' }}>
        <div style={{ height: 30, borderRadius: R.md, display: 'flex', alignItems: 'center', gap: 8, padding: open ? '0 10px' : 0, justifyContent: open ? 'flex-start' : 'center' }}>
          <span style={{ fontSize: 13, width: 20, textAlign: 'center', flexShrink: 0, color: C.railMuted }}>↩</span>
          {open && <span style={{ fontSize: 11, color: C.railMuted, whiteSpace: 'nowrap' }}>Back to my ESS</span>}
        </div>
      </Link>
    </div>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const path = usePathname();
  const { grant, loading } = useGrant();

  // The door. Nobody signed in goes to the login page; somebody signed in with
  // no admin module at all goes back to their own portal rather than staring
  // at an empty sidebar.
  useEffect(() => {
    if (loading) return;
    // The answer never arrived — a timed-out request, say. Somebody holding a
    // token is not thrown out because of that; they stay, unenforced.
    if (!grant.resolved) return;
    if (!grant.employeeId && !grant.legacy) { window.location.href = '/'; return; }
    if (!hasAdminAccess(grant)) { window.location.href = '/ess-portal'; }
  }, [loading, grant]);

  // Which sections are folded open. Empty means "everything open", which is
  // both the sensible default and what the rail did before it could fold — so
  // nobody's first load looks like modules went missing.
  const [sections, setSections] = useState<Record<string, boolean>>({});
  const isOpenSection = (g: string) => sections[g] ?? true;
  const toggleSection = (g: string) => setSections(prev => {
    const next = { ...prev, [g]: !(prev[g] ?? true) };
    localStorage.setItem('ezer_rail_sections', JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    const raw = localStorage.getItem('ezer_rail_sections');
    if (!raw) return;
    // A hand-edited or half-written value should not take the sidebar down.
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object') setSections(v as Record<string, boolean>);
    } catch { localStorage.removeItem('ezer_rail_sections'); }
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

  const showGate = loading || (grant.resolved && (!grant.employeeId && !grant.legacy || !hasAdminAccess(grant)));
  if (showGate) {
    const gateText = loading ? 'Checking access…'
      : !grant.employeeId && !grant.legacy ? 'Taking you to sign in…'
      : 'Taking you to your ESS portal…';
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
        {gateText}
      </div>
    );
  }

  // Every route is filtered through the same grant a direct URL is checked
  // against below — a module the sidebar hides is a module the URL guard
  // blocks too, from one source of truth (lib/rms).
  const current = moduleForPath(path);
  const blocked = current !== null && !canSee(grant, current);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: F.family, background: C.canvas }}>
      <LogoStyles />
      <UIKeyframes />
      <style>{`
        /* ── Every row is a button ──────────────────────────────────────
           A surface, a hairline and a shadow, so an unselected item still
           reads as something you press. Tinted with the product's blue at
           4% rather than left flat white — enough to belong to the rail,
           not enough to compete with the selected one. */
        .ez-nav{
          border-radius: 11px;
          border: 1px solid ${C.line};
          background:
            linear-gradient(180deg,
              color-mix(in srgb, ${C.brand} 5%, ${C.surface}),
              color-mix(in srgb, ${C.brand} 1%, ${C.surface}));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.55),
            0 1px 1.5px rgba(15,23,42,.05);
          color: ${C.railItem};
          transition:
            transform .18s cubic-bezier(.2,.8,.2,1),
            box-shadow .18s ease, background .18s ease, border-color .18s ease;
        }
        .ez-nav:hover{
          transform: translateY(-1px);
          border-color: ${C.brandEdge};
          background: linear-gradient(180deg,
            color-mix(in srgb, ${C.brand} 12%, ${C.surface}),
            color-mix(in srgb, ${C.brand} 5%, ${C.surface}));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.6),
            0 3px 8px -2px rgba(37,99,235,.28);
        }
        /* Pressed goes DOWN. A button that only ever rises never feels
           clicked. */
        .ez-nav:active{ transform: translateY(0) scale(.985); box-shadow: inset 0 1px 3px rgba(15,23,42,.14) }
        .ez-nav:focus-visible{ outline: 2px solid ${C.brand}; outline-offset: 2px }

        /* ── The selected one pops ──────────────────────────────────────
           Lifted 2px, scaled 2%, filled with the brand gradient, and
           carrying a coloured cast shadow so it sits ABOVE the rail rather
           than on it. The inner highlight along the top edge is what makes
           it read as a physical key rather than a blue rectangle. */
        .ez-nav-on, .ez-nav-on:hover{
          background: linear-gradient(180deg, ${C.brand}, ${C.brandDeep});
          border-color: ${C.brandDeep};
          color: ${C.onAccent};
          transform: translateY(-2px) scale(1.02);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.38),
            0 2px 4px rgba(15,23,42,.10),
            0 10px 22px -8px color-mix(in srgb, ${C.brand} 75%, transparent);
          animation: ezPop .34s cubic-bezier(.34,1.56,.64,1) both;
        }
        .ez-nav-on:active{ transform: translateY(-1px) scale(1.005) }
        /* Overshoot, then settle — the "pop". A plain ease would just be a
           row changing colour. */
        @keyframes ezPop{
          0%   { transform: translateY(-2px) scale(.96) }
          55%  { transform: translateY(-3px) scale(1.045) }
          100% { transform: translateY(-2px) scale(1.02) }
        }

        /* The bar that survives at 60px, where the label does not. */
        .ez-nav-on .ez-nav-bar{
          background: ${C.onAccent};
          box-shadow: 0 0 8px rgba(255,255,255,.45);
        }

        /* ── The icon tile ──────────────────────────────────────────────
           Opaque against the button so the row's own tint cannot bleed
           through and move its contrast. */
        .ez-nav-tile{
          background: color-mix(in srgb, ${C.brand} 14%, ${C.surface});
          color: ${C.brand};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
          transition: transform .18s cubic-bezier(.2,.8,.2,1), background .18s ease, color .18s ease;
        }
        .ez-nav:hover .ez-nav-tile{ transform: translateY(-1px) scale(1.05) }
        .ez-nav-on .ez-nav-tile{
          background: rgba(255,255,255,.22);
          color: ${C.onAccent};
          box-shadow: inset 0 1px 0 rgba(255,255,255,.42);
        }

        /* ── Sections ───────────────────────────────────────────────────
           Neutral now. The heading is a label and a rule; it no longer
           carries a colour of its own, because the rail has one colour. */
        .ez-group{ display:flex; flex-direction:column; flex-shrink:0 }
        .ez-group-items{ display:flex; flex-direction:column; gap:5px; position:relative }
        .ez-group-panel{
          display:grid; grid-template-rows:0fr;
          transition: grid-template-rows .34s cubic-bezier(.22,1,.36,1);
        }
        .ez-open > .ez-group-panel{ grid-template-rows:1fr }
        .ez-group-panel-inner{ overflow:hidden; min-height:0 }

        /* Rows unfold on a hinge from their own top edge — the motion that
           says "this was folded away" rather than "this arrived". */
        .ez-group-items{ perspective: 640px; perspective-origin: top center }
        .ez-group-items > a{
          transform-origin: top center;
          transform: rotateX(-72deg); opacity:0;
          transition: transform .30s cubic-bezier(.2,.9,.3,1), opacity .2s ease;
        }
        .ez-open .ez-group-items > a{
          transform:none; opacity:1;
          transition-delay: calc(var(--n) * 26ms);
        }

        .ez-group-head{
          position:relative; display:flex; align-items:center; gap:8px;
          padding:16px 6px 7px; white-space:nowrap; flex-shrink:0;
          width:100%; border:none; background:none; font:inherit;
          cursor:pointer; text-align:left; -webkit-tap-highlight-color:transparent;
        }
        .ez-group-head::before,
        .ez-group-rule-shut{
          content:''; display:block; height:1px; border-radius:1px;
          background: linear-gradient(90deg, ${C.line}, transparent 82%);
        }
        .ez-group-head::before{ position:absolute; left:6px; right:6px; top:0 }
        .ez-group-rule-shut{ margin:9px 8px 8px; flex-shrink:0 }

        .ez-group-name{
          font-size:${F.micro}px; font-weight:${W.bold}; letter-spacing:.12em;
          text-transform:uppercase; color:${C.railFaint};
          overflow:hidden; text-overflow:ellipsis;
          transition: color .2s ease;
        }
        .ez-group-head:hover .ez-group-name{ color:${C.brand} }
        .ez-group-head:focus-visible{ outline:2px solid ${C.brand}; outline-offset:-2px; border-radius:8px }

        .ez-count{
          font-size:9.5px; font-weight:${W.bold}; line-height:1;
          padding:3px 5px; border-radius:5px; flex-shrink:0;
          font-variant-numeric: tabular-nums;
          color:${C.brandDeep}; background:${C.brandTint};
        }
        /* "The page you are on is inside this shut section." */
        .ez-here-head{ background: ${C.brandTint}; border-radius:8px }
        .ez-count-here{
          background:${C.brand}; color:${C.onAccent};
          animation: ez-here-pulse 2.2s ease-out infinite;
        }
        @keyframes ez-here-pulse{
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, ${C.brand} 55%, transparent) }
          70%  { box-shadow: 0 0 0 6px transparent }
          100% { box-shadow: 0 0 0 0 transparent }
        }

        /* A chevron: right when shut, down when open. */
        .ez-fold{
          margin-left:auto; flex-shrink:0;
          display:flex; align-items:center; justify-content:center;
          width:20px; height:20px; border-radius:7px;
          color:${C.railFaint}; background:transparent;
          transition: background .2s ease, color .2s ease;
        }
        .ez-group-head:hover .ez-fold,
        .ez-group-head:focus-visible .ez-fold{ background:${C.brandTint}; color:${C.brand} }
        .ez-fold svg{
          transform: rotate(-90deg);
          transition: transform .38s cubic-bezier(.22,1,.36,1);
        }
        .ez-open .ez-fold svg{ transform: rotate(0deg) }

        .ez-sr{
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0;
        }
        .ez-dotwrap{ display:none }

        .ez-brand:hover .ez-brand-chev{transform:translateX(2px)}

        /* Dark. The tokens already flip — brand becomes a LIGHT blue and
           on-accent becomes near-black — so the selected button needs nothing
           here. What DOES need correcting is the resting surface, and the
           :not(.ez-nav-on) is load-bearing: these selectors are more specific
           than .ez-nav-on, so without it the dark override silently won and
           the selected button lost its blue fill entirely. */
        @media (prefers-color-scheme: dark){
          :root:not([data-ez-theme="light"]) .ez-nav:not(.ez-nav-on){
            /* In dark, --ez-surface and --ez-rail are THE SAME COLOUR, so a
               button built on the surface token had no surface at all — only
               its border showed, and the rail read as a list of outlines.
               Built on the lifted hover token instead, so a button sits above
               the rail the way it does in light. */
            background: linear-gradient(180deg,
              color-mix(in srgb, ${C.brand} 10%, ${C.railHover}),
              color-mix(in srgb, ${C.brand} 4%, ${C.railHover}));
            border-color: ${C.railLine};
            box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 1px 2px rgba(0,0,0,.4);
          }
          :root:not([data-ez-theme="light"]) .ez-nav:not(.ez-nav-on):hover{
            background: linear-gradient(180deg,
              color-mix(in srgb, ${C.brand} 20%, ${C.railHover}),
              color-mix(in srgb, ${C.brand} 10%, ${C.railHover}));
            border-color: ${C.brandEdge};
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 4px 10px -3px rgba(96,165,250,.35);
          }
        }
        :root[data-ez-theme="dark"] .ez-nav:not(.ez-nav-on){
            /* In dark, --ez-surface and --ez-rail are THE SAME COLOUR, so a
               button built on the surface token had no surface at all — only
               its border showed, and the rail read as a list of outlines.
               Built on the lifted hover token instead, so a button sits above
               the rail the way it does in light. */
            background: linear-gradient(180deg,
              color-mix(in srgb, ${C.brand} 10%, ${C.railHover}),
              color-mix(in srgb, ${C.brand} 4%, ${C.railHover}));
            border-color: ${C.railLine};
            box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 1px 2px rgba(0,0,0,.4);
          }
        :root[data-ez-theme="dark"] .ez-nav:not(.ez-nav-on):hover{
            background: linear-gradient(180deg,
              color-mix(in srgb, ${C.brand} 20%, ${C.railHover}),
              color-mix(in srgb, ${C.brand} 10%, ${C.railHover}));
            border-color: ${C.brandEdge};
            box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 4px 10px -3px rgba(96,165,250,.35);
          }

        @media (prefers-reduced-motion: reduce){
          .ez-nav, .ez-nav-tile, .ez-group-panel, .ez-group-items > a,
          .ez-fold, .ez-fold svg, .ez-group-name{ transition:none }
          .ez-nav:hover, .ez-nav:active, .ez-nav:hover .ez-nav-tile{ transform:none }
          .ez-nav-on, .ez-nav-on:hover{ animation:none; transform:none }
          .ez-open .ez-group-items > a{ transition-delay:0ms; transform:none; opacity:1 }
          .ez-count-here{ animation:none }
        }
      `}</style>

      <nav aria-label="Main" className="ez-scroll" style={{
        // The rail asked for "DM Sans" — as 71 files in this repo do — and DM
        // Sans is not loaded anywhere, so every one of those declarations fell
        // through to plain sans-serif. Meanwhile app/layout.tsx already loads
        // Geist through next/font and exposes it as --font-geist-sans, and
        // nothing had ever used it. This points the rail at the face that is
        // actually there: self-hosted, no network request, no CSP exposure.
        //
        // Scoped to the nav rather than the whole dashboard on purpose — the
        // same one-line change would restyle 71 files' worth of screens, and
        // that is a decision to take deliberately, not a side effect of
        // fixing the menu.
        fontFamily: RAIL_FONT,
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
          {/* Collapsed shows the emblem alone — the wordmark at 34px tall would
              be unreadable. Expanded shows the full mark, which already
              contains the word, so the text span beside it is gone. */}
          {!open && <Logo variant="mark" height={36} />}
          {open && (
            <>
              <Logo height={26} />
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
          {/* Filtered through the same grant the direct-URL guard below reads —
              a route the sidebar hides here is a route "blocked" catches if
              typed straight into the address bar. A group with nothing left
              in it does not render its own empty divider. */}
          {NAV.map((g, i) => {
            const items = g.items.filter(item => canSee(grant, item.module));
            if (!items.length) return null;
            return (
              <GroupBlock key={g.group || 'root'} group={g.group} index={i}
                items={items} railOpen={open} path={path}
                expanded={isOpenSection(g.group)}
                onToggle={() => toggleSection(g.group)} />
            );
          })}
        </div>

        {/* Theme lives with the account controls rather than in a page
            header — it is a preference, not part of any one screen. */}
        <div style={{
          flexShrink: 0, padding: open ? '10px 4px 8px' : '10px 0 8px',
          display: 'flex', justifyContent: open ? 'flex-start' : 'center',
        }}>
          <ThemeToggle compact={!open} />
        </div>

        <SidebarFooter grant={grant} open={open} />

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
        {blocked ? <NoAccess module={current as Module} grant={grant} /> : (
          <>
            {/* A route can take a moment to resolve, and in that gap the old page
                is still on screen with nothing to say it is working. */}
            <RouteProgress />
            <PageTransition>{children}</PageTransition>
          </>
        )}
      </main>
    </div>
  );
}
