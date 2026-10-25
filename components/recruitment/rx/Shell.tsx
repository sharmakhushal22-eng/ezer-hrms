'use client';
import * as React from 'react';
import { Icon } from './icons';
import type { IconName } from './logic/types';

/**
 * Header band and phase-grouped tab rail.
 *
 * The rail does NOT decide which tabs exist. Pass it the TABS already filtered
 * by canSeeScreen(grant, 'recruitment.<key>') and the HR Head gate, exactly as
 * page.tsx does today. Switching tabs calls your existing setter.
 */

/**
 * A compact page intro: title with its help pill on one line, the subtitle
 * under it, actions on the right. It used to be a tall tinted hero band with a
 * dot pattern and a "Recruitment & ATS" crumb, which pushed every screen's real
 * content a third of the way down the page and repeated what the stage strip
 * already says. `crumb` is still accepted so no caller breaks; it is not shown.
 */
export function RecruitmentHeader({ title, subtitle, help, actions }: {
  title: string; subtitle?: React.ReactNode; help?: React.ReactNode; actions?: React.ReactNode; crumb?: string;
}) {
  return (
    <header className="rx-head">
      <div className="rx-head-main">
        <div className="rx-head-row">
          <h1 className="rx-title">{title}</h1>
          {help}
        </div>
        {subtitle && <p className="rx-sub">{subtitle}</p>}
      </div>
      {actions && <div className="rx-head-act">{actions}</div>}
    </header>
  );
}

export interface RailTab {
  key: string;            // same keys as TABS in page.tsx: dashboard, mrf, screening, ...
  label: string;
  icon: IconName;
  group: 'Plan' | 'Source' | 'Offer' | 'Join' | 'Track';
  count?: number | null;
  /** Count means "waiting on the viewer" → amber. */
  needsYou?: boolean;
  tooltip?: string;
}

/** Default icon/group per existing tab key. Labels stay the ones in TABS. */
export const TAB_META: Record<string, { icon: IconName; group: RailTab['group'] }> = {
  dashboard: { icon: 'grid', group: 'Plan' },
  mrf: { icon: 'file', group: 'Plan' },
  screening: { icon: 'spark', group: 'Source' },
  pipeline: { icon: 'flow', group: 'Source' },
  negotiation: { icon: 'coin', group: 'Offer' },
  offerapproval: { icon: 'check', group: 'Offer' },
  hrhead: { icon: 'shield', group: 'Offer' },
  // One entry since Send Offers and Offer Letter merged into a single
  // role-aware tab. 'doc' rather than 'send': the screen is the letter, and
  // sending is only what the HR Manager does with it.
  sendoffer: { icon: 'doc', group: 'Offer' },
  offers: { icon: 'mail', group: 'Offer' },
  preonboarding: { icon: 'door', group: 'Join' },
  jobstatus: { icon: 'target', group: 'Track' },
};

/**
 * Journey rail — full-width section navigation.
 *
 * Five numbered phases (Plan · Source · Offer · Join · Track), each column
 * sized by how many sections it holds, every section stretching to fill it.
 * One gradient pill slides to the active section. Once the page scrolls, the
 * rail docks to the top and folds its phase headers away.
 *
 * Render it ONCE in page.tsx and pass the same element to every tab, so the
 * pill animates between sections and the entrance plays only on first load.
 */
export function TabRail({ tabs, active, onSelect }: { tabs: RailTab[]; active: string; onSelect: (key: string) => void }) {
  const groups: RailTab['group'][] = ['Plan', 'Source', 'Offer', 'Join', 'Track'];
  const present = groups.filter((g) => tabs.some((t) => t.group === g)); // a phase with no visible tabs disappears with them
  const activeGroup = tabs.find((t) => t.key === active)?.group;

  const railRef = React.useRef<HTMLElement>(null);
  const indRef = React.useRef<HTMLSpanElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  const place = React.useCallback((animate: boolean) => {
    const rail = railRef.current, ind = indRef.current;
    const tab = rail?.querySelector<HTMLElement>('.rx-tab[aria-current="page"]');
    if (!rail || !ind || !tab) return;
    // layout offsets, not client rects: tabs may still be mid entrance-animation
    let x = 0, y = 0, el: HTMLElement | null = tab;
    while (el && el !== rail) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent as HTMLElement | null; }
    if (!animate) ind.classList.add('still');
    ind.style.transform = `translate(${x}px, ${y}px)`;
    ind.style.width = `${tab.offsetWidth}px`;
    ind.style.height = `${tab.offsetHeight}px`;
    if (!animate) requestAnimationFrame(() => ind.classList.remove('still'));
    if (rail.scrollWidth > rail.clientWidth) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      tab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: still ? 'auto' : 'smooth' });
    }
  }, []);

  // first placement without a slide, then slide on every change of `active`
  React.useLayoutEffect(() => { place(ready); if (!ready) setReady(true); }, [active, place]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the pill glued to its tab when the layout changes (resize, fonts, dock/undock)
  React.useEffect(() => {
    const rail = railRef.current; if (!rail) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place(false)) : null;
    ro?.observe(rail);
    const onEnd = (e: TransitionEvent) => { if ((e.target as HTMLElement).classList?.contains('rx-ph')) place(false); };
    rail.addEventListener('transitionend', onEnd);
    document.fonts?.ready.then(() => place(false));
    return () => { ro?.disconnect(); rail.removeEventListener('transitionend', onEnd); };
  }, [place]);

  // Dock BELOW the host app's own sticky bar, not on top of it.
  //
  // The rail is `position:sticky; top:0`. Inside ESS the portal's top bar (the
  // one carrying the MANAGE menus) is ALSO sticky at top:0, so on scroll both
  // pinned to the same line: the rail slid under the bar and its tab row — the
  // translucent band with the "35" MRF count — sat across the menu row. At
  // /dashboard there is no such bar and the offset stays 0.
  //
  // Found by walking up from the rail and measuring any earlier sibling of an
  // ancestor that is sticky/fixed at top 0 AND overlaps the rail horizontally
  // (the ESS sidebar is sticky too, but beside the rail, not above it). Kept in
  // a CSS variable so the stylesheet owns the rule, and re-measured when that
  // bar changes height (it wraps on narrow screens).
  const [dockTop, setDockTop] = React.useState(0);
  React.useEffect(() => {
    const rail = railRef.current; if (!rail || typeof window === 'undefined') return;
    const bars: HTMLElement[] = [];
    for (let el = rail.parentElement; el && el !== document.body; el = el.parentElement) {
      for (let sib = el.previousElementSibling as HTMLElement | null; sib; sib = sib.previousElementSibling as HTMLElement | null) {
        const cs = getComputedStyle(sib);
        if ((cs.position === 'sticky' || cs.position === 'fixed') && parseFloat(cs.top) === 0) bars.push(sib);
      }
    }
    const measure = () => {
      const rr = rail.getBoundingClientRect();
      let off = 0;
      for (const b of bars) {
        const r = b.getBoundingClientRect();
        const overlaps = r.right > rr.left + 1 && r.left < rr.right - 1;
        if (overlaps && r.height < window.innerHeight * 0.5) off = Math.max(off, Math.round(r.height));
      }
      setDockTop(off);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    bars.forEach((b) => ro?.observe(b));
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // docked state — the sentinel counts as "gone" once it passes under the host bar
  React.useEffect(() => {
    const s = sentinelRef.current; if (!s || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${dockTop}px 0px 0px 0px` });
    io.observe(s);
    return () => io.disconnect();
  }, [dockTop]);

  return (
    <>
      <div className="rx-rail-sentinel" ref={sentinelRef} aria-hidden="true" />
      <nav ref={railRef} aria-label="Recruitment sections"
        className={['rx-rail', ready && 'has-ind', stuck && 'is-stuck'].filter(Boolean).join(' ')}
        style={{ gridTemplateColumns: present.map((g) => `minmax(max-content, ${tabs.filter((t) => t.group === g).length}fr)`).join(' '), ['--rx-dock-top' as string]: `${dockTop}px` }}>
        <span className="rx-ind" ref={indRef} aria-hidden="true" />
        {present.map((g, i) => (
          <div className={g === activeGroup ? 'rx-grp on' : 'rx-grp'} key={g}>
            <div className="rx-ph" aria-hidden="true"><span className="rx-ph-n">{String(i + 1).padStart(2, '0')}</span>{g}<i /></div>
            <div className="rx-grp-t" role="group" aria-label={g}>
              {tabs.filter((t) => t.group === g).map((t) => (
                <button key={t.key} type="button" className="rx-tab" aria-current={active === t.key ? 'page' : undefined}
                  title={t.tooltip ?? t.label} onClick={() => onSelect(t.key)}>
                  <span className="rx-ti"><Icon name={t.icon} /></span>
                  <span className="rx-tl">{t.label}</span>
                  {t.count != null && t.count > 0 && <span className={t.needsYou ? 'rx-n you' : 'rx-n'} aria-label={`${t.count}${t.needsYou ? ' waiting on you' : ''}`}>{t.count}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}

/**
 * Content of one tab: its header, then its body. No wrapper element.
 *
 * page.tsx owns the frame and the rail, so the rail is the SAME element
 * across tab switches (React keeps it mounted) and the pill can slide:
 *
 *   <div className="rx">
 *     <TabRail … />          ← index 0, never remounts
 *     {currentTabView}       ← index 1, swaps per tab
 *   </div>
 *
 * `rail` is accepted only for standalone use (e.g. a story or test page).
 */
export function RxPage({ header, rail, children }: { header: React.ReactNode; rail?: React.ReactNode; children: React.ReactNode }) {
  return <>{rail}{header}{children}</>;
}
