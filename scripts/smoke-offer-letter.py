#!/usr/bin/env python3
"""Smoke test for the offer-letter chain.  Run:  python3 scripts/smoke-offer-letter.py

Guards the wiring between five things that must agree, and fail silently when
they do not:

  1. Admin Setup > Offer Letter        designs the letter (template + clauses + letterhead)
  2. letter_templates.letter_type      identifies WHICH template is the offer letter
  3. MERGE_FIELDS 'Offer' group        the only tokens that can be filled for a candidate
  4. lib/recruitment/offer-letter-pdf  resolves + merges onto the uploaded stationery
  5. send-offer-email                  attaches it, or falls back to the drawn letter

Every one of these failures is invisible at build time, which is why they are
checked by reading the source rather than by trusting that it compiles:

  - a token used in a template but absent from MERGE_FIELDS prints literally on
    a real candidate's offer (renderTemplate leaves unknown tokens in place)
  - offer_request_id not posted from the client means the server can never find
    the template, and silently sends the old drawn letter forever
  - looking the template up by NAME instead of letter_type detaches every
    consumer the moment someone renames it
  - resolveMergeFieldsForEmployee cannot serve an offer at all: a candidate has
    no employees row, so reaching for it would resolve nothing

The merge arithmetic itself is not re-tested here — mergeLetterOntoLetterhead is
shared with HR Letters and exercised by that flow.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

def read(rel):
    p = ROOT / rel
    return p.read_text() if p.exists() else ''

ADMIN_TAB   = read('components/admin/OfferLetterDesign.tsx')
ADMIN_PAGE  = read('app/dashboard/admin/page.tsx')
BUILDER     = read('lib/recruitment/offer-letter-pdf.ts')
SENDER      = read('app/api/recruitment/send-offer-email/route.ts')
FIELDS      = read('lib/letters/mergeFields.ts')
RENDER      = read('lib/letters/renderTemplate.ts')
CLIENT      = read('app/dashboard/recruitment/offer-flow-components.tsx')
MIG140      = read('supabase/migrations/140_offer_letter_config.sql')
MERGE       = read('lib/letterhead/merge.ts')

P, F, W = [], [], []
def check(name, ok, detail=''):
    (P if ok else F).append(name)
    print('  %s %-62s %s' % ('PASS' if ok else 'FAIL', name, detail))
def warn(name, ok, detail=''):
    if ok: P.append(name); print('  PASS %-62s %s' % (name, detail))
    else:  W.append(name); print('  WARN %-62s %s' % (name, detail))

print()
print('── 0. the files exist at all ───────────────────────────────────────────')
for rel, src in [('components/admin/OfferLetterDesign.tsx', ADMIN_TAB),
                 ('lib/recruitment/offer-letter-pdf.ts', BUILDER),
                 ('app/api/recruitment/send-offer-email/route.ts', SENDER),
                 ('supabase/migrations/140_offer_letter_config.sql', MIG140)]:
    check('present: ' + rel, bool(src.strip()))

print()
print('── 1. the Admin tab is reachable ───────────────────────────────────────')
check('admin page imports the Offer Letter screen',
      'OfferLetterDesign' in ADMIN_PAGE)
check("the tab id is in the page's tab union",
      "'offerletter'" in ADMIN_PAGE)
check('the tab is rendered, not merely declared',
      re.search(r"tab\s*===\s*'offerletter'\s*&&\s*<OfferLetterDesign", ADMIN_PAGE) is not None,
      'declaring a tab without rendering it leaves a dead button')

print()
print('── 2. template identity is letter_type, never the name ─────────────────')
check('migration 140 adds letter_type',
      'add column if not exists letter_type' in MIG140)
check('migration 140 claims the existing row by name ONCE, in SQL',
      "upper(trim(name)) = 'OFFER LETTER'" in MIG140,
      'a one-time claim is fine; a runtime name lookup is not')
check('the admin tab queries by letter_type',
      "eq('letter_type'" in ADMIN_TAB)
check('the builder queries by letter_type',
      "eq('letter_type'" in BUILDER)
for label, src in [('admin tab', ADMIN_TAB), ('builder', BUILDER)]:
    check('%s does NOT look the template up by name' % label,
          not re.search(r"eq\(\s*'name'\s*,", src),
          'renaming the template would detach it')

print()
print('── 3. every Offer token is registered ──────────────────────────────────')
# The tokens the builder/sample actually produce must all be declared in
# MERGE_FIELDS, or renderTemplate reports them unknown and generation refuses.
declared = set(re.findall(r"\{\s*token:\s*'([a-z_]+)'", FIELDS))
offer_block = FIELDS[FIELDS.find("group: 'Offer'"):] if "group: 'Offer'" in FIELDS else ''
check("MERGE_FIELDS has an 'Offer' group", bool(offer_block))
check("the MergeField union includes 'Offer'", "'Offer'" in FIELDS.split('export const MERGE_FIELDS')[0])
# Bound the slice to the resolver's own `fields` literal. An earlier version
# sliced from resolveMergeFieldsForOffer to sampleOfferMergeFields, which also
# swallowed resolveAppraisalFields — so the RPC ARGUMENTS of
# calculate_appraisal_breakup (p_effective_from, p_new_fixed_ctc_annual, ...)
# were reported as undeclared merge tokens. They are parameters, not tokens.
resolver = ''
if 'resolveMergeFieldsForOffer' in FIELDS:
    start = FIELDS.find('resolveMergeFieldsForOffer')
    lit = FIELDS.find('const fields: ResolvedFields = {', start)
    if lit != -1:
        resolver = FIELDS[lit:FIELDS.find('\n  }', lit)]
produced = set(re.findall(r"^\s{4}([a-z_]+):", resolver, re.M))
check('the offer resolver\'s field literal was actually parsed',
      len(produced) >= 10, '%d tokens found' % len(produced))
unregistered = sorted(t for t in produced if t not in declared)
check('every token the offer resolver produces is declared',
      not unregistered, ', '.join(unregistered) or '%d tokens, all declared' % len(produced))
check('token names are lowercase_underscore only',
      all(re.fullmatch(r'[a-z_]+', t) for t in produced),
      "renderTemplate matches /\\{\\{([a-z_]+)\\}\\}/g — anything else never substitutes")
check('the admin picker only offers fillable groups',
      "f.group === 'Offer'" in ADMIN_TAB and "f.group === 'System'" in ADMIN_TAB,
      'Employee/Appraisal tokens cannot resolve for a candidate')

print()
print('── 4. an offer is resolved from the request, not from an employee ───────')
check('the builder uses resolveMergeFieldsForOffer',
      'resolveMergeFieldsForOffer' in BUILDER)
check('the builder does NOT reach for the employee resolver',
      'resolveMergeFieldsForEmployee' not in BUILDER,
      'a candidate has no employees row')
check('offer tokens come off offer_approval_requests',
      "from('offer_approval_requests')" in FIELDS)

print()
print('── 5. the letterhead cascade ───────────────────────────────────────────')
check('branch leg goes through the resolved view',
      "from('letterhead_resolved')" in BUILDER)
check('company leg falls back to letterhead_files',
      "eq('scope_type', 'COMPANY')" in BUILDER)
check('group leg falls back to letterhead_files',
      "eq('scope_type', 'GROUP')" in BUILDER)
check('the uploaded PDF is downloaded from the shared bucket',
      "storage.from('letterhead-files')" in BUILDER)
check('the admin upload writes that SAME store',
      'saveLetterheadAtScope' in ADMIN_TAB,
      'a second store would disagree with HR Letters')
check('the stored signature mime is read, not assumed',
      'signature_mime_type' in BUILDER,
      'embedPng on a JPEG throws and would kill the send')
check('merge accepts a missing signatory',
      'ResolvedSignatory | null' in MERGE)

print()
print('── 6. a single-page letterhead is enforced at upload ───────────────────')
check('multi-page PDFs are rejected',
      'pageCount > 1' in ADMIN_TAB,
      'merge paints page 1 as every page background; pages 2+ would vanish')
check('only PDFs are accepted',
      'ACCEPTED_LETTERHEAD_MIME' in ADMIN_TAB)
check('a size ceiling is applied',
      'MAX_LETTERHEAD_BYTES' in ADMIN_TAB)
check('replacing shared stationery is confirmed, naming the file',
      'confirm(' in ADMIN_TAB and 'file_name' in ADMIN_TAB,
      'HR Letters prints on the same row')

print()
print('── 7. dispatch is wired, and fails the right way ───────────────────────')
check('the client posts offer_request_id',
      'offer_request_id: selected.id' in CLIENT,
      'without it the server can never find the template — silent fallback forever')
check('the route reads offer_request_id',
      'offer_request_id' in SENDER)
check('the route calls the builder',
      'buildOfferLetterPdf' in SENDER)
check('a bad token REFUSES the send with 400',
      'OfferTemplateTokenError' in SENDER and 'status: 400' in SENDER,
      'otherwise a candidate receives a letter showing {{tokens}}')
check('the builder throws on unknown tokens rather than returning',
      'throw new OfferTemplateTokenError' in BUILDER)
check('renderTemplate still reports unknown tokens',
      'unknownTokens' in RENDER,
      'the refusal above depends on this')
check('no letterhead falls back to the drawn letter',
      'renderOfferLetterPng' in SENDER and 'attachments.length' in SENDER,
      '"not configured yet" must not block an approved offer')
check('the fallback runs only when nothing was built',
      re.search(r'if\s*\(\s*!attachments\.length\s*&&\s*offer\s*\)', SENDER) is not None,
      'otherwise both attachments are sent')

print()
print('── 8. money is never taken from the editable form ──────────────────────')
check('the builder reads figures from the approved request',
      'offered_ctc' in FIELDS,
      'the HR Head approved these; the letter must not restate them')
check('absent money renders as a blank, not a zero',
      'FALLBACK' in FIELDS and 'Number(n) === 0' in FIELDS,
      '"Rs 0 joining bonus" states a term nobody offered')

print()
total = len(P) + len(F)
print('──────────────────────────────────────────────────────────────────────────')
print('  %d/%d checks passed, %d failed, %d warnings' % (len(P), total, len(F), len(W)))
if F:
    print()
    print('  FAILED:')
    for n in F:
        print('    - ' + n)
print()
# NOTE ON READING THIS SCRIPT'S RESULT: the exit code is the result. Piping the
# output through head/tail and then reading $? reports the PIPE's status, not
# Python's, which once made a run with a failure look like a pass. Use
#   python3 scripts/smoke-offer-letter.py; echo "exit: $?"
# or check ${PIPESTATUS[0]} if you must pipe.
sys.exit(1 if F else 0)
