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
// Twenty-seven rows, twenty-seven colours. The rail's problem was not that it
// lacked colour but that every row had the SAME colour, so the eye had nothing
// to fix on and had to read all twenty-seven labels to find one.
//
// The hues are not picked at random and not picked by group alone. Each group
// occupies its own arc of the wheel — People cool blue through violet, Time
// teal through blue, Money green through amber, Compliance magenta through
// rose, Setup deliberately quieter, Help warm — so the rail still reads as
// organised. Within an arc the LIGHTNESS alternates, because seven neighbouring
// blues at one lightness are seven versions of the same blue. Every adjacent
// pair was measured in CIE Lab: the closest is dE 17.5 (the three Money greens,
// which are a family on purpose), and everything else is further apart.
//
// Every value also had to survive both themes. Measured, not eyeballed:
//   · glyph on its own tile >= 3.0:1 in light AND dark (the AA bar for a
//     graphic, not the 4.5:1 text bar — these are 15px stroke icons)
//   · white glyph on the active tile >= 3.0:1 for all 27
// That is what pushed the cyan and the ambers darker than they want to be:
// #15A7C1 and #C88D04 came out at 2.53 and 2.57 on white and were unusable.
const HUE: Record<string, string> = {
  '/dashboard':                      '#084FA0',
  // People — blue → violet, alternating light and deep
  '/dashboard/recruitment':          '#4B82E2',
  '/dashboard/onboarding':           '#1631CA',
  '/dashboard/employees':            '#655EDE',
  '/dashboard/org-chart':            '#481EC8',
  '/dashboard/bulk-upload':          '#955CDB',
  '/dashboard/transfer':             '#871AC1',
  '/dashboard/pms':                  '#C54DDB',
  // Time & Attendance — teal → blue
  '/dashboard/attendance':           '#08917F',
  '/dashboard/attendance-reports':   '#0B8BB1',
  '/dashboard/leave-upload':         '#0A4A8A',
  // Money — green → amber
  '/dashboard/payroll':              '#057F5B',
  '/dashboard/finance':              '#269757',
  '/dashboard/flexi-claims':         '#137222',
  '/dashboard/travel-claims':        '#549523',
  '/dashboard/loans':                '#B77606',
  // Compliance & Docs — magenta → rose
  '/dashboard/compliance':           '#AB21A0',
  '/dashboard/letters':              '#DB4DB0',
  '/dashboard/policies':             '#AB1C5F',
  '/dashboard/reports':              '#E43A61',
  // Setup — muted on purpose. Configuration should not shout louder than work.
  '/dashboard/ess':                  '#1C649C',
  '/dashboard/admin':                '#6F4BC3',
  '/dashboard/flexi-policy':         '#243B99',
  '/dashboard/company-profile':      '#147390',
  '/dashboard/db-export':            '#4F5A69',
  // Help — warm, and the only warm pair in the rail, so it reads as "not work"
  '/dashboard/ai':                   '#D8510E',
  '/dashboard/support':              '#A57403',
}
const hueOf = (href: string) => HUE[href] ?? '#2563EB'

// The section headings had one grey between them all, which made six different
// sections look like one list with words dropped into it. Each now carries its
// own ink — the centre of that group's item arc, so the heading is visibly the
// same family as the rows beneath it.
//
// Two values per group, not one, because a hue that clears 5.5:1 on white is
// nowhere near readable on #171B21 and vice versa. 10px uppercase is small
// text: 4.5:1 is the floor, not a comfortable place to sit, so these were
// walked until both themes cleared 5.5:1.
const GROUP_INK: Record<string, { inkL: string; inkD: string }> = {
  'People':            { inkL: '#562FB1', inkD: '#9E82DE' },
  'Time & Attendance': { inkL: '#187091', inkD: '#50BBE2' },
  'Money':             { inkL: '#1F753C', inkD: '#5ED485' },
  'Compliance & Docs': { inkL: '#B12F82', inkD: '#D86EB1' },
  'Setup':             { inkL: '#51698A', inkD: '#7E95B4' },
  'Help':              { inkL: '#9E531A', inkD: '#E28F50' },
}
const inkOf = (group: string) =>
  GROUP_INK[group] ?? { inkL: 'var(--ez-rail-faint)', inkD: 'var(--ez-rail-faint)' }

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
  const hue = hueOf(item.href);
  return (
    <Link href={item.href} title={open ? undefined : item.label}
      style={{ textDecoration: 'none', width: '100%', flexShrink: 0,
               ['--n' as string]: n }}>
      <div className={`ez-nav${active ? ' ez-nav-on' : ''}`} style={{
        height: 40, borderRadius: R.md, display: 'flex', alignItems: 'center',
        gap: 10, padding: open ? '0 8px' : 0,
        justifyContent: open ? 'flex-start' : 'center',
        // The row tint and the tile colour are BOTH in CSS, keyed off the
        // custom property below — an inline background would win the cascade
        // and the dark-theme rules could never lift it. Only geometry and the
        // hue itself are inline here.
        color: active ? C.railText : C.railItem,
        position: 'relative',
        // Set as a custom property so the hover and active rules in
        // ez-nav CSS can reach the hue without a style tag per row.
        ['--nav-hue' as string]: hue,
      }}>
        {/* The bar carries the selection when the tint alone is too quiet —
            and it survives at 60px wide, where the label does not. */}
        {active && (
          <span aria-hidden style={{
            position: 'absolute', left: 0, top: 7, bottom: 7, width: 3,
            borderRadius: '0 3px 3px 0', background: hue,
            boxShadow: `0 0 8px ${hue}80`,
          }} />
        )}

        {/* The icon TILE is what carries the colour. An icon tinted on its own
            is a thin coloured glyph on a white ground and reads as grey at
            16px; a filled tile behind it is a solid block of the hue, which
            is what makes twenty-seven rows distinguishable at a glance. */}
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
  const { inkL, inkD } = inkOf(group);
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
    <div className={`ez-group${shown ? ' ez-open' : ''}`} style={{
      ['--g-ink-l' as string]: inkL,
      ['--g-ink-d' as string]: inkD,
      ['--i' as string]: index,
    }}>
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
          {/* A plus that becomes a minus. Two bars rather than a chevron: at
              11px a rotating chevron reads as a smudge, where a bar
              disappearing is unambiguous. */}
          <span className="ez-fold" aria-hidden>
            <span className="ez-fold-h" />
            <span className="ez-fold-v" />
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
        /* Colour and motion both live here rather than in inline styles, for
           two different reasons. Motion, because twenty-seven inline hover
           handlers would be twenty-seven closures re-created on every render.
           Colour, because an inline background wins the cascade outright — and
           the dark theme needs to LIFT these hues, which it cannot do to a
           style attribute. Everything below reads the row's own --nav-hue. */

        .ez-nav{
          /* Sign out and "Back to my ESS" wear this class too, and they have no
             hue of their own — without a default here their hover background
             would be an invalid var() substitution, which drops the whole
             declaration and leaves them with no hover state at all. Rail items
             set --nav-hue inline and override this. */
          --nav-hue: ${C.railFaint};
          transition: background .16s ease, color .16s ease,
                      transform .16s cubic-bezier(.2,.8,.2,1);
        }
        .ez-nav-on{ background: color-mix(in srgb, var(--nav-hue) 9%, transparent) }

        /* The icon TILE is what carries the colour. A tinted glyph on its own
           is a thin coloured stroke on a white ground and reads as grey at
           15px; a filled tile behind it is a solid block of the hue, which is
           what makes twenty-seven rows tell themselves apart at a glance. */
        .ez-nav-tile{
          background: color-mix(in srgb, var(--nav-hue) 12%, transparent);
          color: var(--nav-hue);
          /* Inner highlight: the top edge catches light, so a flat square
             reads as a raised object rather than a swatch. */
          box-shadow: inset 0 1px 0 rgba(255,255,255,.14);
          transition: transform .18s cubic-bezier(.2,.8,.2,1),
                      box-shadow .18s ease, background .16s ease, color .16s ease;
        }
        .ez-nav-on .ez-nav-tile{
          background: linear-gradient(145deg, var(--nav-hue),
                      color-mix(in srgb, var(--nav-hue) 78%, #000));
          color: #FFF;
          box-shadow: inset 0 1px 0 rgba(255,255,255,.32),
                      0 3px 8px -1px color-mix(in srgb, var(--nav-hue) 44%, transparent);
        }

        /* Slide, not lift. The rail is a vertical list, and a row that rises
           off its neighbours breaks the column; sliding is also the direction
           the click takes you. The tile is the part that lifts. */
        .ez-nav:hover{
          background: color-mix(in srgb, var(--nav-hue) 12%, transparent);
          color: ${C.railText};
          transform: translateX(2px);
        }
        .ez-nav:hover .ez-nav-tile{
          transform: translateY(-1px) scale(1.06);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.28),
                      0 4px 10px -2px color-mix(in srgb, var(--nav-hue) 55%, transparent);
        }
        .ez-nav:active{ transform: translateX(1px) scale(.99) }
        .ez-nav-on:hover{ background: color-mix(in srgb, var(--nav-hue) 20%, transparent) }
        .ez-nav:focus-visible,
        .ez-nav-tile:focus-visible{ outline: 2px solid var(--nav-hue); outline-offset: 2px }

        /* Dark. A hue chosen to clear 3:1 on white is too dark to read on
           #171B21, so the tile takes more of it (20% rather than 12%) and the
           glyph is lifted.

           HOW it is lifted matters more than it looks. Mixing toward white was
           the obvious move and the wrong one: it desaturates, and this palette
           separates its neighbours by SATURATION and LIGHTNESS as much as by
           hue, so white-mixing collapsed the worst adjacent pair from dE 17.5
           to 12.3 — the rail went back to looking uniform in dark mode, which
           is the whole problem being fixed. Adding to lightness while leaving
           hue and saturation alone keeps the alternation intact: worst pair
           dE 18.8, and the glyph clears 4.18:1.

           Setting lightness to a fixed value is the same trap by another
           route — it flattens the light/deep alternation the palette is built
           on and measures dE 6.9. It has to be an offset.

           Both dark states are declared, because they are genuinely different
           selectors: the media query catches "System", which stamps no
           attribute at all, and the attribute catches an explicit choice. A
           rule written only one way leaves the other showing light-theme ink
           on a dark rail. */
        @media (prefers-color-scheme: dark){
          :root:not([data-ez-theme="light"]) .ez-nav:not(.ez-nav-on) .ez-nav-tile{
            background: color-mix(in srgb, var(--nav-hue) 20%, transparent);
            color: color-mix(in srgb, var(--nav-hue) 74%, #FFF);
          }
          :root:not([data-ez-theme="light"]) .ez-nav-on{ background: color-mix(in srgb, var(--nav-hue) 20%, transparent) }
          :root:not([data-ez-theme="light"]) .ez-group{ --g-ink: var(--g-ink-d) }
        }
        :root[data-ez-theme="dark"] .ez-nav:not(.ez-nav-on) .ez-nav-tile{
            background: color-mix(in srgb, var(--nav-hue) 20%, transparent);
            color: color-mix(in srgb, var(--nav-hue) 74%, #FFF);
          }
        :root[data-ez-theme="dark"] .ez-nav-on{ background: color-mix(in srgb, var(--nav-hue) 20%, transparent) }
        :root[data-ez-theme="dark"] .ez-group{ --g-ink: var(--g-ink-d) }

        /* The lift proper. Guarded, because relative colour syntax is the one
           thing here a browser might not have — and the color-mix above is a
           usable fallback (3.15:1) rather than an unreadable one. */
        @supports (color: hsl(from #000 h s calc(l + 1%))){
          @media (prefers-color-scheme: dark){
            :root:not([data-ez-theme="light"]) .ez-nav:not(.ez-nav-on) .ez-nav-tile{
            color: hsl(from var(--nav-hue) h s calc(l + 26%));
          }
          }
          :root[data-ez-theme="dark"] .ez-nav:not(.ez-nav-on) .ez-nav-tile{
            color: hsl(from var(--nav-hue) h s calc(l + 26%));
          }
        }

        /* ── Sections ────────────────────────────────────────────────────
           --g-ink is the section's own ink, swapped per theme further down.
           Everything in a section reads from it, so one value moves the
           heading, the dot, the boundary rule and the spine together. */
        .ez-group{ display:flex; flex-direction:column; flex-shrink:0; --g-ink: var(--g-ink-l) }
        .ez-group-items{ display:flex; flex-direction:column; gap:1px; position:relative }

        /* The spine. It sits at left:0 BEHIND the rows rather than indenting
           them — an indent would have cost 10px of label width, and
           "ESS & Role Management" already runs to the edge. The row tints are
           translucent, so it shows through them; the active row's own bar
           covers it, which is the right precedence. */
        .ez-group-items::before{
          content:''; position:absolute; left:0; top:3px; bottom:3px; width:2px;
          border-radius:2px; pointer-events:none;
          background: linear-gradient(180deg,
            color-mix(in srgb, var(--g-ink) 62%, transparent),
            color-mix(in srgb, var(--g-ink) 14%, transparent));
          transform-origin: top;
          animation: ez-spine .42s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: calc(var(--i) * 70ms + 90ms);
          transition: opacity .2s ease;
        }
        .ez-group-bare::before{ display:none }

        /* The boundary. Full width, fading out to the right so it reads as a
           rule under the section above rather than a box around this one. */
        .ez-group-head{
          position:relative; display:flex; align-items:center; gap:8px;
          padding:15px 8px 6px; white-space:nowrap; flex-shrink:0;
          /* It is a <button> now: a real one, so it is reachable by keyboard
             and announces its own state, rather than a div with a click. */
          width:100%; border:none; background:none; font:inherit;
          cursor:pointer; text-align:left; -webkit-tap-highlight-color:transparent;
          animation: ez-sec-in .42s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: calc(var(--i) * 70ms);
        }
        .ez-group-head::before,
        .ez-group-rule-shut{
          content:''; display:block; height:1px; border-radius:1px;
          background: linear-gradient(90deg,
            color-mix(in srgb, var(--g-ink) 60%, transparent),
            color-mix(in srgb, var(--g-ink) 8%, transparent) 78%, transparent);
          transform-origin: left;
          animation: ez-sec-line .5s cubic-bezier(.2,.8,.2,1) both;
          animation-delay: calc(var(--i) * 70ms);
        }
        .ez-group-head::before{ position:absolute; left:0; right:0; top:0 }
        .ez-group-rule-shut{ margin:9px 8px 8px; flex-shrink:0 }

        /* ── The fold ────────────────────────────────────────────────────
           Height animates with grid-template-rows 0fr -> 1fr. The rail has
           sections of three rows and sections of seven; a max-height would
           either clip the long ones or leave the short ones drifting open
           against dead space, and measuring heights in JS means a layout read
           on every toggle. This animates to the content's real height with
           neither problem. */
        .ez-group-panel{
          display:grid; grid-template-rows:0fr;
          transition: grid-template-rows .34s cubic-bezier(.22,1,.36,1);
        }
        .ez-open > .ez-group-panel{ grid-template-rows:1fr }
        .ez-group-panel-inner{ overflow:hidden; min-height:0 }

        /* The rows do not slide in — they UNFOLD, hinged along their own top
           edge. It is the one motion that says "this was folded away" rather
           than "this arrived from somewhere", which is what a disclosure
           actually did. The perspective is on the list, so the rows share one
           vanishing point instead of each tilting in its own little world. */
        .ez-group-items{ perspective: 640px; perspective-origin: top center }
        .ez-group-items > a{
          transform-origin: top center;
          transform: rotateX(-72deg); opacity:0;
          transition: transform .30s cubic-bezier(.2,.9,.3,1), opacity .2s ease;
        }
        .ez-open .ez-group-items > a{
          transform:none; opacity:1;
          /* Dealt out in order on the way open. On the way shut every row
             leaves at once — a staggered close reads as hesitation, and you
             already know what you clicked. */
          transition-delay: calc(var(--n) * 28ms);
        }

        /* A plus that loses its vertical bar. Two bars rather than a chevron:
           at this size a rotating chevron reads as a smudge, where a stroke
           vanishing is unambiguous even at 9px. */
        .ez-fold{
          margin-left:auto; position:relative; width:9px; height:9px; flex-shrink:0;
          transform: rotate(-90deg);
          transition: transform .34s cubic-bezier(.22,1,.36,1);
        }
        .ez-open .ez-fold{ transform: rotate(0deg) }
        .ez-fold-h, .ez-fold-v{
          position:absolute; background: var(--g-ink); border-radius:1px;
          transition: transform .28s cubic-bezier(.22,1,.36,1);
        }
        .ez-fold-h{ left:0; right:0; top:4px; height:1.6px }
        .ez-fold-v{ top:0; bottom:0; left:4px; width:1.6px }
        .ez-open .ez-fold-v{ transform: scaleY(0) }

        /* What a shut section still tells you. Without these, folding a
           section hides both its rows and the fact that you are standing in
           one of them. */
        .ez-count{
          font-size:9.5px; font-weight:${W.bold}; line-height:1;
          padding:3px 5px; border-radius:5px; flex-shrink:0;
          font-variant-numeric: tabular-nums;
          color: var(--g-ink);
          background: color-mix(in srgb, var(--g-ink) 14%, transparent);
        }
        /* Visually hidden, still announced. Not display:none, which removes it
           from the accessibility tree along with everything else. */
        .ez-sr{
          position:absolute; width:1px; height:1px; padding:0; margin:-1px;
          overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0;
        }
        .ez-dotwrap{ position:relative; display:flex; flex-shrink:0 }

        /* "The page you are on is in here." First attempt was a conic-gradient
           ring turning around the 6px dot, and at that size it rendered as a
           lopsided smudge — an indicator you have to squint at is not an
           indicator. This says it at the scale the rail actually reads at:
           the whole heading takes a wash of its own ink, and the count flips
           from a quiet tint to a solid pill. */
        .ez-here-head{
          background: color-mix(in srgb, var(--g-ink) 9%, transparent);
          border-radius:8px;
        }
        .ez-count-here{
          background: var(--g-ink);
          color: ${C.rail};
          animation: ez-here-pulse 2.2s ease-out infinite;
        }
        /* The pulse rides on box-shadow, which does not affect layout — a
           scaling badge would nudge the heading text on every beat. */
        @keyframes ez-here-pulse{
          0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--g-ink) 55%, transparent) }
          70%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--g-ink) 0%, transparent) }
          100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--g-ink) 0%, transparent) }
        }

        .ez-group-dot{
          width:6px; height:6px; border-radius:2px; flex-shrink:0;
          background: var(--g-ink);
          transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease;
        }
        .ez-group-name{
          font-size:${F.micro}px; font-weight:${W.bold}; letter-spacing:.12em;
          text-transform:uppercase; color: var(--g-ink);
          overflow:hidden; text-overflow:ellipsis;
        }

        /* Hovering anywhere in a section shows you its extent. The resting
           state is not dimmed to make room for this — the ink already clears
           5.5:1 — so what changes is the spine and the dot, never the text. */
        .ez-group:hover .ez-group-items::before{ opacity:1 }
        .ez-group .ez-group-items::before{ opacity:.72 }
        .ez-group-head:hover .ez-group-dot,
        .ez-group-head:focus-visible .ez-group-dot{
          transform: scale(1.4);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--g-ink) 20%, transparent);
        }
        .ez-group-head:hover .ez-group-name{ letter-spacing:.145em }
        .ez-group-name{ transition: letter-spacing .28s cubic-bezier(.22,1,.36,1) }
        .ez-group-head:active{ transform: translateY(.5px) }
        .ez-group-head:focus-visible{ outline:2px solid var(--g-ink); outline-offset:-2px; border-radius:8px }

        @keyframes ez-sec-line{ from{ transform:scaleX(0); opacity:0 } to{ transform:scaleX(1); opacity:1 } }
        @keyframes ez-sec-in{ from{ opacity:0; transform:translateX(-6px) } to{ opacity:1; transform:none } }
        @keyframes ez-spine{ from{ transform:scaleY(0) } to{ transform:scaleY(1) } }

        .ez-brand:hover .ez-brand-chev{transform:translateX(2px)}

        @media (prefers-reduced-motion: reduce){
          .ez-nav, .ez-nav-tile, .ez-nav:hover, .ez-nav:active,
          .ez-nav:hover .ez-nav-tile,
          .ez-group:hover .ez-group-dot{ transition:none; transform:none }
          /* The sections still have to ARRIVE — only the movement goes. */
          .ez-group-head, .ez-group-head::before,
          .ez-group-rule-shut, .ez-group-items::before{
            animation:none; transform:none; opacity:1;
          }
          /* The fold still WORKS — it just stops being a performance. The
             panel snaps, the rows are simply there or not, and the ring that
             marks your place holds still instead of turning. */
          .ez-group-panel{ transition:none }
          .ez-group-items > a{ transition:none; transform:none; opacity:1 }
          .ez-open .ez-group-items > a{ transition-delay:0ms }
          .ez-fold, .ez-fold-h, .ez-fold-v, .ez-group-name{ transition:none }
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
