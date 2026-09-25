# 07 · Prompt for Claude Code

Paste this into Claude Code at the root of `ezer-hrms`, after copying the kit
into the repo (Step 0 of the implementation guide). Run it once per phase;
change the PHASE line each time.

---

```
You are restyling the Recruitment & ATS module of this repo. This is a
presentation-only change.

READ FIRST, in this order:
1. docs/recruitment-redesign/01-WHAT-STAYS-THE-SAME.md   (the contract — never break it)
   docs/recruitment-redesign/02-IMPLEMENTATION-GUIDE.md
   docs/recruitment-redesign/03-TAB-BY-TAB.md
   docs/recruitment-redesign/05-NEW-FEATURES.md
2. components/recruitment/rx/index.ts and logic/derive.ts
3. app/dashboard/recruitment/page.tsx (TABS, loadAll, moveStage, canSeeScreen use)

PHASE: Dashboard + Job Status
(next phases: MRF list + drawer · Pipeline + candidate modal · AI Screening ·
Offer tabs · Pre-onboarding · ten-step edit form)

RULES
- Do not change any Supabase query, any fetch() call, any route under
  app/api/recruitment/, loadAll, moveStage, canSeeScreen, OVERSIGHT_CODES,
  QUICK_HIRE_CAP, STAGES, MRF_STATUSES, or any write handler.
- Keep all state, effects and handlers of a tab; replace only its JSX.
- Pass existing handlers into the rx views/cards as callbacks.
- Resolve every "// VERIFY" in components/recruitment/rx/logic/adapters.ts
  against the real column names before using the adapters.
- Do not add drag-and-drop. Do not add columns or migrations.
- Features in docs/recruitment-redesign/05-NEW-FEATURES.md that need a new read (#3 with rounds,
  #8) stay OFF unless I say otherwise.
- Use examples/page-integration.tsx in the kit as the wiring pattern.
- Import lib/ui/recruitment.redesign.css once in app/dashboard/recruitment/layout.tsx.

WHEN DONE WITH THE PHASE
- Show me the diff summary per file.
- Confirm that the only non-JSX changes are imports, the adapter useMemo
  lines and the rail construction.
- List which items of docs/recruitment-redesign/06-QA-CHECKLIST.md I should run for this phase.
```
