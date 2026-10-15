# Git workflow

These rules apply to every change, however small. Written on 2026-10-15 after a change was committed onto an
already-merged branch and merged into a stale local `main`.

## Before starting any change

1. `git fetch --prune origin`
2. Branch from the **remote** main, without tracking it:
   `git switch --no-track -c <prefix>/<short-name> origin/main`
   - Prefixes: `rag/` (the RAG implementation), `viz/` (RAG Lab), `docs/`, `chore/` (tooling, config, rules).
   - One branch per change. Never reuse a branch that was already merged, even if it is still checked out.
3. Never commit on `main`. If the current branch is `main` or an already-merged branch, make a new branch first.

## While working

- Commit only when the owner asks. Small commits with a message that says why.
- Keep tooling (`viz/`) and learning work (`rag/`) in separate commits, ideally separate branches.
- Before committing, run the checks for what changed: `make test-db` and `make test-contract` for
  `viz/db`; `npx tsc --noEmit` and `pnpm build` for `viz/frontend`.

## Getting it into main

- Into `main` only through a **pull request** on GitHub (`gh pr create`). The owner merges it.
  Don't merge locally and don't push to `main` directly unless the owner asks for exactly that.
- Before opening or updating a PR: `git fetch origin`, then `git rebase origin/main`, rerun the checks,
  then push the branch: `git push -u origin <branch>`.
- Push only when the owner asks.

## Never

- Force-push `main`, or rewrite anything that is already on `origin/main`.
- Force-push a branch someone else may have pulled, unless the owner agrees (`--force-with-lease` only).
- `git branch -D` without first checking the branch is in `origin/main` (or its tree equals it).
- Assume local `main` is current. Always compare against `origin/main` after a fetch.

## After a PR is merged

- `git fetch --prune origin`, `git switch main`, `git merge --ff-only origin/main`.
- Delete the local branch (`git branch -d`); GitHub deletes the remote one, or `git push origin --delete <branch>`.
