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

## Canvas checklist

The logic behind the canvas (layout, keys, saving) has tests, but nothing drives the canvas itself.
Before merging a canvas change, run `npm run build:ui && node src/cli.ts --dir example` and check
the items it could affect. A change to the side panel doesn't need the sharing items, for example.

Reading:

- [ ] The overview shows Customer, Shop and Mail service, each with a coloured icon tile. Mail
      service is grey with a cloud and reads "external", and Shop says "3 inside". Double-click Shop:
      the view zooms into it, the breadcrumb reads Overview › Shop, a frame labelled Shop wraps Web
      app, API and Orders DB, and Customer and Mail service are faded and dashed outside it.
- [ ] Double-click API, then press Backspace twice quickly: it zooms back out to the overview.
      Clicking the breadcrumb works too. The zoom buttons in the corner don't move while it zooms.
- [ ] Click Shop and press Enter: it zooms in. Double-click API, click Auth (its panel opens),
      then press Esc three times: the panel closes, then it zooms out to Shop, then to the
      overview. Esc again does nothing. Tab moves the focus between boxes, and Enter opens the
      focused one.
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
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes and line stay lit.
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
