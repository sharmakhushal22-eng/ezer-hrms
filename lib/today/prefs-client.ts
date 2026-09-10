// lib/today/prefs-client.ts — client-side preference helpers (theme + formats).
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Prefs, Theme } from './types';

const DEFAULT: Prefs = { theme: 'auto', time_format: '24', date_format: 'long' };

export function applyThemeAttr(theme: Theme) {
  const root = document.documentElement;
  // BOTH attributes, deliberately. This app grew two theme controls: the
  // existing ThemeToggle writes data-ez-theme, and this preference writes
  // data-theme. lib/ui/theme.css now selects on either, so writing both keeps
  // the two in step — change the theme here and the toggle in the nav shows
  // the same state, instead of the two silently disagreeing.
  if (theme === 'auto') {
    root.removeAttribute('data-theme');
    root.removeAttribute('data-ez-theme');
  } else {
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-ez-theme', theme);
  }
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
