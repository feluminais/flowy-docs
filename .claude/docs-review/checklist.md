# Things that get forgotten when Flowy Docs changes

The docs review reads this list after main gets new commits. Each entry says what changes, what has to follow, and
how to check it. "Seen" names the commit that later had to fix the miss. Add an entry whenever a docs-only commit
turns up that an earlier change should have carried; the review suggests candidates at the end of each report.

Judge against what main contains now, not commit by commit: a later commit in the same range may already have
fixed it.

## 1. README.md

- A user-visible feature, shortcut, CLI command or flag, MCP tool, file format, or desktop/browser difference needs
  its place in the README section that covers it: Zoom in, Details on demand, Flows, Performance, Find anything,
  Let Claude build it, Edit it, Share it, Shortcuts, The desktop app, The browser version.
- The shortcut table equals the keys the apps handle. Check `ui/src/keys.ts`, `ui/src/Shortcuts.tsx` and the
  desktop's `MainWindow.axaml.cs`, `Overlays.cs`, `ReaderView*.cs`. Seen: c68e5ab (Ctrl+K and / were missing).
- Any count or list of MCP tools (README, `docs/`, `flowy/`) equals the tools `test/mcp-guidance.test.ts` counts: the
  `tool('` calls plus the `server.registerTool('` calls in `src/node/mcp.ts` (32 on 2026-11-05). Seen: af162c1.
- The usage line in `src/cli.ts` and the commands the README shows say the same thing.

## 2. CONTRIBUTING.md

- A new top-level folder or subsystem gets a section, the way "The performance lab" and "The desktop app" have one.
  Seen: 71d66ac, 8df337f.
- Every `npm run` script in `package.json` that a contributor needs is mentioned (`lab:run`, `lab:smoke`, ...).
- A canvas or panel change adds or fixes an item in the "Canvas checklist". The items quote exact behaviour (keys,
  labels, what is faded), so an item that no longer matches the app is a finding too. Seen: a093eae, 901d21e.

## 3. The self-model in `flowy/`

- Adding, moving or removing a box, a connection or a flow in the product means `flowy/model.yaml` and
  `flowy/flows/*.yaml` change too. Changes to `src/`, `ui/`, `desktop/` or the CLI's commands are the trigger.
- Every `code:` path in `flowy/` exists (check with `git ls-files`), and a flow step names boxes and connections
  that exist. Seen: 26f97ed, 71d66ac, 901d21e, 8df337f.

## 4. The guide, the writing tips and the MCP instructions

- A new `model.yaml` field, shape, line style, step option or file format (the performance run file, for one) goes
  in `docs/format.md` (run file keys in `docs/guide/performance.md`), behaviour in the page of `docs/guide/` for that part, and how to word it in `docs/writing.md`, which `flowy://rules/*` serves by section.
  The schema in `src/core/model.ts` is the source of truth. Seen: a093eae, 7c34288.
- `docs/writing.md` still agrees with both.

## 5. Two implementations kept in step

- The reader exists twice: TypeScript (`src/core`, `ui/`) and C# (`desktop/Flowy.Core`, `desktop/Flowy.App`). A
  behaviour change in one needs the matching change in the other, or a line saying why not. Seen: e544b33 and
  7c4fdd9, 2ae4b44 and 42d1d67 (the same fix, twice, in separate commits).
- A change to something `desktop/fixtures` covers means `desktop/fixtures/expected` is regenerated;
  `test/desktop-fixtures.test.ts` fails when it is not. A fixture that holds a path from one checkout is a bug.
  Seen: 649b51c.

## 6. Screenshots

- `docs/images/*.png` shows the desktop app. A change that moves panels, the rail, the overview or the look of the
  shapes the pictures show makes them stale. Say which pictures, and call it "check" confidence. Seen: af162c1, 9d52d9a.

## 7. Tests

- New behaviour in `src/core` or `src/node` has a test in `test/`; a change to `perf-lab/` has one in
  `perf-lab/test/`; a change to the desktop has one in `desktop/Flowy.Tests` or `desktop/Flowy.App.Tests`.
  Mention only a clear gap, not a missing edge case.

## 8. Release and licence files

- A new npm or NuGet dependency means `desktop/THIRD-PARTY-NOTICES.md` is regenerated
  (`node desktop/tools/third-party.mjs`) when it is a desktop dependency, and `package.json` is still accurate
  (`files`, `bin`, `engines`).
- `.github/workflows/desktop.yml` still calls commands that exist, and its header comment is still true.
- `<Version>` in `desktop/Flowy.App/Flowy.App.csproj` and `version` in `package.json` are only a finding when a
  change says it is a release.

## 9. The performance lab

- A change to the run file format, a lab script or a lab part (`perf-lab/`, `src/core/perf/`) means
  `perf-lab/README.md` and the Performance sections in `README.md`, `CONTRIBUTING.md` and `docs/guide.md` still
  match. Seen: 71d66ac, a093eae.

## 10. The example

- `example/` is what the Canvas checklist drives. A new feature the checklist relies on has to be in
  `example/model.yaml`, and the checklist's account of the example (Customer, Shop, Mail service...) has to match it.

## 11. UI text

- Text a person sees (labels, keys, legends, hints, empty states, notices, field labels) follows `.claude/ui-text.md`.
  A finding is a new or changed string that explains a colour, line or shape in words where a drawn swatch with a short
  name would do, a stat term in a label (`p50`, `p95`), or one thing called two names across the chart key, the readouts,
  the README, the guide and the tests.
- A string changed in `ui/src` has its twin changed in `desktop/Flowy.App` (and the other way round), word for word.

## 12. Skills and agents

- `.claude/skills/*/SKILL.md`, `.claude/agents/*.md` and `CLAUDE.md` name commands, flags, paths, test filters and
  screenshot settings. A change to any of those (a renamed script, a moved file, a new `--shot` flag or picture in
  `docs/maintaining.md`) makes them stale. `retake-shots` copies its table from `docs/maintaining.md`.
- The list of skills and agents in `CONTRIBUTING.md` matches the folders in `.claude/skills` and `.claude/agents`.

## Not on this list

Style, wording (UI text is entry 11), missing edge-case tests, anything in `research_notes/`, `reports/`, `dist/`, `node_modules/` and
anything that stays local (`.claude/worktrees/`, `docs/superpowers/`).
