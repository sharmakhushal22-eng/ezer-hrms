// lib/wall/__tests__/company-scoping.test.ts
//
// The Wall of Fame's catalogues are PER COMPANY. shoutout_categories,
// recognition_values, recognition_awards and badge_master each hold one row
// per company, and this database has three companies — so an unfiltered read
// returns every category, value, award and badge three times over.
//
// That shipped. "What is it for" listed Performance, Helping hand and the rest
// three times each, and choosing one was a coin toss between three
// identical-looking options belonging to three different companies. It was
// fixed once in ShoutoutComposer for recognition_values, and the same bug three
// lines above it in the same effect was missed — then found again in
// AppreciationComposer and in the query behind all six admin panels.
//
// A unit test cannot catch it: the fault is a missing clause in a query, and
// the query only misbehaves against a multi-company database. So this asserts
// the RULE at the source level. Any read of these tables must constrain
// company_id. It is the cheapest guard that would have caught all four sites.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Tables with one row per company. Reading any of them unscoped shows every
 *  company's copy. */
const PER_COMPANY = [
  'shoutout_categories',
  'recognition_values',
  'recognition_awards',
  'badge_master',
];

const ROOTS = ['components', 'app', 'lib'];
const SKIP = new Set(['node_modules', '.next', '.git', '__tests__']);

function sources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

/** The chained query following .from('table'). Supabase builders read as one
 *  expression, so the statement it sits in is the right unit to inspect. */
export function queryAfter(src: string, index: number): string {
  const chunk = src.slice(index, index + 600);
  const stop = chunk.indexOf('\n\n');
  return stop === -1 ? chunk : chunk.slice(0, stop);
}

export function unscopedReads(src: string, tables = PER_COMPANY): string[] {
  const found: string[] = [];
  for (const t of tables) {
    const re = new RegExp(`from\\(['"\`]${t}['"\`]\\)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (!queryAfter(src, m.index).includes('company_id')) found.push(t);
    }
  }
  return found;
}

describe('per-company catalogues are never read unscoped', () => {
  const files = ROOTS.flatMap(r => sources(r));

  test('the scanner actually looks at files', () => {
    // An empty file list would make every assertion below pass for free — the
    // failure mode this whole suite exists to avoid.
    assert.ok(files.length > 50, `expected to scan the app, saw ${files.length} files`);
  });

  test('the scanner flags an unscoped read (sabotage check)', () => {
    const bad = `const c = await supabase.from('shoutout_categories')\n  .select('id, label').eq('is_active', true)`;
    assert.deepEqual(unscopedReads(bad), ['shoutout_categories']);
  });

  test('the scanner accepts a scoped read', () => {
    const good = `let cq = supabase.from('shoutout_categories')\n  .select('id, label').eq('is_active', true)\ncq = cq.eq('company_id', companyId)`;
    assert.deepEqual(unscopedReads(good), []);
  });

  test('no source file reads a per-company table without company_id', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const hits = unscopedReads(readFileSync(f, 'utf8'));
      for (const t of hits) offenders.push(`${f} → ${t}`);
    }
    assert.deepEqual(offenders, [],
      `these reads would show every company's rows:\n  ${offenders.join('\n  ')}`);
  });

  test('the dynamic admin-panel query is scoped too', () => {
    // AdminConsole builds its table name at runtime, so the scan above cannot
    // see it. Every table behind those six panels carries company_id.
    const src = readFileSync('components/wall/AdminConsole.tsx', 'utf8');
    assert.ok(src.includes("supabase.from(q[0])"), 'the dynamic query moved; update this test');
    assert.ok(/\.eq\(['"]company_id['"]/.test(src),
      'AdminConsole must constrain company_id or every panel lists all companies');
  });
});
