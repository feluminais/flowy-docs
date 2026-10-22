# Flowy Docs guide

What every part of Flowy does, one page for each part. Read the page for the part you need and no others. The examples come from Plum, a made-up delivery service whose model is in [`docs/demo/flowy`](demo/flowy).

| Page | Covers | Read it when |
| --- | --- | --- |
| [The canvas](guide/canvas.md) | Zooming, panels, search, editing, the YAML tab and history | Using or changing how the canvas reads or edits |
| [Shapes, colour and icons](guide/shapes.md) | Which shape, colour, opacity and icon a box takes | Choosing a look other than the type's default |
| [Flows](guide/flows.md) | How a request ends, repeats, branches, parallel steps, shape states | Writing a flow beyond plain steps |
| [Data](guide/data.md) | What a store holds | Showing tables, key sets, topics or collections |
| [Code](guide/code.md) | A few lines of code on a shape | Showing a formula, a query or a request |
| [Failure modes](guide/failures.md) | Rating how each part fails | Writing or reading a failure analysis |
| [Performance](guide/performance.md) | Replaying a load test | Working with runs in `perf/` |
| [Compare](guide/compare.md) | Two flows or two runs side by side | Showing a change, a fix or a speed-up |
| [AI and MCP](guide/ai.md) | Setup, the tools, the prompts, what to ask for | Letting an AI build or update the model |
| [Check it and share it](guide/share.md) | `check`, `export`, Mermaid | Gating a build or publishing the model |
| [The desktop app](guide/desktop.md) | What the app does and where it differs | Using the app |

Beside the guide: [the file format](format.md) lists every key of the files, [Writing good Flowy docs](writing.md) says what to put in
them, [Install](install.md) says how to get each version and [Shortcuts](shortcuts.md) lists the keys.

## What to read for a request

A bare "document this repo" or "make Flowy docs" gets the default: the people, apps, stores, components and outside services in the
repo, how they connect, and three to five plain flows. That needs [Writing good Flowy docs](writing.md) and nothing from the pages above.

Anything else is asked for by name. Each part below has its own page, and it is the only one to load for that part.

| The request names | Load |
| --- | --- |
| Nothing but the repo | [Writing good Flowy docs](writing.md) |
| Animation, a failed or lost request, a repeat, a branch, parallel steps, a shape going down | [Flows](guide/flows.md) |
| What a database, cache or queue holds | [Data](guide/data.md) |
| A formula, a query or a payload on a shape | [Code](guide/code.md) |
| How it breaks, risk, FMEA, "what if X is down" | [Failure modes](guide/failures.md) |
| Load, capacity, "where does it struggle" | [Performance](guide/performance.md) |
| A fix, a before and after, "what changed", two runs next to each other | [Compare](guide/compare.md) |
| Colour, shape, icon | [Shapes, colour and icons](guide/shapes.md) |
| Every key of a file, writing YAML by hand | [The file format](format.md) |
