---
name: retake-shots
description: Retake the desktop app's screenshots in docs/images/desktop-*.png with --shot, and say which browser pictures and README animations also went stale. Use after wording or layout changes in something a screenshot shows, or when asked to retake or refresh screenshots or pictures.
---

# Retake the desktop screenshots

`docs/maintaining.md` (the paragraph that starts "The screenshots in `docs/images/desktop-*.png`") is the source for
these commands. Read it first. If it differs from the table below, follow it and fix the table.

## Rules

- Work in your own worktree, not the shared checkout.
- `--shot` saves the picture and exits on its own, and CLAUDE.md allows pictures of the app only this way. The window
  can still show for a moment, so say so before a batch, take the shots in one go, and never start the app without
  `--shot`.
- Build once, then run each shot with `--no-build`, one at a time, in the background.
- Retake only what is stale: a picture whose view shows the text or layout that changed. Before retaking one, check it
  is used (`grep -rn "desktop-<name>" README.md docs vscode .github`). `desktop-code.png` and `desktop-structure.png` are
  used nowhere at the moment, and `docs/maintaining.md` gives no command for `desktop-code.png`.

## Commands

```bash
dotnet build desktop/Flowy.App
dotnet run --project desktop/Flowy.App --no-build -- docs/demo <flags> --scale 2 --size <size> --theme light --shot docs/images/<file>
```

| File | Flags | Size |
| --- | --- | --- |
| `desktop-overview.png` | (none) | 1200x760 |
| `desktop-zoom.png` | `--view ordering` | 1200x760 |
| `desktop-panel.png` | `--view ordering --select order-api` | 1200x760 |
| `desktop-dark.png` | `--view ordering --select order-api`, with `--theme dark` in place of light | 1200x760 |
| `desktop-edit.png` | `--view ordering --select order-api --edit` | 1200x760 |
| `desktop-used-by.png` | `--view ordering --edit --delete orders-db` | 1200x760 |
| `desktop-data.png` | `--view ordering --select orders-db` | 1200x760 |
| `desktop-flow.png` | `--view ordering --flow place-order --step 1` | 1200x760 |
| `desktop-structure.png` | `--view ordering --flow capture-payment --step 6` (the one with groups) | 1200x760 |
| `desktop-states.png` | `--view ordering --flow stripe-outage --step 7` | 1200x760 |
| `desktop-recursion.png` | `--view order-api --flow price-a-deal --step 1 --delay 2800`, run with `FLOWY_REDUCE_MOTION=0` (the stack at its deepest) | 1200x760 |
| `desktop-payload-card.png` | `--view ordering --flow place-order --step 1 --pause-at 900 --hover-dot --delay 1500`, run with `FLOWY_REDUCE_MOTION=0` (the Basket dot paused mid-send, its card open) | 1200x760 |
| `desktop-performance.png` | `--view delivery --tab performance --select dispatch` | 1280x760 |
| `desktop-time.png` | `--view ordering --run stripe-outage --tab performance --at 70` | 1280x760 |
| `desktop-sources.png` | `--view delivery --run together --tab performance --at 800,400` | 1280x760 |
| `desktop-failures.png` | `--view ordering --tab failures --select stripe-timeout` | 1280x1000 |
| `desktop-compare.png` | `--compare refund,refund-not-recorded --changes` | 1200x860 |
| `desktop-compare-swap.png` | `--compare refund,refund-not-recorded,swap --changes` | 1200x860 |
| `desktop-search.png` | `--search re` | 1200x760 |

## Look at every picture

Open each new picture with Read and check:

- the changed wording or layout is there
- swatches can be seen and have the right colours
- nothing is clipped
- the dark one reads in dark

A picture that came out wrong is a bug to fix, not to commit. Compare file sizes with `git diff --stat`: a picture that
shrank a lot is often blank.

## What else went stale

Name these rather than retaking them unasked:

- **Browser pictures.** `docs/images/failures.png` and `docs/images/yaml.png` are taken by hand from a served copy of
  `docs/demo` (the steps are in `docs/maintaining.md`).
- **README animations.** `docs/images/anim/` comes from `node docs/images/record.mjs [scene]`: headless Chrome, ffmpeg,
  about 20 minutes for all of them. Retake one scene when the canvas it shows changed.
- **VS Code picture.** `vscode/images/panel.png` is a picture of the VS Code panel.

Commit the pictures with the change that made them stale.
