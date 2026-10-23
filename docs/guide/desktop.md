# The desktop app

What the desktop app does and where it differs from the browser. Part of the [Flowy Docs guide](../guide.md).

## The desktop app

The desktop app is a native reader for the same folders: it reads the YAML itself and draws it with its own renderer, so there is
no server and no browser behind it. It reads and it edits: [Edit it](canvas.md#edit-it) above is as true of the app as of the browser, and
what it saves, the browser and an AI see, and the other way round. A file that can't be read leaves the last good model on screen
with the reason in a banner, and while it is there editing is off.

Editing in the app: **E** (or the Edit button) turns it on, and the bar gains New flow, Add, Undo, Redo and Tidy. A shape's panel becomes
a form (name, type, outside service, tech, look, description, code, links, source, and a store's data), and a line's panel has a label field and a delete for each connection it
stands for. Delete works as it does in the browser: a shape nothing depends on goes at once, with an Undo button in the notice, and one that flows or failure modes use opens the Used by panel ([Edit it](canvas.md#edit-it)). Drag a shape to move it; the dot under a shape starts a connection, which you drop on another shape. Each edit is checked first:
one that would add a problem is refused and a notice says why. A file changed elsewhere since the app read it is never overwritten: the
edit is dropped, and the view reloads. **Ctrl+Z** and **Ctrl+Y** undo and redo, but only where the files are still as that edit left
them. The sample model that ships with the app can't be edited.

What it has, as the canvas does: zoom into a shape (double-click it, or select it and press Enter; Esc and Backspace go back up, and
the breadcrumb works too), a frame around the shape you're inside, shapes that belong to another level faded and dashed, wheel to
zoom and drag to pan, **F** to fit, the side panel with the description, its code, what a store holds (its [Data](data.md#data) section), its links, the files a shape lives in (as links when the repo's
origin is on GitHub or GitLab), and every connection out and in, the rail of icons on the left edge (**O** shows the whole documentation as a tree, **L** lists every flow and plays one, **T** replays load-test runs, **M** lists failure modes; all four are always there, and one with nothing in it says so, as in the browser) and the one on the right for Details, flows that play with ← and → (Home and End go to the first and last
step) with a step's animation, **R** to play it again and **P** to let the flow run on its own, **Ctrl+K** or **/** to find a shape, **?** for the shortcut list, the problem list in the top bar, straight, curved or
right-angled lines, light or dark with the system, and no animation when the system asks for less. **Opening a shape that sits
beside the one you're in slides across instead of zooming in.** It doesn't have the browser's YAML tab (**Y**) yet.

It compares too: the Compare button on a flow row and on the player card, **C** and **X**, Side by side and Swap, the marks, the note and the tag all work as in the
browser, on flows and on runs. See [Compare](compare.md#in-the-desktop-app) for what differs.

The links in a shape's panel open on your computer. A web address opens in the browser, a folder in the file explorer, and a file in your
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
  something to look at before you point it at a repo. It has three made-up load-test runs, so its Performance tab (**T**) works too.

For sharing, **View › Copy as Mermaid** puts the view on screen, or the flow playing, on the clipboard as a fenced Mermaid
diagram, the same text the browser's Mermaid button copies. **View › Save Picture…** saves the diagram, without the top bar and
the panel, as a PNG at twice the size on screen. **File › Reload** (F5) reads the folder again, which is also how to carry on
after the folder was deleted and came back, and **Show in Explorer** (Finder on macOS) opens the model's folder. A model with no
shapes says so instead of showing a blank canvas.

The shapes you haven't dragged are placed by the app's own layout, not by the browser's, so they can sit a little differently
there. Shapes you did drag are where `layout.yaml` says in both. The address that follows the canvas in the browser has no
counterpart in the app.

A few seconds after it starts, an installed copy asks GitHub's Releases whether a newer version exists: **Help › Check for updates
automatically** turns that off and **Help › Check for Updates…** asks once. The macOS build isn't signed, so there the item opens
the download page. Images in descriptions are not fetched; they show as their description in brackets.
