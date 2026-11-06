# Setting up EZER Learn

Written for whoever deploys this. Nothing here touches existing data.

## 1. Run the migrations

In the Supabase SQL Editor, in this order. Each one is safe to run twice.

1. `supabase/migrations/206_lms_schema.sql`
2. `supabase/migrations/207_lms_engine.sql`
3. `supabase/migrations/208_lms_roles.sql`
4. `supabase/verify/208_lms_verify.sql`: read-only, and every row must say PASS
5. `supabase/migrations/211_lms_live_and_scorm.sql`: webinars and SCORM (two new tables,
   three new columns, two wider CHECK lists). It also moves "tell the manager after" from 7
   overdue days to 1, for companies still on the old default only. Without it, Live sessions
   and SCORM uploads say this migration is needed; everything else works.

206 and 207 only add `lms_*` tables and functions and one storage bucket. 208 adds three
roles to `ess_roles` and new rows to `role_permissions`. It uses `ON CONFLICT DO NOTHING`,
so it never changes an existing permission. If another branch merges first and takes
these numbers, rename the files; nothing depends on the numbers.

Until they are run, the Learning screens show a "not set up yet" message and every other
part of the HRMS works as before.

## 2. Supabase plan and limits (a decision for you)

**The Pro plan is required for video.** The Free plan's 50 MB upload limit rejects a single
six-minute video.

- Dashboard → Storage → Settings: set the global file size limit to at least 2 GB, or the
  bucket's 2 GB limit has no effect.
- Decide the **Spend Cap** before training goes live. Video shares one egress quota with the
  whole HRMS. With the cap on, overage does not bill but the project enters a Fair Use grace
  period, so a large training push could affect payroll and everything else. With the cap
  off, it bills. For most companies this will not arise (see the cost table in
  ARCHITECTURE.md), but a company-wide push at a large customer can exceed the 250 GB allowance.

No new paid service is needed to launch. Moving video to a streaming service is a later
choice, with switching triggers set out in ARCHITECTURE.md.

## 3. Environment variables

No new required variables. It uses the ones already set:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_APP_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CRON_SECRET`.

`ESS_SESSION_SECRET` is optional, as it is today. Candidate sessions derive their own key
from it, or from the service-role key.

The new daily job is in `vercel.json` (`/api/cron/lms-daily`, 06:00 IST). Vercel limits cron
jobs by plan; confirm yours allows one more.

## 4. Verify on the real stack (15 minutes)

End-to-end tests ran against a local Postgres with a hand-written stand-in for PostgREST and
Supabase Storage, because there was no way to run DDL on the live project from the build
environment. The stand-in matches the calls this module makes, but three things can only be
proved on real Supabase:

1. **Resumable upload.** Upload a video of 100 MB or more in Learning → Courses. Supabase's
   signed TUS route has been confirmed from its source and tests, not by a live request.
2. **Seeking on a signed URL.** Play that video and drag the bar forward. In the browser's
   network panel, requests for the file should answer 206 rather than 200.
3. **PostgREST on the RPC functions.** Open Learning → Overview, then assign one course to
   one test employee. Any error names the function involved.

## 5. Give people access

Nobody receives a role automatically. In **Roles → Assign Roles**, give your learning owner
**L&D Manager**, or rely on **HR Head**, which already has full access once 208 runs. See the
permission matrix in ARCHITECTURE.md. Anyone with a Learning module sees Learning in the
sidebar; every employee sees Learning in ESS.
