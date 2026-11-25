---
name: finish-work
description: Finish a Flowy Docs feature branch the safe way. Verify it, merge it into main from the main checkout, remove the branch and its worktree without touching a node_modules junction, and push only when asked. Use when someone runs /finish-work or says to merge finished work into main.
disable-model-invocation: true
---

# Finish work in Flowy Docs

Each step below exists because skipping it cost something once. Do them in order. Stop and say what is left whenever a
step fails or needs a decision.

## 1. Know where you are

- Run `git status` and `git worktree list`. The work should sit in `.claude/worktrees/<name>` on branch `<name>`.
- Commit your own work there. Never discard, reset, restore, clean or check out over uncommitted edits, yours or anyone
  else's. Keep status checks as status checks: nothing chained after them.

## 2. Verify in the feature worktree

Run these in the background and read the results:

```bash
npm test
npm run typecheck
dotnet test desktop --filter "Weight!=Heavy"
```

- Never start the heavy set or the whole desktop suite unless asked. If another `Flowy.App.Tests` process is running,
  wait.
- If the work changed text a person sees, also go through "Before you say you're done" in `.claude/ui-text.md`.
- Any failure stops here.

## 3. Decide whether to ask first

Merge without asking unless one of these holds:

- a design or scope choice nobody has made yet
- a breaking or destructive change (data migration, removed feature, public API change)
- work that fails or couldn't be verified
- a merge conflict with no obvious resolution

If one does, say what is on the branch and what decision it needs, and stop.

## 4. Merge in the main checkout

Main is checked out in the repository root itself, the folder that holds `.claude/worktrees`.

```bash
set -eo pipefail
cd "$(git rev-parse --path-format=absolute --git-common-dir)/.."
git status --short          # must be empty; if not, it is someone's work: stop and say so
git symbolic-ref --short HEAD   # must be main; if not, another session moved it: stop and say so
git merge --no-ff <name>
```

- No pipes on git steps that gate anything: a pipe once hid a failed merge and the push went ahead.
- A conflict you can resolve with confidence: resolve, run the fast checks of step 2 in the main checkout, commit. Otherwise
  `git merge --abort` and ask.

Main moving starts the docs review hook, if it is installed (`.claude/docs-review`). Nothing rebuilds an installed copy of
the desktop app by itself. If the merge touches `desktop/` (not its tests, fixtures or tools) or `docs/demo`, say that the
installed app needs a rebuild. Never run a reinstall yourself.

## 5. Remove the feature worktree and branch

1. Look for files git does not track before removing anything: `git -C .claude/worktrees/<name> status --short --ignored`.
   Excluded files (specs, plans, notes, reports) are lost with the worktree. If there are any beyond build output
   (`node_modules`, `bin`, `obj`, `dist`), keep the worktree and say why.
2. If `node_modules` in the worktree is a junction, remove the junction alone first:

   ```powershell
   $nm = ".claude\worktrees\<name>\node_modules"
   if ((Get-Item $nm -Force).LinkType -eq 'Junction') { (Get-Item $nm -Force).Delete() }
   ```

   Never pass `--force` to `git worktree remove` while a junction is there: it once emptied the junction target's `node_modules`.
3. `git worktree remove .claude/worktrees/<name>`, then `git branch -d <name>` from the main checkout (`-d`, so git refuses
   an unmerged branch). It checks against HEAD, so run it only while that checkout is on main.
4. If the merge brought in commits from main, fast-forward the branch first (`git merge --ff-only main` in its worktree)
   and build what changed there, so the merged result compiles before the worktree goes.

## 6. Push only when asked

Other sessions merge into local main all the time, so main can hold their unpushed commits.

```bash
git fetch origin
git log --oneline origin/main..<sha>   # every commit listed must be this work
git push origin <sha>:main
```

- If the list holds anyone else's commits, stop and ask.
- A local pre-push hook, if there is one, may run the tests again and refuse while another `Flowy.App.Tests` runs.

## 7. Report

Say: the merge commit, the checks that ran and their result, what was removed or kept, the rebuild note if it applies,
and whether anything was pushed.
