# File format

Every key Flowy reads, in one place, for anyone who writes the YAML by hand: you, or an AI that writes files and not through MCP.
[The guide](guide.md) explains what each part looks like and does, and [Writing good Flowy docs](writing.md) says what to put in
it. Run `flowy check` when you are done: it prints every problem and exits 1 if there is one.

## The folder

A model is a folder, `flowy/` by default, next to the code it describes.

| File | Holds | Written by |
| --- | --- | --- |
| `model.yaml` | The shapes (`objects`), the lines between them (`connections`) and project settings | You, an AI, the canvas |
| `flows/<id>.yaml` | One flow: a walkthrough of something happening. It can sit in folders inside `flows/` | You, an AI, the canvas |
| `failures/<id>.yaml` | One failure analysis | You, an AI, the canvas |
| `perf/<id>.yaml` | One load-test run | A tool. Flowy reads it, and writes only its `compare` |
| `layout.yaml` | Where shapes were dragged | The canvas. Don't write it |
| `drafts/<id>/` | A draft: a model of its own with the same files, which the model never reads ([Drafts](guide/drafts.md)) | You, an AI, the canvas |

A flow's file can sit in folders inside `flows/` (`flows/payments/refund.yaml`), and the folders are yours to arrange. The id is the file name alone, so no two flows share one whatever their folders, and a flow moved to another folder keeps its id. A folder name may hold letters, digits, spaces and most marks, but not `\ / : * ? " < > | # %`; it can't start with a dot (such a folder is left alone), end in a dot or a space, or be longer than 64 characters, and folders nest six deep at most. `flowy check` lists a folder it skips and a name that two files share.

A file name that ends in `.yml` is ignored, and `flowy check` says so. An `<id>` is lowercase letters, digits and dashes, not starting with a dash, and
`root` is taken, and so are the Windows device names (`con`, `nul`, `aux`, `prn`, `com1` to `com9`, `lpt1` to `lpt9`). The same rule holds for an
object's id in `model.yaml`.

A save from the canvas, the desktop app or an AI writes the whole file again. Keys Flowy doesn't know are kept, but comments are
not, and a row written on one line (`{ type: app, name: API }`) comes back as several. Put a note that has to stay in a `description`.

**Every value is text.** Flowy reads YAML with the failsafe schema, so `opacity: 40` is the text "40", `external: true` is the text "true", and an id like
`007` stays `007`. A key with nothing after it (`shape:`) is left out. In the one-line form `{ ... }` and `[ ... ]`, put double quotes around
a value that holds `,` `:` `#` `{` `}` `[` or `]`, or that starts with `-` `?` `*` `&` `!` `|` `>` `%` `@` or a quote: a comma ends the value, the words after it become a key
with no value, and the file can't be saved again. `flowy check` reports that. A long value reads better as a block (`description: |`).

## model.yaml

| Key | Takes |
| --- | --- |
| `objects` | A mapping of object id to object (below) |
| `connections` | A list of connections (below) |
| `name` | Text | What the system is called. The Overview's heading |
| `about` | Markdown | What the system is for and who uses it, a paragraph or two. The Overview shows it |
| `lines` | How the canvas draws lines: `straight` (the default, so leave it out), `curved` or `angled` |
| `icons` | Your own icons: a mapping of name to SVG path data on a 24 by 24 grid ([the guide](guide/shapes.md#icons)) |

Other top-level keys are kept as they are.

### An object

| Key | Takes | Notes |
| --- | --- | --- |
| `type` | `actor`, `system`, `app`, `store` or `component` | Required. Sets what it may sit inside |
| `name` | Text | Required |
| `in` | The id of the parent | An actor or a system has none. An app or a store is in a system. A component is in an app or a store |
| `external` | `true` or `false` | An outside service you don't own. Drawn grey. Leave it out for `false` |
| `shape` | `rectangle`, `pill`, `ellipse`, `diamond`, `hexagon`, `parallelogram`, `cylinder`, `queue`, `document`, `folder`, `note`, `cloud` or `arrow` | Left out, the type's own: actor a pill, store a cylinder, the rest a rectangle |
| `color` | `gray`, `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple` or `pink`, or a hex like `"#3b82f6"` | Left out, the type's colour |
| `opacity` | A whole number from 0 to 100 | How much of `color` the fill holds. 15 when a colour is set and this is not |
| `icon` | A built-in icon name ([the guide](guide/shapes.md#icons)) or one under `icons:` | Left out, the type's icon (cloud for an external one) |
| `tech` | Text | The real stack, short: `Node, Fastify` |
| `description` | Markdown | The first paragraph, up to the first blank line, is the hover teaser |
| `code` | A list of paths | Files and folders in the repo, relative to the folder that holds `flowy/`. Each must exist |
| `links` | A list of `{ url, title }` | `url` is an `http` or `https` address, or a path in the repo that exists. `title` is optional |
| `snippets` | A list of `{ text, title, language }` | A few lines of code, at most 6 of 40 lines and 8000 characters. `title` and `language` are optional ([the guide](guide/code.md#code)) |
| `data` | A list of entries | Only on a `store`: its tables, key sets, topics or collections ([the guide](guide/data.md#data)) |

### A connection

A line from one object to another. It has a direction, and an arrow shows it.

| Key | Takes |
| --- | --- |
| `from` | The id of the object it starts at |
| `to` | The id of the object it goes to. Not the same as `from` |
| `label` | A few words, a verb and what moves: `reads menus`. Optional but wanted. The same `from`, `to` and `label` can't repeat |

## flows/&lt;id&gt;.yaml

| Key | Takes |
| --- | --- |
| `name` | Text. Required |
| `view` | `root`, or the id of an object that holds others. Every step must be visible there |
| `steps` | A list of steps, at least one |
| `groups` | A mapping of group id to group ([the guide](guide/flows.md#repeats-branches-and-parallel-steps)) |
| `states` | Where shapes stand before step 1: a mapping of object id to a state |
| `tags` | A list of words that say what kind of walkthrough it is, up to 32 characters each, such as `happy path`, `error path`, `edge case`, `recovery` and `background`. Any word works, and a word counts once whatever its case |
| `compare` | The id of the older flow this one is compared with, or `{ with: <id>, note: "text" }` with a line on what changed. The holder is the newer one. It can't name this flow, and the id has to be a flow |

### A step

| Key | Takes |
| --- | --- |
| `from` | The id of the object the step starts at. Required |
| `to` | The id of the object it goes to. Leave it out for a step one object does on its own |
| `text` | One short sentence. Required |
| `description` | Longer detail in Markdown, shown as More |
| `animation` | A kind, or a mapping (below). Leave it out and the step doesn't move |
| `group` | The id of a group under `groups` |
| `lane` | In a branch or parallel group: starts a lane here, named in plain words |
| `flow` | The id of another flow that tells what happens next. It must exist |
| `states` | The objects this step changes: object id to a state |

A **state** is `running` (the default), `starting`, `stopping`, `stopped`, `restarting` or `degraded`. It holds from the step that sets it until another step
changes it ([the guide](guide/flows.md#shape-states)).

An **animation** is a kind, `send`, `call`, `callback` or `event`, or a mapping with a `kind` and any of these:

| Key | Takes |
| --- | --- |
| `kind` | `send`, `call`, `callback` or `event` |
| `trigger` | `inside` (the default) or `outside`. For `callback` only |
| `carries` | A word the moving label shows |
| `outcome` | `fail` (`send`, `call`), `timeout` (`call`), or `lost`, `rejected`, `intercepted`, `duplicated`, `delayed` (`send`, `call`, `event`). Only where the step really ends that way |
| `share` | A whole percent from 1 to 100 of the requests that meet the outcome. Needs an `outcome` |
| `reason` | A few words, at most 40 characters. Needs an `outcome` |
| `by` | For `intercepted`: a shape id that is not an end of the step, or `{ name: ... }` of up to 24 characters |
| `at` | For `lost`: how far along the line, 0.1 to 0.9 |
| `effect` | `squish`, `bounce`, `pulse` or `wiggle`: what the moving label does on its way, just for fun, without bending its shape. Leave it out for none |
| `opens` | `stream`, `listener` or `job`: what the step leaves open once its request has arrived. It stays drawn on the later steps until a step closes it ([the guide](guide/flows.md#streams-listeners-and-jobs)). Not with an `outcome` |
| `name` | With `opens`: a name of up to 24 characters, so a later step can close it |
| `towards` | With `opens`: `from` or `to`, the end of the line it points at. A stream flows to `to` and a job runs on `to`; a listener sits at `from` |
| `closes` | The `name` of a channel an earlier step opened. It goes after this step. Not with `opens` or an `outcome` |

### A group

| Key | Takes |
| --- | --- |
| `kind` | `repeat`, `branch` or `parallel` |
| `times` | `repeat` only: how many times in all, the first run included, a whole number from 2 to 99 |
| `until` | `repeat` only: what stops it, in words |
| `text` | A few words for what the kind doesn't say, such as the backoff |

A group's steps sit next to each other, and a group can't hold another. In a branch or parallel group every lane starts at a step with a `lane`.

## failures/&lt;id&gt;.yaml

| Key | Takes |
| --- | --- |
| `name` | Text. Required |
| `about` | Who rated it, when, and what the ratings rest on |
| `scope` | `root`, or the id of an object that holds others. What the coverage counts |
| `scale` | What the ends of a rating mean: `severity`, `occurrence` and `detection`, each with `low` and `high` |
| `modes` | A mapping of mode id to mode |

A **mode** is one way a part fails:

| Key | Takes |
| --- | --- |
| `mode` | The condition, as a fact: "Stripe doesn't answer within 5 s". Required |
| `on` | The id of the object that fails. Give this, or `from` and `to`, not both |
| `from`, `to` | For a line: it must be a connection in the model, in that direction |
| `effect`, `cause` | What a person or another part then sees, and why it happens |
| `severity`, `occurrence`, `detection` | Whole numbers from 1 to 10. For `detection`, 10 means nobody would notice. Leave one out rather than guess. All three make a risk |
| `controls`, `action`, `owner` | What exists today, what to do next, and who |
| `status` | `open` (the default), `planned`, `done` or `accepted` |
| `after` | The ratings once the action is done: `severity`, `occurrence`, `detection` |
| `affects` | A list of object ids the failure hurts. You write it |
| `flow`, `step` | The flow that tells it, and which step of it, counting from 1. A `step` needs a `flow` |
| `run` | The id of a load-test run in `perf/` that shows it. It must exist |
| `description` | More, in Markdown |

## perf/&lt;id&gt;.yaml

A load test, summarised: a `name`, a `unit`, optional `about`, `entry`, `source` (the colour and scale of its dots), and `levels` (at least two, rising in `load`), each with the numbers every shape and
connection measured. With `axis: time` the levels rise in `at` instead, and `events` say what happens at a time, such as a shape going down. `adds` lists two to four runs to play added together,
and `sources` tests several at once. Tools write it. The format is in [the guide](guide/performance.md#performance).

A run can also carry a `compare`, the id of the older run it is compared with: `compare: before-the-cache`, or a `with` and a `note` for a line on what changed:

```yaml
compare:
  with: before-the-cache
  note: "Cache added in front of the orders API"
```

The holder is the newer one. It can't name itself, and the id has to be a run. `compare` is the one key of a run that Flowy writes, in place (it adds, changes or removes that
one entry and leaves the rest of the file as it is), and a tool that writes a run over an existing file keeps it.

## What writes what over MCP

| To change | Use |
| --- | --- |
| An object and everything on it (`type`, `name`, `in`, `external`, `shape`, `color`, `opacity`, `icon`, `tech`, `description`, `code`, `links`, `snippets`, `data`) | `put_object` |
| The system's `name` and `about` | `put_project` |
| A custom icon | `put_icon` |
| A connection | `connect`, `disconnect` |
| A flow, with its groups, states and animations | `put_flow` |
| A failure analysis, or one mode of it | `put_failures`, `put_failure` |
| The `compare` of a flow, or of a run | `set_compare` (a run is otherwise not written over MCP) |
| `lines`, the rest of `perf/`, `layout.yaml` | Not over MCP: write the file, or use the canvas |

[The guide](guide/ai.md#let-an-ai-build-it) lists all the tools.
