# 04 · Components and helpers

Everything is exported from `components/recruitment/rx/index.ts`.
All components are client components, take plain props, and never fetch.

## Frame

| Export | Props | Notes |
|---|---|---|
| `RxPage` | `header, rail, children` | The `.rx` frame for one tab |
| `RecruitmentHeader` | `title, subtitle?, help?, actions?, crumb?` | Header band with dotted motif |
| `TabRail` | `tabs: RailTab[], active, onSelect` | Groups: Plan · Source · Offer · Join · Track. Receives already-visible tabs |
| `TAB_META` | — | Icon and group per existing tab key |

## Views (whole-tab replacements)

| Export | Replaces | Writes |
|---|---|---|
| `DashboardView` | `DashTab` markup | none |
| `MrfListView` | `MRFTab` list markup | via passed handlers only |
| `PipelineView` | `PipelineTab` card list | none (opens the modal) |
| `JobStatusView` | `JobStatusTab` markup | via passed `onShare` / `onExport` |

## Cards

| Export | Purpose |
|---|---|
| `MrfCard` | Requisition card: lane, status, chips, approval chain, fill ring, recruiters, next step |
| `CandidateCard` | Board card: experience / expects / notice, source, AI score, next step |
| `ScreeningResultCard` | AI result: score ring, tag, matched/missing, questions, duplicate guard, error state |

## Primitives

`Badge` · `Chip` · `Module` · `Ring` · `Track` · `PropBar` · `KpiCard` · `MiniBars` ·
`NextStepLine` · `Help` · `Callout` · `EmptyState` · `Avatar` · `ApprovalChain` ·
`Timeline` · `FilterPills` · `Segmented` · `SearchBox` · `StageRiver` ·
`RxDialog` (native `<dialog>`, drawer | modal) · `RxToastProvider` / `useRxToast`.

`MRF_TONE` / `MRF_LABEL` map MRF statuses to one badge colour and label everywhere.

## Hooks

| Hook | Does |
|---|---|
| `useListControls(items, {text, status?, defaultView})` | In-memory search, status filter, view switch |
| `useSlashFocus(ref)` | `/` focuses the screen's search box |
| `useCountUp(n)` | KPI count-up; instant under reduced motion |

## Pure helpers (`logic/derive.ts`)

Display only. None of them is an authority — see the header comment in the file.

| Helper | Returns |
|---|---|
| `formatINR(rupees)` | `₹8,04,000` |
| `formatLakh(rupees, digits)` | `₹8.04L` |
| `lakhToRupees`, `annualise`, `laneFor` | Unit helpers mirroring the documented rules |
| `noticeLabel`, `experienceLabel` | `Immediate`, `5 yrs` |
| `budgetFit(offer, budgetMax)` | within / diff / % of ceiling |
| `hikePct(current, offered)` | one decimal |
| `daysUntil`, `relativeDay`, `shortDate`, `shortTime` | date labels |
| `countByStage(cands, stages)` | stage counts, rejected, max |
| `moveOptions(stages, current, rounds)` | which forward targets `moveStage` would accept, with reasons |
| `candidateNextStep(c, rounds)` | the card's next-step line |
| `chainProgress(mrf)`, `mrfNextStep(mrf)` | approval progress and next-step line |
| `dashboardTodos({mrfs, viewerName, offerRequestsPending?})` | "Your next steps" items |
| `existingCandidate(email, mrfId, cands)` | duplicate guard for screening |
| `missingDocuments(docs)` | names of documents not yet received |

## Adapters (`logic/adapters.ts`)

`toMrfVM(row, ctx)`, `toCandidateVM(row)`, `toRoundVM(row, nameOf)`.
Resolve the `// VERIFY` comments once against the schema.

## CSS classes worth knowing

Layout `rx-grid` + `s2…s12` · entrance `rx-stag` · lift `rx-lift` ·
buttons `rx-btn` + `p` / `g` / `d` / `ok` / `sm` / `ic` · fields `rx-field`, `rx-label`, `rx-input` ·
board `rx-board`, `rx-col`, `rx-card` · drop zone `rx-drop` · scanning `rx-scan` ·
letter `rx-paper` · stepper `rx-vs`, `rx-vsi` · sticky footer `rx-footbar` ·
confirm box `rx-confirm` · disabled reason `rx-why`.
