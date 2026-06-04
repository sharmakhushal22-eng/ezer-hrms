# Ezer HRMS — Run & Deploy Cheat-Sheet

Everyday workflow for running locally and shipping changes.
Deploys use **Git auto-deploy**: push to `main` → Vercel builds & deploys automatically.

---

## One-time setup (already done / do once)

**Connect GitHub → Vercel for auto-deploy:**
Vercel → project **ezer-hrms** → **Settings → Git** → **Connect Git Repository** →
pick `sharmakhushal22-eng/ezer-hrms`, production branch = `main`.

After this, every `git push origin main` auto-deploys to production. No CLI deploy needed.

**Environment variables** are already set in Vercel (Production + Preview):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`.

---

## A. Run locally (everyday)

```bash
cd ~/Desktop/HRMS/ezer-hrms
nvm use 22          # first time in a new terminal
npm run dev         # open http://localhost:3000
```

- Next.js **hot-reloads**: for most small edits, just save the file and refresh the browser — no restart.
- Restart `npm run dev` only when you change `.env.local`, `next.config.ts`, or add a package.
- After pulling new code or new dependencies: run `npm install` once.
- Stop the server: `Ctrl+C`, or `pkill -f "next dev"`.

---

## B. Ship a change — one command ⭐

```bash
./scripts/deploy.sh "describe what changed"
```

This does it all: **commit → pull (rebase) → push → deploy to Vercel production**.
It asks to confirm before the production deploy.

- Skip the confirm: `./scripts/deploy.sh -y "message"`
- No message → it uses an auto timestamped one.
- No keys needed — uses your existing `git` login and `vercel login` session.
- Track the build: **vercel.com → ezer-hrms → Deployments** (~1–2 min).

### Or do it manually
```bash
git add -A
git commit -m "describe what changed"
git pull --rebase origin main
git push origin main
vercel --prod
```

> Pushes authenticate with your GitHub Personal Access Token (already configured).
> If `vercel --prod` says you're logged out, run `vercel login` once.

---

## C. Safer flow for risky changes (preview first)

```bash
git checkout -b my-change
# ...edit + commit...
git push origin my-change      # Vercel creates a PREVIEW deploy on its own URL
# verify the preview URL, then merge to main to go live:
git checkout main && git merge my-change && git push origin main
```

---

## D. Environment variables

- Local secrets live in `.env.local` (gitignored — never committed).
- The 3 app vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`.
- ⚠️ **Do NOT run `vercel env pull` casually** — it **overwrites** `.env.local` and can drop your keys.
  If you must, back up first: `cp .env.local .env.local.bak`.
- To change a value in production: Vercel → Settings → Environment Variables → edit → then redeploy.

---

## E. Database changes (Supabase)

The app talks to Supabase directly. If you add/rename a column the app writes to, the live
DB must have it or writes fail with **"could not find the 'X' column ... in schema cache"**.

1. Write SQL in `supabase/migrations/`.
2. Run it in **Supabase Dashboard → SQL Editor**.
3. Verify: `bash scripts/check-recruitment-schema.sh`.

---

## F. Quick troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails at "Collecting page data" | A required env var is missing in Vercel → add it, redeploy |
| AI features return 500 | `ANTHROPIC_API_KEY` missing/invalid in Vercel |
| DB write: "column not found in schema cache" | Run the pending Supabase migration (section E) |
| `Port 3000 is in use` | `pkill -f "next dev"` then `npm run dev` |
| Push asks for password | Use a GitHub **Personal Access Token**, not your account password |
