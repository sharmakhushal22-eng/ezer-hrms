// components/ess/today/hooks.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export const useReducedMotion = () => {
  const [r, setR] = useState(false);
  useEffect(() => { const mq = matchMedia('(prefers-reduced-motion: reduce)'); setR(mq.matches); const f = () => setR(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return r;
};

/** Ticks every `ms`; returns the current Date. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/** Eased count-up from 0 to `to`, starting after `delay` ms. */
export function useCountUp(to: number, decimals = 0, delay = 450, duration = 1100) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) { setV(to); return; }
    let raf = 0; const start = performance.now() + delay;
    const step = (now: number) => { const p = Math.min(1, Math.max(0, (now - start) / duration)); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [to, delay, duration, reduce]);
  return v.toFixed(decimals);
}

/** Simple toast: call show('text'); render <Toast/> once. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 2600); }, []);
  return { msg, show };
}

/** Sets a state flag to true after `ms` — used to trigger CSS transitions post-mount. */
export function useMounted(ms = 250) {
  const [ok, setOk] = useState(false);
  useEffect(() => { const id = setTimeout(() => setOk(true), ms); return () => clearTimeout(id); }, [ms]);
  return ok;
}
