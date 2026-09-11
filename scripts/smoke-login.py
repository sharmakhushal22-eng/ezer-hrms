#!/usr/bin/env python3
"""Smoke test for the login path.  Run:  python3 scripts/smoke-login.py

Guards the failure that shipped: sign in successfully on the dashboard, get
bounced straight back to the login screen, with nothing on screen saying why.

Two causes were found, and this covers both:

  1. SUPABASE_SERVICE_ROLE_KEY empty in .env.local, so every server-side
     grant lookup 401'd and returned an empty grant.
  2. A stale ESS token in localStorage. authToken() prefers it over the
     Supabase session, so once it expired the dashboard sent a token nobody
     could read and the valid session was never tried.

The decision logic itself is unit-tested in lib/rms/__tests__/grant-state.ts.
This checks the wiring around it, and the environment.
"""
import pathlib, re, sys, os

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = (ROOT/'lib/rms/client.ts').read_text()
STATE  = (ROOT/'lib/rms/grant-state.ts').read_text()
SERVER = (ROOT/'lib/rms/server.ts').read_text()
LAYOUT = (ROOT/'app/dashboard/layout.tsx').read_text()

P, F, W = [], [], []
def check(name, ok, detail=''):
    (P if ok else F).append(name)
    print('  %s %-58s %s' % ('PASS' if ok else 'FAIL', name, detail))
def warn(name, ok, detail=''):
    if ok: P.append(name); print('  PASS %-58s %s' % (name, detail))
    else:  W.append(name); print('  WARN %-58s %s' % (name, detail))

print()

# ── 1. the environment that broke it first ────────────────────────────────
env = ROOT/'.env.local'
if env.exists():
    vals = {}
    for line in env.read_text().splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k, _, v = line.partition('=')
            vals[k.strip()] = v.strip().strip('"').strip("'")
    svc = vals.get('SUPABASE_SERVICE_ROLE_KEY', '')
    # Never print the value — only whether there is one.
    warn('SUPABASE_SERVICE_ROLE_KEY has a value', bool(svc),
         'EMPTY — every grant lookup will 401 and the dashboard will bounce'
         if not svc else '%d chars' % len(svc))
    warn('anon key present', bool(vals.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')))
    warn('ESS_SESSION_SECRET set, so ESS tokens do not depend on the service key',
         bool(vals.get('ESS_SESSION_SECRET')))
else:
    warn('.env.local present', False, 'not found — cannot check the keys')

# ── 2. the stale-token fallback is wired in ───────────────────────────────
check('the grant decision lives in a testable module',
      'shouldDropEssToken' in STATE and 'grantIsUseless' in STATE)
check('the client uses those helpers rather than an inline copy',
      'shouldDropEssToken' in CLIENT and 'grantIsUseless' in CLIENT
      and 'from \'./grant-state\'' in CLIENT)
check('a dead ESS token is cleared from localStorage',
      'localStorage.removeItem(ESS_KEY)' in CLIENT)
check('the fallback re-asks with the Supabase session',
      'supabase.auth.getSession()' in CLIENT and 'access_token' in CLIENT)
check('clearing is guarded on a session existing',
      'hasSupabaseSession' in CLIENT)

# ── 3. the precedence that caused it is still documented ──────────────────
# Not a bug in itself — ESS-first is deliberate — but it is the reason the
# stale token could win, so it must not be changed silently.
check('authToken still prefers the ESS session (documented, not accidental)',
      re.search(r'const t = essToken\(\)\s*\n\s*if \(t\) return t', CLIENT) is not None)

# ── 4. the server treats a bad token as "not signed in", not a crash ──────
check('a missing or unreadable token yields an empty grant, not a throw',
      'return emptyGrant()' in SERVER and 'LEGACY_SUPABASE_BRIDGE' in SERVER)
check('the Supabase bridge is on, so a dashboard login can resolve at all',
      re.search(r'LEGACY_SUPABASE_BRIDGE\s*=\s*true', SERVER) is not None)

# ── 5. the gate that does the bouncing ────────────────────────────────────
check('the dashboard gate lets a legacy session through',
      '!grant.employeeId && !grant.legacy' in LAYOUT)
check('the gate waits for a resolved answer before bouncing anyone',
      'grant.resolved' in LAYOUT)
check('a network failure does not read as "signed out"',
      'resolved: false' in CLIENT)

print('\n  %d passed, %d failed, %d warnings\n' % (len(P), len(F), len(W)))
if W:
    print('  Warnings are environment, not code — they stop YOUR login working,')
    print('  not everyone\'s. Fix .env.local and restart the dev server.\n')
sys.exit(1 if F else 0)
