'use client';
// components/ess/today/HeroPanel.tsx — the day panel's shell and layout.
//
// This file used to be the whole hero: clock, greeting, brief, meta, the
// format popover and the theme switch, all in one 130-line component. It is
// now the composition and nothing else, so each piece can be changed on its
// own:
//
//   HeroTools      top-right — streak, format picker, theme switch
//   HeroClock      the wall clock and date
//   HeroGreeting   avatar, greeting, designation
//   HeroBrief      the one-line brief
//   HeroMeta       shift / week / next holiday
//   children       the right side, today PunchPanel
//
// WHERE THE TOOLS SIT. Top-LEFT, above the clock, as the first row of the left
// column. They used to be on the clock's own line with margin-left:auto, which
// pushed them to that column's right edge — the middle of the panel, next to
// nothing in particular.
import type { ReactNode } from 'react';
import type { Prefs, TodayPayload } from '@/lib/today/types';
import { useNow } from './hooks';
import HeroTools from './HeroTools';
import HeroClock from './HeroClock';
import HeroGreeting from './HeroGreeting';
import { HeroBrief, HeroMeta } from './HeroBrief';

type Props = {
  data: TodayPayload;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  children: ReactNode;
  onSearch?: () => void;
};

export default function HeroPanel({ data, prefs, onPrefs, children, onSearch }: Props) {
  // One timer for the whole hero. The clock and the greeting read it, and the
  // sun/moon position is computed from it.
  const now = useNow(15000);
  const h = now.getHours();
  const tone = h >= 17 || h < 6 ? 'evening' : h >= 12 ? 'afternoon' : '';

  // The orb rides the arc in the top band: 6:00 at the left end, 20:00 at the right.
  const t = h + now.getMinutes() / 60;
  const p = Math.min(1, Math.max(0, (t - 6) / 14));
  const a = Math.PI * (1 - p);
  const orb = { left: `${67 + Math.cos(a) * 33}%`, top: `${30 - Math.sin(a) * 18}%` };

  return (
    <section className={`hero reveal ${tone}`} style={{ ['--i' as string]: 0 }} aria-label="Today">
      <div className="hero-bg"><div className="grain" /><div className="sky"><div className="arc" /><div className="orb" style={orb} /></div></div>

      <div className="hero-main">
        <HeroTools data={data} prefs={prefs} onPrefs={onPrefs} now={now} onSearch={onSearch} />
        <HeroClock now={now} prefs={prefs} />
        <HeroGreeting data={data} now={now} />
        <HeroBrief data={data} />
        <HeroMeta data={data} prefs={prefs} />
      </div>

      <div className="hero-side">{children}</div>
    </section>
  );
}
