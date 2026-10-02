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

export function RecruitmentHeader({ title, subtitle, help, actions, crumb = 'Recruitment & ATS' }: {
  title: string; subtitle?: React.ReactNode; help?: React.ReactNode; actions?: React.ReactNode; crumb?: string;
}) {
  return (
    <header className="rx-head">
      <div>
        <div className="rx-crumb"><Icon name="brief" /><span>{crumb}</span></div>
        <h1 className="rx-title">{title}</h1>
        {subtitle && <p className="rx-sub">{subtitle}</p>}
        {help && <div style={{ marginTop: 12 }}>{help}</div>}
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
  sendoffer: { icon: 'send', group: 'Offer' },
  offerletter: { icon: 'doc', group: 'Offer' },
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

  // docked state
  React.useEffect(() => {
    const s = sentinelRef.current; if (!s || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className="rx-rail-sentinel" ref={sentinelRef} aria-hidden="true" />
      <nav ref={railRef} aria-label="Recruitment sections"
        className={['rx-rail', ready && 'has-ind', stuck && 'is-stuck'].filter(Boolean).join(' ')}
        style={{ gridTemplateColumns: present.map((g) => `minmax(max-content, ${tabs.filter((t) => t.group === g).length}fr)`).join(' ') }}>
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
