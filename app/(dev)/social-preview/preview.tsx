'use client';
// app/(dev)/social-preview/preview.tsx — the harness around the Social section.
//
// It mounts Social against mock data with no network and no Supabase, so the
// design can be walked state by state — light and dark, desktop and phone —
// without an ESS login. Same purpose and shape as the inbox preview.
//
// TWO THINGS IT NOW MIRRORS FROM THE PORTAL, because without them the preview
// was flattering the design rather than testing it:
//
//   * <UIKeyframes/>. The portal mounts it; this did not. It carries
//     `button { border-radius:10px !important }`, which every shape in
//     social.css has to out-specify — so the preview was the one place those
//     rules were never exercised.
//   * The .ez-page-head band. The portal draws one above every section
//     (TabHeader), which is why Social must not draw a header of its own.
//     Rendering the band here keeps the preview honest about how much vertical
//     space the section actually gets.
//
// The width buttons matter more than they look: Social renders beside a
// 200-260px rail and its stylesheet uses container queries against its own
// wrapper, so resizing the frame is the only honest way to see a phone layout.
import { useEffect, useState } from 'react';
import Social from '@/components/ess/social/Social';
import { MOCK } from '@/components/ess/social/mock';
import { UIKeyframes, IconEmployees } from '@/lib/ui';

const WIDTHS = [
  { label: 'Desktop', w: 1100 },
  { label: 'Portal column', w: 900 },
  { label: 'Tablet', w: 680 },
  { label: 'Phone', w: 390 },
];

/** A stand-in for the portal's TabHeader, with the same band and content. */
function FakeTabHeader() {
  return (
    <div className="ez-page-head">
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 4,
      }}>
        <div style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-.02em',
          display: 'flex', alignItems: 'center', gap: 9,
        }}>
          <IconEmployees size={20} strokeWidth={1.8} />Social
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
          background: 'var(--ez-positive-tint)', color: 'var(--ez-positive)',
        }}>Available</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--ez-muted)' }}>
        Birthdays, work anniversaries, new joiners and the Wall of Fame — everyone
        across your group, in one place
      </div>
    </div>
  );
}

export default function Preview() {
  const [w, setW] = useState(1100);
  const [dark, setDark] = useState(false);

  // The toggle writes the same attribute ThemeToggle does, so the preview
  // exercises the real theme path rather than a private one.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-ez-theme', dark ? 'dark' : 'light');
    return () => el.removeAttribute('data-ez-theme');
  }, [dark]);

  const pill = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--ez-brand)' : 'var(--ez-line)'}`,
    background: on ? 'var(--ez-brand-tint)' : 'var(--ez-surface)',
    color: on ? 'var(--ez-brand)' : 'var(--ez-muted)',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ez-canvas)', paddingBottom: 60 }}>
      <UIKeyframes />
      <div style={{
        position: 'sticky', top: 0, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 16px', background: 'var(--ez-surface)',
        borderBottom: '1px solid var(--ez-line)',
        fontFamily: '"DM Sans","Segoe UI",system-ui,sans-serif', fontSize: 12.5,
      }}>
        <strong style={{ fontSize: 13, color: 'var(--ez-ink)' }}>Social — design preview</strong>
        <span style={{ color: 'var(--ez-faint)' }}>mock data · no network</span>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WIDTHS.map(x => (
            <button key={x.w} type="button" onClick={() => setW(x.w)} style={pill(w === x.w)}>
              {x.label}
            </button>
          ))}
          <button
            type="button" onClick={() => setDark(d => !d)}
            style={{ ...pill(false), borderColor: 'var(--ez-line-strong)', color: 'var(--ez-ink)' }}
          >{dark ? 'Light' : 'Dark'}</button>
        </span>
      </div>

      <div
        data-harness="social"
        style={{
          width: w, maxWidth: '100%', margin: '18px auto',
          border: '1px solid var(--ez-line)', borderRadius: 14, overflow: 'hidden',
          background: 'var(--ez-canvas)',
          // The same padding the portal gives a normal section (line 3839).
          padding: '18px 22px',
          boxShadow: 'var(--ez-shadow-raised)',
        }}
      >
        <FakeTabHeader />
        <Social initial={MOCK} />
      </div>
    </div>
  );
}
