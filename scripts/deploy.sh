#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# One-command deploy for Ezer HRMS:
#   commit  ->  pull (rebase)  ->  push  ->  deploy to Vercel production.
#
# Usage:
#   ./scripts/deploy.sh "your commit message"     # commit, push, deploy (asks to confirm prod)
#   ./scripts/deploy.sh -y "your commit message"  # skip the confirmation prompt
#   ./scripts/deploy.sh                            # no message -> auto timestamped message
#
# No keys needed: uses your existing `git` credentials and `vercel login` session.
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Load nvm so `node` and `vercel` are on PATH (vercel was installed under Node 22).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 || true

# Always operate from the repo root (one level up from this script).
cd "$(dirname "$0")/.."

# ── Preconditions ─────────────────────────────────────────────────────────
command -v git    >/dev/null 2>&1 || { echo "✗ git not found";    exit 1; }
command -v vercel >/dev/null 2>&1 || { echo "✗ vercel CLI not found. Run: npm i -g vercel"; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ── Parse args ────────────────────────────────────────────────────────────
ASSUME_YES=0
if [ "${1:-}" = "-y" ] || [ "${1:-}" = "--yes" ]; then ASSUME_YES=1; shift; fi
MSG="${1:-}"
[ -z "$MSG" ] && MSG="deploy: $(date '+%Y-%m-%d %H:%M:%S')"

echo "▶ Repo:   $(git rev-parse --show-toplevel)"
echo "▶ Branch: $BRANCH"
echo

# ── 1. Stage + commit (skip cleanly if nothing changed) ───────────────────
git add -A
if git diff --cached --quiet; then
  echo "• Nothing to commit — working tree clean."
else
  git commit -m "$MSG"
  echo "✓ Committed: $MSG"
fi
echo

# ── 2. Pull latest (rebase keeps history linear) ──────────────────────────
echo "▶ Syncing with origin/$BRANCH (pull --rebase)..."
if ! git pull --rebase origin "$BRANCH"; then
  echo "✗ Pull/rebase hit a conflict. Resolve it, run 'git rebase --continue', then re-run this script."
  exit 1
fi
echo

# ── 3. Push ───────────────────────────────────────────────────────────────
echo "▶ Pushing to origin/$BRANCH..."
git push origin "$BRANCH"
echo "✓ Pushed to GitHub."
echo

# ── 4. Confirm + deploy to Vercel production ──────────────────────────────
if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Deploy to Vercel PRODUCTION now? [y/N] " ans
  case "$ans" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "• Aborted before deploy. Your code is safely pushed to GitHub."; exit 0 ;;
  esac
fi

echo "▶ Deploying to Vercel production..."
vercel --prod
echo "✓ Deploy triggered. Track it at: https://vercel.com/khushal-sharma-s-projects/ezer-hrms/deployments"
