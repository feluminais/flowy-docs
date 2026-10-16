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
- Lines have no labels until you point at one. Click a box and its lines show theirs while the
  others fade.
- Faded, dashed boxes live elsewhere in the model. They show up because something here connects to
  them, and they wait around the edges (people above, the rest on both sides) while what's inside
  sits in the middle.
- A box can list the files and folders it lives in, under its description. When the repo's
  `origin` is on GitHub or GitLab, they link there.
- Ctrl+K or / (or Search) finds a box anywhere in the model by name. Pick one and the canvas
  opens the level it's on, with its panel open.
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
- Click a box to change its name, type, tech, description and code. A field saves when you leave
  it. Code takes one path per line, relative to the folder that holds `flowy/`. A path that
  doesn't exist shows up as a problem.
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

Claude can also note where each box lives in the code (`code: [src/api/]`). A path that doesn't
exist is refused, so the model can't quietly point at code that's gone. When code moves later,
the box gets a "!" until someone fixes the path.

Saving rewrites the file, so YAML comments in `model.yaml` and flow files aren't kept. Put
notes in an object's `description` instead.

## Share it

People without the repo can read the model too:

```bash
npx flowy-docs export
```

It writes a read-only copy of the canvas to `./flowy-site`, with the model inside its `index.html`.
Put the folder on any static host, such as GitHub Pages, and send the link. Browsers won't run it
straight from disk. To show it in Notion or Confluence, embed the link. `--dir` picks the model
folder and `--out` the export folder.

Export again after the model changes. Only what the export wrote is replaced, so a `.git` or a
`CNAME` you keep next to it stays. A folder with other files in it is left alone, and so is one
that holds the model. A file that can't be read stops the export. Problems don't: the page lists
them.

For a README or a pull request, the Mermaid button copies the view on screen (or the flow
playing) as a Mermaid diagram, fenced and ready to paste. GitHub and GitLab draw it. The same
from the command line, or for Claude through MCP (`get_mermaid`):

```bash
npx flowy-docs mermaid --view shop
```

`--flow <id>` prints a flow as a sequence diagram instead.

The address follows what's on screen. `#shop` is the inside of Shop, and `#shop/checkout` plays
the flow `checkout` there. Copy it to send someone straight to a level or a flow. The local canvas
does this too.

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
- [ ] Every zoom fits the whole diagram in the window, and doesn't open the side panel. Resize the
      window: it fits again.
- [ ] In Shop, lines have no labels. Hover one: its label shows. Click API: its lines show labels
      and the others fade. If the panel would cover the box you click, the view moves it aside.
- [ ] Hover API: after a moment its first paragraph appears under it. Click API: the side panel
      shows the whole description with its bullet list. Esc, ×, or a click on empty canvas closes it.
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes and line stay lit.
      → and ← move, the buttons match, Esc stops.
- [ ] In API, play "Customer signs in". Web app joins as a faded box, with a dashed line to Auth.
- [ ] In Shop, click the "2 connections" line: the panel lists both connections.
- [ ] From the overview, press / and type `au`: "Auth component in API" is listed. Press Enter: the
      canvas opens API with Auth selected and its panel open. Ctrl+K and `zzz`: "Nothing called
      that." Esc closes the search and leaves the panel open.
- [ ] Rename Shop in `example/model.yaml` and save: the page updates without a reload.
- [ ] Add a line `  shop: {}` right under `objects:` and save: a banner names model.yaml and the
      line, and Edit greys out. Undo it: the banner goes.
- [ ] Add `  floating: { type: app, name: Floating }` right under `objects:`: "1 problem" appears
      and Floating has a "!". Pick the problem: Floating's panel shows it.
- [ ] Add `    code: [src/cli.ts, nope/]` under `api:`. "1 problem" names `nope/`. API's panel lists
      both paths, as links to github.com/feluminais/flowy-docs on the current branch. Undo it.
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
- [ ] Select API, type `src/cli.ts` in Code and press Tab: `example/model.yaml` gets a
      `code` list with `src/cli.ts`. Clear the field and press Tab: `code` is gone.
- [ ] Press New flow, name it, click Customer then Web app, type a step and press Enter. Add a
      second step, move it up with ↑, delete it with ×. Leave edit mode and play the new flow.

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
