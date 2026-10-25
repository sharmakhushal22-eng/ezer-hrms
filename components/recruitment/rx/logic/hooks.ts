'use client';
import * as React from 'react';

/**
 * Search + status filter + view switch over data the tab ALREADY has in props.
 * Purely client-side: no query is added or changed, so row scoping from loadAll
 * is untouched.
 */
export function useListControls<T, V extends string>(
  items: T[],
  opts: {
    text: (t: T) => string; status?: (t: T) => string; defaultView: V;
    /**
     * Optional CONTROLLED status. Pass both to let the parent own the value —
     * the MRF tab does, because its "N awaiting approval · Show them" banner
     * sets the status filter from outside the list.
     *
     * This has to live here rather than being overridden by the caller: the
     * `visible` memo below filters on this hook's own `status`, so a caller
     * that merely swapped the value would move the pills without filtering
     * anything — a control that looks like it works and does not.
     */
    statusValue?: string;
    onStatusChange?: (v: string) => void;
  },
) {
  const [query, setQuery] = React.useState('');
  const [statusState, setStatusState] = React.useState<string>('*');
  const controlled = opts.statusValue !== undefined;
  const status = controlled ? (opts.statusValue as string) : statusState;
  const { onStatusChange } = opts;
  const setStatus = React.useCallback((v: string) => {
    onStatusChange?.(v);
    if (!controlled) setStatusState(v);
  }, [controlled, onStatusChange]);
  const [view, setView] = React.useState<V>(opts.defaultView);
  const q = query.trim().toLowerCase();
  const visible = React.useMemo(
    () => items.filter((t) =>
      (!q || opts.text(t).toLowerCase().includes(q)) &&
      (status === '*' || !opts.status || opts.status(t) === status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, status],
  );
  // setStatus is no longer a useState setter (those are stable) but a
  // useCallback that changes identity with `controlled`/`onStatusChange`, so an
  // empty dep list here would pin `clear` to the FIRST setStatus forever and
  // "Clear filters" would reset the search while leaving the status pill stuck.
  const clear = React.useCallback(() => { setQuery(''); setStatus('*'); }, [setStatus]);
  return { query, setQuery, status, setStatus, view, setView, visible, total: items.length, clear, filtered: !!q || status !== '*' };
}

/** "/" focuses the screen's search box, unless the user is already typing somewhere. */
export function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
      if (!ref.current || ref.current.offsetParent === null) return;
      e.preventDefault(); ref.current.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref]);
}

/** Counts a number up once on mount. Respects prefers-reduced-motion. */
export function useCountUp(target: number, ms = 700) {
  // State starts AT the target, and the effect only ever writes from inside a
  // rAF callback. The kit's version called setV() synchronously in the effect
  // body twice — once for the reduced-motion path and once as setV(0) before
  // animating — which this repo's eslint flags as an error (cascading renders),
  // and which also made the value flash to 0 on every mount before counting up.
  // Behaviour is otherwise identical: no motion means the number is simply
  // correct immediately, which is what reduced motion asks for.
  const [v, setV] = React.useState(target);
  React.useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0; const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/**
 * Pointer tilt for a card: sets --rx-rx / --rx-ry (max 4°) and --mx / --my
 * (sheen position) on the element. Off for touch and reduced motion.
 * Resets to flat on leave, so text is never left on a transformed layer.
 */
export function useTilt<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    const el = ref.current; if (!el || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover)').matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width; const py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--rx-ry', `${((px - 0.5) * 8).toFixed(2)}deg`);
      el.style.setProperty('--rx-rx', `${((0.5 - py) * 6).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`); el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    };
    const leave = () => { el.style.setProperty('--rx-ry', '0deg'); el.style.setProperty('--rx-rx', '0deg'); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, []);
  return ref;
}

/**
 * A multi-step form body that does not jump.
 *
 * Two things went wrong in the MRF wizards when a long step was followed by a
 * short one: the card shrank, so the page scrolled up under the cursor and the
 * reader landed on the MRF cards below; and the new step's top was wherever the
 * old step's bottom had been.
 *
 *  - `bodyRef` goes on the element wrapping the step CONTENT. Its height is
 *    watched and the tallest height seen so far becomes `minHeight` — put that
 *    on the element AROUND it. The body therefore never shrinks while the form
 *    is open (a ratchet, reset only by remounting the form).
 *  - `topRef` goes on the form's top (stepper). When `step` changes and that top
 *    is out of view, it is scrolled back into view below any sticky bar, and
 *    focus moves there (without scrolling again) so keyboard and screen-reader
 *    users start the new step at its beginning.
 */
export function useWizardBody(step: number) {
  const [minHeight, setMinHeight] = React.useState(0);
  const roRef = React.useRef<ResizeObserver | null>(null);
  const topRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect(); roRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const h = el.offsetHeight; setMinHeight((m) => (h > m ? h : m)); });
    ro.observe(el); roRef.current = ro;
  }, []);
  React.useEffect(() => () => roRef.current?.disconnect(), []);
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    const top = topRef.current; if (!top || typeof window === 'undefined') return;
    // How much of the viewport's top is covered by sticky/fixed bars right here.
    // Stacked bars (ESS top bar, then the recruitment rail docked under it)
    // are found by probing just below each one in turn.
    let cover = 0;
    const r = top.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + 24, 1), window.innerWidth - 1);
    for (let pass = 0; pass < 4; pass++) {
      const y = cover + 2;
      let next = cover;
      for (const el of document.elementsFromPoint(x, y)) {
        for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.position === 'sticky' || cs.position === 'fixed') {
            const b = n.getBoundingClientRect();
            if (b.top <= y && b.bottom > y && b.height < window.innerHeight * 0.5) next = Math.max(next, b.bottom);
            break;
          }
        }
      }
      if (next <= cover) break;
      cover = next;
    }
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (r.top < cover + 4 || r.top > window.innerHeight * 0.6) {
      window.scrollBy({ top: r.top - cover - 12, behavior: still ? 'auto' : 'smooth' });
    }
    try { top.focus({ preventScroll: true }); } catch { /* older browsers */ }
  }, [step]);
  return { bodyRef, topRef, minHeight };
}
