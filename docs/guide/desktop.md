# The desktop app

A native reader and editor of the same folders, with its own renderer and no server. [The canvas](canvas.md), Performance, Failures and Compare hold here too, with the same words and keys, except:

- Address: none.
- A run's tag: no Undo, as in the browser.
- Player: Autoplay and the speed last until it closes.
- A sketch: opens in a window of its own.
- Layout: shapes you haven't dragged can sit a little differently. Dragged ones are where `layout.yaml` says.
- A file that can't be read: the last good model stays, with the reason in a banner and editing off.
- Images in descriptions: never fetched, shown as their description in brackets.
- **View › Copy as Mermaid**: what the browser's button copies. **View › Save Picture…**: a PNG of the diagram at twice its size on screen, with no top bar or panel.
- **File › Reload**: also carries on after the folder was deleted and came back. **Show in Explorer** (Finder on macOS) opens the folder.
- Updates: an installed copy asks GitHub's Releases a few seconds after it starts. **Help › Check for updates automatically** turns that off. **Help › Check for Updates…** asks once, or on macOS opens the download page.

## Links

- Web address: the browser.
- Folder: the file explorer.
- Markdown, text, PDF, common image: the default app.
- Any other file: shown in its folder, never run. The type is the real file's, so a link called `notes.md` that points at a script counts as a script. A folder button beside each file does the same.
- **File › Open Files With** picks your own app for any file in the repo. The choice stays on your computer.

## Opening a model

**File › Open Folder** takes the first that fits: a folder called `flowy`, the `flowy/` inside it, or the folder itself if it holds `model.yaml`. With none, the app says so. Opening never creates files.

- Also: drop a folder on a window, **File › Open Recent**, or `FlowyDocs.exe path\to\repo`. A running app takes the folder.
- **Open with Flowy Docs**: on the right-click menu of a folder and its empty space (under *Show more options* on Windows 11), from the Windows installer until you uninstall.
- Each model has one window, and opening it again brings that forward. A new window takes the size and maximized state of the last one closed.
- **Help › Open the Demo (Plum)**, or the welcome window's button: the sample in the app, with seven made-up load-test runs. It can't be edited.
