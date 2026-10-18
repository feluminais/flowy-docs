<h1 align="center">Flowy Docs</h1>

<p align="center">Architecture docs you zoom through instead of scrolling through.</p>
<p align="center">Desktop app for Windows &nbsp; · &nbsp; Browser version for Windows, macOS and Linux (Node 22.18+) &nbsp; · &nbsp; MIT</p>
<p align="center">Your architecture lives as YAML in your repo. Open it in the app, let Claude write it, or draw it on the canvas.</p>

<p align="center">
  <a href="#get-it"><strong>Get it</strong></a>
  &nbsp; · &nbsp;
  <a href="docs/guide.md">Guide</a>
  &nbsp; · &nbsp;
  <a href="https://github.com/feluminais/flowy-docs/issues">Report an issue</a>
  &nbsp; · &nbsp;
  <a href="CONTRIBUTING.md">Build &amp; contribute</a>
</p>

![The overview of Plum, a food-delivery service, in the Flowy Docs app: customers, restaurants, couriers and support agents, four systems and three outside services](docs/images/desktop-overview.png)

Readers start at the big picture and open only the box they care about. The model is plain YAML in a `flowy/` folder:
people, systems, apps, stores and components, the connections between them, and step-by-step flows. It sits in git next
to the code it describes.

The screenshots show Plum, a made-up delivery service, in the desktop app. Its model is in [docs/demo/flowy](docs/demo/flowy).

What to write in it, box by box, is in [Writing good Flowy docs](docs/writing.md).

## Get it

**The desktop app** is the way to read a model. Download the installer for your system from
[Releases](https://github.com/feluminais/flowy-docs/releases), start it, and open a repo with **File › Open Folder**
(Ctrl+O). It finds the repo's `flowy/` folder, draws it, and redraws it whenever a file changes. No repo handy? **Help ›
Open the Demo** shows Plum.

**The browser version** reads too, and it is where you edit by hand. From the root of the repo:

```bash
npx flowy-docs
```

The app only reads. To change a model, ask Claude ([below](#let-claude-build-it)) or [edit it in the browser](#edit-it), and
the app shows each save as it happens.

## Zoom in

![Inside Ordering: a frame wraps its apps and stores, and faded dashed boxes around it are what they connect to](docs/images/desktop-zoom.png)

Boxes show their type as a coloured icon, and a box that holds others says how many ("7 inside"). Double-click it, or
select it and press Enter, to zoom in. A frame named after the box wraps what's inside, and the faded dashed boxes
around it are what something inside connects to. Esc, Backspace or the breadcrumb zoom back out. A faded box that
opens sits beside you rather than inside, so opening it slides across instead.

| Type | What it is | Lives |
| --- | --- | --- |
| Actor | A person or role | At the top |
| System | Something you build or use | At the top, and holds apps and stores |
| App | A service, a mobile app, a website | Inside a system, and holds components |
| Store | A database, a cache, a queue | Inside a system, and holds components |
| Component | A part of an app or store | Inside an app or a store |

Outside services you don't own (a payment provider, an SMS gateway) are marked `external: true` and show grey with a cloud.

## Details on demand

![Order API's panel with its description, the folder it lives in, and every connection out, one of them opened to list five](docs/images/desktop-panel.png)

Hover a box for its short description. Click it for the full text, the files it lives in, and every connection out and
in. A line that stands for several connections opens to list them, and pointing at a row lights its line on the canvas.
Lines show their labels when you point at one, or when you select a box.

A box can list the files and folders it lives in. When the repo's `origin` is on GitHub or GitLab they link there, and a
path that doesn't exist shows up as a problem, so the model can't quietly point at code that's gone.

## Flows

![A flow playing: Customer app to Order API is lit, and a card says what happens and has a More with the detail](docs/images/desktop-flow.png)

Pick a flow in the top bar to play it step by step. A step is one box handing something to another, or one box doing
something on its own, and a step with more to say has a **More**. In the browser the address follows what's on screen, so
`#ordering/place-order` plays Customer places an order; send it to someone and they land on the same step.

## Find anything

![Search open with "re" typed: Restaurant, Refunds in Order API, and Data warehouse in Back office](docs/images/desktop-search.png)

**Ctrl+K** or **/** finds a box anywhere in the model by name. Pick one and the canvas opens the level it's on, with its
panel open.

## Let Claude build it

From the root of the repo you want to document:

```bash
claude mcp add flowy -- npx flowy-docs mcp
```

Then ask Claude something like "map this repo into Flowy". It writes `flowy/model.yaml` and `flowy/flows/*.yaml`, points
each box at the code it lives in, marks outside services, and refuses any change that would break the model. Keep the
model open in the app, and it updates by itself as Claude saves.

You can write the files by hand too. This is Checkout from the demo:

```yaml
objects:
  checkout:
    type: component
    in: order-api
    name: Checkout
    code: [services/order-api/src/checkout.ts]
    description: Prices the basket, authorises the card and places the order.
connections:
  - { from: checkout, to: stripe, label: holds the card }
```

Saving rewrites a file, so YAML comments aren't kept. Put notes in a box's `description` instead.

## Edit it

![Edit mode in the browser: the toolbar with New flow, Add, Undo, Redo and Tidy, dots under each box to connect it, and a box's fields in the panel](docs/images/edit.png)

Editing happens on the browser canvas: run `npx flowy-docs`, then press **E**, or the Edit button.

- Drag boxes to arrange a view. Positions go to `flowy/layout.yaml`.
- Drag from the dot under a box onto another box to connect them, then type a label.
- **Add** offers only the types that fit where you are: actors and systems at the top, apps and stores inside a system, components
  inside an app or store.
- Click a box to change its name, type, tech, description and code. A field saves when you leave it.
- **Tidy** forgets where boxes were dragged and lays the view out again with as few crossing lines as it finds.
- **New flow** records a walkthrough: click the box where a step starts and the box it goes to, type what happens, press
  Enter, repeat.

Every save goes through the same checks as Claude's edits: a change that would add a problem is refused, and nothing is
written. **Ctrl+Z** takes back your last change, **Ctrl+Y** puts it back. Git keeps the history.
[The guide](docs/guide.md#edit-it) has the rest.

## Share it

People without the repo can read the model too:

```bash
npx flowy-docs export
```

It writes a read-only copy of the canvas to `./flowy-site`. Put the folder on any static host, such as GitHub Pages, and
send the link. Embed the link to show it in Notion or Confluence.

For a README or a pull request, the app's **View › Copy as Mermaid** (the browser's **Mermaid** button) copies the view on
screen, or the flow playing, as a Mermaid diagram that GitHub and GitLab draw. **View › Save Picture** saves the diagram as a
PNG. This is Customer places an order, from `npx flowy-docs mermaid --flow place-order`:

```mermaid
sequenceDiagram
  actor n0 as Customer
  participant n1 as Customer app
  participant n2 as Order API
  participant n3 as Stripe
  participant n4 as Orders DB
  participant n5 as Order events
  participant n6 as Delivery
  participant n7 as Kitchen tablet
  n0->>n1: Fills a basket and taps Place order
  n1->>n2: POST /orders with the basket
  n2->>n3: Holds the amount on the card
  n2->>n4: Saves the order as placed
  n2->>n5: Announces the order
  n5->>n6: Dispatch starts looking for a courier
  n2->>n7: The restaurant's tablet rings
```

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+K or / | Find a box |
| Enter | Open the selected box |
| Esc | Close what's open, then go up a level |
| Backspace | Go up a level |
| F | Fit the view |
| ← → | Previous and next step of the flow playing |
| Home, End | First and last step |
| Ctrl+O, F5 | Open a folder, reload it (app) |
| E | Edit mode on and off (browser) |
| N | Add a box (browser) |
| Ctrl+Z, Ctrl+Y | Undo and redo (browser) |
| ? | List every shortcut |

## The desktop app

It is a native reader, not a browser in a window: it reads a repo's `flowy/` folder itself and draws it with its own renderer
(Avalonia, on .NET), so there is no server behind it. It shows what the canvas shows, from zooming through the levels to the
side panel, flows, search and problems, in light or dark, and it reloads when the files change. A file that breaks keeps the
last good model on screen, with the file and line in a banner.

- **File › Open Folder** (Ctrl+O), a folder dropped on the window, or **Open Recent**. Give it a repo and it opens the repo's
  `flowy/` folder. A folder with no model is refused with a message, and the app never creates files in your repo.
- One window per model, and the window opens at the size you left it. Opening a model that's already open brings it forward, and
  `FlowyDocs.exe path\to\repo` from a terminal opens the folder in the app that's already running.
- On Windows, right-click a folder (under *Show more options* on Windows 11) and choose **Open with Flowy Docs**.
- **View › Copy as Mermaid** and **Save Picture…** for READMEs and pull requests. **File › Reload** (F5) reads the folder again,
  and **Show in Explorer** opens it.

Windows is where it has been built and tried. The macOS and Linux packages are built by the same workflow but haven't been run.
None of them is signed yet, so Windows shows SmartScreen the first time, and the macOS app needs right-click, then Open, and
doesn't update itself.

## The browser version

From the root of the repo you want to document:

```bash
npx flowy-docs
```

It prints a local address (port 4321, or the next free one) and opens it in your browser. The model lives in `./flowy`,
which Flowy creates if it's missing. `--dir <folder>` uses another folder, `--port <number>` picks the port, and
`--no-open` skips the browser. Needs Node 22.18 or later. It does everything the app does, plus editing, the Mermaid button
and `export`.

<details>
<summary>Not on npm? Run it from a clone</summary>

`flowy.sh` (macOS, Linux, Git Bash) or `flowy.cmd` (Windows) does the same with the same flags. Run it from the repo
you want to document. The first run installs and builds, which takes a moment. After a `git pull`, delete `dist/` to
rebuild.

```bash
/path/to/flowy-docs/flowy.sh
```

</details>

<details>
<summary>Is it safe to run?</summary>

Flowy runs on your machine and touches only its model folder.

- The browser version listens on 127.0.0.1, so other computers can't reach it. It refuses a request whose Host isn't
  `127.0.0.1` or `localhost` on its own port, and it saves only when a request carries a header that a web page open in
  another tab can't send. A website can't change your files through it.
- Saving, from the canvas or from Claude, writes `model.yaml`, `layout.yaml` and `flows/*.yaml` in the model folder and
  nothing else. `export` writes only to its output folder. The desktop app never writes into a model folder at all.
- It never opens your code. For `code:` paths it checks that they exist, and it runs `git` with fixed arguments to read
  the `origin` URL and the branch for the links.
- It makes no network requests of its own: no telemetry, no CDN, no fonts. The page talks only to its local server.
  The desktop app adds one: a few seconds after it starts, an installed copy asks GitHub's Releases whether a newer version
  exists, and **Help › Check for updates automatically** turns that off. It fetches no remote images from descriptions (they show
  as their description in brackets), opens a link only if it is an `http` or `https` address and shows where a link goes when
  you point at it, and keeps its recent folders, window size and line-style pick in `state.json` in its own folder under your
  application data.
- Through `npx flowy-docs mcp`, Claude gets nine tools: three read the model and six change its objects, connections and
  flows. None runs a command or reads a file outside the model folder.

Treat a `flowy/` folder you didn't write like any other text from that repo. In the browser, descriptions are Markdown and
can embed images, which your browser then fetches from wherever they point, and Claude reads the descriptions back through MCP.

</details>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, the conventions and the checklist to run through before changing
the canvas or the app. This repo documents itself: open its own `flowy/` folder in the app, or run `node src/cli.ts`. Bug
reports and feature requests go to [Issues](https://github.com/feluminais/flowy-docs/issues).

## License

[MIT](LICENSE). The box icons are from [Tabler Icons](https://tabler.io/icons), also MIT; their notice ships with the
canvas and the app.

Plum is made up. Stripe, Twilio and Mapbox appear in it as examples of outside services, and have no tie to Flowy Docs.
