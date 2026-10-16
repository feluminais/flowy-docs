# Flowy Docs

Architecture docs you zoom through instead of scrolling through. An open-source take on IcePanel.

Your architecture lives as YAML in your repo, in a `flowy/` folder: systems, apps, stores and
components, the connections between them, and step-by-step flows. Readers start at the big
picture and zoom in only where they need to. Draw it on the canvas, let Claude write it, or both.

Needs Node 22.18 or later.

## Open it

From the root of the repo you want to document:

```bash
npx flowy-docs
```

It prints a local address (port 4321, or the next free one) and opens it in your browser. The
model lives in `./flowy`, which is created on the first save. `--dir <folder>` uses another
folder, `--port <number>` picks the port, and `--no-open` skips the browser.

## Read it

- Double-click a box drawn as a stack to zoom into it. The breadcrumb or Backspace zooms out.
- Hover a box for its short description. Click it for the full text. Click a line to see the
  connections it stands for.
- Faded, dashed boxes live elsewhere in the model. They show up because something here connects to them.
- Pick a flow in the top bar to play it step by step: ← and → move, Esc stops.
- "N problems" in the top bar lists what's wrong in the files. Pick one to jump to it. Boxes with
  a problem carry a "!".

The page follows the files: when Claude or your editor changes them, it updates by itself.

## Edit it

Press E, or the Edit button.

- Drag boxes to arrange the view. Positions go to `flowy/layout.yaml`.
- Drag from the dot under a box onto another box to connect them, then type a label in the panel.
- Add puts a box in the current view. It offers only the types that fit there: actors and
  systems at the top, apps and stores inside a system, components inside an app or store.
  Double-click an empty system, app or store to open it and add what goes inside.
- Click a box to change its name, type, tech and description. A field saves when you leave it.
- Delete (the key, or the button in the panel) removes the selected box or line. A box that still
  contains others, or that a flow uses, stays, and a notice says why.
- New flow records a walkthrough: name it, click the box where a step starts and the box it goes
  to, type what happens and press Enter. Repeat. ↑, ↓ and × reorder and delete steps. "Edit a
  flow" opens one you already have.

Every save goes through the same checks as Claude's edits: a change that would add a problem is
refused, and nothing is written. If a file changed on disk in the meantime, the save is dropped
and the page reloads. Git keeps the history.

## Let Claude build it

From the root of the repo you want to document:

```bash
claude mcp add flowy -- npx flowy-docs mcp
```

Then ask Claude something like "map this repo into Flowy". It writes `flowy/model.yaml` and
`flowy/flows/*.yaml`, and refuses any change that would break the model. Add `--dir <folder>`
after `mcp` to keep the files somewhere other than `./flowy`.

Saving rewrites the file, so YAML comments in `model.yaml` and flow files aren't kept. Put
notes in an object's `description` instead.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run build
```

`npm run build` puts the canvas in `dist/ui` and the server in `dist/`. In a clone,
`node src/cli.ts` does what `npx flowy-docs` does, once `npm run build:ui` has built the canvas.

To work on the canvas with hot reload, run Flowy on the example model, then Vite, and open
http://localhost:5173:

```bash
node src/cli.ts --dir example --no-open
npm run dev:ui
```

### Canvas checklist

There are no automated UI tests. Before merging a canvas change, run
`npm run build:ui && node src/cli.ts --dir example` and check:

Reading:

- [ ] The overview shows Customer, Shop and Mail service. Double-click Shop: the breadcrumb reads
      Overview › Shop, and Customer and Mail service are faded and dashed.
- [ ] Double-click API, then press Backspace twice: you're back at the overview. Clicking the
      breadcrumb works too.
- [ ] Hover API: after a moment its first paragraph appears under it. Click API: the side panel
      shows the whole description with its bullet list. Esc, ×, or a click on empty canvas closes it.
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes and line stay lit.
      → and ← move, the buttons match, Esc stops.
- [ ] In API, play "Customer signs in". Web app joins as a faded box, with a dashed line to Auth.
- [ ] In Shop, click the "2 connections" line: the panel lists both connections.
- [ ] Rename Shop in `example/model.yaml` and save: the page updates without a reload.
- [ ] Add a line `  shop: {}` right under `objects:` and save: a banner names model.yaml and the
      line, and Edit greys out. Undo it: the banner goes.
- [ ] Add `  floating: { type: app, name: Floating }` right under `objects:`: "1 problem" appears
      and Floating has a "!". Pick the problem: Floating's panel shows it.
- [ ] Stop flowy: a banner says the connection is lost. Start it again: the banner goes.

Editing (press E):

- [ ] Drag Mail service: `example/layout.yaml` appears, and the box stays put after a reload.
- [ ] Drag from Customer's dot onto Mail service: a line appears and its panel opens. Type a label
      and press Enter: the line shows it.
- [ ] In Shop, press Add, pick store, name it Cache and press Enter: the box appears with its form.
      Set Tech to Redis and press Tab: the box reads "store · Redis". Clear the name and press
      Enter: a notice says it was refused, and the name comes back.
- [ ] Select API and press Delete: the notice says it still contains auth and orders. Select
      Cache and press Delete: it goes.
- [ ] Press New flow, name it, click Customer then Web app, type a step and press Enter. Add a
      second step, move it up with ↑, delete it with ×. Leave edit mode and play the new flow.

`git checkout example` puts the tracked files back. Delete `example/layout.yaml` and the new
flow's file by hand.
