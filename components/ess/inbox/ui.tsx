'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FolderVM } from './types';

/* ------------------------------------------------------------------ toast */

interface ToastMsg { text: string; action?: { label: string; run: () => void } }
interface ToastApi { show: (text: string, action?: ToastMsg['action']) => void }

const ToastCtx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  const show = useCallback((text: string, action?: ToastMsg['action']) => {
    if (timer.current) window.clearTimeout(timer.current);
    setMsg({ text, action }); setOn(true);
    timer.current = window.setTimeout(() => setOn(false), 3200);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className={`toast${on ? ' on' : ''}`} role="status" aria-live="polite">
        {msg && <span>{msg.text}</span>}
        {msg?.action && (
          <button type="button" onClick={() => { msg.action?.run(); setOn(false); }}>{msg.action.label}</button>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

/* ----------------------------------------------------------- folder ink */

/** Inline style that carries a folder's measured colour pair; pair with className "ib-h". */
export function inkStyle(f: Pick<FolderVM, 'inkLight' | 'inkDark'>): React.CSSProperties {
  return { ['--ib-l' as string]: f.inkLight, ['--ib-d' as string]: f.inkDark } as React.CSSProperties;
}

/* ------------------------------------------------------------------ FLIP */

/**
 * Rows glide to their new position when the list reorders (a poll moved a
 * conversation to the top). Call with the container ref and a dependency
 * that changes whenever the order may have changed.
 */
export function useFlip(ref: React.RefObject<HTMLElement | null>, orderKey: string) {
  const before = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-flip]'));
    if (!reduce) {
      rows.forEach(r => {
        const prev = before.current.get(r.dataset.flip ?? '');
        if (prev == null) return;
        const dy = prev - r.getBoundingClientRect().top;
        if (!dy) return;
        r.style.animation = 'none';
        r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
      });
    }
    before.current = new Map(rows.map(r => [r.dataset.flip ?? '', r.getBoundingClientRect().top]));
  }, [ref, orderKey]);
}

/* ---------------------------------------------------------- bump on change */

/** Returns a class name that re-triggers the `tick` keyframe whenever `value` changes. */
export function useTick(value: number | string): string {
  const [cls, setCls] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setCls('');
    const id = requestAnimationFrame(() => setCls('tick'));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return cls;
}

/* ---------------------------------------------------------- inbox height */

/**
 * The inbox is one screen tall: three panes that fill the viewport and scroll
 * independently. Sizing that in CSS alone does not survive this app, for two
 * reasons, so it is measured instead.
 *
 * 1. HOW MUCH CHROME IS ABOVE IT. The 92px default in inbox.css is only ever
 *    right by accident — the portal top bar, the header band and the
 *    admin-viewing banner all change it, and a phone changes it again.
 *
 * 2. components/UiScale.tsx SETS `zoom` ON <html>. It auto-fits the whole app
 *    to the viewport width (1.25 on a 1440px screen), and `zoom` scales the
 *    used value of every length — including `100dvh`. So `height:100dvh` under
 *    a 1.25 zoom paints 125% of the viewport and the panes run off the bottom
 *    of the screen. getBoundingClientRect() and innerHeight are both in visual
 *    pixels, so the available space divided by the zoom is the height to set in
 *    the element's own (pre-zoom) coordinates.
 *
 * The CSS rule stays as the pre-hydration fallback; this overrides it.
 */
const BOTTOM_GAP = 24;

export function useInboxOffset(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;

    const measure = () => {
      // Below 760px the stylesheet deliberately drops the fixed-viewport
      // sizing — the rail becomes a chip strip and the thread is a fixed
      // full-screen layer, so the shell scrolls with the page. An inline
      // height here would override that and put back the desktop layout.
      if (window.matchMedia('(max-width: 760px)').matches) {
        el.style.removeProperty('height');
        el.style.removeProperty('--ib-offset');
        return;
      }
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
      const top = el.getBoundingClientRect().top;   // visual px from the viewport top
      const available = (window.innerHeight - top) / zoom - BOTTOM_GAP;
      el.style.setProperty('--ib-offset', `${Math.round(window.innerHeight / zoom - available)}px`);
      el.style.height = `${Math.max(Math.round(available), 420)}px`;
    };

    measure();
    window.addEventListener('resize', measure);
    // UiScale writes the new zoom straight onto <html>'s style attribute, and
    // that is not a resize — without this the panes keep the old height until
    // something else reflows them.
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

    return () => { window.removeEventListener('resize', measure); mo.disconnect(); };
  }, [ref]);
}

/* -------------------------------------------------------------- viewport */

export function useIsMobile(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const f = () => setM(mq.matches); f();
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}
