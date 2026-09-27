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
  offers: { icon: 'mail', group: 'Offer' },
  preonboarding: { icon: 'door', group: 'Join' },
  jobstatus: { icon: 'target', group: 'Track' },
};

export function TabRail({ tabs, active, onSelect }: { tabs: RailTab[]; active: string; onSelect: (key: string) => void }) {
  const groups: RailTab['group'][] = ['Plan', 'Source', 'Offer', 'Join', 'Track'];
  return (
    <nav className="rx-rail" aria-label="Recruitment sections">
      {groups.map((g) => {
        const items = tabs.filter((t) => t.group === g);
        if (!items.length) return null; // a group with no visible tabs disappears with them
        return (
          <div className="rx-grp" key={g}>
            <div className="rx-grp-l">{g}</div>
            <div className="rx-grp-t">
              {items.map((t) => (
                <button key={t.key} type="button" className="rx-tab" aria-current={active === t.key ? 'page' : undefined}
                  title={t.tooltip} onClick={() => onSelect(t.key)}>
                  <Icon name={t.icon} />{t.label}
                  {t.count != null && t.count > 0 && <span className={t.needsYou ? 'rx-n you' : 'rx-n'}>{t.count}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Page frame for one tab: header, then the rail, then the tab body.
 * page.tsx builds the rail once and passes the same element to every tab.
 */
export function RxPage({ header, rail, children }: { header: React.ReactNode; rail: React.ReactNode; children: React.ReactNode }) {
  return <div className="rx">{header}{rail}{children}</div>;
}
