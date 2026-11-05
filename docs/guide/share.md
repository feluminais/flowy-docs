# Check it and share it

`flowy` here means `node /path/to/flowy-docs/dist/cli.js`, or `flowy.sh` or `flowy.cmd` in the clone. `--dir` picks the model folder.

- `flowy check`: prints every problem, one line each. Exits 1 on any.
- `flowy tidy`: fixes the views whose faded shapes aren't on the side they have in the view above, in `layout.yaml`, and lists them.
- `flowy tidy --check`: only lists them, on stderr. Exits 1 on any.
- `tidy_layout` over MCP: the same, with `view` for one view and `check: true` to only list.
- `flowy export`: writes a read-only copy of the canvas to `./flowy-site`, or to `--out`.
- `flowy mermaid --view <id>` or `--flow <id>`: prints a flowchart or a sequence diagram.
- `flowy failures`: prints the analyses as Markdown tables (`--format csv`, `--analysis <id>`), with problems on stderr. Exits 1 when it has nothing to print or the failure files have a problem. Other problems don't count.
- `flowy mcp`: runs the MCP server.

## Check it

Gate a build on `check`. It reads the model, flows, failure analyses and load-test runs, then each sketch on its own, naming a sketch's files from the model folder. It reports a mode whose run doesn't exist, a `code` or `links` path that doesn't exist and a file that could not be saved again. A model or flow file that can't be read is the one line it prints.

## Export

The model sits inside the page's `index.html`, with any runs and failure analyses. Browsers won't run it from disk, so it needs a static host such as GitHub Pages. Notion or Confluence embed that link.

- Exporting again replaces only what the export wrote, so a `.git` or a `CNAME` stays.
- `--out` refuses the folder that holds the model, and a folder with other files (hidden ones don't count).
- A file that can't be read stops the export with exit 1. Problems don't: the page lists them, and it exits 0.

## Mermaid

The Mermaid button copies the view on screen, or the flow playing, fenced for a README or a pull request. A shape becomes the closest Mermaid node and a colour a `style` line (a folder stays a rectangle, and the queue, document, note and cloud shapes need Mermaid 11.3 or later). The same from the command line, or for an AI through MCP (`get_mermaid`): name a view or a flow.

A connection's kind is only partly kept: an extension point comes out as a dotted line, a line with a mark at its start has an arrowhead at both ends, and the kind's name is not added to the label.

In a sequence diagram a step on one shape is a note, a recursion an arrow back to the shape, a repeat a `loop`, a branch `alt` and `else` (`opt` with one lane) and a parallel group `par` and `and`. Outcomes, channels, states and a step's `flow` are notes.

## Addresses

The address follows what's on screen, in the browser and on a hosted export, so a document can link back to the map. `#ordering` opens the inside of Ordering and `#ordering/place-order` plays that flow there. The top level is `root`.

- `#<view>/perf/<run>/<level>`: `<level>` is the level's place in the run from 0, or with several sources a comma list of places (`2,1.5`).
- `#<view>/failures/<analysis>`, with `/<mode>` to pick a mode.
- `#<view>/compare/<a>/<b>` for flows and `compare-runs` for runs, with `/swap` for Swap. `<a>` is the left pane, and a pair that can't open shows a notice.
