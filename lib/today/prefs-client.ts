// lib/today/prefs-client.ts — client-side preference helpers (theme + formats).
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Prefs, Theme } from './types';
import { applyTheme } from '@/lib/ui/ThemeToggle';
import { fromTodayTheme, toTodayTheme, onThemeChange } from '@/lib/ui/theme-resolve';
import { authHeaders } from '@/lib/auth-headers';

// Light, matching the product default in lib/ui/theme-resolve.ts. This said
// 'auto', and because the mount effect below applied it before the saved
// preference arrived, every ESS load reset the theme to "follow the OS".
const DEFAULT: Prefs = { theme: 'light', time_format: '24', date_format: 'long' };

export function applyThemeAttr(theme: Theme, opts: { animate?: boolean } = {}) {
  // Delegates to the app's own theme control rather than duplicating it.
  //
  // This app grew two theme controls: the nav's ThemeToggle and this
  // preference. applyTheme() owns the stored key, so everything goes through
  // it — and it notifies subscribers, which is how the nav toggle learns that
  // Today's button changed the theme.
  //
  // It cross-fades only when asked to: restoring a remembered choice is not a
  // gesture worth animating, and two transitions close together abort each
  // other.
  //
  // applyTheme() owns the stored choice AND writes both attributes as the
  // RESOLVED light/dark — see swap() in lib/ui/ThemeToggle.tsx. So there is
  // nothing left to mirror here.
  //
  // This used to write data-theme itself, with the RAW value, and remove the
  // attribute entirely on 'auto'. That made two writers disagree about the same
  // attribute — one writing resolved, one writing raw or nothing — which is the
  // shape of the bug this whole change exists to fix. It also meant an 'auto'
  // choice left data-theme absent, and absent is not neutral: the dark guards
  // in theme.css, today.css and social.css are negative selectors.
  applyTheme(fromTodayTheme(theme), { animate: opts.animate ?? false });
}

/** Holds prefs in state, applies the theme attribute, and persists via PUT /api/ess/preferences. */
export function usePrefs(initial?: Prefs) {
  const [prefs, setPrefs] = useState<Prefs>(initial ?? DEFAULT);
  // Silent by default. This effect runs on mount with whatever prefs we have,
  // then again when the saved ones arrive from /api/ess/today — neither is a
  // user gesture, and cross-fading both aborted the first transition. Only a
  // theme the reader just picked animates.
  const chose = useRef(false);
  // Whether a real preference has arrived — from the server payload, or from
  // the reader pressing the button.
  const settled = useRef(initial !== undefined);
  // The last theme this hook actually pushed through applyTheme(). Guards the
  // loop: nav toggle → notify → setPrefs → effect → applyTheme → notify → …
  const lastApplied = useRef<Theme | null>(initial?.theme ?? null);
  useEffect(() => {
    // THE BUG THIS GUARD FIXES.
    //
    // This effect used to run on mount with the DEFAULT prefs, before the saved
    // ones arrived from /api/ess/today. That call applied a theme nobody had
    // chosen, over the top of the one the boot script had just restored from
    // the reader's own explicit choice — and because the old default was
    // 'auto', it routed to applyTheme('system'), which deleted the stored key
    // outright. Pick Light in the nav toggle, open ESS, and it was gone: the
    // page fell back to the OS and came back dark on a dark-OS machine. The
    // mirror image happened on a light OS to anyone who had picked Dark.
    //
    // A theme is only applied once something real says so. Until then the boot
    // script's value stands, which is already correct.
    if (!settled.current) return;
    // Already on screen because the nav toggle put it there — re-applying would
    // notify again and bounce the two controls off each other.
    if (lastApplied.current === prefs.theme) return;
    lastApplied.current = prefs.theme;
    applyThemeAttr(prefs.theme, { animate: chose.current });
    chose.current = false;
  }, [prefs.theme]);

  // The nav toggle changed it — follow, so Today's button shows the same mode.
  // lastApplied is set first so the effect above sees the theme as already
  // applied and does not drive applyTheme() a second time.
  useEffect(() => onThemeChange((c) => {
    const t = toTodayTheme(c);
    lastApplied.current = t;
    settled.current = true;
    setPrefs(p => (p.theme === t ? p : { ...p, theme: t }));
  }), []);
  // Saved prefs arrive one of two ways, and both mark us settled:
  //   * server-rendered — passed in as `initial`, so settled from the start;
  //   * fetched client-side — Today.tsx calls update(j.prefs), which sets it.
  // There is deliberately no effect watching `initial`: it is a prop that never
  // changes after mount, so such an effect would never fire on the fetch path
  // and the theme would never be applied at all.
  // The latest prefs, for update() to merge against without re-creating itself
  // on every change.
  const latest = useRef(prefs);
  useEffect(() => { latest.current = prefs; }, [prefs]);

  const update = useCallback((patch: Partial<Prefs>) => {
    const prev = latest.current;
    const next = { ...prev, ...patch };
    // Pressing the theme button is a real preference, whatever arrived before.
    if (patch.theme !== undefined && patch.theme !== prev.theme) { chose.current = true; settled.current = true; }
    latest.current = next;
    setPrefs(next);
    // Outside the updater. React invokes an updater twice in development, and
    // sending the same PUT twice per click is not something to shrug at — a
    // measured 16 requests came out of 8 clicks while this lived in there.
    void (async () => {
      try {
        await fetch('/api/ess/preferences', {
          method: 'PUT', headers: await authHeaders(), body: JSON.stringify(next),
        });
      } catch {/* best-effort; the UI has already moved */}
    })();
  }, []);
  return { prefs, update };
}
