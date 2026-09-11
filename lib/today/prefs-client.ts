// lib/today/prefs-client.ts — client-side preference helpers (theme + formats).
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Prefs, Theme } from './types';
import { applyTheme } from '@/lib/ui/ThemeToggle';
import { authHeaders } from '@/lib/auth-headers';

const DEFAULT: Prefs = { theme: 'auto', time_format: '24', date_format: 'long' };

export function applyThemeAttr(theme: Theme, opts: { animate?: boolean } = {}) {
  // Delegates to the app's own theme control rather than duplicating it.
  //
  // This app grew two theme controls: the nav's ThemeToggle and this
  // preference. Writing the attribute here was not enough to keep them in
  // step, because the toggle takes its state from localStorage['ezer_theme']
  // and the boot script in <head> restores from that key on every load — so a
  // theme picked in Today looked right until the next reload, then silently
  // reverted, and the nav toggle showed the wrong state the whole time.
  //
  // applyTheme() owns that key. It cross-fades only when asked to — see the
  // note there; restoring a remembered choice is not a gesture worth animating,
  // and two of them close together abort each other. The extra data-theme
  // attribute is this drop's own convention, which parts of today.css still
  // select on, so it is mirrored alongside.
  applyTheme(theme === 'auto' ? 'system' : theme, { animate: opts.animate ?? false });
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Holds prefs in state, applies the theme attribute, and persists via PUT /api/ess/preferences. */
export function usePrefs(initial?: Prefs) {
  const [prefs, setPrefs] = useState<Prefs>(initial ?? DEFAULT);
  // Silent by default. This effect runs on mount with whatever prefs we have,
  // then again when the saved ones arrive from /api/ess/today — neither is a
  // user gesture, and cross-fading both aborted the first transition. Only a
  // theme the reader just picked animates.
  const chose = useRef(false);
  useEffect(() => {
    applyThemeAttr(prefs.theme, { animate: chose.current });
    chose.current = false;
  }, [prefs.theme]);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs(p => {
      const next = { ...p, ...patch };
      if (patch.theme !== undefined && patch.theme !== p.theme) chose.current = true;
      // Persist outside the updater. React may call this function twice, and a
      // request is not something to send twice; it also cannot await in here,
      // and the PUT needs the ESS token or the route answers 401 and the
      // preference silently fails to save.
      queueMicrotask(async () => {
        try {
          await fetch('/api/ess/preferences', {
            method: 'PUT', headers: await authHeaders(), body: JSON.stringify(next),
          });
        } catch {/* best-effort; the UI has already moved */}
      });
      return next;
    });
  }, []);
  return { prefs, update };
}
