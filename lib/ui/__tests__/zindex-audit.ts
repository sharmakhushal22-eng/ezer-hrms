// lib/ui/__tests__/zindex-audit.ts — finds raw z-index numbers.
//
// NOT A TEST FILE. Same arrangement as theme-audit.ts: the runner's glob is
// "lib/**/__tests__/*.test.ts", so this is importable but never run as a test,
// and it lives here because it imports node:fs.
//
// WHAT IT LOOKS FOR
//
// A literal number assigned to z-index. Reported as: open the "People" menu in
// the ESS nav and the page's own tab row paints over it.
//
// The cause was not the menu. The nav bar was z-index 25 and the recruitment
// page's sticky header was 30 — siblings in one stacking context, so the page
// legitimately won, and the menu's own 40 never entered into it because it is a
// DESCENDANT of the 25 bar. Raising the menu would have changed nothing.
//
// That is what a raw number does: it can only be chosen by looking at whatever
// is currently on top, which is how this repo reached 37 distinct values —
// 0,1,2,3,5,10,15,20,25,29,30,40,41,50,60,80,90,100,200,211,300,400,501,600,
// 601,999,1000,1001,1200,1500,2000,3000,4000,5000,9999,99999,2147483000 —
// with 19 separate files each hardcoding a toast at 9999 or 99999.
//
// THE RULE IS "USE THE SCALE", NOT "VALUES ABOVE N ARE BAD"
//
// Every raw number is flagged, whatever its size. A small one inside a card is
// usually harmless, and the baseline records those without asking anyone to
// change them. But a NEW raw number is always a guess, and guessing is the
// thing being stopped. `zIndex: Z.nav` contains no digits and so never matches.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** `zIndex: 40`, `z-index:30`, `zIndex:\n  200`. Not `zIndex: Z.nav`. */
const RAW_Z = /(?:zIndex|z-index)\s*:\s*-?\d+/;

/**
 * Block and line comments, newlines preserved.
 *
 * The colour scanner's first version collapsed them and reported line numbers
 * that were wrong in 97 of 203 files — right counts, fictional locations. Same
 * mistake is not being made twice.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 1-based line numbers carrying a raw z-index. */
export function violatingLines(src: string): number[] {
  const out: number[] = [];
  stripComments(src).split('\n').forEach((line, i) => {
    if (RAW_Z.test(line)) out.push(i + 1);
  });
  return out;
}

export function countIn(src: string): number {
  return violatingLines(src).length;
}

const EXT = ['.tsx', '.ts', '.css'];

export function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.') || e === '__tests__') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.some(x => p.endsWith(x))) out.push(p);
  }
  return out;
}

/** file → count of raw z-index lines, for every file that has any. */
export function scan(roots: string[] = ['app', 'components', 'lib']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const root of roots) {
    for (const file of walk(root)) {
      const n = countIn(readFileSync(file, 'utf8'));
      if (n > 0) out[file] = n;
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
