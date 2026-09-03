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
            // NO COLOUR HERE — it inherits from the button.
            //
            // This used to set `active ? C.railText : C.railItem` inline, and
            // an inline colour beats the stylesheet. So the selected row got
            // --ez-rail-text, which is NEAR-BLACK in light mode, printed bold
            // on the deep blue fill. That is the heavy black-on-blue that kept
            // coming back: the CSS said white, the inline style overruled it,
            // and every contrast figure I measured was of the rule that never
            // applied.
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
        /* ══ THE RAIL IS THE BLUE ══════════════════════════════════════
           Previous passes all had the same shape: a pale ground with
           card-like buttons drawn on it, and every complaint — "button and
           bg are similar", "selected blends in", "section blends in" — was
           the same problem, because separating a light thing from a light
           thing can only ever be a matter of degree.

           So the figure and ground are swapped. The rail is deep blue; the
           items are light text ON it with no card chrome at all; and the
           selected row is a WHITE pill. Nothing has to be tuned into
           visibility — white on deep blue is 8.7:1 by construction, and the
           section labels can be quiet without disappearing because the
           ground is dark enough to carry a quiet colour.

           Motion changed with it. No lift, no scale, no bounce: the selected
           pill WIPES IN from the left edge, which is the direction reading
           goes and the direction the content sits. Hover is a wash that
           fades, not a movement.

           Measured at the rail's lightest point, which is the worst case:
             item label     5.58 (on a raised row)   section 7.95 (recessed)
             icon           5.37    selected ink  8.72 (on the white pill)
        */
        /* ══ TWO POLARITIES, NOT ONE DESIGN WITH A DARKER SKIN ═════════
           Light is now a PALE rail: a light-blue ground with navy ink, rows
           tinted DARKER than the ground and sections lighter. Dark keeps the
           deep rail: white ink, rows lighter than the ground, sections
           darker. They are mirror images, so nothing below may assume which
           way round it is — every colour that depends on polarity is a
           token, set once per theme and never referenced literally in a
           rule. A single hard-coded rgba() here is a rule that silently
           renders one theme's ink on the other theme's surface.

           WHY THE PALE GROUND STOPS WHERE IT DOES. The span is squeezed from
           both ends and the ends want opposite things:

             the section band is WHITE over the ground, so it separates least
             at the TOP, where the ground is already near-white and there is
             no headroom left above it;

             the row is NAVY over the ground, and its navy label separates
             least at the BOTTOM, where the row is darkest.

           #D2E2FE -> #8FB4F2 is the widest span where both still hold, 16
           points of lightness. Measured at whichever end is worse:

                          light (pale)        dark (deep)
             label          4.83                 5.07
             icon           3.63                 4.55
             section ink    8.05                 8.53
             row/ground     1.41                 1.32
             band/ground    1.19                 1.19
        */
        .ez-rail{
          background: linear-gradient(180deg, #D2E2FE 0%, #8FB4F2 100%);
          /* A row goes DARKER than this ground; a section goes lighter. */
          --r-row:   linear-gradient(180deg, rgba(21,45,120,.10), rgba(21,45,120,.22));
          --r-row-h: linear-gradient(180deg, rgba(21,45,120,.16), rgba(21,45,120,.30));
          --r-band:  rgba(255,255,255,.62);
          --r-edge:  rgba(21,45,120,.20);
          --r-cast:      rgba(21,45,120,.16);
          --r-cast-far:  rgba(21,45,120,.20);
          --r-cast-h:    rgba(21,45,120,.20);
          --r-cast-far-h:rgba(21,45,120,.28);
          --r-press:     rgba(21,45,120,.14);
          --r-focus:     #0D2154;
          --r-pill-edge: rgba(21,45,120,.55);
          --r-band-in:   rgba(255,255,255,.65);
          --r-band-h:    rgba(255,255,255,.82);
          --r-sec-ink-h: #0A1E52;
          --r-fold:      #2A4E95;
          --r-pulse:     rgba(20,48,110,.45);
          /* Lit from above, same as the deep rail — but on a pale surface
             the highlight is white and the shading below it is the navy. */
          --r-spec:  rgba(255,255,255,.55);
          --r-spec-h:rgba(255,255,255,.66);
          --r-rim-t: rgba(255,255,255,.70);
          --r-rim-b: rgba(21,45,120,.26);
          --r-rim-th:rgba(255,255,255,.85);
          --r-edge-h:rgba(21,45,120,.34);
          /* Ink DARKENS on hover here, the mirror of going white on a deep
             rail: the row darkens under it, so the ink has to outrun it. */
          --r-ink:      #0F2660;
          --r-ink-h:    #0A1E52;
          --r-icon:     #1B3A7E;
          --r-icon-h:   #0A1E52;
          --r-sec-ink:  #173672;
          --r-pill-bg:  #14306E;
          --r-pill-ink: #FFFFFF;
          --r-pill-ink-h: #FFFFFF;
          /* The brand mark, the footer and the sign-out row inherit these.
             On the pale rail they are NAVY, not the near-white they are on
             the deep one — the single largest thing that flips. */
          --ez-rail-text:  #0D2154;
          --ez-rail-item:  #123069;
          --ez-rail-muted: #1B3A7E;
          --ez-rail-faint: #204186;
          --ez-rail-line:  rgba(21,45,120,.20);
          --ez-rail-hover: rgba(21,45,120,.08);
          --ez-rail-active-bg:   rgba(21,45,120,.16);
          --ez-rail-active-text: #0D2154;
        }
        @media (prefers-color-scheme: dark){
          :root:not([data-ez-theme="light"]) .ez-rail{
            background: linear-gradient(180deg, #204A93 0%, #0F2657 100%);
            --r-row:   linear-gradient(180deg, rgba(61,130,255,.46), rgba(61,130,255,.30));
            --r-row-h: linear-gradient(180deg, rgba(61,130,255,.52), rgba(61,130,255,.35));
            --r-band:  rgba(0,0,0,.34);
            --r-edge:  rgba(255,255,255,.16);
            --r-cast:      rgba(4,12,42,.30);
            --r-cast-far:  rgba(4,12,42,.34);
            --r-cast-h:    rgba(4,12,42,.32);
            --r-cast-far-h:rgba(4,12,42,.42);
            --r-press:     rgba(255,255,255,.16);
            --r-focus:     #FFFFFF;
            --r-pill-edge: rgba(255,255,255,.55);
            --r-band-in:   rgba(0,0,0,.22);
            --r-band-h:    rgba(0,0,0,.42);
            --r-sec-ink-h: #FFFFFF;
            --r-fold:      #C3D4F2;
            --r-pulse:     rgba(255,255,255,.55);
            --r-spec:  rgba(255,255,255,.26);
            --r-spec-h:rgba(255,255,255,.34);
            --r-rim-t: rgba(255,255,255,.34);
            --r-rim-b: rgba(0,0,0,.20);
            --r-rim-th:rgba(255,255,255,.55);
            --r-edge-h:rgba(255,255,255,.42);
            --r-ink:      #FFFFFF;
            --r-ink-h:    #FFFFFF;
            --r-icon:     #DCE8FF;
            --r-icon-h:   #FFFFFF;
            --r-sec-ink:  #C3D4F2;
            --r-pill-bg:  #FFFFFF;
            --r-pill-ink: #1B3A9E;
            --r-pill-ink-h: #17307E;
            --ez-rail-text:  #F2F6FF;
            --ez-rail-item:  #E8EEFB;
            --ez-rail-muted: #DEE9FC;
            --ez-rail-faint: #D8E4FA;
            --ez-rail-line:  rgba(255,255,255,.16);
            --ez-rail-hover: rgba(255,255,255,.10);
            --ez-rail-active-bg:   rgba(255,255,255,.18);
            --ez-rail-active-text: #FFFFFF;
          }
        }
        :root[data-ez-theme="dark"] .ez-rail{
          background: linear-gradient(180deg, #204A93 0%, #0F2657 100%);
          --r-row:   linear-gradient(180deg, rgba(61,130,255,.46), rgba(61,130,255,.30));
          --r-row-h: linear-gradient(180deg, rgba(61,130,255,.52), rgba(61,130,255,.35));
          --r-band:  rgba(0,0,0,.34);
          --r-edge:  rgba(255,255,255,.16);
          --r-cast:      rgba(4,12,42,.30);
          --r-cast-far:  rgba(4,12,42,.34);
          --r-cast-h:    rgba(4,12,42,.32);
          --r-cast-far-h:rgba(4,12,42,.42);
          --r-press:     rgba(255,255,255,.16);
          --r-focus:     #FFFFFF;
          --r-pill-edge: rgba(255,255,255,.55);
          --r-band-in:   rgba(0,0,0,.22);
          --r-band-h:    rgba(0,0,0,.42);
          --r-sec-ink-h: #FFFFFF;
          --r-fold:      #C3D4F2;
          --r-pulse:     rgba(255,255,255,.55);
          --r-spec:  rgba(255,255,255,.26);
          --r-spec-h:rgba(255,255,255,.34);
          --r-rim-t: rgba(255,255,255,.34);
          --r-rim-b: rgba(0,0,0,.20);
          --r-rim-th:rgba(255,255,255,.55);
          --r-edge-h:rgba(255,255,255,.42);
          --r-ink:      #FFFFFF;
          --r-ink-h:    #FFFFFF;
          --r-icon:     #DCE8FF;
          --r-icon-h:   #FFFFFF;
          --r-sec-ink:  #C3D4F2;
          --r-pill-bg:  #FFFFFF;
          --r-pill-ink: #1B3A9E;
          --r-pill-ink-h: #17307E;
          --ez-rail-text:  #F2F6FF;
          --ez-rail-item:  #E8EEFB;
          --ez-rail-muted: #DEE9FC;
          --ez-rail-faint: #D8E4FA;
          --ez-rail-line:  rgba(255,255,255,.16);
          --ez-rail-hover: rgba(255,255,255,.10);
          --ez-rail-active-bg:   rgba(255,255,255,.18);
          --ez-rail-active-text: #FFFFFF;
        }

        /* ── A row sits ABOVE the rail; a section sits BELOW it ────────
           Bare text on the rail was as flat as a card the colour of its own
           ground — the same blending complaint, from the other direction.
           A dark ground is what fixes it: white at 12% lifts a row off the
           rail, black at 26/38% presses a section into it, and the selected
           pill goes fully white on top. Four levels, one hue. */
        .ez-nav{
          position:relative; border-radius:9px;
          color: var(--r-ink);
          /* SHADED, not merely tinted. A flat wash of white at one alpha is
             what read as dull: it lifts a row off the rail arithmetically
             while giving the eye nothing to call a surface. What makes a
             button look like a button is the light on it, so the fill runs
             top-to-bottom, the top edge catches a specular, and the bottom
             sits on a contact shadow.

             The tint is a BLUE, never a neutral. White over a saturated
             ground does not lighten it, it greys it — white at .24 on the
             old deep rail left the row holding 53% of the rail's
             saturation, and that desaturation, not the brightness, is what
             read as a dull muddy colour. Both polarities tint with a blue
             for the same reason: the deep rail lifts with #3D82FF, the pale
             one shades with #152D78, and each keeps its ground's hue.

             Which DIRECTION the tint runs is the token's business, not this
             rule's. On the deep rail --r-row lightens; on the pale rail it
             darkens. Everything here is written to be true either way. */
          background: var(--r-row);
          border:1px solid var(--r-edge);
          border-top-color: var(--r-rim-t);
          border-bottom-color: var(--r-rim-b);
          box-shadow:
            inset 0 1px 0 var(--r-spec),              /* specular along the top */
            0 1px 2px var(--r-cast),                  /* contact with the rail */
            0 3px 7px -3px var(--r-cast-far);         /* the lift itself */
          transition: color .18s ease, background .18s ease,
                      border-color .18s ease, box-shadow .18s ease,
                      transform .10s ease;
          isolation:isolate;
        }
        /* The fill is a pseudo-element so it can wipe independently of the
           text, which stays put. */
        .ez-nav::before{
          content:''; position:absolute; inset:0; border-radius:inherit;
          background: var(--r-row-h);
          transform: scaleX(0); transform-origin: left center;
          transition: transform .22s cubic-bezier(.2,.8,.2,1);
          z-index:-1;
        }
        /* Hover carries most of its signal in the EDGE and the shadow rather
           than in fill brightness. Pushing the fill far enough to read on
           luminance alone takes the top stop to .32, where a white label
           measures 4.28 — under the bar. A brighter rim and a taller lift
           cost nothing and read as "raised further". */
        .ez-nav:hover{
          color: var(--r-ink-h);
          border-color: var(--r-edge-h);
          border-top-color: var(--r-rim-th);
          box-shadow:
            inset 0 1px 0 var(--r-spec-h),
            0 2px 4px var(--r-cast-h),
            0 6px 14px -5px var(--r-cast-far-h);
        }
        .ez-nav:hover::before{ transform: scaleX(1) }
        /* Pressed: the row travels the 1px it was lifted and its shadow
           collapses, so the click lands on the rail instead of hovering
           above it. A button that does not move under the pointer is the
           other half of looking dull. */
        .ez-nav:active{
          transform: translateY(1px);
          box-shadow: inset 0 1px 2px var(--r-cast-h), 0 0 0 rgba(0,0,0,0);
        }
        .ez-nav:active::before{ background: var(--r-press) }
        .ez-nav:focus-visible{ outline:2px solid var(--r-focus); outline-offset:-2px }

        /* ── Selected: a white pill ────────────────────────────────────
           Wipes in from the left rather than popping. */
        /* The selected pill is the one level that does not mirror: it is
           the FURTHEST thing from its ground either way. On the deep rail
           that is white; on the pale rail it is near-navy. Same idea, other
           end of the scale — so it is a token like everything else. */
        .ez-nav-on{ color: var(--r-pill-ink); border-color: var(--r-pill-edge);
                    box-shadow: 0 1px 2px var(--r-cast),
                                0 6px 16px -6px var(--r-cast-far-h) }
        .ez-nav-on::before{
          background: var(--r-pill-bg);
          transform: scaleX(1);
          animation: ezWipe .30s cubic-bezier(.2,.8,.2,1) both;
          box-shadow: 0 1px 2px var(--r-cast), 0 6px 16px -6px var(--r-cast-far-h);
        }
        .ez-nav-on:hover{ color: var(--r-pill-ink-h) }
        .ez-nav-on:hover::before{ background: var(--r-pill-bg) }
        @keyframes ezWipe{
          from{ transform: scaleX(0); opacity:.4 }
          to  { transform: scaleX(1); opacity:1 }
        }
        /* No left bar any more — the pill IS the marker. It stays only for
           the 60px rail, where there is no label to carry the state. */
        .ez-nav-bar{ display:none }

        /* ── Icons ─────────────────────────────────────────────────────
           No tile. A tile was card chrome by another name; on a deep ground
           the glyph alone reads. */
        .ez-nav-tile{
          background:transparent; box-shadow:none;
          /* Was #B7CCF2 — dimmer than the label beside it, which made the
             row look switched off rather than merely unselected. It cleared
             the 3:1 graphics bar and still looked dull, which is the whole
             gap between passing and good. */
          color: var(--r-icon);
          transition: color .18s ease, transform .18s cubic-bezier(.2,.8,.2,1);
        }
        .ez-nav:hover .ez-nav-tile{ color: var(--r-icon-h) }
        .ez-nav-on .ez-nav-tile{ color: var(--r-pill-ink) }

        /* ── Sections: a band pressed INTO the rail ────────────────────
           The opposite move to a row. Rows come toward the reader, sections
           sink away, and the rail sits between them. */
        .ez-group{ display:flex; flex-direction:column; flex-shrink:0 }
        .ez-group-items{ display:flex; flex-direction:column; gap:2px; position:relative;
                         perspective:none }
        .ez-group-panel{ display:grid; grid-template-rows:0fr;
                         transition: grid-template-rows .30s cubic-bezier(.22,1,.36,1) }
        .ez-open > .ez-group-panel{ grid-template-rows:1fr }
        .ez-group-panel-inner{ overflow:hidden; min-height:0 }
        /* Rows fade up rather than unfolding on a hinge — the hinge was more
           motion than a list of links needs. */
        .ez-group-items > a{ opacity:0; transform: translateY(-4px);
                             transition: opacity .2s ease, transform .2s ease }
        .ez-open .ez-group-items > a{ opacity:1; transform:none;
                                      transition-delay: calc(var(--n) * 18ms) }

        .ez-group-head{
          position:relative; display:flex; align-items:center; gap:8px;
          padding:7px 10px 6px; margin:16px 0 4px; white-space:nowrap; flex-shrink:0;
          width:100%; border:none; font:inherit;
          /* Recessed BELOW the rail — the opposite direction from the rows,
             so a section can never be mistaken for one. */
          background: var(--r-band);
          box-shadow: inset 0 1px 2px var(--r-band-in);
          cursor:pointer; text-align:left; border-radius:8px;
          -webkit-tap-highlight-color:transparent;
          transition: background .18s ease;
        }
        .ez-group-head:hover{ background: var(--r-band-h) }
        .ez-group-head:focus-visible{ outline:2px solid var(--r-focus); outline-offset:-2px }
        /* A hairline ABOVE the label, stopping short of the label itself —
           it separates the groups without boxing them. */
        .ez-group-head::before{
          content:''; position:absolute; left:10px; right:10px; top:-8px; height:1px;
          background: var(--r-edge);
        }
        .ez-group-name{
          font-size:${F.micro}px; font-weight:${W.bold}; letter-spacing:.14em;
          text-transform:uppercase; color: var(--r-sec-ink);
          overflow:hidden; text-overflow:ellipsis; transition:color .18s ease;
        }
        .ez-group-head:hover .ez-group-name{ color: var(--r-sec-ink-h) }

        .ez-count{
          font-size:9.5px; font-weight:${W.bold}; line-height:1; padding:3px 6px;
          border-radius:99px; flex-shrink:0; font-variant-numeric:tabular-nums;
          color:#16307E; background:rgba(255,255,255,.82);
        }
        .ez-here-head{ background: var(--ez-rail-hover) }
        .ez-count-here{ background: var(--r-pill-bg); color: var(--r-pill-ink);
                        animation: ez-here-pulse 2.2s ease-out infinite }
        @keyframes ez-here-pulse{
          0%{ box-shadow:0 0 0 0 var(--r-pulse) }
          70%{ box-shadow:0 0 0 6px transparent }
          100%{ box-shadow:0 0 0 0 transparent }
        }

        .ez-fold{
          margin-left:auto; flex-shrink:0; display:flex; align-items:center;
          justify-content:center; width:18px; height:18px;
          color: var(--r-fold); background:transparent;
          transition: color .18s ease;
        }
        .ez-group-head:hover .ez-fold{ color: var(--r-sec-ink-h) }
        .ez-fold svg{ transform:rotate(-90deg);
                      transition: transform .30s cubic-bezier(.22,1,.36,1) }
        .ez-open .ez-fold svg{ transform:rotate(0deg) }
        .ez-group-rule-shut{ display:block; height:1px; border-radius:1px;
                             margin:10px 10px 9px; flex-shrink:0;
                             background: var(--r-edge) }

        .ez-sr{ position:absolute; width:1px; height:1px; padding:0; margin:-1px;
                overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0 }
        .ez-dotwrap{ display:none }
        .ez-brand:hover .ez-brand-chev{ transform:translateX(2px) }

        @media (prefers-reduced-motion: reduce){
          .ez-nav, .ez-nav::before, .ez-nav-tile, .ez-group-panel,
          .ez-group-items > a, .ez-fold svg, .ez-group-name, .ez-group-head{ transition:none }
          .ez-nav-on::before{ animation:none }
          .ez-nav:hover::before{ transform:scaleX(1) }
          .ez-open .ez-group-items > a{ transition-delay:0ms; transform:none; opacity:1 }
          .ez-count-here{ animation:none }
        }
      `}</style>

      <nav aria-label="Main" className="ez-rail ez-scroll" style={{
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
        // The ground is the gradient in .ez-rail; a flat background here
        // would sit on top of it and win.
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
