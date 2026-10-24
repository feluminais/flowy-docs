<h1 align="center">Flowy Docs</h1>

<p align="center">Architecture docs you zoom into, kept in your repo.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/feluminais/flowy-docs"></a>
  <a href="https://github.com/feluminais/flowy-docs/actions/workflows/ci.yml"><img alt="Tests" src="https://github.com/feluminais/flowy-docs/actions/workflows/ci.yml/badge.svg"></a>
</p>

<p align="center">
  <a href="docs/install.md"><strong>Install</strong></a>
  &nbsp; · &nbsp;
  <a href="https://feluminais.github.io/flowy-docs/">Demo</a>
  &nbsp; · &nbsp;
  <a href="docs/guide.md">Guide</a>
  &nbsp; · &nbsp;
  <a href="docs/format.md">File format</a>
  &nbsp; · &nbsp;
  <a href="https://github.com/feluminais/flowy-docs/issues">Issues</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/zoom-dark.webp">
    <img alt="The browser version on Plum, a food-delivery service: zooming into Ordering and Order API, back out, sideways to Delivery and into Dispatch, and out to the overview" src="docs/images/anim/zoom-light.webp">
  </picture>
</p>

Flowy Docs draws a system as shapes you zoom into: people, systems, apps, stores and components, the connections between
them, and step-by-step flows. Double-click a shape to open what is inside it. Esc takes you back to where you were, the breadcrumb takes you up, and a
faded shape beside you slides across instead. The model is plain YAML in a `flowy/` folder, so it goes through git and review
like the code it describes. You read it in the desktop app, a browser or VS Code, and you or an AI agent write it.

A Mermaid diagram in the repo stays a flat picture. Flowy plays flows as animation from the same YAML in a browser, the
desktop app and VS Code, and adds failure analyses and load-test replay to the diagram.

The animations are the browser version on Plum, a made-up delivery service whose model is in [docs/demo/flowy](docs/demo/flowy).

## Flows

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/flows-dark.webp">
    <img alt="Customer places an order, played one step at a time: a call, an event and a callback travel along the lines between shapes, then The payment is captured, with a retry and a branch" src="docs/images/anim/flows-light.webp">
  </picture>
</p>

Play a request one step at a time, and watch it travel along its lines: a send, a call that waits for its answer, an event, a callback.
A step can fail, and a group of steps can repeat, branch or run in parallel. Flows can be filed in folders and tagged, such as happy path or error path, so a long list stays easy to search. [More](docs/guide/flows.md)

## Performance

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/performance-dark.webp">
    <img alt="The Delivery view while a load test steps up from 100 to 1200 orders a minute: dots speed up along the lines, shape outlines go from green to red, and a click on Dispatch reads its numbers" src="docs/images/anim/performance-light.webp">
  </picture>
</p>

Put a load test's results in `flowy/perf/` and replay them on the diagram. Dots run along the lines, outlines go from green to
red as a shape fills up, and the panel says where the system first struggles. [More](docs/guide/performance.md)

## Failure modes

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/failures-dark.webp">
    <img alt="The Failures tab on the Ordering view: picking a mode outlines the part that fails and what it affects, and Show it plays the flow that tells it" src="docs/images/anim/failures-light.webp">
  </picture>
</p>

Rate how each part can fail on severity, likelihood and how hard it is to spot. The canvas badges the worst parts, outlines
what a mode touches and plays the flow that tells it. [More](docs/guide/failures.md)

## Compare

<p align="center">
  <img alt="Plum's refund flows side by side in the desktop app, with New, Removed and Changed outlines and a note under the panes" src="docs/images/desktop-compare.png" width="760">
</p>

Open a bug and its fix, an old flow and its replacement, or a slow run and a faster one in two panes, or swap one canvas between them. Show
changes outlines what is New, Removed or Changed, and a note says why. Tag the newer one with `compare:` to make a pair. [More](docs/guide/compare.md)

## Data

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/data-dark.webp">
    <img alt="Orders DB's panel: the orders table with sample rows and a note, then order_items and refunds opened" src="docs/images/anim/data-light.webp">
  </picture>
</p>

A store shows what it holds: tables as tables, with sample rows, a short note where a choice needs explaining, and how long
the data is kept. The rows are made up, and Flowy never connects to a database. [More](docs/guide/data.md)

## Edit

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/anim/edit-dark.webp">
    <img alt="Edit mode: a shape is added and given another shape, then a line is drawn from it to Orders DB and labelled" src="docs/images/anim/edit-light.webp">
  </picture>
</p>

Press **E** to draw lines, add shapes and restyle them from drawn pickers. Every save is checked, written as plain YAML and can
be undone, so git sees the same change whether you made it by hand or in the app. [More](docs/guide/canvas.md#edit-it)

## AI agents

An MCP server lets any MCP client, such as Claude Code, read the model and write it: shapes, lines, flows and failure analyses. Each
call is checked, so a change that would break the model is refused, and an open canvas redraws as the files change. From the
root of the repo you want to document:

```bash
claude mcp add flowy -- node /path/to/flowy-docs/dist/cli.js mcp
```

Another MCP client runs `node /path/to/flowy-docs/dist/cli.js mcp` over stdio. Then ask the agent to "map this repo into Flowy". [More](docs/guide/ai.md)

## Also

- **Source links.** A shape lists the files it lives in, and a path that no longer exists is reported. [More](docs/guide/canvas.md#read-it)
- **Share.** Export a read-only site, or copy a view as a Mermaid diagram for a README or a pull request. [More](docs/guide/share.md)
- **Search and history.** Ctrl+K finds a shape anywhere, and the YAML tab keeps every change to the files. [More](docs/guide/canvas.md#yaml-and-history)

## Install

There is no release yet, so both versions run from a clone. The browser version needs Node 22.18 or later:

```bash
git clone https://github.com/feluminais/flowy-docs
cd flowy-docs
npm install
npm run build
```

Then, from the root of the repo you want to read:

```bash
node /path/to/flowy-docs/dist/cli.js
```

To look at Plum first, run `node dist/cli.js --dir docs/demo/flowy` in the clone. The desktop app needs the .NET 10 SDK:
`dotnet run --project desktop/Flowy.App -- docs/demo` opens Plum, and **File › Open Folder** opens a repo. Installers will be on
[Releases](https://github.com/feluminais/flowy-docs/releases) once the first one is out. The VS Code extension, the other commands
(`check`, `export`, `mermaid`, `failures`) and updating are in [Install](docs/install.md).

> [!NOTE]
> Windows is where the desktop app has been built and tried. The macOS and Linux packages haven't been run, and none of them is signed yet.

## What a model looks like

This is Checkout from the demo, a component of Order API with a line to Stripe. You can write the files by hand too.

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

## Documentation

| Page | Covers |
| --- | --- |
| [Guide](docs/guide.md) | Everything the canvas does, and how editing, agents and sharing work |
| [Writing good Flowy docs](docs/writing.md) | What to put in a model, shape by shape |
| [File format](docs/format.md) | Every key of the YAML files |
| [Install](docs/install.md) | The desktop app, the browser version, the VS Code extension |
| [Shortcuts](docs/shortcuts.md) | Every key |
| [Security](SECURITY.md) | What Flowy touches, and how to report a problem |

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the build and the conventions, and [Maintaining](docs/maintaining.md) the rest. This repo
documents itself: open its own `flowy/` folder in the app, or run `node src/cli.ts`. Bug reports and feature requests go to
[Issues](https://github.com/feluminais/flowy-docs/issues).

Flowy Docs is written with AI coding agents, which is why most commits carry a `Co-Authored-By` line. Each change has to pass
the tests and checks in CONTRIBUTING.md.

## License

[MIT](LICENSE). The shape icons are from [Tabler Icons](https://tabler.io/icons), also MIT; their notice ships with the
canvas and the app.

Plum is made up. Stripe, Twilio and Mapbox appear in it as examples of outside services, and have no tie to Flowy Docs.
