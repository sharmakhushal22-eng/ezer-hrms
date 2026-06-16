@AGENTS.md

# EZER HRMS — Claude Code Guide

> This file tells Claude Code exactly how this project works, what conventions to follow,
> and what the current in-progress feature is. Read the entire file before touching any code.

---

## Project Identity

**Product:** EZER HRMS — India-focused HR SaaS for companies with 50–2,000 employees  
**Repo:** `sharmakhushal22-eng/ezer-hrms`  
**Live URL:** `https://ezer-hrms-chi.vercel.app`  
**Owner:** Khushal Sharma (Payroll Head, OfBusiness + EZER founder)  
**Deadline:** 30 June 2026 — MVP launch

---

## Stack (exact versions)

```
Framework:  Next.js 16.2.6  (App Router — read node_modules/next/dist/docs/ before writing code)
Language:   TypeScript (strict: true)
Database:   Supabase (PostgreSQL, ap-south-1 / Mumbai region)
UI:         Inline styles only — NO Tailwind classes in JSX, NO CSS modules
Deploy:     Vercel (auto-deploy on push to main)
Node:       22.x
React:      19.2.4
```

**Key dependencies:**
```
@supabase/supabase-js ^2.105.4
xlsx ^0.18.5
mammoth ^1.12.0
next 16.2.6
```

**Path alias:** `@/*` maps to project root (e.g. `@/lib/supabase`, `@/components/recruitment/...`)

---

## Supabase Client

Always import from `@/lib/supabase` — never instantiate a new client inline.

```typescript
import { supabase } from '@/lib/supabase'
```

`lib/supabase.ts` contents:
```typescript
import { createClient } from '@supabase/supabase-js'
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseKey)
```

**RLS policy pattern** — every new table must have:
```sql
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_my_table" ON my_table;
CREATE POLICY "allow_all_my_table" ON my_table
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```

---

## Style System (STRICT — never deviate)

All styling is done with inline React `style={{}}` objects. No Tailwind classes in JSX.
Each page/component defines a local `T` or `C` constant at the top. Match it exactly.

### Hardcoded hex palette

```
Page background   →  #F5F3FF
Cards             →  #FFFFFF
Primary text      →  #1E1B4B
Muted text        →  #6B7280
Border            →  rgba(124,58,237,0.12)
Purple (primary)  →  #7C3AED
Purple soft       →  rgba(124,58,237,0.08)
Purple label      →  #6D28D9
Green (success)   →  #059669
Amber (warning)   →  #B45309
Red (error)       →  #DC2626
Card shadow       →  0 1px 4px rgba(124,58,237,0.06)
```

### Border radius

```
Cards / containers  →  10px  (borderRadius: 10)
Inputs / buttons    →  7px   (borderRadius: 7)
Badges / pills      →  99px  (borderRadius: 99)
```

### Typography

```
Font family     →  "DM Sans","Segoe UI",sans-serif
Page font-size  →  13px base
Labels          →  11px, fontWeight:600, uppercase, letterSpacing:'.06em', color:#6D28D9
Section heads   →  12px, fontWeight:600, color:#7C3AED, uppercase, letterSpacing:'.05em'
Card titles     →  13–14px, fontWeight:600, color:#1E1B4B
Body text       →  12–13px, color:#1E1B4B or #374151
Muted           →  #6B7280 or #9CA3AF
```

### T style constant pattern (recruitment/page.tsx)

```typescript
const T = {
  page:       { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif' },
  card:       { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' },
  label:      { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase', letterSpacing:'.06em', display:'block', marginBottom:4 },
  input:      { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid #DDD6FE', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', boxSizing:'border-box', fontFamily:'inherit' },
  select:     { /* same as input */ },
  textarea:   { /* same as input + resize:'vertical', minHeight:90 */ },
  btn:        { padding:'8px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap' },
  btnPrimary: { ...btn, background:'#7C3AED', color:'#fff' },
  btnOutline: { padding:'7px 13px', borderRadius:7, border:'1px solid #DDD6FE', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#6D28D9' },
  g2: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 },
  g3: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 },
  g4: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 },
}
```

### C style constant (used in InterviewPipeline.tsx)

```typescript
const C = {
  page:  { background:'#F5F3FF', minHeight:'100vh', color:'#1E1B4B', fontFamily:'"DM Sans","Segoe UI",sans-serif', fontSize:'13px' },
  card:  { background:'#FFFFFF', borderRadius:10, border:'1px solid rgba(124,58,237,0.12)', padding:'14px 16px', marginBottom:10, boxShadow:'0 1px 4px rgba(124,58,237,0.06)' },
  btnP:  { padding:'8px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:'#7C3AED', color:'#fff' },
  btnG:  { padding:'8px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:'#059669', color:'#fff' },
  btnO:  { padding:'7px 14px', borderRadius:7, border:'1px solid rgba(124,58,237,0.2)', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:'#fff', color:'#7C3AED' },
  inp:   { width:'100%', padding:'9px 11px', background:'#FAFAF8', border:'1px solid rgba(124,58,237,0.12)', borderRadius:7, color:'#1E1B4B', fontSize:13, outline:'none', fontFamily:'inherit', boxSizing:'border-box' },
  lbl:   { fontSize:11, fontWeight:600, color:'#6D28D9', textTransform:'uppercase', letterSpacing:'.05em', display:'block', marginBottom:4 },
  g2:    { display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 },
  g3:    { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 },
  pill:  (bg, color) => ({ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:600, background:bg, color }),
}
```

---

## Architecture — Key Rules

### React sub-components

**CRITICAL:** All sub-components MUST be defined OUTSIDE the parent component function.
Defining them inside causes re-mount on every keystroke → focus loss bugs.

```typescript
// ✅ CORRECT — outside parent
function StarRating({ value, onChange }: ...) { ... }
function RoundCard({ round, ... }: ...) { ... }

export default function InterviewPipeline({ candidate }: ...) {
  // use StarRating, RoundCard here — they're stable references
}

// ❌ WRONG — inside parent — breaks on every keystroke
export default function InterviewPipeline({ candidate }: ...) {
  function StarRating() { ... }  // re-mounts on parent re-render
}
```

### White-label

No company name, no logo anywhere in UI. EZER HRMS is the brand.

### No CSS variables

Only hardcoded hex colors. Never `var(--color-xxx)` in JSX styles.

### File structure

```
app/
  dashboard/
    recruitment/
      page.tsx          ← 1,365 lines — all recruitment code in ONE file
    admin/
      page.tsx          ← 1,402 lines — admin setup wizard
    onboarding/
      page.tsx          ← onboarding dashboard
    employees/
      page.tsx          ← employee master (read-only)
  onboarding/
    [token]/
      page.tsx          ← employee-facing onboarding portal (server)
      client.tsx        ← OnboardingPortal v3 (1,393 lines)
    hr-queue/
      page.tsx          ← HR activation queue
    review/[id]/
      page.tsx          ← HR review panel
    approvals/it/[id]/
      page.tsx
    approvals/admin/[id]/
      page.tsx
    approvals/payroll/[id]/
      page.tsx
    generate-code/[id]/
      page.tsx
api/
  recruitment/
    generate-jd/        ← Gemini JD generation
    screen-resumes/     ← Gemini resume screening
    interview-ai/       ← AI question + feedback generation
  onboarding/
    send-magic-link/
    validate-token/
    otp/
    save-progress/
    verify-document/    ← Gemini doc extraction
    submit/
    generate-code/
  cron/
    joining-reminders/  ← 3-day DOJ reminder (runs 9 AM IST daily)
components/
  recruitment/
    InterviewPipeline.tsx   ← NEW FILE (being added in this sprint)
  onboarding/
    Timeline.tsx            ← Reusable vertical timeline
lib/
  supabase.ts               ← Single Supabase client
  onboarding/
    actions.ts              ← Onboarding Supabase helpers
```

---

## Current Modules — Status

| Module | File | Status | Lines |
|--------|------|--------|-------|
| Admin Setup | `app/dashboard/admin/page.tsx` | ✅ 85% live | 1,402 |
| Recruitment/ATS | `app/dashboard/recruitment/page.tsx` | ✅ 90% live | 1,365 |
| Employee Master | `app/dashboard/employees/page.tsx` | ⚠️ 40% read-only | 528 |
| Onboarding Portal | `app/onboarding/[token]/client.tsx` | 📦 Written, push pending | 1,393 |
| HR Activation | `app/onboarding/hr-queue/` etc. | 📦 Written, push pending | ~2,000 |
| Interview Pipeline | `components/recruitment/InterviewPipeline.tsx` | 🔨 In progress | 744 |
| Leave / Attendance / Payroll / ESS | — | ❌ Not started | 0 |

---

## ════════════════════════════════════════════
## CURRENT SPRINT: Interview Pipeline Integration
## ════════════════════════════════════════════

### What we're building

A multi-round interview management system embedded in the Recruitment module.

**User story:**  
Recruiter manages all interview rounds (Recruiter Screening → L1 → L2 → HOD → Final HR).  
Each interviewer receives a request and submits structured feedback.  
Every interviewer sees all previous round feedback (read-only) before rating the candidate.  
Last interviewer recommends the next round and optionally suggests who should conduct it.

---

### Feature Overview

**5 built-in round types:**
1. `Recruiter Screening` (RS) — Recruiter fills
2. `L1 Interview` — Technical/domain round
3. `L2 Interview` — Deep dive
4. `HOD Round` — Strategic/leadership fit
5. `Final HR Round` — Compensation, BGV, joining

**Custom rounds:** Can add Panel Interview, Technical Test, Case Study, or any custom name.

**Per-round parameters (5, tailored per round type):**

| Round | Parameters |
|-------|-----------|
| Recruiter Screening | Communication, Experience match, Salary alignment, Availability, First impression |
| L1 Interview | Technical depth, Problem solving, Domain knowledge, Communication, Leadership signals |
| L2 Interview | System design, Ownership & leadership, Cross-functional thinking, Technical depth, Cultural fit |
| HOD Round | Strategic alignment, Team chemistry, Leadership potential, Vision alignment, Org fit |
| Final HR Round | Compensation alignment, Joining & timeline, BGV readiness, Reference check, Final recommendation |

**Per-parameter form:**
- Star rating 1–5 (with labels: Poor / Below average / Average / Good / Excellent)
- Written feedback textarea (max 100 words — hard limit enforced)
- Quick tag buttons per parameter (pre-written shorthand phrases)

**Recommendation at end of form:**
- ✅ Proceed to next round → reveals "Suggest next round" + "Suggest interviewer" fields
- ⏸ On hold
- ❌ Do not proceed

---

### Database Schema

**Table:** `interview_rounds`

```sql
CREATE TABLE IF NOT EXISTS interview_rounds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  round_type            TEXT NOT NULL,
  round_number          INTEGER DEFAULT 1,
  interviewer_name      TEXT,
  interviewer_email     TEXT,
  status                TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','scheduled','done','rejected')),
  scheduled_at          TIMESTAMPTZ,
  feedback_submitted_at TIMESTAMPTZ,
  recommendation        TEXT CHECK (recommendation IN ('yes','no','hold')),
  next_round_suggestion TEXT,
  notes_for_recruiter   TEXT,
  overall_score         INTEGER,        -- 0–100 (avg rating * 20)
  params                JSONB DEFAULT '[]',
  created_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE interview_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_interview_rounds" ON interview_rounds;
CREATE POLICY "allow_all_interview_rounds" ON interview_rounds
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
```

**`params` JSONB structure:**
```json
[
  {
    "param_id":    "tech",
    "param_label": "Technical depth",
    "rating":      4,
    "text":        "Exceptional understanding of product metrics..."
  }
]
```

**Score calculation:**
```typescript
const avg   = params.reduce((a, b) => a + b.rating, 0) / params.length
const score = Math.round(avg * 20)   // 5-star → 100-point scale
```

---

### New Component: `components/recruitment/InterviewPipeline.tsx`

**Location:** `components/recruitment/InterviewPipeline.tsx`  
**Size:** 744 lines  
**Type:** `'use client'` React component

**Exports:**
```typescript
export type RoundType     // 'Recruiter Screening' | 'L1 Interview' | ... | string
export type RoundStatus   // 'pending' | 'scheduled' | 'done' | 'rejected'
export type Recommendation // 'yes' | 'no' | 'hold' | null
export interface ParamFeedback { param_id, param_label, rating, text }
export interface Round { id, candidate_id, round_type, round_number, interviewer_name, ... }
export interface Candidate { id, full_name, designation, department, offered_ctc?, current_ctc?, ai_score? }
export default function InterviewPipeline({ candidate, initialRounds? })
```

**Props:**
```typescript
interface Props {
  candidate:     Candidate    // required — candidate being interviewed
  initialRounds?: Round[]     // optional — pass [] or omit; component loads from Supabase
}
```

**REQUIRED `useEffect` to add** — the component must load existing rounds from Supabase on mount.
Add this immediately after `useState<Round[]>(initialRounds)` declaration:

```typescript
const [rounds, setRounds] = useState<Round[]>(initialRounds || [])

// ADD THIS useEffect right here:
useEffect(() => {
  supabase
    .from('interview_rounds')
    .select('*')
    .eq('candidate_id', candidate.id)
    .order('round_number', { ascending: true })
    .then(({ data }) => {
      if (data?.length) {
        setRounds(data.map(r => ({
          ...r,
          params: typeof r.params === 'string'
            ? JSON.parse(r.params)
            : (r.params || []),
        })))
      }
    })
}, [candidate.id])
```

**4 internal views (state-driven, no routing):**
1. `'pipeline'` — recruiter dashboard: candidate header, timeline, round cards, add round
2. `'schedule'` — recruiter schedules an interview (interviewer name, email, date, time, mode)
3. `'feedback'` — interviewer fills assessment form (prev rounds read-only + 5 params + recommendation)
4. `'detail'` — recruiter views completed round's full feedback

**Key sub-components (all defined OUTSIDE `InterviewPipeline`):**
- `StarRating` — 1–5 star interactive rating with hover
- `RoundNode` — single timeline node (dot + label)
- `RoundCard` — expandable round card with action buttons
- `PrevFeedbackBlock` — collapsible previous rounds read-only block
- `AssessmentForm` — per-round feedback form
- `ScheduleForm` — schedule interview form

**ROUND_CONFIGS constant** — defines badge, colors, and 5 parameters per round type:
```typescript
const ROUND_CONFIGS: Record<string, RoundConfig> = {
  'Recruiter Screening': { badge:'RS', color:'#185FA5', lightBg:'#E6F1FB', params:[...] },
  'L1 Interview':        { badge:'L1', color:'#059669', lightBg:'#ECFDF5', params:[...] },
  'L2 Interview':        { badge:'L2', color:'#D97706', lightBg:'#FFFBEB', params:[...] },
  'HOD Round':           { badge:'HOD',color:'#DC2626', lightBg:'#FEF2F2', params:[...] },
  'Final HR Round':      { badge:'FHR',color:'#7C3AED', lightBg:'#EDE9FE', params:[...] },
}
```

---

### Changes to `app/dashboard/recruitment/page.tsx`

This file has **1,365 lines** and contains ALL recruitment code.
Do NOT split it into multiple files — keep everything in one file per project convention.

#### Change 1 — Add import (line 4, after xlsx import)

```typescript
// ADD after line 4:
import InterviewPipeline from '@/components/recruitment/InterviewPipeline'
```

#### Change 2 — Add `interviewCand` state to `PipelineTab`

Find `function PipelineTab(...)` and add state as the very first line inside:

```typescript
function PipelineTab({ supabase, mrfs, candidates, onRefresh, showNotify }:any) {
  // ADD THIS:
  const [interviewCand, setInterviewCand] = useState<Candidate|null>(null)

  // existing state continues:
  const [selMRF, setSelMRF] = useState('all')
  // ...
```

#### Change 3 — Pass `onOpenInterviews` to `CandidateDrawer`

Find the `{selCand && <CandidateDrawer ... />}` block and add the prop:

```typescript
// BEFORE:
{selCand && (
  <CandidateDrawer candidate={selCand} mrfs={mrfs} onClose={()=>setSelCand(null)}
    onStageChange={moveStage} onSaveNotes={saveNotes}
    aiQs={aiQs} aiQLoading={aiQLoading} onGetQuestions={getAIQuestions}
    aiFbLoading={aiFbLoading} onGetFeedback={getAIFeedback} />
)}

// AFTER (add onOpenInterviews prop):
{selCand && (
  <CandidateDrawer candidate={selCand} mrfs={mrfs} onClose={()=>setSelCand(null)}
    onStageChange={moveStage} onSaveNotes={saveNotes}
    aiQs={aiQs} aiQLoading={aiQLoading} onGetQuestions={getAIQuestions}
    aiFbLoading={aiFbLoading} onGetFeedback={getAIFeedback}
    onOpenInterviews={(c: Candidate) => { setSelCand(null); setInterviewCand(c) }} />
)}
```

#### Change 4 — Add InterviewPipeline overlay inside PipelineTab's return

Inside `PipelineTab`'s `return (...)`, before the closing `</div>` tag, add:

```tsx
{/* ── Interview Pipeline full-screen overlay ── */}
{interviewCand && (
  <div style={{
    position:   'fixed',
    inset:      0,
    background: '#F5F3FF',
    zIndex:     300,
    overflowY:  'auto',
    fontFamily: '"DM Sans","Segoe UI",sans-serif',
  }}>
    {/* Header bar with back button */}
    <div style={{
      background: 'linear-gradient(135deg,#7C3AED,#4F46E5)',
      padding:    '12px 20px',
      display:    'flex',
      alignItems: 'center',
      gap:        12,
      position:   'sticky',
      top:        0,
      zIndex:     10,
    }}>
      <button
        onClick={() => setInterviewCand(null)}
        style={{
          padding:    '6px 14px',
          borderRadius: 7,
          border:     '1px solid rgba(255,255,255,.3)',
          background: 'transparent',
          color:      '#fff',
          cursor:     'pointer',
          fontSize:   12,
          fontFamily: 'inherit',
          fontWeight: 500,
        }}
      >
        ← Back to Pipeline
      </button>
      <div style={{ fontSize:15, fontWeight:600, color:'#fff' }}>
        Interview Pipeline — {interviewCand.full_name}
      </div>
      <div style={{ marginLeft:'auto', fontSize:12, color:'rgba(255,255,255,.65)' }}>
        {interviewCand.designation || '—'} · {interviewCand.current_company || '—'}
      </div>
    </div>

    {/* InterviewPipeline component */}
    <InterviewPipeline
      candidate={{
        id:          interviewCand.id,
        full_name:   interviewCand.full_name,
        designation: interviewCand.designation || '—',
        department:  mrfs.find((m: MRF) => m.id === interviewCand.mrf_id)
                       ?.department_id || '—',
        current_ctc: interviewCand.current_ctc,
        ai_score:    interviewCand.ai_score
                       ? Math.round(interviewCand.ai_score)
                       : undefined,
      }}
    />
  </div>
)}
```

#### Change 5 — Update `CandidateDrawer` function signature

Find `function CandidateDrawer(` and add `onOpenInterviews` to the destructured props:

```typescript
// BEFORE:
function CandidateDrawer({ candidate:c, mrfs, onClose, onStageChange, onSaveNotes,
  aiQs, aiQLoading, onGetQuestions, aiFbLoading, onGetFeedback }:any) {

// AFTER:
function CandidateDrawer({ candidate:c, mrfs, onClose, onStageChange, onSaveNotes,
  aiQs, aiQLoading, onGetQuestions, aiFbLoading, onGetFeedback,
  onOpenInterviews }:any) {
```

#### Change 6 — Replace "Interviewer Assign Karein" with "Manage Interview Rounds" button

Inside `CandidateDrawer`, find the `{/* Interviewer Assignment */}` block:

```tsx
// FIND AND REMOVE THIS ENTIRE BLOCK:
{/* Interviewer Assignment */}
<SectionLine title="Interviewer Assign Karein" />
<div style={{ display:'flex', gap:8, marginBottom:14 }}>
  <input style={{ ...T.input, flex:1 }} value={interviewer}
    onChange={e=>setInterviewer(e.target.value)}
    placeholder="Interviewer ka naam ya email" />
  <button
    onClick={()=>{ const n = (c.interview_notes||'')+'\n\nInterviewer: '+interviewer;
      onSaveNotes(c.id,n); setNotes(n) }}
    style={T.btnOutline}>Assign</button>
</div>

// REPLACE WITH:
{/* Interview Pipeline */}
<SectionLine title="Interview Rounds" />
<button
  onClick={() => onOpenInterviews && onOpenInterviews(c)}
  style={{
    ...T.btnPrimary,
    width:          '100%',
    marginBottom:   14,
    padding:        10,
    fontSize:       13,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
  }}
>
  📋 Manage Interview Rounds →
</button>
```

---

### Summary of all changes

| # | File | Location | Change |
|---|------|----------|--------|
| 0 | Supabase SQL | SQL Editor | Create `interview_rounds` table + RLS |
| 1 | New file | `components/recruitment/InterviewPipeline.tsx` | 744-line component |
| 2 | `recruitment/page.tsx` | Line 4 | Add import statement |
| 3 | `recruitment/page.tsx` | `PipelineTab` line 1 | Add `interviewCand` useState |
| 4 | `recruitment/page.tsx` | `PipelineTab` — CandidateDrawer call | Add `onOpenInterviews` prop |
| 5 | `recruitment/page.tsx` | `PipelineTab` — end of return | Add InterviewPipeline overlay |
| 6 | `recruitment/page.tsx` | `CandidateDrawer` signature | Add `onOpenInterviews` to destructure |
| 7 | `recruitment/page.tsx` | `CandidateDrawer` body | Replace "Interviewer Assign" with button |

---

### UX Flow (after implementation)

```
Recruiter opens Recruitment → Pipeline tab
  → Sees Kanban board of candidates
  → Clicks any candidate card
  → CandidateDrawer opens on right side
  → Sees "📋 Manage Interview Rounds →" button
  → Clicks it
  → Full-screen InterviewPipeline opens (covers everything, z-index:300)
  → Shows pipeline: RS → L1 → L2 → HOD → Final HR + Add button
  → Recruiter clicks "Schedule this round" → schedule form opens
  → Fills interviewer name, email, date, time, mode
  → Submits → round status becomes 'scheduled'
  
  When interviewer opens their assessment link:
  → Sees previous round feedback (collapsible, read-only)
  → Fills 5-parameter form (star rating + 100-word text)
  → Adds recommendation (Proceed / Hold / Reject)
  → If Proceed → suggests next round type + interviewer
  → Submits → round status becomes 'done', score saved
  
  Recruiter returns to pipeline:
  → Sees updated timeline (RS✓ L1✓ L2✓ HOD⏳ ...)
  → Clicks "View feedback" on any done round → sees full detail
  → Clicks "Schedule this round" on next pending round
```

---

### Common Errors to Watch For

**1. Focus loss on textarea / input**
Cause: Sub-component defined inside parent → re-mount on every keystroke.
Fix: Move sub-component definition OUTSIDE parent function.

**2. `params` JSONB is a string from Supabase**
Cause: Supabase may return JSONB as string in some SDK versions.
Fix: Always parse: `typeof r.params === 'string' ? JSON.parse(r.params) : r.params`

**3. InterviewPipeline shows empty rounds on open**
Cause: `useEffect` to load rounds not added.
Fix: Add the `useEffect` block described in "REQUIRED useEffect to add" section above.

**4. position:fixed overlay not covering sidebar**
Cause: `z-index` not high enough.
Fix: Use `zIndex: 300` — dashboard sidebar uses ~100.

**5. TypeScript error on `candidate.department`**
Cause: `Candidate` interface in recruitment page uses `department_id` (UUID), not name.
Fix: Pass the MRF's department_id as `department` — it's just used for display purposes in InterviewPipeline.

---

### Testing Checklist

After implementation, verify these work:

- [ ] Pipeline tab loads without TypeScript errors
- [ ] Click any candidate card → drawer opens
- [ ] Drawer shows "Manage Interview Rounds →" button (not old "Interviewer Assign" input)
- [ ] Click button → full-screen overlay appears with gradient header
- [ ] "← Back to Pipeline" closes overlay
- [ ] "+ Add round" in pipeline → round type picker appears
- [ ] Add an L1 round → schedule form opens
- [ ] Fill interviewer name + date → Schedule → round appears as "⏳ Scheduled"
- [ ] Click "Open assessment form" → feedback form opens
- [ ] Previous round feedback visible at top (if any rounds are done)
- [ ] Star ratings work (click → stars highlight, hover animation)
- [ ] Textarea enforces 100-word limit (word count shown)
- [ ] Quick tag buttons append text to textarea
- [ ] Tab navigation: clicking parameter tabs switches content
- [ ] Recommendation buttons: Proceed turns green, Hold amber, Reject red
- [ ] Proceed → next round suggestion fields appear
- [ ] Submit → round status → 'done', score saved to Supabase
- [ ] Verify: `interview_rounds` table has the new row in Supabase dashboard
- [ ] "View feedback" on done round → full detail view
- [ ] Running avg score shows in top-right when at least 1 param rated

---

## Git Convention

```bash
git add -A
git commit -m "feat: interview pipeline — multi-round assessment system"
git push
```

Commits use: `feat:`, `fix:`, `refactor:`, `chore:` prefixes.
Always push to `main` — Vercel auto-deploys.

---

## Environment Variables

Required in Vercel Dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL          = https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY     = eyJxxx...
SUPABASE_SERVICE_ROLE_KEY         = eyJxxx... (for server-side routes)
GOOGLE_GENERATIVE_AI_API_KEY      = AIza... (Gemini 2.5 Flash)
NEXT_PUBLIC_APP_URL               = https://ezer-hrms-chi.vercel.app
RESEND_API_KEY                    = re_xxx (3-day joining reminder emails)
CRON_SECRET                       = ezer-cron-2026 (Vercel cron auth)
HR_DEFAULT_EMAIL                  = hr@company.com
```

---

## Frequently Asked AI Questions

**Q: Can I use Tailwind classes?**
A: No. All styling is inline `style={{}}` objects with hardcoded hex values. Never `className="..."` for styles.

**Q: Can I create a new file for each sub-component?**
A: No. Per project convention, all related code stays in one file (recruitment/page.tsx is 1,365 lines — that's intentional). The only exception is the `InterviewPipeline.tsx` component because it's large enough and reused.

**Q: Should I use Next.js `router.push()` for navigation within the pipeline?**
A: No. All pipeline views are state-driven (`'pipeline' | 'schedule' | 'feedback' | 'detail'`). No URL changes. The overlay is rendered inline.

**Q: How do I add a new interview round type?**
A: Add it to the `ROUND_CONFIGS` object in `InterviewPipeline.tsx`. Add `badge` (2-3 chars), `color`, `lightBg`, and `params` array with 5 parameter objects.

**Q: Why is `supabase` imported directly in InterviewPipeline.tsx instead of passed as prop?**
A: Other components in the dashboard receive `supabase` as a prop (from the parent page). `InterviewPipeline.tsx` is a standalone component in `components/` so it imports directly — same pattern as `lib/onboarding/actions.ts`.

---

*Last updated: June 14, 2026*  
*Feature: Interview Pipeline Integration*  
*Author: Khushal Sharma + EZER Dev Session*
