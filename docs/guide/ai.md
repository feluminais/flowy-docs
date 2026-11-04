# AI and MCP

Letting an AI build the model: setup, the tools, the prompts and the guides. Part of the [Flowy Docs guide](../guide.md).

## Let an AI build it

From the root of the repo you want to document, once the clone is built as
[Install](../install.md#the-browser-version) says:

```bash
claude mcp add flowy -- node /path/to/flowy-docs/dist/cli.js mcp
```

That command is for Claude Code. Any other MCP client takes the same command over stdio. Its config looks like this:

```json
{ "mcpServers": { "flowy": { "command": "node", "args": ["/path/to/flowy-docs/dist/cli.js", "mcp"] } } }
```

Then ask the AI something like "map this repo into Flowy". It writes `flowy/model.yaml` and
`flowy/flows/*.yaml`, and refuses any change that would break the model. Ask how the system fails and it can write a
[failure analysis](failures.md#failure-modes) in `flowy/failures/` too, leaving a rating out rather than guessing it. Add `--dir <folder>`
after `mcp` to keep the files somewhere other than `./flowy`.

**What to ask for.** "Map this repo into Flowy" or "make Flowy docs" gets the default: the people, apps, stores, components and outside services in the repo, how they connect, and three to five plain flows. Nothing else is written until you name it: flows with motion, repeats, branches or failed requests ([Flows](flows.md)), what the stores hold ([Data](data.md)), code on shapes ([Code](code.md)), a failure analysis ([Failure modes](failures.md)) or a look ([Shapes, colour and icons](shapes.md)). Ask for "everything" and it asks which. It reads the rules for a part only when you ask for that part, and ends by naming what Flowy could add that it saw material for in the repo.

A connection can say how the two shapes talk (`kind:` on `connect`, or `set_kind` on one that exists), and the line is drawn to match ([Connection kinds](kinds.md)). The AI is told to set a kind only where the code shows it and to leave it out when unsure. In a sketch, where each connection is a line of its own, a flow step names the connection it rides with `via` ([Flows](flows.md#which-line-a-step-rides)), and when the pair has several lines, the answer to `put_flow` says which one each step rides.

A shape can note where it lives in the code (`code: [src/api/]`). A path that doesn't
exist is refused, so the model can't quietly point at code that's gone. When code moves later,
the shape gets a "!" until someone fixes the path.

A shape can link its long documents (`links: [{ title: Runbook, url: docs/runbook.md }]`).
A repo path must exist, and a web address is taken as given.

A shape can hold a few lines of code that explain it (`snippets:`, see [Code](code.md#code)). The AI copies them from the repo as they are,
leaves out secrets and real data, and keeps to the limits. `put_object` replaces the whole list, so it reads the shape first and
sends the snippets to keep.

The AI can write what a store holds (`data:`, see [Data](data.md#data)) from a migration, a schema file or the code that builds the keys. It
is told to show only the few tables a reader needs to follow the flows, to invent the sample rows and never copy them from a real
database or a log, and to keep a note to one line that says why. `put_object` replaces a store's whole list of entries, so it reads
the store first and sends the ones to keep.

The AI marks outside services (a payment provider, a third-party API) with `external: true`, so
they show grey. It is told to leave `shape`, `color`, `opacity` and `icon` alone unless one says something the type
doesn't, and to keep a colour to one meaning across the model, so a model it builds looks like the type defaults until you choose otherwise.

When the AI saves a flow, Flowy answers with how each step will read on the flow's view, the
way the player shows it ("2. Alert channels → Text and speech in Core: …"). Its instructions ask
for steps that say what passes between the two shapes and whether the sender waits, so a flow
reads the way the code works.

Saving rewrites the file, so YAML comments in `model.yaml` and flow files aren't kept. Put
notes in an object's `description` instead.

**The tools.** The server has thirty-two. What `get_model` shows can be sent straight back to the tool that writes it. Every tool but the three sketch tools also takes `sketch`, a sketch's id, and then reads or writes that sketch instead of the model ([Sketches](sketches.md)). Three of the thirty-two are old names, listed last, that keep older setups working.

| Tool | Does |
| --- | --- |
| `get_model` | Reads the model. `summary: true` gives one short line for each thing, and `object`, `flow` or `analysis` gives that one thing in full. It also lists the load-test runs and the problems |
| `get_problems` | Lists every problem right now, one line each, or says "No problems." It is `flowy check` ([below](share.md#check-it)) |
| `get_view` | What one diagram shows: its shapes, the faded ones that connect in or that its flows name as people, and the lines merged to that zoom level, one per pair of shapes (`both` when they run both ways, `kind` when all its connections share a kind, `look` when the line is drawn other than plain). With `pairs: separate` it also returns `strands`, one line for each connection that differs in direction or label, with its `id`, `pair`, `label`, `lane` and `lanes` |
| `get_mermaid` | One view as a flowchart, or one flow as a sequence diagram |
| `get_failures` | The failure analyses as tables, worst first, with coverage; `format: csv` for a spreadsheet |
| `put_object`, `delete_object` | A shape and everything on it ([the file format](../format.md#an-object)), or removes one, with its lines. A shape with shapes inside it, or one a flow step, a flow view or a failure mode names, is refused with a row for each of those and the actions that settle it. Called again with `resolve`, one entry for each row, it settles them and deletes in one edit, or saves nothing |
| `connect`, `disconnect` | Adds a line from one shape to another, or removes it. A line a failure mode is on is refused the same way, and `resolve` removes the mode with it. Where each connection is a line of its own (`pairs: separate`), `disconnect` with no label is refused when several run between the two shapes, and lists their labels. `connect` also takes the `kind` of the line and the `payloads` it carries |
| `set_kind` | Sets the kind of one line (`request`, `stream`, `publish`, `cached`, `object` or `extension`), or takes it off with `""` ([the file format](../format.md#a-connection)) |
| `put_payload`, `delete_payload` | A payload: the data a line carries or a step sends, with an about, a shape and an example ([the file format](../format.md#payloads)), or removes one. A payload a line or a step names is refused, and the refusal lists them |
| `set_payloads` | Sets the payloads one line carries, by id or written in place; `[]` takes them all off |
| `put_flow`, `delete_flow` | A flow with its groups, states, animations and the payload, reply and `via` (the connection it rides) of each step, and answers with how each step reads on its view, or removes it. `folder` and `tags` file and label it; left out, a replaced flow keeps both |
| `move_flow` | Moves a flow's file into a folder under `flows/`, or back to the top with `""`. The flow keeps its id |
| `tag_flow` | Sets a flow's tags to exactly the words given, such as `happy path`, `error path`, `edge case` or `recovery`; `[]` takes them all out |
| `put_failures`, `delete_failures` | A whole failure analysis, or removes it |
| `put_failure`, `delete_failure` | One mode of an analysis, or removes it. `run` must be one of the runs `get_model` lists |
| `put_project` | The system's name and what it is, the first thing Details shows when nothing is picked. `""` removes one. `pairs` is `separate` for a line for each connection, or `merged` for one line between two shapes |
| `put_icon`, `delete_icon` | Your own icon, or removes one nothing uses |
| `tidy_layout` | Puts the faded shapes of each view on the side they have in the view above, so zooming across never leads the same way twice, and saves it in `layout.yaml`. A view that already agrees is left as it is. `view` limits it to one view, and `check: true` only lists what is on the wrong side. Ask for it once, when the shapes and connections are in |
| `set_compare` | The `compare` of a flow or a run: the older one it is compared with, and a note. Leave `with` out to remove it |
| `get_sketches` | The sketches of the model, with their ids and names |
| `new_sketch`, `delete_sketch` | A sketch in `sketches/<id>/`, empty or starting with copies of the shapes `copy` names, the shapes they sit in and the lines between them, drawn with a line for each connection; or removes one with every file in it. The model is not touched |
| `get_drafts`, `new_draft`, `delete_draft` | The old names of the three above, from when sketches were called drafts. They do the same, and every tool still takes `draft` in place of `sketch`. Use the new names |

Not over MCP: the project's `lines:`, the load-test runs in `perf/` (a tool writes those, and `set_compare` is the one thing over MCP that changes a run) and the positions you drag, which are the canvas's. `tidy_layout` is the one thing over MCP that writes `layout.yaml`.

Besides tools, the server offers the guides as resources (`flowy://docs/guide.md` says which page holds what, then `format.md`, `writing.md` and one page for each part, which a client can read when
it has the clone), how to word a model (`flowy://rules/writing`), the rules for the parts most requests leave out (`flowy://rules/flows`, `data`, `code` and `failures`) and five prompts for the usual jobs: `map-repo`, `update-after-change`, `write-flow`, `failure-analysis` and `review-model`.
[The file format](../format.md) lists every key, for writing the files by hand.

If you or the AI write the YAML by hand, put double quotes around the text of a one-line step when it holds a comma:
`{ from: app, to: api, text: "Sets the time zone, if the request has one" }`. Unquoted, the comma ends the text and what follows
becomes a key with no value. The file still loads, with the step cut short, but it can't be saved again, so Flowy lists the key as a
problem (`step 3: "if the request has one" has no value`) instead of leaving it to fail on the next edit.
[Writing good Flowy docs](../writing.md#write-flows) has the full list of characters to quote.
