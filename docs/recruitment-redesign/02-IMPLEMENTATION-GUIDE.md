# 02 · Implementation guide

Target: `ezer-hrms`, Next.js App Router, the Recruitment & ATS feature
(six files, 7,742 lines). Work on a branch; ship tab by tab.

Estimated effort: 4–6 developer days for the full module, or about one day for
the read-only screens (Dashboard, MRF list, Pipeline, Job Status) if you ship
in phases.

---

## Step 0 — Copy the kit in

```
components/recruitment/rx/        ← from src/components/recruitment/rx/
lib/ui/recruitment.redesign.css   ← from styles/recruitment.redesign.css
docs/recruitment-redesign/        ← from docs/   (so Claude Code and reviewers can read the contract)
```

`examples/page-integration.tsx` is a reference for the wiring; it is not copied.

Nothing else in the repo is replaced by copying. The kit has no dependencies
beyond React.

## Step 1 — Load the stylesheet and the display font

`app/dashboard/recruitment/layout.tsx` (create it if it does not exist):

```tsx
import '@/lib/ui/recruitment.redesign.css';
import { Bricolage_Grotesque } from 'next/font/google';

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700'], variable: '--rx-display-font' });

export default function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  return <div className={display.variable}>{children}</div>;
}
```

The stylesheet already picks it up: `.rx` resolves `--rx-display` from
`--rx-display-font` when the layout sets it, and falls back to DM Sans when it does not.

DM Sans is already the product font; nothing changes for body text.
Skip the font entirely if you prefer — titles fall back to DM Sans.

`theme.css` must load before this file (it already does, globally).

## Step 2 — Toast provider

Wrap the page body once. If EZER already has a toast system, skip this and map
`useRxToast()` to it.

```tsx
import { RxToastProvider } from '@/components/recruitment/rx';
// in RecruitmentPage render:
<RxToastProvider> …existing page… </RxToastProvider>
```

Rule: call `toast()` **after** a write succeeds, next to the existing
`onRefresh()` call — never optimistically.

## Step 3 — Build the rail once, from the existing TABS

```tsx
import { TabRail, TAB_META, type RailTab } from '@/components/recruitment/rx';

const visibleTabs = TABS.filter(t =>
  canSeeScreen(grant, `recruitment.${t.key}`) && (t.key !== 'hrhead' || isHrHead)); // ← EXACTLY the current filter

const railTabs: RailTab[] = visibleTabs.map(t => ({
  key: t.key, label: t.label, ...TAB_META[t.key],
  count: countFor(t.key),                 // optional, see below
  needsYou: t.key === 'offerapproval' || t.key === 'hrhead',
}));

const rail = <TabRail tabs={railTabs} active={tab} onSelect={setTab} />;
```

`countFor` is optional. Use only numbers the page already has (e.g. `mrfs.length`,
active candidates). Leave `count` undefined where you would need a new query.

## Step 4 — Adapt the loaded rows

```tsx
import { toMrfVM, toCandidateVM } from '@/components/recruitment/rx';

const ctx = { departments, locations, candidates, quickHireCap: QUICK_HIRE_CAP, nameOf: resolveName };
const mrfVMs  = useMemo(() => mrfs.map(r => toMrfVM(r, ctx)), [mrfs, candidates, departments, locations]);
const candVMs = useMemo(() => candidates.map(toCandidateVM), [candidates]);
```

Open `logic/adapters.ts` and resolve every `// VERIFY` against the real column
names (about 20 spots). This is the only place the kit touches row shapes.

`resolveName` is whatever the page already uses to turn employee ids into names
(the `employees` lookups).

## Step 5 — Replace tabs, one PR each

Recommended order (lowest risk first):

1. **Dashboard** → `<DashboardView>` (read-only)
2. **Job Status** → `<JobStatusView>` (read-only + existing share/export)
3. **MRF list** → `<MrfListView>` (handlers passed through)
4. **Pipeline** → `<PipelineView>` + candidate modal shell (`<RxDialog>`)
5. **AI Screening** → `<ScreeningResultCard>` inside the existing tab
6. **Offer tabs** (Negotiation, Offer Approval, HR Head, Send Offers, Offers)
7. **Pre-onboarding**
8. **Inline ten-step edit form** and, if agreed, `MrfForm` styling

Details and snippets for each: `03-TAB-BY-TAB.md`.

For every PR run the relevant section of `06-QA-CHECKLIST.md`.

## Step 6 — Page frame

Every tab renders inside `<RxPage header={…} rail={rail}>`. The four views do
this themselves. For tabs you restyle in place:

```tsx
<RxPage rail={rail} header={<RecruitmentHeader title="Salary negotiation" subtitle="…" />}>
  <div className="rx-grid rx-stag"> …existing tab logic, new markup… </div>
</RxPage>
```

## Step 7 — Remove the old markup

Delete the old JSX of each tab once its replacement ships. Keep all state,
effects, handlers and queries. A quick way to check you kept them: the diff of
each PR should show **only JSX and className changes** in the tab body, plus
the adapter/useMemo lines.

---

## Styling rules for anyone touching this later

- Colours only through `var(--ez-*)`. Dark mode then works for free.
- Use the `rx-*` classes; avoid new inline colours.
- The runtime sheet forces `border-radius:10px !important` on `button`. The
  redesign CSS restores its own radii under `.rx`. If you add a new button
  shape, add it to the "APP INTEGRATION" block.
- Motion: one entrance wave per screen (`rx-stag`), plus motion that answers an
  action. Everything collapses under `prefers-reduced-motion`.
