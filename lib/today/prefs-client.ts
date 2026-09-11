// lib/today/prefs-client.ts — client-side preference helpers (theme + formats).
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Prefs, Theme } from './types';
import { applyTheme } from '@/lib/ui/ThemeToggle';

const DEFAULT: Prefs = { theme: 'auto', time_format: '24', date_format: 'long' };

export function applyThemeAttr(theme: Theme) {
  // Delegates to the app's own theme control rather than duplicating it.
  //
  // This app grew two theme controls: the nav's ThemeToggle and this
  // preference. Writing the attribute here was not enough to keep them in
  // step, because the toggle takes its state from localStorage['ezer_theme']
  // and the boot script in <head> restores from that key on every load — so a
  // theme picked in Today looked right until the next reload, then silently
  // reverted, and the nav toggle showed the wrong state the whole time.
  //
  // applyTheme() owns that key, and cross-fades the swap the same way the nav
  // does. The extra data-theme attribute is this drop's own convention, which
  // parts of today.css still select on, so it is mirrored alongside.
  applyTheme(theme === 'auto' ? 'system' : theme);
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Holds prefs in state, applies the theme attribute, and persists via PUT /api/ess/preferences. */
export function usePrefs(initial?: Prefs) {
  const [prefs, setPrefs] = useState<Prefs>(initial ?? DEFAULT);
  useEffect(() => { applyThemeAttr(prefs.theme); }, [prefs.theme]);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs(p => {
      const next = { ...p, ...patch };
      fetch('/api/ess/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
        .catch(() => {/* best-effort; UI already updated */});
      return next;
    });
  }, []);
  return { prefs, update };
}
