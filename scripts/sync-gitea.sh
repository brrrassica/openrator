#!/usr/bin/env bash
# OpenRator — auto-sync commits to the Gitea remote (run from post-commit).
# Silent no-op when no 'gitea' remote is configured (e.g. CI checkout).
set -u

if ! git remote get-url gitea >/dev/null 2>&1; then
  exit 0
fi

BRANCH=$(git symbolic-ref --short -q HEAD 2>/dev/null || echo main)
if ! git push -q gitea "$BRANCH" >/dev/null 2>&1; then
  echo "openrator: gitea sync failed (offline?) — will sync on next commit" >&2
fi
exit 0