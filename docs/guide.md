# Flowy Docs guide

The full detail behind the [README](../README.md): what every part of the canvas does, how editing and undo work, what Claude can change, and how sharing behaves. The examples come from Plum, a made-up delivery service whose model is in [`docs/demo/flowy`](demo/flowy).

## Read it

- Each box shows its type as a coloured icon: person, system, app, store, component. Outside
  services you don't own are grey with a cloud. "3 inside" means a box opens: double-click it, or
  select it and press Enter, to zoom in. Esc zooms back out, one level per press, once it has
  closed whatever is open (a flow, the side panel). Backspace and the breadcrumb zoom out too.
  Inside a box, a frame named after it wraps what's in it.
- Hover a box for its short description. Click it for the full text and its connections: every
  line out and in, with its label. A line that stands for several connections opens to list them.
  Pointing at a row lights its line on the canvas, and the box's name opens that box. Click a line
  to see the connections it stands for.
- Lines have no labels until you point at one. Click a box and its lines show theirs while the
  others fade.
- Lines (top bar) switches between straight, curved and right-angled lines for your own screen.
  "Project default" goes back to the project's choice.
- Faded, dashed boxes live elsewhere in the model. They show up because something here connects to
  them, and they wait around the edges (people above, the rest beside, below or above, wherever
  fewer lines cross) while what's inside sits in the middle.
- A box can list the files and folders it lives in, under its description. When the repo's
  `origin` is on GitHub or GitLab, they link there.
- Ctrl+K or / (or Search) finds a box anywhere in the model by name. Pick one and the canvas
  opens the level it's on, with its panel open.
- Pick a flow in the top bar to play it step by step: ← and → move, Home and End jump to the first
  and last step, Esc stops. A step can be one box doing something on its own, and a step with more
  to say has a More you can open.
- F fits the whole view back on screen, and ? (or the ? button) lists every shortcut.
- "N problems" in the top bar lists what's wrong in the files. Pick one to jump to it. Boxes with
  a problem carry a "!".

The page follows the files: when Claude or your editor changes them, it updates by itself.

## Edit it

Press E, or the Edit button.

- Drag boxes to arrange the view. Positions go to `flowy/layout.yaml`.
- Drag from the dot under a box onto another box to connect them, then type a label in the panel.
- Add (or N) puts a box in the current view. It offers only the types that fit there: actors and
  systems at the top, apps and stores inside a system, components inside an app or store.
  Double-click an empty system, app or store to open it and add what goes inside.
- Click a box to change its name, type, tech, description and code. A field saves when you leave
  it. Code takes one path per line, relative to the folder that holds `flowy/`. A path that
  doesn't exist shows up as a problem.
- "Outside service" in a box's panel marks it `external: true`, for things you use but don't own.
- Delete (the key, or the button in the panel) removes the selected box or line. A box that still
  contains others, or that a flow uses, stays, and a notice says why.
- Lines, in edit mode, sets the project's style for everyone: a `lines:` key at the top of
  `model.yaml`, which takes `straight` (the default, so it's left out), `curved` or `angled`.
- Tidy forgets where boxes in this view were dragged, so Flowy lays it out again, picking the
  layout with the fewest crossing lines it finds. Ctrl+Z brings your positions back.
- New flow records a walkthrough: name it, click the box where a step starts and the box it goes
  to (or the same box again, for a step it does on its own), type what happens and press Enter.
  Repeat. Each step's More holds longer detail for readers who want it. ↑, ↓ and × reorder and
  delete steps. "Edit a flow" opens one you already have.

Every save goes through the same checks as Claude's edits: a change that would add a problem is
refused, and nothing is written. If a file changed on disk in the meantime, the save is dropped
and the page reloads. Git keeps the history.

Ctrl+Z, or Undo, takes back your last change on this page, then the one before. It goes back as
far as the page has been open. Ctrl+Y or Ctrl+Shift+Z, or Redo, puts back what you undid, until
you make a new change. If the file changed since (Claude, your editor, another tab), undo and redo
leave it alone and say so. Undo brings back what the file said, not how it was written: like any
save, it drops YAML comments and writes the file in Flowy's own layout.

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

Claude marks outside services (a payment provider, a third-party API) with `external: true`, so
they show grey.

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
npx flowy-docs mermaid --view ordering
```

`--flow <id>` prints a flow as a sequence diagram instead.

The address follows what's on screen. `#ordering` is the inside of Ordering, and `#ordering/place-order` plays
the flow `place-order` there. Copy it to send someone straight to a level or a flow. The local canvas
does this too.
