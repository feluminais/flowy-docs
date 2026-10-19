# Flowy Docs guide

The full detail behind the [README](../README.md): what every part of the canvas does, how editing and undo work, what Claude can change, and how sharing behaves. The examples come from Plum, a made-up delivery service whose model is in [`docs/demo/flowy`](demo/flowy).

What to write in it, box by box, is in [Writing good Flowy docs](writing.md).

## Read it

- Each box shows its type as a coloured icon: person, system, app, store, component. Outside
  services you don't own are grey with a cloud. "3 inside" means a box opens: double-click it, or
  select it and press Enter, to zoom in. Esc zooms back out, one level per press, once it has
  closed whatever is open (a flow, the side panel). Backspace, Z and the breadcrumb zoom out too.
  Inside a box, a frame named after it wraps what's in it. A faded box that opens sits beside the
  one you're in, not inside it, so opening it slides across instead of zooming in.
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
- A box can list links to its long documents (a runbook, a decision record, a wiki page) in a Links
  section under its description. A web address opens in a new tab. A path in the repo links to the
  file when the repo's `origin` is on GitHub or GitLab, and a path that doesn't exist shows up as a
  problem.
- Ctrl+K or / (or Search) finds a box anywhere in the model by name. Pick one and the canvas
  opens the level it's on, with its panel open.
- Pick a flow in the top bar to play it step by step: ← and → move, Home and End jump to the first
  and last step, Esc stops. A step can be one box doing something on its own, and a step with more
  to say has a More you can open. When a step lands on a box that stands for a part inside it, the
  player names the part too ("Scheduler in Core"), so two steps on two parts of one box don't read
  as a round trip.
- F fits the whole view back on screen, and ? (or the ? button) lists every shortcut.
- "N problems" in the top bar lists what's wrong in the files. Pick one to jump to it. Boxes with
  a problem carry a "!".

The page follows the files: when Claude or your editor changes them, it updates by itself.

## Edit it

Press E, or the Edit button. The browser canvas and the [desktop app](#the-desktop-app) both do everything below, through the same
checks, and write the same text, so a change made in one looks the same in git as one made in the other.

- Drag boxes to arrange the view. Positions go to `flowy/layout.yaml`.
- Drag from the dot under a box onto another box to connect them, then type a label in the panel.
- Add (or N) puts a box in the current view. It offers only the types that fit there: actors and
  systems at the top, apps and stores inside a system, components inside an app or store.
  Double-click an empty system, app or store to open it and add what goes inside.
- Click a box to change its name, type, tech, description and code. A field saves when you leave
  it. Code takes one path per line, relative to the folder that holds `flowy/`. A path that
  doesn't exist shows up as a problem.
- Links takes one per line, as `title | address`, or an address alone. An address is a web address
  (http or https) or a path in the repo, relative to the folder that holds `flowy/`. Anything else
  is refused.
- "Outside service" in a box's panel marks it `external: true`, for things you use but don't own.
- Delete (the key, or the button in the panel) removes the selected box or line. A box that still
  contains others, or that a flow uses, stays, and a notice says why.
- Lines, in edit mode, sets the project's style for everyone: a `lines:` key at the top of
  `model.yaml`, which takes `straight` (the default, so it's left out), `curved` or `angled`.
- Esc or Backspace, straight after dragging a box, take the drag back: whoever has just moved a box and got it wrong reaches for them.
  Once anything else is done (a click, another edit, a move to another level) they close the panel and go up again, as in reading.
  **Z** zooms out whatever you have just done, and Ctrl+Z undoes the last change of any kind.
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

Claude can also link a box to its long documents (`links: [{ title: Runbook, url: docs/runbook.md }]`).
A repo path must exist, and a web address is taken as given.

Claude marks outside services (a payment provider, a third-party API) with `external: true`, so
they show grey.

When Claude saves a flow, Flowy answers with how each step will read on the flow's view, the
way the player shows it ("2. Alert channels → Text and speech in Core: …"). Its instructions ask
for steps that say what passes between the two boxes and whether the sender waits, so a flow
reads the way the code works.

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

## The desktop app

The desktop app is a native reader for the same folders: it reads the YAML itself and draws it with its own renderer, so there is
no server and no browser behind it. It reads and it edits: [Edit it](#edit-it) above is as true of the app as of the browser, and
what it saves, the browser and Claude see, and the other way round. A file that can't be read leaves the last good model on screen
with the reason in a banner, and while it is there editing is off.

Editing in the app: **E** (or the Edit button) turns it on, and the bar gains New flow, Add, Undo, Redo and Tidy. A box's panel becomes
a form (name, type, outside service, tech, description, links, code), and a line's panel has a label field and a delete for each connection it
stands for. Drag a box to move it; the dot under a box starts a connection, which you drop on another box. Each edit is checked first:
one that would add a problem is refused and a notice says why. A file changed elsewhere since the app read it is never overwritten: the
edit is dropped, and the view reloads. **Ctrl+Z** and **Ctrl+Y** undo and redo, but only where the files are still as that edit left
them. The sample model that ships with the app can't be edited.

What it has, as the canvas does: zoom into a box (double-click it, or select it and press Enter; Esc and Backspace go back up, and
the breadcrumb works too), a frame around the box you're inside, boxes that belong to another level faded and dashed, wheel to
zoom and drag to pan, **F** to fit, the side panel with the description, its links, the files a box lives in (as links when the repo's
origin is on GitHub or GitLab), and every connection out and in, flows that play with ← and → (Home and End go to the first and last
step), **Ctrl+K** or **/** to find a box, **?** for the shortcut list, the problem list in the top bar, straight, curved or
right-angled lines, light or dark with the system, and no animation when the system asks for less. **Opening a box that sits
beside the one you're in slides across instead of zooming in.**

The links in a box's panel open on your computer. A web address opens in the browser, a folder in the file explorer, and a file in your
default app if it is a document (Markdown, text, PDF, a common image). Any other file, such as a script or a program, is shown in its
folder and not run. A small folder button beside each file shows it in its folder. **File › Open Files With** picks an app of your own to
open files with (any file inside the repo), and that choice stays on your computer, never in the repo.

What it adds is a way to choose the model:

- **File › Open Folder** (Ctrl+O) takes a repo or its `flowy/` folder. A folder called `flowy` is
  used as it is; otherwise the `flowy/` inside it, and with none of those, the folder itself if it holds `model.yaml`. If there is
  none, the app says so. Opening never creates files; only an edit does.
- Drop a folder on a window, pick one from **File › Open Recent**, or start the app with a path: `FlowyDocs.exe path\to\repo`. If
  the app is already running, the folder opens there.
- On Windows the installer adds **Open with Flowy Docs** to the right-click menu of a folder and of a folder's empty space (under
  *Show more options* on Windows 11), and removes it again when you uninstall.
- Each model gets its own window. Opening one that is already open brings its window forward. A window opens at the size, and
  maximized or not, that the last one was closed at.
- **Help › Open the Demo (Plum)**, or the welcome window's button, opens the sample model that ships with the app, so there is
  something to look at before you point it at a repo.

For sharing, **View › Copy as Mermaid** puts the view on screen, or the flow playing, on the clipboard as a fenced Mermaid
diagram, the same text the browser's Mermaid button copies. **View › Save Picture…** saves the diagram, without the top bar and
the panel, as a PNG at twice the size on screen. **File › Reload** (F5) reads the folder again, which is also how to carry on
after the folder was deleted and came back, and **Show in Explorer** (Finder on macOS) opens the model's folder. A model with no
boxes says so instead of showing a blank canvas.

The boxes you haven't dragged are placed by the app's own layout, not by the browser's, so they can sit a little differently
there. Boxes you did drag are where `layout.yaml` says in both. The address that follows the canvas in the browser has no
counterpart in the app.

A few seconds after it starts, an installed copy asks GitHub's Releases whether a newer version exists: **Help › Check for updates
automatically** turns that off and **Help › Check for Updates…** asks once. The macOS build isn't signed, so there the item opens
the download page. Images in descriptions are not fetched; they show as their description in brackets.
