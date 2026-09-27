// lib/ui/theme-resolve.ts — the one place that decides which theme is showing.
//
// WHY THIS FILE EXISTS
//
// The theme was decided in three places that could not agree, and none of them
// could be tested: a template-literal boot script in <head>, a React component
// (ThemeToggle.tsx), and the ESS Today preference (lib/today/prefs-client.ts).
// The bug that produced this file: pick Light in the nav toggle, reload ESS,
// and the page comes back dark on a dark-OS machine — and the mirror image on a
// light OS. Three separate defects fed it.
//
//   1. THE WIPE. usePrefs() mounted with a default of theme:'auto' and applied
//      it immediately, before the saved preference arrived from the API.
//      'auto' routed to applyTheme('system'), which called
//      localStorage.removeItem('ezer_theme') — destroying the explicit choice
//      the boot script had just honoured. The server defaulted to 'auto' too,
//      so for anyone who had never touched Today's button the wipe was
//      permanent, repeating on every single load.
//
//   2. ABSENCE MEANT TWO THINGS. 'system' was stored by REMOVING the key, so
//      "I chose to follow my OS" and "I have never chosen anything" were
//      byte-identical. Every dark rule in the product is a negative guard —
//      :root:not([data-ez-theme="light"]) — which matches when the attribute is
//      absent. So absence plus a dark OS meant dark, whatever the user thought
//      they had picked.
//
//   3. THE SECOND ATTRIBUTE WAS ASYMMETRIC. Both data-ez-theme="dark" and
//      data-theme="dark" turn dark ON (theme.css:497-498), but only
//      data-ez-theme="light" turns it OFF. A light choice written to the other
//      attribute alone could never defeat the guard.
//
// The rules below are pure functions of their inputs, so they can be tested
// against every combination rather than clicked through. See
// __tests__/theme-resolve.test.ts.

/** What the user asked for. 'system' means "follow the OS", explicitly chosen. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** What is actually painted. 'system' is never a rendered state. */
export type ResolvedTheme = 'light' | 'dark';

/** localStorage key. Shared by the boot script and both controls. */
export const STORAGE_KEY = 'ezer_theme';

/**
 * The product default.
 *
 * Light, for admin and ESS alike. It used to be "follow the OS", which meant an
 * employee whose laptop switched to dark at sunset found the HRMS dark the next
 * morning without having asked for anything.
 */
export const DEFAULT_CHOICE: ThemeChoice = 'light';

/**
 * Interpret the stored value.
 *
 * An ABSENT key means nobody has chosen, which is now light — not 'system'.
 * That distinction is the whole fix for defect 2: 'system' is written to
 * storage explicitly from here on, so it survives as a real choice instead of
 * being indistinguishable from never having decided.
 *
 * Anything unrecognised (a stale value, a half-written key, another tab's
 * garbage) falls back to the default rather than throwing — a corrupt
 * preference must not leave somebody unable to read the screen.
 */
export function readChoice(raw: string | null | undefined): ThemeChoice {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return DEFAULT_CHOICE;
}

/**
 * Which theme is actually painted, given the choice and the OS preference.
 *
 * This is the ONLY place the OS preference is allowed to decide anything. An
 * explicit light or dark choice wins over the OS in both directions — that was
 * the documented intent in theme.css all along, and the negative CSS guards
 * only achieved it by accident.
 */
export function resolveTheme(choice: ThemeChoice, osPrefersDark: boolean): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return osPrefersDark ? 'dark' : 'light';
}

/** Read + resolve in one step, for the boot script and for mount-time reads. */
export function resolveStored(raw: string | null | undefined, osPrefersDark: boolean): ResolvedTheme {
  return resolveTheme(readChoice(raw), osPrefersDark);
}

/**
 * The attribute value to write on <html>.
 *
 * ALWAYS the resolved 'light' or 'dark', NEVER 'auto' and never absent.
 *
 * Two reasons it must be explicit. First, every dark rule in the product is a
 * negative guard, so an absent attribute is not neutral — it is "dark if the OS
 * says so". Writing the resolved value is what makes an explicit light choice
 * actually stick. Second, components/ess/inbox/inbox.css carries rules keyed on
 * [data-ez-theme="auto"].is-dark — a third convention that nothing has ever
 * written. Those rules are dead today and must STAY dead: writing 'auto' here
 * would silently switch on about eight inbox rules that have never once
 * rendered, which is not a change anybody asked for.
 */
export function attrFor(choice: ThemeChoice, osPrefersDark: boolean): ResolvedTheme {
  return resolveTheme(choice, osPrefersDark);
}

// ── Keeping the two controls in step ───────────────────────────────────────
//
// The nav toggle (lib/ui/ThemeToggle.tsx) and the Today button
// (components/ess/today/HeroPanel.tsx) render the same setting in two places.
// Both drove the theme correctly but neither could see the other change it:
// the toggle read its value once on mount, and Today rendered its own prefs
// object. Flip one and the other went on showing the old mode.
//
// This carries the CHOICE, not the resolved theme. A MutationObserver on the
// html attribute — the pattern app/page.tsx already uses — would be simpler and
// cannot drift from what is painted, but it only ever sees 'light' or 'dark',
// so "System on a dark OS" and "Dark" are the same to it and the toggle would
// highlight the wrong one of its three buttons.
type ThemeListener = (choice: ThemeChoice) => void;
const listeners = new Set<ThemeListener>();

/** Subscribe to theme changes. Returns the unsubscribe function. */
export function onThemeChange(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Tell every subscriber the choice changed. Called by applyTheme().
 *
 * Iterates a COPY: a listener that unsubscribes while being notified — a React
 * effect cleaning up mid-notification — would otherwise mutate the set being
 * walked. Errors are contained so one broken subscriber cannot stop the rest
 * from updating, which would leave a control stuck showing the wrong mode.
 */
export function notifyThemeChange(choice: ThemeChoice) {
  for (const fn of [...listeners]) {
    try { fn(choice); } catch { /* one bad listener must not strand the others */ }
  }
}

/** Test seam only. */
export function _listenerCount(): number { return listeners.size; }

/** The ESS Today preference's vocabulary. Its 'auto' is this module's 'system'. */
export type TodayTheme = 'auto' | 'light' | 'dark';

/** Today's value → the shared choice. The two controls must agree on meaning. */
export function fromTodayTheme(t: TodayTheme): ThemeChoice {
  return t === 'auto' ? 'system' : t;
}

/** The shared choice → Today's value, so flipping either control updates both. */
export function toTodayTheme(c: ThemeChoice): TodayTheme {
  return c === 'system' ? 'auto' : c;
}
