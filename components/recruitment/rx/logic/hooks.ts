'use client';
import * as React from 'react';

/**
 * Search + status filter + view switch over data the tab ALREADY has in props.
 * Purely client-side: no query is added or changed, so row scoping from loadAll
 * is untouched.
 */
export function useListControls<T, V extends string>(
  items: T[],
  opts: { text: (t: T) => string; status?: (t: T) => string; defaultView: V },
) {
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState<string>('*');
  const [view, setView] = React.useState<V>(opts.defaultView);
  const q = query.trim().toLowerCase();
  const visible = React.useMemo(
    () => items.filter((t) =>
      (!q || opts.text(t).toLowerCase().includes(q)) &&
      (status === '*' || !opts.status || opts.status(t) === status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, status],
  );
  const clear = React.useCallback(() => { setQuery(''); setStatus('*'); }, []);
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
