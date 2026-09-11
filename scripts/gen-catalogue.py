#!/usr/bin/env python3
"""
gen-catalogue.py — generate migration 089's seed rows from lib/wall/catalogue.ts.

The catalogue is seventy-four items transcribed from
HRMS_Employee_Applause_Recognition_Master.docx. Maintaining it twice — once in
TypeScript for the UI and once in SQL for the database — is how the two end up
disagreeing, and the disagreement surfaces as a badge that exists on one screen
and not another.

So the TS file is canonical and this writes the SQL. Run it after editing the
catalogue; lib/wall/__tests__/catalogue.test.ts re-parses the migration and
fails if the two have drifted, so forgetting to run it is caught rather than
shipped.

    python3 scripts/gen-catalogue.py          # rewrite the seed block in place
    python3 scripts/gen-catalogue.py --check  # exit 1 if it would change
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TS  = ROOT / 'lib/wall/catalogue.ts'
SQL = ROOT / 'supabase/migrations/089_recognition_catalogue.sql'

BEGIN = '-- >>> GENERATED FROM lib/wall/catalogue.ts — DO NOT EDIT BY HAND <<<'
END   = '-- >>> END GENERATED <<<'

ITEM = re.compile(
    r"\{\s*ref:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)',\s*"
    r"category:\s*'([^']+)',\s*glyph:\s*'([^']*)',\s*"
    r"description:\s*'((?:[^'\\]|\\.)*)'\s*\}", re.S)

def unesc(s): return s.replace("\\'", "'").replace('\\\\', '\\')
def q(s):     return "'" + s.replace("'", "''") + "'"

def parse():
    src = TS.read_text()
    def block(name):
        start = src.index(f'export const {name}: CatalogueItem[] = [')
        end   = src.index('\n]', start)
        return [(r, unesc(n), c, g, unesc(d))
                for r, n, c, g, d in ITEM.findall(src[start:end])]
    return block('BADGES'), block('TAGS')

def rows(items, kind):
    return ',\n'.join(
        f"    ({q(ref)}, {q(kind)}, {q(name)}, {q(cat)}, {q(glyph)}, {q(desc)}, {i * 10})"
        for i, (ref, name, cat, glyph, desc) in enumerate(items, 1))

def render():
    badges, tags = parse()
    return (
f"""{BEGIN}
-- {len(badges)} badges and {len(tags)} tags, from
-- HRMS_Employee_Applause_Recognition_Master.docx.
insert into recognition_catalogue (ref, kind, name, category, glyph, description, sort_order)
values
{rows(badges, 'BADGE')},
{rows(tags, 'TAG')}
on conflict (ref) do update set
  name        = excluded.name,
  category    = excluded.category,
  glyph       = excluded.glyph,
  description = excluded.description,
  sort_order  = excluded.sort_order;
{END}""")

def main():
    body = render()
    text = SQL.read_text()
    a, b = text.index(BEGIN), text.index(END) + len(END)
    updated = text[:a] + body + text[b:]
    if '--check' in sys.argv:
        if updated != text:
            print('SQL is out of date — run: python3 scripts/gen-catalogue.py')
            return 1
        print('SQL matches the catalogue')
        return 0
    SQL.write_text(updated)
    badges, tags = parse()
    print(f'wrote {len(badges)} badges + {len(tags)} tags into {SQL.name}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
