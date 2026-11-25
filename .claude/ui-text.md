# UI text for Flowy Docs: show it, don't explain it

Read this before you add or change any text a person sees: labels, keys and legends, hints, empty states, notices,
tooltips, field labels, the demo model, and the README, guide and CONTRIBUTING text that describes the UI.

## The rule

If a sentence tells the reader what a colour, line, shape or mark means, draw the mark and put a name of one to three
words beside it. People match by eye. They should not have to decode a paragraph to learn that blue is the typical call.

Before (the Performance panel's chart, under "Where it struggles"):

> Blue: the typical call. Amber: the slowest 1 in 20. The red dashes: where it first struggles.

After:

> [blue line] Expected call   [amber line] Slowest 5%   [red dashes] First struggles

This is not only about word choice. Replacing the sentence with a shorter sentence is the wrong fix. The fix is to
change the interface so the sentence isn't needed.

## Rules

1. **Draw what you would describe.** A key item is a swatch plus a label of one to three words (four when a
   parenthesis earns its place).
   - The swatch is the real thing, not an approximation: the same colour token (`--accent`, `--warn`, `--danger`,
     `--know`, `--muted`, `--line` in `ui/src/style.css`; `AccentBrush`, `WarnBrush`, `DangerBrush`, `KnowBrush`,
     `MutedBrush`, `LineBrush` in `Styles.axaml`; amber `--warn` is for warnings only, purple `--know` is for notes), the same dash, the same shape and the same strain gradient as on the chart or canvas. Never
     hard-code a second colour. It must follow the light and dark theme.
   - Show only the marks that are on screen now. "First struggles" appears only when the run struggles.
   - The label carries the meaning; the swatch is for the eye (`aria-hidden` in the browser, no automation name on the
     desktop). Never let colour be the only copy of a fact.
2. **Name things the way a person says them, not the way the data stores them.** "Expected call" and "Slowest 5%", never
   `p50`, `p95`, "typical", "1 in 20", "overall p95" or "latency passes 3x its starting point". The run file keeps
   `p50` and `p95`; `docs/guide/performance.md` maps them to the names once, and the UI never shows them.
3. **One name per thing, everywhere.** The chart key, the readout label under "Selected", tooltips, the README, the
   guide and the tests use the same words. When you rename something, grep for the old name in every folder listed
   under "Where text lives".
4. **Say the state, not the method.** "Tested" and "Between 600 and 900, estimated", not "a tested level" and
   "worked out from the two".
5. **Keys live in the shortcut list, not in panels.** No keycap hints (`[<-][->] Step`) and no sentence about keys in a
   panel, an empty state or a notice: drawn caps beside a panel look like buttons that don't work. A new key goes into the list `?` opens (`HELP_ORDER` in `ui/src/keymap.ts`, `Order` in
   `desktop/Flowy.App/KeyMap.cs`, both pinned by tests) and into `docs/shortcuts.md`. A tooltip may name its key
   ("Remove every row (Enter)").
6. **Cut the words that point at the interface.** "Click a shape or a line." not "Click a shape or a line to see its
   numbers." An empty state says what is missing and the next move, in one line.
7. **Field labels: the name, then the limit in as few words as it takes.** "Times (2 to 99)", "Opacity (0 to 100)". Use
   the name the reader meets elsewhere: "More", not "Detail a reader can open".
8. **A sentence is for a fact the reader can't see.** "First struggles at 900 orders/min: ETA at 90% of capacity" earns
   its place. A sentence that re-describes a control, repeats the section title, or explains what a chart is does not.
9. **Labels are fragments.** Sentence case, no full stop on a label, tooltip or button. Full stop on a real sentence.
10. **Headings and group names are plain nouns for what the group is.** "This view" and "Other views", not "In
    Overview" and "Everywhere else". No phrase a copywriter would be pleased with, and no heading that repeats the name
    the breadcrumb or the tab already shows. A count beside a heading already says how many; don't repeat it in a note
    ("4 elsewhere" under an "Other views 4" heading).
11. **Prose tells.** No "not X but Y", no one-line closers, no forced triads, no "simply", "easily", "seamlessly",
    "powerful", "robust", no "Let's", no emoji, no "Please". No em or en dashes: the docs have none, so use a full stop,
    a comma, a colon or parentheses. The `humanizer:humanizer` skill has the full list; run it on prose (README, guide,
    demo YAML, notices), not on one-word labels.

## What the Performance panel changed

| Was | Now | Rule |
| --- | --- | --- |
| "Blue: the typical call. Amber: the slowest 1 in 20. The red dashes: where it first struggles." | Three swatches: Expected call, Slowest 5%, First struggles | 1 |
| Key paragraph: "A shape's outline runs from green to red as it fills up. A number on it..." | Six swatches: Busy (gradient), Waiting (badge), Not measured (empty outline), A call, A call that fails, More calls | 1 |
| Readout labels "Typical", "Slowest 1 in 20" | "Expected call", "Slowest 5%" | 2, 3 |
| "Latency passes 3x its starting point at 400 req/s: overall p95 goes from 100 ms to 420 ms" | "First struggles at 400 req/s: the slowest 5% of calls go from 100 ms to 420 ms" | 2, 8 |
| "a tested level" / "between 25 and 50, worked out from the two" | "Tested" / "Between 25 and 50, estimated" | 4 |
| "<-> step the levels, P ramps up" | nothing in the panel; the keys are in the `?` list | 5 |
| "Click a shape or a line to see its numbers." | "Click a shape or a line." | 6 |
| "Times (a whole number from 2 to 99)" | "Times (2 to 99)" | 7 |
| "Detail a reader can open (markdown)" | "More (Markdown)" | 3, 7 |
| Flows list: "In Overview" / "Everywhere else", "No flows in Overview. 4 elsewhere." | "This view" / "Other views", "No flows on this view." | 10 |

## Where text lives

Flowy has two readers of the same model and they must say the same thing.

- Browser: `ui/src/*.tsx`, styles in `ui/src/style.css` (`.keyrow`, `.sw.*`). The key components are `KeyRow` and
  `KeyItem` in `ui/src/Performance.tsx`.
- Desktop: `desktop/Flowy.App/*.cs`, styles in `Styles.axaml` (shared) and `Styles/<area>.axaml` (one area's own, see
  `AreaStyles.cs`; the key's `Border.sw.*` and `Line.knee` are mostly in `Styles/Performance.axaml`). The helpers are
  `KeyRow` and `HeatSwatch` in `PerfPanel.cs`.
- Shared strings live in core and have a C# twin that must match word for word: `src/core/captions.ts` and
  `desktop/Flowy.Core/Captions.cs` (the legend), `src/core/perf/text.ts` and `desktop/Flowy.Core/PerfText.cs` (`kneeText`), and
  `ui/src/perfview.ts` and `desktop/Flowy.Core/PerfView.cs` (metric names). After changing one, run
  `node desktop/fixtures/generate.ts` and check with `git diff --stat desktop/fixtures/expected` that only the files you
  meant to change moved.
- Tests that pin wording: search `test/`, `desktop/Flowy.Tests` and `desktop/Flowy.App.Tests` for the old string.
  `test/captions.test.ts` also refuses the phrase "at once" in the legend.
- Docs that quote the UI: `README.md`, `CONTRIBUTING.md`, `docs/maintaining.md` (the checklists quote exact labels),
  `docs/guide.md`, `docs/writing.md`.
- Screenshots in `docs/images/desktop-*.png` go stale when wording or layout in them changes. Retake with the commands in
  `docs/maintaining.md`, for example
  `dotnet run --project desktop/Flowy.App -- docs/demo --view delivery --tab performance --select dispatch --theme light --scale 2 --size 1280x760 --shot docs/images/desktop-performance.png`.
- The demo model (`docs/demo/flowy`, Plum) is the model of good text. `docs/writing.md` says how to word teasers, labels
  and steps. Keep it that way.

## Finding what still needs the treatment

Run these (the Grep tool, or `rg` in your own shell; a subagent's Bash has no `rg`, so use `git grep -nP` there) over `ui/src`, `src/core`, `desktop/Flowy.App` and `desktop/Flowy.Core`:

```bash
# colour words doing a swatch's job
rg -n "\b(Blue|Amber|Red|Green|Orange|Grey|Gray)\b[:,]" ui/src src/core desktop/Flowy.App desktop/Flowy.Core
# words that point at the interface
rg -n -i "\b(to see|in order to|here you|you can|simply|easily|seamless)\b" ui/src desktop/Flowy.App
# stat jargon in a label
rg -n "\b(p50|p95|percentile|median)\b" ui/src desktop/Flowy.App
# headings and group names that read like copy
rg -n "Everywhere|Anywhere|Nothing here|Here's|Here are|all the rest|the rest\b" ui/src desktop/Flowy.App
# a legend or key written as a sentence
rg -n "\b(means|stands for|is where|are the)\b" ui/src desktop/Flowy.App
```

Not every hit is wrong. A colour word is fine in a tooltip for a colour picker. Judge each by rule 1: could the reader
see this instead of reading it?

## Before you say you're done

- Grep the old wording across `src`, `ui`, `desktop`, `test`, `docs`, `README.md` and `CONTRIBUTING.md` (`docs` includes `docs/maintaining.md`).
- `npm test`, `npm run typecheck` and `dotnet test desktop/Flowy.slnx --filter "Weight!=Heavy"` pass (the heavy set runs by hand, see CLAUDE.md).
- Look at it. Browser: build the UI and open the demo (`#delivery/perf/dinner-rush/3`). Desktop: `--shot`. Light and
  dark. A swatch that can't be seen, or is the wrong colour, is a bug.
- Read each string once more and delete any word that changes neither what the reader knows nor what they do.
