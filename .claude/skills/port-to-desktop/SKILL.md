---
name: port-to-desktop
description: Use when a change to Flowy Docs' TypeScript core (src/core, src/node, ui/src/graph.ts, ui/src/perfview.ts) has to reach the desktop app's C# twin in desktop/Flowy.Core, when a "desktop" test in npm test fails after a core change, when twin-drift.test.ts names a new export, or when a Flowy.Tests parity test fails against desktop/fixtures/expected.
---

# Port a core change to the desktop

`desktop/Flowy.Core` ports part of `src/core` and `src/node`. The TypeScript is the source: `desktop/fixtures/*.ts`
dump what it says into `desktop/fixtures/expected/*.json`, and `desktop/Flowy.Tests` compares the C# with those files.
A port is done when the fixtures pin the new behaviour and the C# passes them. `docs/maintaining.md` ("The desktop app")
is the long version.

## 1. Where to work

In a feature worktree, never the shared checkout: `git worktree add .claude/worktrees/<name> -b <name> main`. If a
worktree for the same feature already exists (`git worktree list`), work there. Finish with the `finish-work` skill.

## 2. Find the twin and the pinning

```bash
git grep -n "src/core/<module>.ts" -- desktop/Flowy.Core   # the C# file(s): "A port of ...", "The twin of ..."
git grep -n "src/core/<module>.ts" -- desktop/fixtures     # the dumps that import from the module
git grep -n "<expected-name>" -- desktop/Flowy.Tests       # the C# test: Expected("detect") or "channel-folds.json"
```

`generate.ts` names each expected file (`write('channel-folds', ...)`); folder dumps take their names from
`fixtures.json`, and their C# side is `desktop/Flowy.Tests/JsonDump.cs`, which must build the same shape as `dump.ts`.

If the module has no C# twin yet, the new file names its source in its summary (`/// <summary>A port of
src/core/x.ts ...`): `twin-drift.test.ts` finds ported modules by that line.

## 3. Pin it on the TypeScript side first

- Call the new export in the dump that covers its module and put its result in the output, or add a dump and a
  `write(...)` line in `generate.ts`. An import alone makes `twin-drift.test.ts` pass but pins nothing.
- New rule or edge: add a case under `desktop/fixtures/cases/<area>/flowy` (and to `fixtures.json` if it is a folder
  dump), or a value list in the dump (like `KIND_WORDS` in `channels.ts`): missing key, `null`, empty, wrong type,
  unicode, too long.
- An export that has no C# twin on purpose goes in `desktop/fixtures/twin-gaps.json` instead. That is a choice: say
  why in the commit. `UPDATE_TWIN_GAPS=1 npm test` rewrites the list; check its diff.

## 4. Regenerate

| Changed | Run |
| --- | --- |
| `src/core/look.ts`, `src/core/icons.ts` | `node desktop/tools/make-look-data.ts` (writes `LookData.cs`) |
| `src/core/detect.ts` | `node desktop/tools/make-detect-data.ts` (writes `DetectData.cs`). A new cue also needs a labelled snippet in `test/detect-corpus.json`; a new language needs `LANGUAGES` in `src/core/snippets.ts` and `Snippets.cs`, and `ui/src/hljs.ts` |
| `ui/src/hljs.ts` | `node desktop/tools/make-hljs-bundle.ts` |
| anything above, or `src/core`, `ui/src/graph.ts`, `example/`, `docs/demo`, a fixture case | `node desktop/fixtures/generate.ts` |

Then `git diff --stat desktop/fixtures/expected`: only the files you meant to change should move. Never edit
`expected/*.json` or the generated `.cs` files by hand.

## 5. Port the C#

- Same names, same order, same numbers. JavaScript string and number behaviour (trim, `\s`, key order, number text)
  lives in `JsCompat.cs`; use it, don't reach for .NET's own.
- Shared strings match word for word: `captions.ts` / `Captions.cs`, `perf/text.ts` / `PerfText.cs`,
  `ui/src/perfview.ts` / `PerfView.cs`. Text a person sees follows `.claude/ui-text.md`.
- A C# test that fails means the C# is wrong. Fix the C#, never the expected file.
- If the browser shows the result, show it in the matching `desktop/Flowy.App` panel (`Performance.tsx` /
  `PerfPanel.cs`, `Failures.tsx` / `FailuresPanel.cs`, ...). If a screenshot in `docs/images/desktop-*.png` shows that
  panel, use the `retake-shots` skill.

## 6. Prove it

```bash
npm test
npm run typecheck
dotnet test desktop --filter "Weight!=Heavy"
```

Run them in the background. Not the heavy set or the whole suite unless asked, and not while another
`Flowy.App.Tests` process runs (check with PowerShell's `Get-Process Flowy.App.Tests`). The fast set runs
`Flowy.Tests` (the parity tests) and the light `Flowy.App.Tests` classes; the ones that drive whole panels are heavy,
so say in the report that a panel change still needs a heavy run.

## 7. Check the twin

Run the `core-twin` agent on the module: it reports behaviour the two cores still differ on and paths no fixture pins.
If the change shows on screen, also run `reader-parity` on the panel.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Porting the C# before the dump exists | Nothing pins it; dump first, watch the C# test fail, then port |
| Adding to `twin-gaps.json` to make twin-drift pass | Only for a real "no twin"; otherwise dump it |
| Using .NET `Trim()` or `Dictionary` order | `JsCompat` and an ordered list |
| Expected JSON changed in files you didn't touch | Something else drifted: find out why before committing |
