# EZER Learn on its own domain (ezerlms.com)

Written for whoever deploys or sells EZER Learn. Branch `feat/lms-standalone`.

## What it is

EZER Learn is a product of its own at **ezerlms.com**, the way the marketing site is at
ezerhrms.com and the HRMS at app.ezerhrms.com.

- **Someone who buys only the LMS** gets ezerlms.com. They sign in there and never see an
  HRMS screen. Every HRMS page address on that domain shows Learning instead, and every HRMS
  API answers 404.
- **An HRMS customer** clicks Learning in EZER HRMS and lands on the same screen at
  ezerlms.com, already signed in. "Back to EZER HRMS" takes them back.

## How it is built

**One repository, one database, two Vercel projects.**

| | HRMS | LMS |
|---|---|---|
| Vercel project | `ezer-hrms` | `ezer-lms` |
| Domain | app.ezerhrms.com | ezerlms.com (www redirects to it) |
| Code | this repository | this repository, same build |
| Database | Supabase zhvtdssgnllpjsrhzswx | the same one |
| Switch | `NEXT_PUBLIC_LMS_URL=https://ezerlms.com` | `NEXT_PUBLIC_EZER_SURFACE=lms` |

Why not a separate repository or database: Learning reads employees, managers, companies,
roles and permissions, and sends through the same notifications and mail. A separate database
would need an employee sync like the ones Darwinbox runs with Cornerstone or Vowel, and a
separate repository would copy the design system and auth. A company that buys only the LMS
is a company in the same multi-tenant database with the Learning modules switched on. If the
LMS ever needs its own codebase, `components/learning`, `lib/lms` and `app/api/lms` already
stand apart.

### Sign-in

This follows what suites do: Darwinbox's "SSO based redirection" to Cornerstone, Zoho's single
account across apps, and TalentLMS or Docebo, which have their own login page plus SSO:

1. **The LMS has its own sign-in** (`components/learning/app/SiteSignIn.tsx`). Employees use
   their email or employee code and password, with the same first-time and temporary-password
   steps as `/ess-login`. Admins use the dashboard email login. Both call the same APIs.
2. **Single sign-on from HRMS** (`lib/lms/sso.ts`, `lib/lms/sso-client.ts`). Opening
   `/learning` in HRMS gets a signed code that lasts one minute. The browser takes it to
   ezerlms.com in the `#fragment`, which is never sent to a server or logged. The LMS trades it
   for a session of its own: a fresh ESS token for an employee, or a one-time magic-link hash
   for a dashboard login.
3. **Each site signs out on its own.** Signing out of the LMS leaves the HRMS session alone,
   and the reverse is also true. This is the default for suites without a central identity
   provider. Sessions still expire on their own clock (12 hours for ESS).

### What the LMS site serves (`proxy.ts`, `lib/lms/site.ts`)

- Learning screens at the root: `/`, `/catalog`, `/course/…`, `/studio/…`
- Old `/learning/…` links redirect to the same path without the prefix
- Public Learning links: `/learn/…` (candidate pre-joining), `/learn/verify/…` (certificates),
  `/learn-scorm/…`
- APIs: `/api/lms/*`, `/api/ess-auth/*`, `/api/version`. Everything else is a 404, **crons
  included**. The project builds from the same `vercel.json`, so it registers the crons too,
  and without the 404 every reminder would go out twice. The HRMS project still runs all
  crons, including `lms-daily`.

## Environment variables

**ezer-lms** (set 9 Nov 2026):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_EZER_SURFACE` | `lms` |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LMS_URL` | `https://ezerlms.com` (links in LMS mail, certificate verify links) |
| `NEXT_PUBLIC_HRMS_URL` | `https://app.ezerhrms.com` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | same Supabase project as HRMS |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `GMAIL_FROM_NAME` | same sender as HRMS |
| `ESS_SESSION_SECRET` | its own random value |
| `LMS_HANDOFF_SECRET` | random; **must equal the HRMS value** |

**ezer-hrms**, set these only when this branch merges into main:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_LMS_URL` | `https://ezerlms.com`. This switches HRMS's Learning links over. Unset, Learning stays inside HRMS as before. |
| `LMS_HANDOFF_SECRET` | the same value as on ezer-lms |

Vercel stores both secrets as write-only, so nobody can read the LMS value back to copy it.
When you set the HRMS one, generate a new value (`openssl rand -base64 48`) and put it on
**both** projects, then redeploy both. If the two values differ, the hand-off fails safely:
people land on the LMS sign-in page instead of arriving signed in.

`NEXT_PUBLIC_*` values are inlined at build time, so every change needs a redeploy.

## DNS (GoDaddy, ezerlms.com)

Domain → DNS → DNS Records:

1. Delete the two parking `A` records on `@` (`3.33.130.190`, `15.197.148.33`) and turn off
   any domain forwarding.
2. Add `A`, name `@`, value `216.150.1.1`.
3. Change `CNAME` `www` to `311896c36469546f.vercel-dns-016.com`.

Vercel issues the certificate on its own once these resolve (minutes to an hour). Check under
ezer-lms → Settings → Domains.

## Deploying

The `ezer-lms` project is **not connected to Git yet**: the Vercel login that created it has
no GitHub connection. Until it is connected, deploy from a clean export of the branch:

```bash
git archive HEAD | tar -x -C /some/empty/dir
cd /some/empty/dir && mkdir .vercel
echo '{"projectId":"prj_IkIuwibPi4J8A5TFMcrV9c16Td74","orgId":"team_CYcKff6gchxrsUD9zkzWXUh1"}' > .vercel/project.json
vercel deploy --prod --yes --scope khushal-sharma-s-projects
```

To connect Git, someone whose Vercel login is linked to GitHub opens ezer-lms → Settings → Git,
connects `sharmakhushal22-eng/ezer-hrms` and sets the production branch to `main` once this
branch has merged. Set the Ignored Build Step (Settings → Git) as well, or every push to any
branch builds a preview:

```bash
if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi
```

Optionally, disable Cron Jobs for ezer-lms (Settings → Cron Jobs). They are refused anyway,
but disabling them keeps 404s out of the logs.

## Testing locally

Two ports are two origins, so their storage is separate, exactly as between two domains:

```bash
# HRMS
GMAIL_USER= GMAIL_APP_PASSWORD= NEXT_PUBLIC_LMS_URL=http://localhost:3101 npx next dev -p 3102
# LMS (its own build folder, so the two dev servers do not collide)
GMAIL_USER= GMAIL_APP_PASSWORD= NEXT_DIST_DIR=.next-lms NEXT_PUBLIC_EZER_SURFACE=lms \
  NEXT_PUBLIC_HRMS_URL=http://localhost:3102 NEXT_PUBLIC_APP_URL=http://localhost:3101 npx next dev -p 3101
```

Run `git checkout -- tsconfig.json` afterwards (see `next.config.ts`).

Checked on 9 Nov 2026, against the live test database:

- ESS sign-in on HRMS, then `/learning/catalog`, lands on LMS `/catalog` signed in
- The code is removed from the address
- "Back to EZER HRMS" goes to `/ess`
- Signing out of the LMS leaves HRMS signed in
- Signing in directly on the LMS works, and shows no "Back to EZER HRMS"
- `/dashboard/payroll` on the LMS shows Learning
- A forged code shows the sign-in page
- A dashboard login opens the Studio on the LMS with its own Supabase session
- `lib/lms/__tests__/site.test.ts` covers the routing rules and the code
