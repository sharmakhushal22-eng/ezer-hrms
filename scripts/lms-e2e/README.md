# EZER Learn end-to-end rig

Runs the real Next.js app and its real API routes against a throwaway local database. It never
contacts your Supabase project at run time, and every person in it is invented.

- `db.mjs` builds real Postgres (PGlite) with the live schema's tables, applies migrations
  206–208, and seeds two fictional companies.
- `server.mjs` is a local stand-in for PostgREST, Supabase Storage and TUS. It keeps PostgREST's
  1,000-row cap and enforces the anon role, so RLS and grant failures are real failures.
- `e2e.mjs` is the suite: the 17 brief scenarios plus the refusals.

## Run it

Install the two dependencies somewhere outside the repo, copy these files beside them, and:

```bash
npm i @electric-sql/pglite
node gen-defs.mjs /path/to/repo/.env.local defs.json     # table and column names only, no rows
REPO=/path/to/repo node server.mjs                       # local database on :54400

# in the repo, in a second terminal:
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54400 NEXT_PUBLIC_SUPABASE_ANON_KEY=rig-anon-key \
SUPABASE_SERVICE_ROLE_KEY=rig-service-key ESS_SESSION_SECRET=rig-ess-secret \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3210 GMAIL_USER= GMAIL_APP_PASSWORD= CRON_SECRET= \
NEXT_DIST_DIR=.next-rig npx next dev -p 3210 -H 127.0.0.1

node e2e.mjs                                             # third terminal; needs a fresh server.mjs
```

`next dev` rewrites `tsconfig.json`; run `git checkout tsconfig.json` afterwards.

What it cannot prove is listed in `docs/lms/SETUP.md`, section 4.
