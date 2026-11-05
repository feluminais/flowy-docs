# File format

Every key written by hand lives here, except the keys of a load-test run, which are in [Performance](guide/performance.md#performance). After a hand edit, run [`flowy check`](guide/share.md).

## The folder

A model is a folder, `flowy/` by default, next to the code it describes.

| File | Holds | Written by |
| --- | --- | --- |
| `model.yaml` | The shapes (`objects`), the lines between them (`connections`) and project settings | You, an AI, the canvas |
| `flows/<id>.yaml` | One flow. It can sit in folders inside `flows/` | You, an AI, the canvas |
| `failures/<id>.yaml` | One failure analysis | You, an AI, the canvas |
| `perf/<id>.yaml` | One load-test run | A tool |
| `layout.yaml` | Where shapes were dragged | The canvas, never by hand |
| `sketches/<id>/` | A model of its own with the same files, which the model never reads. `drafts/<id>/` is read too | You, an AI, the canvas |

- **Ids.** An `<id>`, or the id of an object, group, payload or mode: lowercase letters, digits and dashes, not starting with a dash. `root` and the Windows device names (`con`, `nul`, `aux`, `prn`, `com1` to `com9`, `lpt1` to `lpt9`) are taken. A file name that ends in `.yml` is ignored, and `flowy check` says so.
- **Flow folders.** A flow's id is its file name alone, so no two flows share one whatever their folders, and a flow moved to another folder keeps it. A folder name has at most 64 characters, can't hold `\ / : * ? " < > | # %`, can't be a Windows device name, and can't end in a dot or a space. One that starts with a dot is left alone. Folders nest six deep at most. `flowy check` lists a folder it skips and a name two files share.
- **Saving.** A save from the canvas, the desktop app or an AI writes the whole file again. Keys Flowy doesn't know are kept. Comments are not, and a row on one line (`{ type: app, name: API }`) comes back as several, so a note that has to stay goes in a `description`.
- **Values.** Flowy reads YAML with the failsafe schema, so every value is text: `opacity: 40` is the text "40", `external: true` the text "true", and `007` stays `007`. A key with nothing after it (`shape:`) is left out. Anchors and aliases are refused.
- **Quoting.** Put double quotes around a value that starts with `#` `{` `}` `[` `]` `,` `*` `&` `!` `|` `>` `%` `@` `` ` `` or a quote, that starts with `-`, `?` or `:` and a space, that holds `: ` or ` #`, or that ends in `:`. In the one-line form `{ ... }` and `[ ... ]`, also a value that holds `,` `{` `}` `[` or `]`: a comma ends the value, and the words after it become a key with no value, which `flowy check` lists as a problem. A long value goes in a block (`description: |`).

## model.yaml

| Key | Takes |
| --- | --- |
| `objects` | A mapping of object id to object |
| `connections` | A list of connections |
| `name` | Text: what the system is called |
| `about` | Markdown: what the system is for and who uses it |
| `lines` | How lines are drawn: `straight` (the default), `curved` or `angled` |
| `pairs` | Two shapes with several connections between them: `merged` (the default) is one line, `separate` is a line for each. A sketch starts as `separate` |
| `icons` | Your own icons: a mapping of name to SVG path data (the `d` of each `<path>`, joined) on a 24 by 24 grid, at most 4000 characters, drawn two units thick with round ends. A name takes lowercase letters, digits and dashes, not starting with a dash, and can't be a built-in icon's |
| `payloads` | A mapping of payload id to payload, at most 200 |

Other top-level keys are kept as they are.

### An object

| Key | Takes | Notes |
| --- | --- | --- |
| `type` | `actor`, `system`, `app`, `store` or `component` | Required |
| `name` | Text | Required |
| `in` | The id of the parent | None on an actor or a system. An app or a store is in a system. A component is in an app or a store |
| `external` | `true` or `false` | An outside service you don't own. Left out, `false` |
| `shape` | `rectangle`, `pill`, `ellipse`, `diamond`, `hexagon`, `parallelogram`, `cylinder`, `queue`, `document`, `folder`, `note`, `cloud` or `arrow` | Left out, the type's own: `pill` for an actor, `cylinder` for a store, `rectangle` for the rest |
| `color` | `gray`, `red`, `orange`, `amber`, `green`, `teal`, `blue`, `indigo`, `purple` or `pink`, or a quoted hex: `"#38f"`, `"#3b82f6"` | Left out, the type's colour, or `gray` with `external` |
| `opacity` | A whole number from 0 to 100 | How much of `color` the fill holds. Left out, 15 with a `color` and 0 without |
| `icon` | A [built-in icon name](guide/shapes.md#icons) or one under `icons` | Left out, the type's icon, or `cloud` with `external` |
| `tech` | Text | The real stack: `Node, Fastify` |
| `description` | Markdown | The first paragraph, up to the first blank line, is the hover teaser. A code fence that names a snippet language is coloured as a snippet |
| `code` | A list of paths | Files and folders relative to the folder that holds `flowy/`, with `/` between folders and no `.` or `..` parts. A write with a missing path is refused, and one that goes missing later is a problem |
| `links` | A list of `{ url, title }` | `url` is an `http` or `https` address, or a path as in `code`. `title` is optional |
| `snippets` | A list of [snippets](#a-snippet), at most 6 | |
| `data` | A list of [data entries](#a-data-entry) | Only on a `store` |

### A snippet

| Key | Takes |
| --- | --- |
| `text` | The code. Required. At most 40 lines and 8000 characters. It is never run, and a save writes it as a block of lines |
| `title` | Text |
| `language` | `typescript`, `javascript`, `json`, `yaml`, `csharp`, `java`, `kotlin`, `python`, `go`, `rust`, `sql`, `bash`, `powershell`, `html`, `xml`, `css`, `dockerfile`, `markdown`, `c`, `cpp`, `php`, `ruby`, `swift` or `text` (no colours). Short names (`ts`, `py`, `sh`, `c#`) are read too, and a save writes the id. Left out, worked out from the code |

### A data entry

An entry is one table, key set, topic or collection. It takes `columns` or `sample`, never both.

| It holds | Write |
| --- | --- |
| Tables | `columns` and `rows` |
| A key set | `columns: [Key, Value, Expires]` and `rows` |
| A topic | `columns: [Key, Value]` and a row for each message |
| Documents | `sample` and `notes` |

| Key | Takes |
| --- | --- |
| `name` | Required, and unique in the store. The name a developer uses |
| `kind` | A word for what it is: `table`, `collection`, `topic` |
| `limits` | One line on how long it is kept or how much fits |
| `note` | One line on why it is this way |
| `columns` | At most 12, each a bare name or a mapping (below). Names are unique |
| `rows` | Needs `columns`. At most 8, each a list with one cell for each column. An empty cell is `""`. A save writes each row on one line |
| `sample` | One sample document: text, lists and mappings, at most 3 levels deep and 20 fields, with no list directly inside a list |
| `notes` | Needs `sample`. A field to its note. A nested field is its keys joined with dots (`hours.mon`). A field under a list item takes no note |

| Column key | Takes |
| --- | --- |
| `name` | Required |
| `type` | Free text of up to 40 characters, as the code writes it: `int`, `"numeric(12,2)"`, `"text[]"`. A final `?` says the column can be empty: `timestamp?` |
| `key` | `primary`, the only value |
| `to` | The table a foreign key points to |
| `note` | One line on why |

No text in `data` can hold a line break, and U+0085, U+2028 and U+2029 count as one.

### A connection

| Key | Takes |
| --- | --- |
| `from` | The id of the object that starts it. For `publish`, `cached` and `object`, the publisher. For `extension`, the host that calls |
| `to` | The id of the object that receives it, not the same as `from`. For `extension`, what plugs into the host |
| `label` | A few words: `reads menus`. The same `from`, `to` and `label` can't repeat |
| `kind` | [How the two talk](guide/kinds.md): `request` (Request and reply), `stream` (Request then stream), `publish` (Publish and subscribe), `cached` (Cached publish), `object` (Object updates) or `extension` (Extension point). Left out, a Plain line. Any other word is a problem |
| `payloads` | A list of what the line carries, at most 12: payload ids, or payloads written in place with a `name` |

### Payloads

| Key | Takes |
| --- | --- |
| `name` | Text. Left out, the id stands in. A payload written in place has no id, so it needs one |
| `about` | Markdown: what it is and what it is for |
| `shape` | `{ text, language }`: the whole thing, a type, a JSON schema or a CSV header. At most 400 lines and 40000 characters. `language` is a [snippet's](#a-snippet) |
| `example` | `{ text, language }`: a filled-in instance, with the same limits |

A payload needs at least one of `about`, `shape` and `example`. The id is what makes two the same: a payload written in place is never one of those under `payloads:`, whatever its name.

## flows/&lt;id&gt;.yaml

| Key | Takes |
| --- | --- |
| `name` | Text. Required |
| `view` | `root`, or the id of an object that holds others. Every step must be visible there |
| `steps` | A list of steps, at least one |
| `groups` | A mapping of group id to [group](#a-group) |
| `states` | Where shapes stand before step 1: object id to a state. Left out, `running` |
| `tags` | A list of words of up to 32 characters, with no space at either end. A word counts once whatever its case. The form offers `happy path`, `error path`, `edge case`, `recovery` and `background`, and any word works |
| `compare` | The id of the older flow, or `{ with: <id>, note: "text" }`. The holder is the newer one. It can't name this flow, and the id has to be a flow. A tag that breaks either rule is a problem, and the flow still opens |

### A step

| Key | Takes |
| --- | --- |
| `from` | The id of the object the step starts at. Required |
| `to` | The id of the object it goes to. Left out, one object acts on its own |
| `text` | One short sentence. Required |
| `description` | Markdown, shown as More |
| `animation` | A kind, or a mapping (below). Left out, the step doesn't move |
| `group` | The id of a group under `groups`. A step is in at most one |
| `lane` | In a `branch` or `parallel` group: starts a lane here, named in plain words and unique in its group. The steps after it, up to the next `lane`, belong to it |
| `flow` | The id of another flow that tells what happens next. It must exist, and it can point back |
| `via` | The `label` of a connection between the step's two shapes, in any case, and it must match one. Where `pairs` is `separate`, the step rides that line. Left out, the `payload` or the direction picks one |
| `states` | The objects this step changes: object id to a state. Two lanes of one parallel stop can't give one object two states |
| `payload` | What the step sends: a payload id, or a payload written in place with a `name`. Needs a `to`, except on a `recurse` |
| `reply` | What comes back, the same way. Only on a `call`, a `callback` or a `recurse` |

A **state** is `running` (up and serving, the default), `starting` (coming up, not ready), `stopping` (draining or shutting down), `stopped` (off), `restarting` (down and coming back) or `degraded` (up but not well).

An **animation** is a kind, or a mapping with a `kind` and any of these:

| Key | Takes |
| --- | --- |
| `kind` | `send`, `call`, `callback` or `event` on a step with a `to`. `recurse` on a step with no `to`, where the shape calls itself |
| `trigger` | `callback` only: `inside` (the default) or `outside` |
| `carries` | A word the moving dot shows |
| `outcome` | `fail` (`send`, `call`), `timeout` (`call`), or `lost`, `rejected`, `intercepted`, `duplicated`, `delayed` (`send`, `call`, `event`) |
| `share` | A whole percent from 1 to 100 of the requests that meet the outcome. Needs an `outcome`. Left out, the step plays one request |
| `reason` | A few words on one line, at most 40 characters. Needs an `outcome` |
| `by` | Required on `intercepted`, and only there: a shape id that is not an end of the step, or `{ name: ... }` of up to 24 characters |
| `at` | `lost` only: how far along the line, 0.1 to 0.9. Left out, 0.55 |
| `effect` | `squish`, `bounce`, `pulse` or `wiggle`: what the moving dot does on its way. Left out, none |
| `opens` | `stream`, `listener` or `job`: what stays open once the request has arrived. Not with an `outcome`, and not on a `recurse` |
| `name` | With `opens`: up to 24 characters on one line, not a name already open. Left out, it stays open to the end of the flow |
| `towards` | With `opens`: `from` or `to`, the end of the line it points at. Left out, `from` for a `listener` and `to` for the others |
| `closes` | The `name` of a channel open at this step. It goes after this step. Not with `opens` or an `outcome`, and not on a `recurse` |
| `depth` | `recurse` only: 2 to 5 levels with the first call counted. Left out, 3 |
| `returns` | `recurse` only: a word on the answers coming back |

### A group

| Key | Takes |
| --- | --- |
| `kind` | `repeat`, `branch` or `parallel`. Required |
| `times` | `repeat` only: how many times in all, the first run included, a whole number from 2 to 99. With `until` it is the most |
| `until` | `repeat` only: what stops it, in words. A `repeat` needs `times` or `until` |
| `text` | A few words for what the kind doesn't say, such as the backoff |

- A group's steps sit next to each other, a group can't hold another, and a group under `groups` needs a step.
- A `branch` or `parallel` group starts with a step that has a `lane`. A `parallel` group needs two lanes, a `branch` one. A `repeat` has none.

## failures/&lt;id&gt;.yaml

| Key | Takes |
| --- | --- |
| `name` | Text. Required |
| `about` | Who rated it, when, and what the ratings rest on |
| `scope` | `root` (the default), or the id of an object that holds others. What the coverage counts |
| `scale` | What the ends of a rating mean: `severity`, `occurrence` and `detection`, each with `low` and `high` |
| `modes` | A mapping of mode id to mode, unique in the file |

A **mode** is one way a part fails:

| Key | Takes |
| --- | --- |
| `mode` | The condition, as a fact: "Stripe doesn't answer within 5 s". Required |
| `on` | The id of the object that fails. Give this, or `from` and `to`, not both |
| `from`, `to` | For a line: a connection in the model, in that direction |
| `effect`, `cause` | What a person or another part then sees, and why it happens |
| `severity`, `occurrence`, `detection` | Whole numbers from 1 to 10. A 10 means the worst result, it keeps happening, and nobody would notice, in that order. All three make a risk |
| `controls`, `action`, `owner` | What exists today, what to do next, and who |
| `status` | `open` (the default), `planned`, `done` or `accepted` |
| `after` | The ratings once the action is done: `severity`, `occurrence`, `detection` |
| `affects` | A list of object ids the failure hurts. Flowy doesn't work it out |
| `flow`, `step` | The flow that tells it, and the step's place in that file's `steps`, counting from 1. A `step` needs a `flow` |
| `run` | The id of a load-test run in `perf/`. It must exist |
| `description` | More, in Markdown |

## perf/&lt;id&gt;.yaml

Tools write a run, and its keys are in [Performance](guide/performance.md#performance). The one key Flowy writes is `compare`: the id of the older run, or a `with` and a `note`.

```yaml
compare:
  with: before-the-cache
  note: "Cache added in front of the orders API"
```

The holder is the newer one. It can't name itself, the id has to be a run, and a run called `null` can't be named. A tool that writes a run over an existing file keeps it.

## What writes what over MCP

| To change | Use |
| --- | --- |
| An object and every key on it | `put_object`, `delete_object` |
| `name`, `about` and `pairs` of `model.yaml` | `put_project` |
| An entry under `icons` | `put_icon`, `delete_icon` |
| A connection, its `kind`, its `payloads` | `connect`, `disconnect`, `set_kind`, `set_payloads` |
| A payload under `payloads` | `put_payload`, `delete_payload` |
| A flow and every key in it | `put_flow`, `move_flow`, `tag_flow`, `delete_flow` |
| A failure analysis, or one mode of it | `put_failures`, `put_failure`, `delete_failures`, `delete_failure` |
| The `compare` of a flow or a run | `set_compare` |
| `layout.yaml` | `tidy_layout` |
| A sketch | `new_sketch`, `delete_sketch` |
| `lines`, the rest of `perf/` | Not over MCP: write the file, or use the canvas |

- `put_object` replaces the whole `data` or `snippets` list.
- `delete_icon` is refused while a shape uses the icon.
- `delete_object` is refused for a shape with shapes inside it, or one a flow step, a flow view or a failure mode names. The refusal has a row for each with the actions that settle it, and the same call with `resolve`, one entry per row, deletes in one edit or saves nothing. `disconnect` works the same way for a line a failure mode is on.
- With `pairs: separate`, `disconnect` with no label is refused when several connections run between the two shapes, and lists their labels. With `merged` it removes them all.
