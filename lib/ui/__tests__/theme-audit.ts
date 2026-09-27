// lib/ui/__tests__/theme-audit.ts — finds colours that cannot follow the theme.
//
// NOT A TEST FILE. The runner's glob is "lib/**/__tests__/*.test.ts", so this is
// importable from a test but never executed as one. It lives here rather than in
// lib/ui/ because it imports node:fs — if application code ever imported it, the
// browser bundle would break.
//
// WHAT IT LOOKS FOR
//
// A hex literal used for a colour-bearing CSS property in a .tsx file. Those are
// frozen: one attribute on <html> repaints everything that resolves through
// lib/ui/theme.css, and a literal resolves through nothing. That is the whole
// bug behind "open the MRF form in dark mode and it renders light".
//
// WHAT IT DELIBERATELY DOES NOT COUNT
//
//   var(--ez-surface, #FFFFFF)   a fallback INSIDE var() is correct and common;
//                                the scoped stylesheets in LeaveSection and
//                                FunZone are built this way and are theme-aware.
//                                Counting these reported 759 problems where
//                                there were 288.
//   comments                     a hex in prose is not a rendered colour.
//   non-colour properties        a hex in an id, a key, or a data string.
//
// The rule is line-based on purpose: one line with three literals is one place a
// human has to go and look, not three.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Properties whose value actually paints something. */
const COLOUR_PROP = /background|color|border|boxShadow|box-shadow|fill|stroke|outline|shadow/i;
const HEX = /#[0-9A-Fa-f]{3,8}\b/;

/**
 * Block and line comments. The `[^:]` guard keeps `https://` intact.
 *
 * NEWLINES ARE PRESERVED. A block comment is replaced by the same number of
 * newlines it spanned, not by nothing.
 *
 * The first version collapsed them, and the line numbers it reported were then
 * wrong for any file containing a block comment — 97 of 203 files in this repo.
 * It pointed at `<div className="dial">` in PunchDial when the real hit was two
 * lines further down, in an SVG gradient stop. The counts were right and the
 * locations were fiction, which is the worst way for a measuring tool to fail:
 * it looks like it is working.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `var(--x, #hex)` is theme-aware; the fallback must not be counted. */
function stripVarCalls(src: string): string {
  return src.replace(/var\([^()]*\)/g, '');
}

/** The violating line numbers in one file's source, 1-based. */
export function violatingLines(src: string): number[] {
  const cleaned = stripVarCalls(stripComments(src));
  const out: number[] = [];
  cleaned.split('\n').forEach((line, i) => {
    if (COLOUR_PROP.test(line) && HEX.test(line)) out.push(i + 1);
  });
  return out;
}

export function countIn(src: string): number {
  return violatingLines(src).length;
}

/** Every .tsx under a root, skipping node_modules and dotted directories. */
export function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** file path → violation count, for every file that has any. Sorted. */
export function scan(roots: string[] = ['app', 'components']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const root of roots) {
    for (const file of walk(root)) {
      const n = countIn(readFileSync(file, 'utf8'));
      if (n > 0) out[file] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
