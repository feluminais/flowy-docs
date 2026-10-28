# Maintaining

What [CONTRIBUTING.md](../CONTRIBUTING.md) leaves out: the demo and its pictures, the desktop app, the VS Code extension, the
performance lab, the benchmarks and the checklists to run by hand before a change to the canvas or the app is merged.

## The demo and its pictures

`docs/demo/` is Plum, the made-up delivery service in the README's screenshots. `node src/cli.ts --dir docs/demo/flowy`
opens it. Its `code:` paths point at placeholder files beside it, so the canvas shows no problems. Its `flowy/perf/` holds
seven runs with made-up numbers (a dinner rush where Delivery's ETA runs out of Mapbox calls at 900 orders a minute,
the same test after a fix, customer orders alone, courier pings with a `source` that sets a colour and a dot scale, the two added together (`together`), the two tested together (`together-measured`),
and Stripe going down at 40 s and coming back at 85 s, a run over time; `together-measured` is tagged as the newer of `together`, and the flow `refund` as the newer of `refund-not-recorded`, each with a note, so Compare has a pair of each to open; the file names sort so the demo still opens on the dinner rush); they name shapes and connections of the model, so a rename there is a run problem. Its `flowy/failures/ordering.yaml`
is a fourteen-mode failure analysis with made-up ratings, and it names shapes, connections, flows and a run in the same way. The screenshots in
`docs/images/desktop-*.png` are the desktop app on that model in the light theme, 1200 by 760 (1280 by 760 for the performance one, 1280 by 1000 for the failures one) at twice the pixel
density, taken with `--shot` (below): `docs/demo --shot out.png --scale 2 --size 1200x760 --theme light`, plus `--view ordering` for the zoom,
`--view ordering --select order-api` for the panel, `--edit` on top of that for the edit one, `--view ordering --edit --delete orders-db` for `desktop-used-by.png`, `--view ordering --select orders-db` for the Data section, `--view order-api --select pricing` for `desktop-code.png`, `--view ordering --flow place-order --step 1` for the flow, `--view ordering --flow capture-payment --step 6` for the one with groups, `--view ordering --flow stripe-outage --step 5` for `desktop-states.png`, `--view order-api --flow price-a-deal --step 1 --delay 2800` with `FLOWY_REDUCE_MOTION=0` (the stack at its deepest) for `desktop-recursion.png`,
`--view delivery --tab performance --select dispatch` (1280 by 760) for the performance one, `--view ordering --run stripe-outage --tab performance --at 70` (1280 by 760) for `desktop-time.png`, `--view delivery --run together --tab performance --at 800,400` (1280 by 760) for `desktop-sources.png`, `--view ordering --tab failures --select stripe-timeout` (1280 by 1000) for the failures one, `--compare refund,refund-not-recorded --changes` (1200 by 860) for `desktop-compare.png`, the same with `,swap` on the pair for `desktop-compare-swap.png`, and `--search re` for the search. `desktop-dark.png` is the panel one with `--theme dark`.
Retake them when the app changes how it looks.

`docs/images/anim/` holds the animations in the README, a light and a dark one for each feature (GitHub shows the dark one in its dark theme). They are
recorded from the browser canvas on a throwaway copy of the demo by `docs/images/record.mjs`, in headless Chrome so no window opens, and cut into animated
WebP by ffmpeg. Build first, then run it:

```bash
npm run build
npm install --no-save puppeteer-core
node docs/images/record.mjs          # every animation, about 20 minutes
node docs/images/record.mjs flows    # one
```

It needs ffmpeg on the PATH and Chrome or Edge (`CHROME` names the browser if it isn't found). `FORMAT=gif` writes GIFs, about four times the size. The story
of each one is its entry in `scenes` in `record.mjs`: the clicks and keys, the caption in the top bar, and where it starts and ends. A new feature gets a scene,
a section in the README and a line in this paragraph. Retake one when the canvas moves or looks different, and look at both themes before you commit.

`docs/images/failures.png` and `docs/images/yaml.png` are the browser version in the light theme at twice the pixel density, in a 1200 by 800
and a 1200 by 760 window. Serve a copy of `docs/demo` (`FLOWY_STATE_DIR=<empty folder> node src/cli.ts --dir <copy>/flowy --no-open`, so the
copy's history stays out of your own and the demo is not written to). For the first, open `#ordering/failures/ordering/stripe-timeout` and press F, so the diagram fits beside the tab. For the
second, press E and change a few things (a shape's Tech, a line of a flow's file in an editor, a `put_object` through `node src/cli.ts mcp`) so
the list has You, AI and Outside steps, press Y, and pick the step the AI wrote.

## Line labels

A line's label shows only for the lines of a selected shape, the line pointed at and the line a flow has lit (`focusEdges` in `ui/src/graph.ts`). The lines of one shape meet at it, so
their middles are close and long labels land on top of each other. `ui/src/labels.ts` keeps them apart. The rules, for the next overlap that turns up:

- Move the labels, never the lines or boxes: the layout stays as the reader left it. A label stays at the middle of its line unless something is there.
- A label slides along its line, nearest the middle first, to the first place clear of every box and of the labels placed before it. Only when no place along it is
  clear does it stack above or below the middle. It never leaves its line to hide a collision.
- Clear means a few characters apart side by side (`ROW_GAP`), not touching: two labels on one row with a space between them read as one sentence.
- A lit line's label is pinned: step marks and the pipe are placed by it, and the other labels go round it.
- No place can hold a label wider than the gap, so a label is cut short past `MAX_LABEL` characters with an ellipsis. Its whole text is in the line's panel.
- `placeLabels` has no DOM in it and `test/labels.test.ts` runs it: a new case of overlap is a new test there, with the boxes and lines as numbers.
- The desktop app places its labels with the C# twin, `desktop/Flowy.Core/LineLabels.cs`, sized by the text it measures. The `labels` cases in
  `desktop/fixtures/geometry.ts` hold the two to the same places.

## The animation showcase

`docs/showcase/` plays every animation Flowy has, so you can open it and see that each one works and looks right, in the browser and
in the desktop app. `node src/cli.ts --dir docs/showcase/flowy` opens it, and so does
`dotnet run --project desktop/Flowy.App -- docs/showcase`. Each shape is named for the animation it plays (Send · from, Flash · to), and its second line holds the tag that sets it off.
It has eight views:

- Step animations: a flow of one step for each way a step can travel (Send, Call, Event, Callback, Flash, Bolt drop, Send with a word, Fail, Timeout, Lost, Rejected, Intercepted twice, Duplicated, Delayed, Share of requests), so you can click through them, and Every step animation, which plays them all: press **P** to watch them one after the other, or **R** to play a step again.
- Flow structure: a flow each for Repeat, Branch, Parallel and Flow link.
- Performance: the run Every load effect (**T**) gives each shape one effect of load, and **Ramp** sweeps all of them.
- Colour and scale: the run Colour and scale gives each shape one thing a run's `source` does (blobs counted by a formula, the same blobs at another pace, bigger calls, a line scaled down, lost calls, rejected calls).
- Several sources: the runs Several sources added and Several sources tested together put two sources of requests on one line, add a shared shape past full, and leave one line with no source named.
- Shape states: the flows Every state and State inside a shape.
- Compare: the flows Compare before and Compare after are a pair (`compare:` on the newer one, with a note), built so Show changes marks every kind of change (New, Removed and Changed) on steps, shapes and lines.
- Runs over time: the run Every state over time puts a service in all six states through events, and a part inside a holder in one: pick it in the Performance tab (**T**), then press **Play**, drag the slider or click an event.

`test/showcase.test.ts` fails when an animation kind, an outcome, a kind of group, a load effect, a state or a kind of change mark has no place there. When you add one, add a
pair of shapes named for it, a step or a flow, and (for a load effect) numbers in `docs/showcase/flowy/perf/every-load-effect.yaml` (for several sources, `added.yaml` and `together-grid.yaml`), then add the check to that test.
The folder is also one of the parity fixtures in `desktop/fixtures/fixtures.json`, so the desktop app has to read it the same way.

## The VS Code extension

`vscode/` is an extension that opens a repo's `flowy/` folder in a panel inside VS Code (command `Flowy: Open Docs`). It has its own
`package.json` and `npm install`, and it reuses `src/core`, `src/node/files.ts`, `src/node/writes.ts` and the built canvas: `npm run build:vscode` builds
the canvas, bundles the extension into `vscode/dist` and copies the canvas to `vscode/media`. To try it, open the `vscode/` folder in
VS Code and press F5; the new window opens this repo, so `Flowy: Open Docs` shows the model you're reading now, and its edits write to
your working copy: try them on a scratch copy of `docs/demo` instead. The panel reads and edits like the browser version; it has no
server, so the canvas asks the extension for the state and for each write (`src/core/host.ts` is the message format, `ui/src/transport.ts`
the page's side).
A change to `ui/` shows after `npm run build:vscode` and closing and reopening the panel; a change to `vscode/src` also needs
`Developer: Reload Window` in the new window.

The extension's commands (`Open Flow…`, `Go to Shape…`, `Show This File in the Docs`) are in `vscode/src/commands.ts`, and what they offer is worked out in
`src/core/finder.ts` (which shape a file belongs to, the picker lists). A path link on the canvas asks the extension to open it (`openInEditor` in
`ui/src/host.ts`; `vscode/src/paths.ts` keeps it inside the repo), and the extension asks the canvas to show a shape or a flow with a `flowy-reveal`
message (`ui/src/reveal.ts`). The canvas's small settings and its address live in the webview's state (`ui/src/store.ts`, `ui/src/host.ts`), which is
how a restored panel opens where it was. Try them in the F5 window on the repo: open a file that a shape's `code` lists and run
`Show This File in the Docs` from its right-click menu.

`test/vscode-page.test.ts` covers the page the extension builds (the policy that lets only the canvas script run), `test/host-message.test.ts`
and `test/transport.test.ts` the messages and the page's side of them, `test/writes.test.ts` what a write does, `test/finder.test.ts` and `test/vscode-paths.test.ts` the matching of files to shapes and paths to disk.
What happens inside VS Code (the webview loading, the theme, editing, opening files, the commands, restoring a panel) has no test: check it in the window.

### Packaging it

`npm run package:vscode` builds the canvas, bundles the extension in release mode (no source map) and runs `vsce package`, which writes
`vscode/flowy-docs-<version>.vsix` (ignored by git). `vscode/.vscodeignore` lets in only what the extension needs: its manifest,
README, CHANGELOG, LICENSE, icon, the bundle, the notices for what the bundle holds (`dist/THIRD-PARTY-LICENSES.md`, written by
`vscode/build.ts`) and the canvas in `media/`. Check what went in with `npx vsce ls --no-dependencies` from `vscode/`, and try the file
the way a user would, in a window that has no development path: `code --install-extension vscode/flowy-docs-0.1.0.vsix --user-data-dir <empty>
--extensions-dir <empty>`, then the same commands with `--user-data-dir` and `--extensions-dir` and a folder that has a `flowy/` in it.

The README's picture is a screenshot of the panel (`vscode/images/panel.png`, taken in a window with the side bars closed). vsce reads a
relative picture as if the extension were the whole repo, so the `package` script gives it the GitHub address of `vscode/` with
`--baseImagesUrl`; the picture shows on the Marketplace only once it is pushed to the repo. `test/vscode-manifest.test.ts` keeps the manifest
honest: the commands it offers are registered, the icon is a big enough PNG, the package carries what it needs, and the licence and changelog
are in step. To release, raise `version` in `vscode/package.json`, add a `CHANGELOG.md` entry, package, and publish with `vsce publish`
(the Marketplace) and `ovsx publish` (Open VSX, which Cursor and VSCodium read). Both need an account whose publisher name matches
`publisher` in the manifest. Nothing here publishes by itself.

## The performance lab

`perf-lab/` is a made-up shop that really runs, and a load generator that measures it and writes the runs the Performance tab
reads (`flowy/perf/*.yaml`). `npm run lab:run` makes a run in about two and a half minutes, `npm run lab:smoke` checks the harness in
under half a minute (it starts real servers, so `npm test` leaves it out), and `node src/cli.ts --dir perf-lab/flowy` opens
the lab. Its [README](../perf-lab/README.md) says what each part is and what to keep in mind reading the numbers.

## Benchmarks

`bench/` times the code that big models stress: the parent-to-child questions, a view's layout, the Performance tab's maths and the server's
read of a folder. `npm run bench` runs them all; each prints times by size and how fast they grow (1 is linear, 2 is quadratic). To
compare with another checkout, point `FLOWY_ROOT` at it: `FLOWY_ROOT=../other-checkout node bench/views.ts`. The desktop twin is
`dotnet run -c Release --project desktop/Flowy.Bench`. Run them before and after a change that touches a hot path, and keep the
numbers in the commit message.

## The desktop app

`desktop/` is a native reader and editor for `flowy/` folders, built with .NET 10 and Avalonia; the browser canvas stays as it is. It
needs the .NET 10 SDK. The pieces:

- `Flowy.Core`: no UI. A C# port of the reading half of `src/core` and `src/node` (YAML read as text, parsing, views, checks, the folder
  loader, code links, load-test runs and how they are played back) plus what the canvas decides (geometry and line paths, layout, the scene, search, navigation) and the shell's rules
  (which folder a pick means, recents, saved state, the folder watcher) and the Mermaid text. It also holds what editing needs, all on
  the files' YAML and never on the typed model, so a key it doesn't know (`owner:`, `links:`) is kept: `YamlWriter` (the `yaml` package's
  output, byte for byte), `EditOps` (a twin of `src/core/ops.ts`), `FileStore` (versioned, atomic writes) and `EditSession` (apply, refuse
  new problems, write, undo and redo).
- `Flowy.App`: the Avalonia app. `Canvas/` draws a view (boxes as controls, one layer behind them for the frame and lines, a camera);
  `ReaderView` holds what the reader has chosen (`ReaderView.Edit.cs` is edit mode, `ReaderView.Performance.cs` and `PerfPanel` the Performance panel); `SidePanel`, `EditPanels.cs` and `Recorder.cs` are the forms; `Shell` owns the windows; `Updates`, `ExplorerEntries` and `SingleInstance` are the
  installer-side parts.
- `Flowy.Tests` (xUnit): the Core, including parity with the TypeScript. `Flowy.App.Tests` (xUnit v3, Avalonia's headless platform):
  keys, clicks, the wheel, windows, the menu, single instance, Explorer entries (in a throwaway registry key, never the real one).
  The whole suite takes about ten minutes and its memory grows as it goes (six gigabytes at the peak), so the classes that load the big demo,
  play animations or drive whole panels carry `[Trait("Weight", "Heavy")]`. Give a new class that trait if it does the same.

```bash
dotnet test desktop --filter "Weight!=Heavy"                               # the fast set, for every change
dotnet test desktop --filter "Weight=Heavy"                                # the heavy set, about once a day (CI runs all of it)
dotnet test desktop                                                        # all of it
dotnet run --project desktop/Flowy.App -- docs/demo                        # open a repo in the app
dotnet run --project desktop/Flowy.App -- docs/demo --shot out.png         # save a picture of the window and exit (--scale 2 for twice the size, --picture for the diagram alone)
```

`--shot` takes flags that set up what the picture shows: `--view ordering`, `--select order-api`, `--line "web order-api"`,
`--hover "web order-api"`, `--flow place-order --step 1`, `--search re`, `--shortcuts`, `--run stripe-outage --tab performance --at 70` (the Performance panel on
a run, at a time or load; `--run together --at 800,400` puts each source of a run with several at a load), `--tab failures --select stripe-timeout` (with Failures open, `--select` picks a failure mode when the id is one), `--compare refund,refund-not-recorded --changes` (two flows side by side with the marks on; the one that holds the tag reads second, `--compare a,b,swap` opens one canvas that flips and `--swapped` shows the other flow, `--compare run:a,b` compares two runs, `--note "text"` types a note, `--pair` asks Save as pair, `--leave` presses Close, `--edit-flow refund --remove-link` asks to remove a flow's link), `--zoom ordering --delay 200` (a frame of the
zoom), `--lines curved`, `--theme dark`, `--size 1100x700`. Check a visual change by looking at pictures next to
`docs/images/desktop-*.png`. `FLOWY_REDUCE_MOTION=1` turns animation off.

**Two readers must agree.** `dotnet test desktop` compares Flowy.Core with the TypeScript on the folders in
`desktop/fixtures/fixtures.json` (`example/`, `docs/demo` and crafted cases) and on the canvas's own functions (line paths, camera fits,
`arrange` and `untangle`, the scene's classes, the panels' lines, search, Mermaid text) and on the whole of editing: `yaml-write.ts` writes
awkward text, collections and every fixture file with the `yaml` package, and `ops.ts` runs a script of every edit; the C# must write the
same bytes and refuse with the same words. What the TypeScript says is in `desktop/fixtures/expected`,
written by `node desktop/fixtures/generate.ts`. If a change to `src/core`, `ui/src/graph.ts`, `example/` or `docs/demo` makes `npm test`
fail on a "desktop" test, run that command, look at `git diff desktop/fixtures/expected`, then run `dotnet test desktop`: a C# test that
now fails means Flowy.Core needs the same change. A new rule in `src/core` should come with a case under `desktop/fixtures/cases`.
Positions of boxes you haven't dragged are the one thing that isn't compared: dagre has no C# twin, so `LayeredLayout` stands in.

Shapes, colours and icons live in two TypeScript files, `src/core/look.ts` (the shapes' outlines, content room and the polygon a line meets,
the named colours, the rules) and `src/core/icons.ts` (the built-in icons, from Tabler). The desktop app never copies them by hand:
`node desktop/tools/make-look-data.ts` writes them to `desktop/Flowy.Core/LookData.cs`, so run it after changing either file. The `look`
case and `appearance.json` check that the two sides resolve every shape, colour, opacity and icon alike, and `geometry.json` that a
straight line meets each shape on its outline. `docs/shapes-sheet` is the model behind `docs/images/shapes.png`.

Code snippets have two generated pieces. `src/core/detect.ts` is the table of cues that names a snippet's language, and
`node desktop/tools/make-detect-data.ts` writes it to `desktop/Flowy.Core/DetectData.cs`. The canvas colours code with highlight.js
and the desktop app runs the same highlight.js in-process (Jint): `ui/src/hljs.ts` lists the languages, and
`node desktop/tools/make-hljs-bundle.ts` builds them into `desktop/Flowy.App/Assets/hljs.js`. Run each after changing its source, then
`node desktop/fixtures/generate.ts`. `test/detect.test.ts` fails when either file is stale, and scores the cues on `test/detect-*.json`: four
sets of labelled snippets, the last written blind (a fresh agent that never saw the cues, scored once before the set joined the tests: 58 of
62 code snippets named, every one of 18 non-code snippets left plain). Add a cue for an idiom people really write, not for one snippet.

Packaging is Velopack: `dotnet tool restore` (from `desktop/`), then

```bash
dotnet publish desktop/Flowy.App -c Release -r win-x64 --self-contained true -o desktop/publish/win-x64
cd desktop && dotnet vpk pack --packId FlowyDocs --packVersion 0.1.0 --packDir publish/win-x64 --mainExe FlowyDocs.exe \
  --packTitle "Flowy Docs" --icon Flowy.App/Assets/icon.ico --outputDir releases
```

makes `FlowyDocs-win-Setup.exe`, a portable zip and the update feed in `desktop/releases/`. The "desktop" workflow does this on each
system and uploads to a draft GitHub release; start it by hand after bumping `<Version>` in `Flowy.App.csproj`. Running the installer
adds a Start menu entry and the "Open with Flowy Docs" entries to your user's registry, and uninstalling removes them. Regenerate the
icon with `dotnet run desktop/tools/make-icon.cs` and the notices with `node desktop/tools/third-party.mjs`.

Before merging a change to the app, look at what it could affect, in a real window:

- [ ] `dotnet run --project desktop/Flowy.App -- docs/demo` shows Plum. Double-click Ordering: the view zooms in, the breadcrumb reads
      Overview › Ordering, and Esc, Backspace or the breadcrumb zoom out. Double-click the faded Delivery while inside Ordering: the
      view slides across instead of zooming in. Esc goes back to Ordering, and a second Esc to the overview. Backspace or Z in Delivery goes
      straight to the overview, and Esc after it does nothing.
- [ ] `dotnet run --project desktop/Flowy.App -- perf-lab` (or `-- perf-lab --view shop --tab performance --shot out.png`): the left rail has a Performance
      button under Failures with a 2 on it, and T opens its tab on the load where the Fulfilment worker first struggles
      (200 req/s on the ramp). In Shop lab, shapes that carry numbers are outlined from green to red along their own outline, Order queue
      carries a number but no colour, busy lines are thicker with more dots, and Catalog cache and Payment gateway stay plain. ← → Home End
      move between tested loads (← from the first goes down to 0 req/s, where nothing runs on the lines); P ramps up (from the top it starts again from no load) and a click on the slider stops it; drag the slider: the
      load follows the thumb in small steps, "Between 50 and 100, estimated" shows between tested loads, and the thumb pulls onto a tested load, which reads "Tested"; a picked shape or
      line reads out its numbers; under Ramp an Each stripe switch has Calls, Data and Mixed, each beside the stripe it draws. This run gives no sizes of a call, so it opens on Calls (a small stripe for each call, running along the line)
      and Data and Mixed are greyed out with the reason in their tooltip and in a muted line under the switch ("No call sizes in this run"). A run with sizes opens on Mixed: the stripes count the calls and are as big as their calls. Data counts the data instead and turns the
      Key's "More calls" into "More data" and the scale into KB/s. A line with no numbers has grey line-highlight stripes that speed up as you drag the slider up (drawn beside the outline under "Not measured" in the Key);
      under the chart a key draws a blue line (Expected call), an amber one (Slowest 5%), red dashes (First
      struggles) and a solid line (Now), the chart says "Calls into" the run's entry shape and "Time (log)" on its left edge, and the Key (under the sentence about where it first struggles, and Each stripe) draws each mark on the canvas
      now (Busy, Struggling, Waiting, Not measured, a call, a failing call, More calls) with no sentences, all of it in view in an 880 px window; a shape past 85% busy wears its percentage and Waiting is a square badge; Esc closes the panel, and the Details button swaps Details back in. With animation effects off there
      are no dots and no Ramp button, and the outlines, thickness, numbers and strip still show. Light and dark both read.
- [ ] `dotnet run --project desktop/Flowy.App -- docs/demo --view ordering --tab failures --select stripe-timeout`: the left rail has a Failures button under
      Performance with a 14 on it, and M opens its tab beside Explorer and Flows, with Details free on the right (a shape picked on the canvas reads out there and
      narrows the list). Opening Performance closes it. Press E: the tab stays open, with Edit analysis and New analysis folded under the name, and Add failure mode
      under the key; the mode picked has a form (part, effect, cause, the three ratings and their After ratings, controls, next action, owner, status, affects, flow,
      step, run, More) where a pick or a typed field is saved at once, and the arrows no longer step through the list. Order API wears a red 2 and is outlined orange (the mode is Medium), so is Stripe, solid, the line between them wears an amber 2 and
      is orange, Kitchen tablet and Customer app are in a lighter orange outline and the rest fades. The card sits above the list: the Fails and Affects marks in orange, Risk 96 (8 × 4 × 3) Medium and "Risk after next action: 96 to 32". Each band row has its rule beside the count ("Risk 150+ or severity 9+", "Risk 60 to 149", "Risk under 60", "A rating missing"), the lists have a Risk heading over their numbers (a High row made so by severity alone has "Severity 9" under its number), and the
      key draws a dot for each band that has modes. The list runs Refunds (126), Orders DB (20) and on down; a click on a row picks
      it and a second click puts it away; ← → step down the list and stop at its ends; a click on a shape narrows the list to its modes and the chip clears
      it; a band button filters and "Not analysed (11)" lists the shapes left. Show it plays The payment is captured; Seen in a run on ETA to Mapbox opens
      Performance on its first level with errors; CSV and Table at the top of the tab put the ranked list on the clipboard. Esc closes the tab (until you click
      the diagram, as with Explorer), and the marks go with it. Light and dark both read.
- [ ] Click Order API: its panel opens and the view moves it out from under the panel. Click a name in the panel's Out list: the panel
      switches. Open "5 connections": each label shows. Point at a row: its line lights up on the canvas.
- [ ] On the overview, the line between Ordering and Back office has an arrowhead at each end. Click it: the panel has a two-way arrow between the names,
      "streams every event" under Ordering → Back office and three connections under Back office → Ordering. Press E: the same two headings, a label field
      and a delete under each.
- [ ] Pick "Customer places an order" in Ordering: ← and → step, Home and End jump, Esc stops, and the player card shows "More".
- [ ] Press L on `docs/demo`: the Flows tab lists delivery, ordering and payments (with stripe inside it) as folders, each a chevron, a folder mark, its name and its count, with every flow's tags under its name and the tags in use as buttons above the list. Press error path: 9 of 20 flows stay, with the count above them. Press E and open a flow: its form has Folder and Tags under Flow. Type a new folder and press Enter: the file moves and the list follows. Press a tag: it lights and the flow's row gains it. New flow has a Folder field, and a name Flowy cannot use is said under it. Light and dark both read. (Dragging a flow onto a folder is browser only.)
- [ ] Ctrl+K, type `re`: Restaurant, Refunds in Order API and Data warehouse in Back office. Enter opens Refunds' panel in its view.
- [ ] Open `desktop/fixtures/cases/problems/flowy` (or its repo): "34 problems" in the bar, "!" on boxes, a click on a problem goes to it.
- [ ] Save `example/model.yaml` with a new box name while the app is open: it appears without a reload. Add a line `<<<<<<<` and
      save: a banner names the file and line, and the last good model stays.
- [ ] File › Open Recent lists what you opened; dropping a folder from Explorer opens a window; opening the same folder twice brings
      the first window forward; `FlowyDocs.exe <folder>` from a terminal opens it in the running app, not a second one.
- [ ] With the system's animation effects off (Settings › Accessibility › Visual effects), opening a box is instant. With them on, it
      is smooth: no stutter on the way in or out, and a second double-click during the move doesn't break it.
- [ ] Help › Open the Demo shows Plum with no problems and a Performance button with a 7 on it; T opens the panel on 900 orders/min,
      "Delivery > Dispatch > ETA at 90% of capacity" (the shapes down to ETA, as the overview draws them), with Delivery outlined red and wearing 90%. View › Copy as Mermaid, pasted into an editor, starts with `` ```mermaid ``;
      View › Save Picture… writes a PNG of the diagram alone. An empty `model.yaml` says "No shapes yet".
- [ ] Close a window after resizing it, open the app again: it opens at that size.
- [ ] Delete the open `flowy/` folder: a banner says it is gone. Put it back and open it again: the model returns.
- [ ] Edit on a copy of `docs/demo` (the sample inside the app can't be edited): E turns edit mode on; rename a box in its panel and click
      elsewhere; add a box with N; drag a box and a second one; draw a connection from the dot under one box onto another and type a label;
      record a flow with two clicks and a line of text per step. Ctrl+Z walks it all back, Ctrl+Y forward. Open the same folder in the
      browser (`node src/cli.ts --dir <copy>`): it shows the same, and `git diff` shows only the lines you changed.
- [ ] On a copy of `docs/demo`, open Pricing: its panel has a Code section with the Delivery fee snippet in TypeScript, the keywords, the
      comment and the numbers in their own colours, and a Copy button that puts the lines on the clipboard. In edit mode press Add code, type
      a title and some SQL, pick nothing: the card reads "Auto: SQL" once there is code. Pick Go: the colours change and `language: go` is in
      the file. Pick Auto: the line goes. Remove the snippet: `snippets:` is gone.
- [ ] On a copy of `docs/demo`, open Orders DB: its panel has a Data section, the orders table open with PK on id, FK customers on customer_id, a type (uuid, int) in small type under each of those names and a purple dot on
      total whose note is under the table on a purple strip (open Refunds: NULL beside reason, whose type is `text?`), and the other three tables closed to a line each ("4 columns", and how long they are kept). Click a closed line: it
      opens. Open Menu cache (a key set with Key, Value and Expires) and Order events (a topic with Key and Value). For a document, paste the Restaurant profiles
      example from the guide's Data section under another store's `data:`: it shows its fields one to a line, indented, with the note under them. In edit mode the
      form has a Data box holding the same lines as the file: delete a column from `columns` but not from the rows and click elsewhere, and a notice says a row has
      too many cells and the box keeps what you typed. Clear the box: `data:` is gone.
- [ ] On a copy of `docs/demo`, open Support refunds an order from the Flows tab (**L**): the row has a link mark and a Compare button, quiet until you point at it. Press it: two panes open at once with the note under them (the row of a flow with no link opens a picker under the tabs), and Side by side, Swap, Show changes and Close in the bar. Show changes outlines New, Removed and Changed with the same key as the browser.
      Double-click a shape that opens in one pane: only that pane zooms in, with a breadcrumb under its title, and **Esc** goes back up before it closes the comparison.
      **X** in Swap glides the shapes, and **Esc** closes the comparison. Press **T** on Orders and pings, tested together, then **C**: two run panes, with Show changes greyed out. In edit mode every Compare button is greyed out
      with "Not while editing". `--compare refund,refund-not-recorded --changes` (below) opens the first pair with its marks on.
- [ ] While the app has a model open, change it in the browser (or save from an editor): the app shows it without a reload, and an edit
      made in the app after that starts from what is on disk.
- [ ] Light and dark: change the system's theme while the app is open.

## Canvas checklist

The logic behind the canvas (layout, keys, saving) has tests, but nothing drives the canvas itself.
Before merging a canvas change, run `npm run build:ui && node src/cli.ts --dir example` and check
the items it could affect. A change to the side panel doesn't need the sharing items, for example.

Reading:

- [ ] The overview shows Customer, Shop and Mail service, each with a coloured icon tile. Mail
      service is grey with a cloud and reads "external", and Shop says "3 inside". Double-click Shop:
      the view zooms into it, the breadcrumb reads Overview › Shop, a frame labelled Shop wraps Web
      app, API and Orders DB, and Customer and Mail service are faded and dashed outside it.
- [ ] Double-click API, then press Backspace twice quickly: it zooms back out to the overview. Z does the same from any level.
- [ ] On `docs/demo`, close every panel and click Details at the top level: the heading reads Plum, with the description and the counts under it. On `example` (no name)
      it reads Overview with "Click a shape." and no keycaps. Press E: the same panel holds Name and About (Markdown). Type a name and leave
      the field: the heading changes and `model.yaml` starts with `name:`. Clear it: the key goes. The same in the desktop app.
- [ ] In edit mode, drag a box and press Esc (then try Backspace on another drag): the box goes back and the level stays; the next press goes
      back. A click in between, or a second edit, turns that off. In the app, press Esc while still holding a drag: the box returns, nothing is saved.
      Clicking the breadcrumb works too. The zoom buttons in the corner don't move while it zooms.
- [ ] Click Shop and press Enter: it zooms in. Double-click API, click Auth (its panel opens),
      then press Esc three times: the panel closes, then it zooms out to Shop, then to the
      overview. Esc again does nothing. Tab moves the focus between boxes, and Enter opens the
      focused one.
- [ ] Add `  smtp: { type: app, name: SMTP, in: mail }` right under `objects:`, so Mail service
      opens. Inside Shop, double-click the faded Mail service: the view slides sideways, away from
      it, instead of zooming in. Esc: it goes back to Shop. Undo the line.
- [ ] Zoom in with the wheel and press F: the whole view fits again. Press ?: the shortcut list
      opens; Esc closes it.
- [ ] Inside API, Auth, Orders and Mail service sit in a row with Orders DB below them, and no
      line runs through a box.
- [ ] With the system's reduce-motion setting on (Windows: Settings › Accessibility › Visual
      effects › Animation effects off), opening and closing a box is instant.
- [ ] Lines: pick curved, then right-angled. In API every line follows, labels still show on hover,
      and a reload keeps your pick. Pick straight again: the lines go back to the project's, and
      `example/model.yaml` is unchanged.
- [ ] Every zoom fits the whole diagram in the window, and doesn't open the side panel. Resize the
      window: it fits again.
- [ ] In Shop, lines have no labels. Hover one: its label shows. Click API: its lines show labels
      and the others fade. If the panel would cover the box you click, the view moves it aside.
- [ ] Hover API: after a moment its first paragraph appears under it. Click API: the side panel
      shows the whole description with its bullet list. Esc, ×, or a click on empty canvas closes it.
- [ ] Press O: the Explorer opens on the left, folders first and then by name. Click API in it: the
      view goes to API and its Details open on the right, beside the Explorer. Drag the edge of either
      panel (it lights up under the pointer): it resizes, and a double-click puts the width back.
      Esc closes Details first, then the Explorer. Reopen the project: the widths are as you left them.
- [ ] On `docs/demo`, press L: the Flows tab lists the flows as the folders under `flows/` (delivery, ordering and payments, with stripe inside payments), each a chevron, a folder mark, its name and how many flows are in it, and under every flow its tags as small words. Folders come first, the flows in a folder by file name. Under the search, the tags in use are buttons with a count: press error path and only those flows stay, with "9 of 20 flows" above them and the folders that have none gone; press recovery as well and the flows with either stay; press them again and the list comes back. Type `stripe` in the search: payments, stripe and its two flows show whatever was folded. Fold payments and the rows under it go while its count stays. A flow with a link mark still has Compare pair in the key at the foot, and pointing at the mark names the flow it is compared with. Light and dark both read.
- [ ] On `docs/demo` at the overview, press O: the Explorer opens and every shape (Courier, Delivery and their badges too) is drawn beside it, none under it. Each row says how many shapes are right inside it ("7 inside", as the canvas does) and how many flows play in it; point at a number: "7 inside, 13 in all, 12 flows". Close the Explorer and the view fits the whole window again. Zoom with the wheel, open and close it: the view stays where you put it. F fits beside it. Click a shape: Details opens and the view fits beside it too; close it and the view fits the window again. Point at the link mark of Support refunds an order: it reads "Compared with The refund is not recorded".
- [ ] On a copy of `docs/demo`, press O: under the tree, Drafts 1 lists Group orders. Click it: the draft opens with 9 shapes and 2 flows, and the top bar reads Plum beside a Draft mark; Plum leads back to the model. Press New draft, type `LAN transfer` and press Enter: an empty draft opens, and `flowy/drafts/lan-transfer/model.yaml` holds its name. The model's Explorer lists it; delete the folder and it goes. Light and dark both read.
- [ ] On a copy of `docs/demo`, press E and open a flow: its form has Folder and Tags under Flow. Type `ordering/waits & timeouts` in Folder and press Enter: the file moves to `flows/ordering/waits & timeouts/`, the list shows the new folder, and Ctrl+Z puts it back. Press happy path in Tags: the flow's row gains it; the field under it adds a tag of your own. New flow has a Folder field too. Drag a flow row onto a folder: it moves in (the folder is ringed while you hover it), and a Top level row at the head of the list takes it back out; Ctrl+Z undoes either. Outside edit mode rows are not dragged.
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes stay lit, with a blue border, and its line is bold and drawn over the faded boxes. Customer, outside Shop, lights up fully in step 1.
      → and ← move, End and Home jump to the last and first step, the buttons match, Esc stops
      (and a second Esc zooms out). Step 3 lights API alone, with no line, and its
      More shows a paragraph with **Orders DB** in bold.
- [ ] In API, play "Customer signs in". Web app joins as a faded box, with a dashed line to Auth.
- [ ] In Shop, click the "2 connections" line: the panel lists both connections.
- [ ] Open `docs/demo` (Plum). On the overview the line between Ordering and Back office has an arrowhead at each end and no second line under it.
      Click it: the panel has a two-way arrow between the names, "streams every event" under Ordering → Back office and three connections under
      Back office → Ordering. Play a flow step from Back office to Ordering: the whole line lights, both arrowheads too.
- [ ] In Shop, click API: its panel lists Out (Orders DB with "2 connections", Mail service with
      "sends receipts" and "Orders → Mail service" under it) and In (Web app, "REST"). Open "2
      connections": both labels show, each with the boxes inside. Point at a row: its line turns
      blue. Click "Orders DB": the panel switches to it.
- [ ] From the overview, press / and type `au`: "Auth component in API" is listed. Press Enter: the
      canvas opens API with Auth selected and its panel open. Ctrl+K and `zzz`: "Nothing called
      that." Esc closes the search and leaves the panel open.
- [ ] Rename Shop in `example/model.yaml` and save: the page updates without a reload.
- [ ] Add a line `  shop: {}` right under `objects:` and save: a banner names model.yaml and the
      line, and Edit greys out. Undo it: the banner goes.
- [ ] Add `  floating: { type: app, name: Floating }` right under `objects:`: "1 problem" appears
      and Floating has a "!". Pick the problem: Floating's panel shows it.
- [ ] Add `    code: [src/cli.ts, nope/]` under `api:`. "1 problem" names `nope/`. API's panel lists
      both paths, as links to your clone's GitHub origin, on the current branch. Undo it.
- [ ] Stop flowy: a banner says the connection is lost. Start it again: the banner goes.

Animation showcase (`npm run build:ui && node src/cli.ts --dir docs/showcase/flowy`, then the same folder in the desktop app):

- [ ] Open *Every step animation* (`#steps/every-step-animation`) and press P: seventeen steps play in turn, each taking two to four seconds. In the browser a step plays again two and a half seconds after it ends until you move on, the Repeat button on the card turns that off (and is
      remembered), and the line's label sits beside the line while it runs. Send runs an envelope one way, Call goes and
      comes back while dots wait over the caller, Event runs a bolt and flashes the receiver, Callback sends a ring, then a bell, then a ring, a callback
      after a step flashes its publisher first, one from outside drops a bolt on it, and the next Send carries the words "order 42". Fail runs an envelope in the danger colour and flashes its receiver in it. Timeout sends the envelope, keeps the dots waiting over the caller with no reply, and then dims the line, which stays dim until you move on. Lost pops the envelope partway and leaves a red cross with the reason under it, and the receiver never squashes. Rejected stops it at a red bar by the receiver, which flashes, and sends it back red. Intercepted leaves the line for a dashed outline round a third shape (or a dashed marker named Café wifi proxy) that lights. Duplicated runs a second copy that trails the first, and the receiver squashes twice. Delayed waits beside a turning dashed clock with the reason beside it, then goes on and is answered. Share of requests sends ten, and the three that are lost are named r1, r2 and r3, each with its own colour and a ring, and leave their crosses where they vanished. Every shape
      squashes or flashes where the animation says it does, on the queue, the cylinder and the hexagon too. With the system's animation effects off, nothing moves.
- [ ] Open Order API and pick "Pricing a meal deal", then step to its second step: a pipe loops out of Pricing's side and back in, cards
      pile up under it, the counter on its corner goes `↻ 1`, `↻ 2`, `↻ 3` and back down, a flag lands where it stops, and `↻ 3 deep` is
      left when it ends. R plays it again from a clean start, and ← → in a hurry leave no card or counter on any box. With the system's
      animation effects off only `↻ 3 deep` shows, and Autoplay (P) still moves on. The browser (`npx flowy-docs --dir docs/demo`, then
      `#order-api/price-a-deal`) does the same. Light and dark both read.
- [ ] Open *Effects* (`#steps/effects`) and press P: the label of each of four steps runs from Effects · from to Effects · to, down a slope, doing what its word says. squish stretches
      along the line, bounce hops, pulse swells and settles, and wiggle rocks from side to side. Whatever it does, the pill stays level and whole: never sheared, one end up and
      one end down, and its words are never stretched. A step with no `effect` (Send with a word) keeps its shape. In the desktop app the same. The `effect` key is for fun
      and is deliberately left out of the guide and the README.
- [ ] Open Repeat, Branch, Parallel and Flow link in Flow structure. Repeat says it repeats up to 3 times, and its box on the bar is dashed. Branch says One of 2, forks the bar into its two lanes by name
      with the lane you are not in hollow, and dashes that lane on the canvas, Parallel lights three lanes together with a bolt each, and Flow link has an Open flow that lands on the other flow and a bar to come back.
- [ ] Open Every state in Shape states (`#states/states`) and press P: Service starts out dotted and circling (Starting), settles with nothing drawn (Running), pulses amber with a
      triangle on its corner (Degraded), drains its outline with an hourglass (Stopping), goes grey and dashed with a power symbol (Stopped), shows a short arc circling it (Restarting) and
      is plain again. The key under the progress bar names only the states on screen. Open State inside a shape: at step 2 the Holder has a dashed ring with a power symbol that reads "Stopped inside" in the key,
      and at step 3 it shows its own amber state instead. With the system's animation effects off the dimming, outlines and symbols stay and nothing moves.
- [ ] In Colour and scale, press T and then Home: every line carries blue stripes, Few calls 1, Ten times the calls 10, Same calls, slower 1 (moving slower than
      Few calls), and Bigger calls has stripes smaller than the usual. The Key says what a stripe stands for ("1 dot = 25 KB/s") and "Bigger call". Press End: Few calls shows 16 dots and
      Ten times the calls 24, and the Key adds "Scaled down" (click that line: its numbers say it too). Bigger calls has dots twice as wide, Lost calls pops a ring where each failing dot dies
      ("Lost call" in the Key), and Rejected calls runs its failing dots to the end of the line, stops them at a red bar and sends them back red ("Rejected call").
      Change `color: blue` in `perf/scale.yaml` to `"#e8590c"`: the dots and the Key's dots turn orange, in both themes. With reduced motion there are no dots and the Key says nothing of the source.
- [ ] In Performance, press T and then Home: the lines are thin and no outline is red. Press Ramp: Traffic's line thickens and its stripes bunch up,
      Failing calls sends red stripes, Strain and Failing shape run from green to red, Queue and Rolled up grow a number, and Not measured stays plain at every load.

Performance (`npm run build:ui && node src/cli.ts --dir perf-lab/flowy`):

- [ ] `dotnet run --project desktop/Flowy.App -- desktop/fixtures/cases/text` (a folder with no flow, run or analysis): the left rail still has Explorer, Flows,
      Performance and Failures, in that order, with no count on the last two. L, T and M each open a panel that says what is missing: "No flows yet", "No load-test runs yet" with a
      Create button that copies a starter run (and says so in a notice), and "No failure analyses yet". The browser does the same.

- [ ] The left rail has a Performance button under Flows with a 2 on it, and T opens its panel (on the left, with Details free on the right) on the load where the Fulfilment worker first struggles (200
      req/s on the ramp), with `#shop/perf/ramp/4` in the address. In Shop lab, shapes that carry numbers are outlined from green to red
      along their own outline (SQLite's cylinder, Upload folder's folder, the boxes of Web API and the worker), Order queue carries a
      number but no colour, busy lines are thicker and carry more dots, and Catalog cache (a hexagon with no numbers) and Payment gateway
      stay plain. Under the chart, a blue line reads Expected call, an amber one Slowest 5%, red dashes First struggles and a solid line Now; the Key (under the first-struggles sentence and Each stripe)
      draws each mark on the canvas now. ← → move between loads, Home and End jump (Home gives `#shop/perf/ramp/0`), and the address follows. Esc closes the
      panel; Back closes it too if you opened it with T (after Esc, Back opens it again). Click a shape and its Details open on the right, beside
      the panel, and the diagram still fits; Esc closes whichever is showing.
- [ ] On Plum (`--dir docs/demo/flowy`, Delivery at 900 orders/min) the line from Dispatch to Order events runs behind Live tracking: its dots go faint and a little
      smaller as they reach the box, run across it as ghosts, and come back as they leave, with no jump at either edge, in the browser and in the desktop app. Click Dispatch:
      the dots on its lines do the same under a label ("accepts or refuses", "travel times"), which stays readable, and in the browser under the card that appears when you
      point at a shape. A dot that comes out of the first or last shape of its own line is not faint there. Reduced motion draws no dots at all.
- [ ] Click Fulfilment worker: the panel stays and reads Busy and Failing with a curve each. Click the line from Order queue to
      it: its numbers show. Pick Slow gateway in the run picker: the struggle is
      at a lower load. Press Home, then P (or click Ramp): the load sweeps up through the levels in about 30 s (from a later load it
      covers the rest at the same pace) and stops at the highest; the slider and the strip's cursor move with it, and touching the
      slider stops it. At the 400 level a few red dots fade out part-way along the lines into Payment gateway. After you move, Go there
      brings you back to the struggle, and About opens the run's note.
- [ ] At the overview (Overview in the breadcrumb), Shop lab takes the worst colour of what is inside it; zoom into it (Enter) and the
      worst outline inside is the same colour. Pick each style in the Lines picker: the dots follow every line. To check a moved shape
      without writing into `perf-lab/`, copy it (`node -e "require('node:fs').cpSync('perf-lab', require('node:os').tmpdir() + '/lab-copy', { recursive: true })"`),
      serve its `flowy` folder (`--dir "$TEMP/lab-copy/flowy"`), press E, drag Web API, press E again and T: the dots follow the moved lines.
- [ ] Press E with the Performance panel open: it closes and the button is greyed out; E again brings it back. On a folder with no runs the button is there too, and its panel says so and offers Create, which copies a starter run. Open
      `#shop/perf/ramp/2` in a new tab: it opens on that load. With the system's reduce-motion setting on there are no dots, no Ramp
      button and no easing between loads, and the outlines, thickness, badges and numbers still show. Light and dark both read.

Failures (`npm run build:ui && node src/cli.ts --dir docs/demo/flowy`):

- [ ] The left rail has a Failures button under Performance with a 14 on it, and M opens its panel on the left with `#root/failures/ordering` in the
      address. Details stays free on the right: a click on a shape picks it there and narrows the list to its modes, and the chip clears it. Opening Performance (T) takes the panel's place.
      The panel is not remembered when the page reloads: the address brings it back. The key reads High 2, Medium 5, Low 6 and Not rated 1, then "Analysed 15 of 26 shapes" and "Not analysed (11)". At the overview Ordering
      carries a red 6 and the line from Checkout to Stripe an amber 2. Under This view the rows run Refunds (126), Orders DB (20), Notifier to Twilio (144),
      ETA to Mapbox (108) and on down to Fleet DB, which is Not rated.
- [ ] Open `#ordering/failures/ordering/stripe-timeout`: Order API, Stripe and the line between them are outlined orange (a Medium mode), Kitchen tablet and Customer app in a lighter orange outline,
      and the rest fades. The card is above the list and reads Risk 96 (8 × 4 × 3) Medium, "Risk after next action: 96 to 32". Show it plays The payment is captured. Open `#delivery/failures/ordering/eta-mapbox-fails`:
      Seen in a run opens `#dispatch/perf/dinner-rush/3`. ← → move down the list, and Esc closes the tab while the last click was in it.
- [ ] Press E with the tab open: it stays, beside Details, and gains New analysis, Add failure mode and a form for the mode picked. CSV and Table put the ranked
      list on the clipboard. `node src/cli.ts failures --dir docs/demo/flowy` prints the same table and exits with 0. Light and dark both read.

How a request ends in Plum (`npm run build:ui && node src/cli.ts --dir docs/demo/flowy`, then the same folder in the desktop app):

- [ ] Play Mapbox turns the travel times away (`#dispatch/mapbox-rate-limit`): step 2 stops the call at a red bar by Mapbox and sends it back red, with "Rate limit" beside the bar.
      The card says Rejected. In Failures, Mapbox calls fail at dinner rush has Show it and opens this step.
- [ ] Play A double tap sends the order twice (`#ordering/order-sent-twice`): a second copy leaves the first, both wear one colour, and Order API takes both in. Play Hotel wifi
      takes the order (`#ordering/hotel-wifi-takes-order`): the call leaves the line for a dashed marker named Hotel wifi portal, which lights. Play Dispatch hears about an order late
      (`#delivery/events-arrive-late`): the bolt waits beside a turning dashed clock labelled Consumer lag, then goes on.
- [ ] Play Stripe reports a charge (`#ordering/stripe-webhook`): a bolt drops onto Stripe first, then a bell runs to Order API with the words o_1042. The last step links to A paid order
      is announced. In that flow the first step is an Event (a bolt, and Order events flashes), and the Dispatch lane is a Callback that flashes Order events first.
- [ ] Click Stripe, Mapbox and Customer app: each has a link in Details (Provider status, Rate limits, Build and release notes). The last one opens the file in the repo. The courier has a truck
      and Message templates is drawn as a document, in the browser and the desktop app, light and dark.

Shape states (`npm run build:ui && node src/cli.ts --dir docs/demo/flowy`, then the same folder in the desktop app):

- [ ] Play Stripe goes down and comes back (`#ordering/stripe-outage`). Step 1: Stripe's outline drains and an hourglass sits on its corner. Step 2: Stripe goes grey and dashed with a power symbol.
      Step 3: Order API has a dashed ring with a triangle, and the key says Stopped and Degraded inside: Checkout. Step 4: a short arc circles Stripe. Step 5: dots circle it. Step 6: nothing is drawn
      and the key is gone. ← steps back and each stop shows what it showed on the way forward. A shape that is dimmed because the step does not light it is still easier to see than the others.
- [ ] Pick Stripe at step 4: Details has a State line that reads Restarting. Pick Order API: it reads "Degraded inside: Checkout". Light and dark both read, and the same flow in the desktop app looks the same.
- [ ] Press E on a copy of `docs/demo` and open that flow: each step has a State section with a row of tiles for each end of it, None first. Pick Stopped for Stripe on step 5: the file gets
      `states` on that step and nothing else changes. Pick None: the key goes again. Ctrl+Z walks both back.

YAML (press Y, in a copy of `docs/demo` served with `FLOWY_STATE_DIR` pointing at an empty folder, so the history stays out of your own):

- [ ] The left panel gains a YAML tab beside Explorer and Flows, with a tab for `model.yaml`, `failures/ordering.yaml` and each flow, and one step, First seen. Press E, change
      a shape's Tech, and press Tab: a "You" step appears, and the changed line shows red above green. Change a file in an editor: an "Outside" step appears.
- [ ] Pick the older step: its files show with the marks against the step before it, and Restore is greyed out with "Edit to restore" beside it. Press E, then Restore: the
      model goes back, a "Restored" step is on top, and Ctrl+Z puts the change back. Clear history asks first, and Clear empties the list. On an exported page and in the VS Code panel the tab is there and says it has no history.
- [ ] In the desktop app on `docs/demo`, press Y: the YAML tab says Read only, has the same file tabs as the browser, and opens on `model.yaml`. Pick Ordering on the canvas: its lines are
      tinted and in view. Play A courier delivers it: its file opens. Change `model.yaml` in an editor: the text follows. Light and dark both read.

Runs over time (`npm run build:ui && node src/cli.ts --dir docs/demo/flowy`, then the same folder in the desktop app):

- [ ] Press T and pick Stripe outage in the run picker (`#ordering/perf/stripe-outage/2`, with Ordering open). The tab says Time, not Load, and reads 45 s, Tested. Stripe is grey and dashed with a power
      symbol, and the key names Stopped and nothing else. Three marks sit above the slider at 40, 70 and 85 s, in the colours of Stopped, Starting and Running, with the words of each when you point at it. The Events list has Payments killed lit,
      a dot before it, and two rings.
- [ ] Drag the slider to 41 s: Stripe stays stopped. Drag to 10 s: its outline goes at once, with no fade, and the key has no state. Drag to 75 s: dotted outline, and Starting in the key. Drag to 90 s: nothing is drawn.
- [ ] Click Restart begins in the list, and the mark above the slider: the slider goes to 70 s, and Stripe eases to Starting. ← and → still go level to level (45 s, 60 s, 90 s). Play (**P**) takes the run in about 30 s,
      the thumb moves evenly in time, Stripe goes stopped, then starting, then runs, and the Events rows fill in as it passes. Touching the slider stops it.
- [ ] Pick Stripe while at 45 s: under its readings is a Stopped line. Pick Dinner rush in the run picker: the tab says Load and Ramp again, and Stripe is as it was. Pick Every state over time in the showcase (`--dir docs/showcase/flowy`):
      the service goes through all six states, and at 45 s the holder shows a dashed ring that reads Stopped inside. With the system's reduce-motion setting on there is no Play, and the states, marks and numbers still show.
      Light and dark both read. In Plum's Failures tab, Stripe doesn't answer within 5 s has Seen in a run: it opens the tab at 45 s on this run.

Several sources (`npm run build:ui && node src/cli.ts --dir docs/demo/flowy`, then the same folder in the desktop app):

- [ ] Press T and pick Orders and pings, added in the run picker (`#delivery/perf/together/3,3`, with Delivery open). The tab says Added from separate runs. It has a block for Customer orders (a blue dot) and one for
      Courier pings (green), each with a slider, its tested loads under it, "Tested" and its own Ramp, and the first is marked at its edge. It opens at 800 orders/min and 400 pings/s: "First struggles with Customer orders at
      800 orders/min and Courier pings at 400 pings/s: Fleet DB at 101% of capacity". On the line from Live tracking to Fleet DB blue and green dots run side by side, and the key names both sources, each in a group with its colour bar, "1 dot = 4 calls/s" under Customer orders and "1 dot = 20 calls/s" under Courier pings, after the marks they share.
- [ ] ← → Home and End move the marked block only. Press the Courier pings slider: that block is marked now, the chart is headed Courier pings with "Customer orders held at 800 orders/min", and the keys move it. Ramp under Courier pings
      moves that slider alone and P stops it; press Ramp under Customer orders while one runs and the ramp moves there. Go there puts both back.
- [ ] Put both at their highest (1200 and 800): Fleet DB is red, and clicking it reads Busy 143% and "Added use is over 100%". The line from Live tracking to Fleet DB has 24 green dots and fewer blue ones (15, the ratio of their calls),
      and the key says Scaled down. Orders alone (Customer orders in the picker) has no label and one slider, as before.
- [ ] Pick Orders and pings, tested together: the tab says Tested together, with three loads on each slider. At 600 orders/min and 400 pings/s Fleet DB reads 99%, where the two added read 93%, and nothing says "Added use" at any setting.
      `#delivery/perf/together/2` (one place for two sources) and `#delivery/perf/together/a,b` both open at the first struggle, and `#delivery/perf/together/1,4` opens at 200 orders/min and 800 pings/s.
- [ ] With reduced motion on there are no dots and no Ramp buttons, and the sliders, numbers and the key's Busy, Struggling, Waiting and Not measured stay. Both themes read.
- [ ] In the showcase (`--dir docs/showcase/flowy`, Several sources, T): Several sources added at its highest has blue and green dots side by side on the line into Shared service, both scaled down together, and Shared service reads
      "Added use is over 100%". Several sources tested together has a grey line into Not split by source, and the key says Other calls.

Compare (`--dir docs/demo/flowy`; `npm run build:ui` first):

- [ ] In the Flows tab (**L**) Support refunds an order has a link mark and every row has a Compare button. Click it on that row: two panes open at once, The refund is not recorded on the left and Support refunds an order on the right, the address is
      `#root/compare/refund-not-recorded/refund`, and the note about the two refunds is under the panes. The row of a flow with no link (Place an order) opens a picker with a field that says "Find a flow" instead. Each pane zooms, pans and plays on its own. Click a shape in one: Details opens, and a second click on it closes it. Double-click Order API in the right pane: only that pane zooms in, a breadcrumb (Overview, Ordering, Order API) appears under its title, and the panel does not open. **Esc** goes up to Ordering and the breadcrumb goes away. Press **Esc** twice: the panel, then the comparison.
- [ ] Press **C** while a flow with no link plays: the picker opens. Press **C** on Support refunds an order: the comparison opens at once. ← → **P** **R** **F** act on the pane you clicked last, which has an outline.
- [ ] Turn on **Show changes**: the key names New, Removed and Changed. Stripe is Changed in both panes, the left flow's other shapes are Removed and the right's are New, and the steps in the progress bars carry the same outlines.
      Reload: the switch is still on. Pick two flows with no shape in common (The refund is not recorded and Courier pings are lost): the key says Nothing in common and no shape is outlined.
- [ ] Press **Swap**, then **X**: one canvas flips between the two, shapes both draw glide, new ones fade in and removed ones fade out, and the bar names both flows with the one on show marked. With reduced motion on, it cuts.
      The address ends in `/swap`.
- [ ] Note: **Note** opens an editor on the saved note; change it and **Save**: `flows/refund.yaml` has the new text under `compare: note:`. On two flows with no tag, type a note and press **Save as pair**: the strip names the flow that
      gets the tag, **Swap sides** changes it, **Save** writes it. Close the comparison with an unsaved note: it asks first. In an exported page the Note button is greyed out and its tooltip says "This page can't save".
- [ ] E on a copy of `docs/demo`: Compare is greyed out ("Not while editing"). Open a flow for editing: its form has **Compare with** with its partner shown, **Remove** asks first because there is a note, and a flow that tags it is listed under **Compared by**.
- [ ] Press **T**, pick Orders and pings, tested together: **Compare** is under the name (with no **Link with**), and **Compare** (or **C**) opens it beside Orders and pings, added (`#delivery/compare-runs/together/together-measured`), each pane with its own panel.
      **Show changes** is greyed out. Press **Edit**: the Performance tab lists the runs, and **Unlink** then **Link with** on Orders and pings writes and removes only `compare:` in `perf/together-measured.yaml`. In the showcase, Compare after is compared with Compare before, and **Show changes** marks all three kinds.

Editing (press E):

- [ ] Drag Mail service: `example/layout.yaml` appears, and the box stays put after a reload. The
      lines stay drawn the whole way, and so do they when you click a box or point at a line.
- [ ] Drag from Customer's dot onto Mail service: a line appears and its panel opens. Type a label
      and press Enter: the line shows it.
- [ ] In Shop, press Add, pick store, name it Cache and press Enter: the box appears with its form.
      Set Tech to Redis and press Tab: the box reads "Redis". Clear the name and press
      Enter: a notice says it was refused, and the name comes back.
- [ ] Rename Shop to Store and press Tab, then Ctrl+Z: it's Shop again, and "Undone." shows.
      Ctrl+Y: it's Store again, and "Redone." shows; Ctrl+Y again: "Nothing to redo." Rename it
      again, change the name in `example/model.yaml` by hand, then Ctrl+Z: the notice says it
      changed since, and your hand edit stays.
- [ ] Press N: the Add panel opens.
- [ ] Select API and press Delete: the Used by panel opens, with auth and orders as rows, and API is outlined in red. Click a row: the shapes
      it names are outlined. Press Esc: nothing changed. Press Delete again, then Enter twice: Remove all fills every row, the second
      Enter deletes, and one Ctrl+Z brings everything back. Select Cache and press Delete: it goes at once, and the notice has an Undo button.
- [ ] Select API, type `src/cli.ts` under Source and press Tab: `example/model.yaml` gets a
      `code` list with `src/cli.ts`. Clear the field and press Tab: `code` is gone.
- [ ] Press New flow, name it, click Customer then Web app, type a step and press Enter. Add a
      second step, move it up with ↑, delete it with ×. Leave edit mode and play the new flow.
- [ ] Open a flow in edit mode and open a step's Animation. Pick Call, then Rejected: the file gains `animation:` with `kind: call` and `outcome: rejected`, and Timeout stays
      a choice for a call only (dimmed, with "Needs a call", on a send). Type a reason and a share of 30; pick Intercepted and a shape, then Lost: the shape goes and the rest stays.
      Type 150 as the share: a notice says why and nothing is saved. Pick None: `animation` is gone. A step on one shape has every choice but None dimmed. Light and dark both read.
- [ ] Lines in edit mode: pick curved and `lines: curved` appears at the top of
      `example/model.yaml`. Ctrl+Z takes it away.
- [ ] In Shop, drag Web app away: the frame follows it. Press Tidy: Web app goes back and
      `example/layout.yaml` holds every box of `shop`. Ctrl+Z puts it where you dragged it.
- [ ] Press Tidy in Shop and in API, then zoom from one to a faded shape and back: the shape you left sits on the opposite side of the one you went to.
- [ ] Switch on Outside service on Customer: its tile goes grey with a cloud. Switch it off.
- [ ] In API's panel click Cylinder under Shape, Teal under Color, drag Opacity to 60 and pick an icon from the grid
      under Icon: each shows on the canvas as you pick it, and `shape`, `color`, `opacity` and `icon` appear for `api`
      in `example/model.yaml`. Click Default in each (the dashed swatch for Color): the keys go. Ctrl+Z walks them back.
      Type `bank` in the icon filter: only `building-bank` is left.

- [ ] In edit mode click Orders DB. Under Data type `- name: orders`, `  columns: [id, total]`, `  rows:` and `    - [o_1, 2490]` on four lines,
      then press Tab: the row sits on one line in `example/model.yaml`, and with edit mode off Orders DB's panel has a Data section with
      a table of two columns and one row. Type `- [a` in the Data box and press Tab: a notice says why and the text stays. Clear the box:
      the data is gone from the file. Ctrl+Z brings it back. API's form has no Data box.
- [ ] In edit mode click API. Under Code press Add code: an empty card appears and Add code greys out. Type a title and, in the code box,
      `SELECT id FROM orders WHERE status = 'placed'`, then press Tab: the card reads "Auto: SQL" and `snippets` is in
      `example/model.yaml` as a block of lines. With edit mode off API's panel has a Code section with the SQL in colour and a Copy button.
      Open the Language row and pick Go: `language: go` is in the file. Pick Auto: it goes. A fenced block under Description that starts with `` ```ts ``
      is coloured, and one with no language stays plain.

`git checkout example` puts the tracked files back. Delete `example/layout.yaml` and the new
flow's file by hand.

Sharing:

- [ ] Run `node src/cli.ts export --dir example --out example-site`, then
      `npx vite preview ui --outDir ../example-site --base /flowy/` and open
      http://localhost:4173/flowy/. The overview shows, with no Edit button, and E does nothing.
- [ ] Double-click Shop: the address ends in `#shop`. Play "Customer checks out": it ends in
      `#shop/checkout`. Press the browser's Back: the flow stops. Back again: the overview.
- [ ] Open http://localhost:4173/flowy/#api in a new tab: it opens inside API.
- [ ] In Shop, press Mermaid and paste into a GitHub comment preview: it draws Shop, with Customer
      and Mail service dashed. Play "Customer checks out" and press Mermaid: a sequence diagram.
- [ ] Export again: it replaces example-site. Add the `  shop: {}` line to `example/model.yaml`
      and export: it names model.yaml and the line, and example-site stays as it was. Undo the line.
