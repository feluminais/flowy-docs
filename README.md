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

Flowy Docs is a map of your system that you can open up. People, services, apps and stores are shapes on a canvas, and
double-clicking one opens what is inside it, down to the components and the files they live in. Flows play a request across
the map one step at a time, and the same shapes carry load-test results, failure analyses and the data each store holds.

The model is plain YAML in a `flowy/` folder next to the code, so a change to the architecture is reviewed in the same pull
request as the code that changes it. Read it in the desktop app, a browser or VS Code. You can write the YAML by hand or in
the app, or ask an AI agent to map the repo. Any view copies out as a Mermaid diagram for a README or a pull request.

The animations show Plum, a food-delivery service whose model is in [docs/demo/flowy](docs/demo/flowy).

## Quick start

The browser version needs Node 22.18 or later. Build it and open Plum:

```bash
git clone https://github.com/feluminais/flowy-docs
cd flowy-docs
npm install
npm run build
node dist/cli.js --dir docs/demo/flowy
```

To read your own repo, run `node /path/to/flowy-docs/dist/cli.js` from its root. It creates the `flowy/` folder if the repo has
none. The desktop app, the VS Code extension and the other commands are in [Install](#install).

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

A store shows what it holds: its tables with a few sample rows, a short note where a design choice needs explaining, and how
long the data is kept, so a reader sees what a row looks like without opening the schema. [More](docs/guide/data.md)

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

There is no release yet, so every version runs from a clone (see [Quick start](#quick-start) for the browser version). The
desktop app needs the .NET 10 SDK: `dotnet run --project desktop/Flowy.App -- docs/demo` opens Plum, and **File › Open Folder**
opens a repo. Installers will be on [Releases](https://github.com/feluminais/flowy-docs/releases) once the first one is out.
The VS Code extension, the other commands (`check`, `export`, `mermaid`, `failures`) and updating are in [Install](docs/install.md).

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

Stripe, Twilio and Mapbox appear in Plum as examples of outside services and are trademarks of their owners.
