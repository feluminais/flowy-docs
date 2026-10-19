# Contributing

Flowy Docs is TypeScript. The server, CLI and MCP server are in `src/node`. Logic that must not touch
Node or the DOM is in `src/core`: its tsconfig has no types, so the typecheck fails if it does. The
canvas is in `ui/` (React and React Flow). Tests are in `test/` and use Node's own runner.

## Before you send a change

```bash
npm install
npm test
npm run typecheck
```

Commit messages follow the existing style: `feat(ui): ...`, `fix: ...`, `docs: ...`.

This repo documents itself: `flowy/` is Flowy Docs' own architecture, and `node src/cli.ts` opens it
(after `npm run build:ui`). If a change adds, moves or removes a box, a connection or a flow, update
`flowy/` in the same change. Every `code:` path in it has to exist, so the canvas shows no problems.

## Run it from source

`npm run build` puts the canvas in `dist/ui` and the server in `dist/`. In a clone, `node src/cli.ts` does what
`npx flowy-docs` does, once `npm run build:ui` has built the canvas.

To work on the canvas with hot reload, run Flowy on the example model, then Vite, and open http://localhost:5173:

```bash
node src/cli.ts --dir example --no-open
npm run dev:ui
```

`docs/demo/` is Plum, the made-up delivery service in the README's screenshots. `node src/cli.ts --dir docs/demo/flowy`
opens it. Its `code:` paths point at placeholder files beside it, so the canvas shows no problems. Its `flowy/perf/` holds
two load-test runs with made-up numbers (a dinner rush where Delivery's ETA runs out of Mapbox calls at 900 orders a minute, and
the same test after a fix); they name shapes and connections of the model, so a rename there is a run problem. The screenshots in
`docs/images/desktop-*.png` are the desktop app on that model in the light theme, 1200 by 760 (1280 by 760 for the performance one) at twice the pixel
density, taken with `--shot` (below): `docs/demo --shot out.png --scale 2 --size 1200x760 --theme light`, plus `--view ordering` for the zoom,
`--view ordering --select order-api` for the panel, `--edit` on top of that for the edit one, `--view ordering --flow place-order --step 1` for the flow, `--view ordering --flow capture-payment --step 4` for the one with groups,
and `--search re` for the search. Retake them when the app changes how it looks.

## The VS Code extension

`vscode/` is an extension that opens a repo's `flowy/` folder in a panel inside VS Code (command `Flowy: Open Docs`). It has its own
`package.json` and `npm install`, and it reuses `src/core`, `src/node/files.ts` and the built canvas: `npm run build:vscode` builds
the canvas, bundles the extension into `vscode/dist` and copies the canvas to `vscode/media`. To try it, open the `vscode/` folder in
VS Code and press F5; the new window opens this repo, so `Flowy: Open Docs` shows the model you're reading now. The panel is read-only so far.
A change to `ui/` shows after `npm run build:vscode` and closing and reopening the panel; a change to `vscode/src` also needs
`Developer: Reload Window` in the new window.

`test/vscode-page.test.ts` covers the page the extension builds (the policy that lets only the canvas script run, the state inlined).
What happens inside VS Code (the webview loading, the theme, the Mermaid copy) has no test: check it in the window.

## The performance lab

`perf-lab/` is a made-up shop that really runs, and a load generator that measures it and writes the runs the Performance tab
reads (`flowy/perf/*.yaml`). `npm run lab:run` makes a run in about two and a half minutes, `npm run lab:smoke` checks the harness in
under half a minute (it starts real servers, so `npm test` leaves it out), and `node src/cli.ts --dir perf-lab/flowy` opens
the lab. Its [README](perf-lab/README.md) says what each part is and what to keep in mind reading the numbers.

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

```bash
dotnet test desktop                                                        # all of it
dotnet run --project desktop/Flowy.App -- docs/demo                        # open a repo in the app
dotnet run --project desktop/Flowy.App -- docs/demo --shot out.png         # save a picture of the window and exit (--scale 2 for twice the size, --picture for the diagram alone)
```

`--shot` takes flags that set up what the picture shows: `--view ordering`, `--select order-api`, `--line "web order-api"`,
`--hover "web order-api"`, `--flow place-order --step 1`, `--search re`, `--shortcuts`, `--zoom ordering --delay 200` (a frame of the
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
      view slides across instead of zooming in.
- [ ] `dotnet run --project desktop/Flowy.App -- perf-lab` (or `-- perf-lab --view shop --tab performance --shot out.png`): the right rail has a Performance
      button under Details with a 2 on it, and T opens its panel (in Details' place) on the load where the Fulfilment worker first struggles
      (200 req/s on the ramp). In Shop lab, shapes that carry numbers are outlined from green to red along their own outline, Order queue
      carries a number but no colour, busy lines are thicker with more dots, and Catalog cache and Payment gateway stay plain. ← → Home End
      move between loads; P ramps up (from the top it starts again from the bottom) and a click on the slider stops it; a picked shape or
      line reads out its numbers; under the chart a key draws a blue line (Expected call), an amber one (Slowest 5%) and red dashes (First
      struggles), and the Key at the bottom draws each mark it names (Busy, Waiting, Not measured, a call, a failing call, More calls) with no
      sentences; Esc closes the panel, and the Details button swaps Details back in. With animation effects off there
      are no dots and no Ramp button, and the outlines, thickness, numbers and strip still show. Light and dark both read.
- [ ] Click Order API: its panel opens and the view moves it out from under the panel. Click a name in the panel's Out list: the panel
      switches. Open "5 connections": each label shows. Point at a row: its line lights up on the canvas.
- [ ] Pick "Customer places an order" in Ordering: ← and → step, Home and End jump, Esc stops, and the player card shows "More".
- [ ] Ctrl+K, type `re`: Restaurant, Refunds in Order API and Data warehouse in Back office. Enter opens Refunds' panel in its view.
- [ ] Open `desktop/fixtures/cases/problems/flowy` (or its repo): "34 problems" in the bar, "!" on boxes, a click on a problem goes to it.
- [ ] Save `example/model.yaml` with a new box name while the app is open: it appears without a reload. Add a line `<<<<<<<` and
      save: a banner names the file and line, and the last good model stays.
- [ ] File › Open Recent lists what you opened; dropping a folder from Explorer opens a window; opening the same folder twice brings
      the first window forward; `FlowyDocs.exe <folder>` from a terminal opens it in the running app, not a second one.
- [ ] With the system's animation effects off (Settings › Accessibility › Visual effects), opening a box is instant. With them on, it
      is smooth: no stutter on the way in or out, and a second double-click during the move doesn't break it.
- [ ] Help › Open the Demo shows Plum with no problems and a Performance button with a 2 on it; T opens the panel on 900 orders/min,
      "ETA at 90% of capacity", with Delivery outlined red. View › Copy as Mermaid, pasted into an editor, starts with `` ```mermaid ``;
      View › Save Picture… writes a PNG of the diagram alone. An empty `model.yaml` says "Nothing to show yet".
- [ ] Close a window after resizing it, open the app again: it opens at that size.
- [ ] Delete the open `flowy/` folder: a banner says it is gone. Put it back and open it again: the model returns.
- [ ] Edit on a copy of `docs/demo` (the sample inside the app can't be edited): E turns edit mode on; rename a box in its panel and click
      elsewhere; add a box with N; drag a box and a second one; draw a connection from the dot under one box onto another and type a label;
      record a flow with two clicks and a line of text per step. Ctrl+Z walks it all back, Ctrl+Y forward. Open the same folder in the
      browser (`npx flowy-docs --dir <copy>`): it shows the same, and `git diff` shows only the lines you changed.
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
- [ ] In edit mode, drag a box and press Esc (then try Backspace on another drag): the box goes back and the level stays; the next press goes
      up. A click in between, or a second edit, turns that off. In the app, press Esc while still holding a drag: the box returns, nothing is saved.
      Clicking the breadcrumb works too. The zoom buttons in the corner don't move while it zooms.
- [ ] Click Shop and press Enter: it zooms in. Double-click API, click Auth (its panel opens),
      then press Esc three times: the panel closes, then it zooms out to Shop, then to the
      overview. Esc again does nothing. Tab moves the focus between boxes, and Enter opens the
      focused one.
- [ ] Add `  smtp: { type: app, name: SMTP, in: mail }` right under `objects:`, so Mail service
      opens. Inside Shop, double-click the faded Mail service: the view slides sideways, away from
      it, instead of zooming in. Esc: it zooms out to the overview. Undo the line.
- [ ] Zoom in with the wheel and press F: the whole view fits again. Press ?: the shortcut list
      opens; Esc closes it.
- [ ] Inside API, Auth, Orders and Mail service sit in a row with Orders DB below them, and no
      line runs through a box.
- [ ] With the system's reduce-motion setting on (Windows: Settings › Accessibility › Visual
      effects › Animation effects off), opening and closing a box is instant.
- [ ] Lines: pick curved, then right-angled. In API every line follows, labels still show on hover,
      and a reload keeps your pick. "Project default" goes back to straight, and
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
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes stay lit, with a blue border, and its line is bold and drawn over the faded boxes. Customer, outside Shop, lights up fully in step 1.
      → and ← move, End and Home jump to the last and first step, the buttons match, Esc stops
      (and a second Esc zooms out). Step 3 lights API alone, with no line, and its
      More shows a paragraph with **Orders DB** in bold.
- [ ] In API, play "Customer signs in". Web app joins as a faded box, with a dashed line to Auth.
- [ ] In Shop, click the "2 connections" line: the panel lists both connections.
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

Performance (`npm run build:ui && node src/cli.ts --dir perf-lab/flowy`):

- [ ] The right rail has a Performance button under Details with a 2 on it, and T opens its panel (in Details' place) on the load where the Fulfilment worker first struggles (200
      req/s on the ramp), with `#shop/perf/ramp/4` in the address. In Shop lab, shapes that carry numbers are outlined from green to red
      along their own outline (SQLite's cylinder, Upload folder's folder, the boxes of Web API and the worker), Order queue carries a
      number but no colour, busy lines are thicker and carry more dots, and Catalog cache (a hexagon with no numbers) and Payment gateway
      stay plain. Under the chart, a blue line reads Expected call, an amber one Slowest 5% and red dashes First struggles; the Key at the
      bottom draws each mark it names. ← → move between loads, Home and End jump (Home gives `#shop/perf/ramp/0`), and the address follows. Esc closes the
      panel; Back closes it too if you opened it with T (after Esc, Back opens it again). With Explorer open on the left as well, both
      panels show and the diagram still fits; the Details button swaps Details back in, and Esc closes whichever is showing.
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
- [ ] Press E with the Performance panel open: it closes and the button leaves the rail; E again brings the button back. Open
      `#shop/perf/ramp/2` in a new tab: it opens on that load. With the system's reduce-motion setting on there are no dots, no Ramp
      button and no easing between loads, and the outlines, thickness, badges and numbers still show. Light and dark both read.

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
- [ ] Select API and press Delete: the notice says it still contains auth and orders. Select
      Cache and press Delete: it goes.
- [ ] Select API, type `src/cli.ts` in Code and press Tab: `example/model.yaml` gets a
      `code` list with `src/cli.ts`. Clear the field and press Tab: `code` is gone.
- [ ] Press New flow, name it, click Customer then Web app, type a step and press Enter. Add a
      second step, move it up with ↑, delete it with ×. Leave edit mode and play the new flow.
- [ ] Lines in edit mode: pick curved and `lines: curved` appears at the top of
      `example/model.yaml`. Ctrl+Z takes it away.
- [ ] In Shop, drag Web app away: the frame follows it. Press Tidy: Web app goes back and
      `example/layout.yaml` loses `shop`. Ctrl+Z puts it where you dragged it. Tidy again with
      nothing dragged: a notice says there's nothing to tidy.
- [ ] Tick "Outside service" on Customer: its tile goes grey with a cloud. Untick it.

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
