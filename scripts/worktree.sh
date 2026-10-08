#!/bin/sh
# A worktree ready for unit tests and type checks: the branch checked out, node_modules linked to
# this tree's, and the Prisma client generated. The post-checkout hook cannot do the last step: it
# runs before node_modules exists, and a worktree has no .env.local, so generation borrows the
# loopback URL in .env.test (generate never connects). e2e refuses such a worktree
# (playwright.config.ts).
#   scripts/worktree.sh <branch> <dir>     an existing branch, or a new one from HEAD
set -eu
[ $# -eq 2 ] || { echo "usage: scripts/worktree.sh <branch> <dir>" >&2; exit 2; }
# The physical directory, so that a relative <dir> means the same to git and to `cd "$2"` below:
# git resolves it from the repository's real location, while a logical cd through a symlinked
# checkout (resume/repos/auditdesk) would look for it beside the link and fail.
cd -P .
root=$(git rev-parse --show-toplevel)
if git show-ref --verify --quiet "refs/heads/$1"; then git worktree add "$2" "$1"; else git worktree add -b "$1" "$2"; fi
ln -s "$root/node_modules" "$2/node_modules"
cd "$2"
DATABASE_URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' .env.test)}" pnpm exec prisma generate >/dev/null
# Its own test database: global-setup drops the database WITH (FORCE), so a shared one fails the
# run another worktree has in progress.
db="auditdesk_test_$(basename "$2" | tr -c 'A-Za-z0-9\n' _)"
sed -n "s|^\(TEST_DATABASE_URL=.*/\)[^/]*\$|\1$db|p" .env.test >.env.test.local
echo "$2 is on $1, with node_modules linked, the Prisma client generated and tests on $db."
