# Flowy Docs

Architecture docs you zoom through instead of scrolling through. An open-source take on IcePanel.

Your architecture lives as YAML in your repo, in a `flowy/` folder: systems, apps, stores and
components, the connections between them, and step-by-step flows. Readers start at the big
picture and zoom in only where they need to.

**Status:** early. The model, the MCP server and a read-only canvas work. Editing on the canvas
comes next.

## Let Claude build it

Clone this repo and run `npm install` in it (needs Node 22.18 or later). Then, from the root of
the repo you want to document:

```bash
claude mcp add flowy -- node "<path to this repo>/src/cli.ts" mcp
```

Then ask Claude something like "map this repo into Flowy". It writes `flowy/model.yaml` and
`flowy/flows/*.yaml`, and refuses any change that would break the model. Add `--dir <folder>`
after `mcp` to keep the files somewhere other than `./flowy`.

Saving rewrites the file, so YAML comments in `model.yaml` and flow files aren't kept. Put
notes in an object's `description` instead.

## Read it

Build the canvas once in this repo (and again after you pull changes):

```bash
npm run build:ui
```

Then, from the root of the documented repo:

```bash
node "<path to this repo>/src/cli.ts"
```

It prints a local address (port 4321, or the next free one) and opens it in your browser.
`--dir <folder>` reads another folder, `--port <number>` picks the port, and `--no-open` skips
the browser.

- Double-click a box drawn as a stack to zoom into it. The breadcrumb or Backspace zooms out.
- Hover a box for its short description. Click it for the full text.
- Faded, dashed boxes live elsewhere in the model. They show up because something here connects to them.
- Pick a flow in the top bar to play it step by step: ← and → move, Esc stops.

The page follows the files: when Claude or your editor changes them, it updates by itself.

## Develop

Needs Node 22.18 or later.

```bash
npm install
npm test
npm run typecheck
```

To work on the canvas with hot reload, run Flowy on the example model, then Vite, and open
http://localhost:5173:

```bash
node src/cli.ts --dir example --no-open
npm run dev:ui
```

### Canvas checklist

There are no automated UI tests. Before merging a canvas change, run
`npm run build:ui && node src/cli.ts --dir example` and check:

- [ ] The overview shows Customer, Shop and Mail service. Double-click Shop: the breadcrumb reads
      Overview › Shop, and Customer and Mail service are faded and dashed.
- [ ] Double-click API, then press Backspace twice: you're back at the overview. Clicking the
      breadcrumb works too.
- [ ] Hover API: after a moment its first paragraph appears under it. Click API: the side panel
      shows the whole description with its bullet list. Esc, ×, or a click on empty canvas closes it.
- [ ] In Shop, play "Customer checks out". Only the current step's two boxes and line stay lit.
      → and ← move, the buttons match, Esc stops.
- [ ] In API, play "Customer signs in". Web app joins as a faded box, with a dashed line to Auth.
- [ ] Rename Shop in `example/model.yaml` and save: the page updates without a reload.
- [ ] Add a line `  shop: {}` right under `objects:` and save: a banner names model.yaml and the
      line. Undo it: the banner goes. (`git checkout example` puts the file back.)
- [ ] Stop flowy: a banner says the connection is lost. Start it again: the banner goes.
