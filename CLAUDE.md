# Flowy Docs

Instructions for AI sessions working on this repository. The skills, agents and docs review they name are in `.claude/`,
and `CONTRIBUTING.md` lists them.

## Text a person sees

Before you add or change any label, key, legend, hint, empty state, notice, tooltip, field label, demo text, or README,
guide or CONTRIBUTING text that describes the UI, read @.claude/ui-text.md and follow it. The short version: when a
sentence explains what a colour, line or shape means, draw the mark and put a one to three word name beside it. Name
things the way a person says them, not the way the data stores them, and use one name per thing in the browser, the
desktop app, the docs and the tests.

## Porting a core change to the desktop

`desktop/Flowy.Core` is a C# twin of part of `src/core` and `src/node`, held equal by `desktop/fixtures`. When a change to a
ported module has to reach the desktop app, follow the `port-to-desktop` skill (`.claude/skills/port-to-desktop`). After the
port, or before merging a change to a ported module, run the `core-twin` agent (`.claude/agents/core-twin.md`, read only) on
the module: it reports where the two cores behave differently and which paths no fixture pins. For what the two readers show
on screen, use `reader-parity` instead.

## Desktop tests: fast set by default

The full `Flowy.App.Tests` suite takes about ten minutes and grows to 6 GB, and several sessions running it at once nearly
froze the machine. The heavy classes carry `[Trait("Weight", "Heavy")]`. Run `dotnet test desktop --filter "Weight!=Heavy"` while you work and
before you say you're done. Run the heavy set (`--filter "Weight=Heavy"`) or the whole suite only when asked, and never
start one while another `Flowy.App.Tests` process is running (check with `Get-Process Flowy.App.Tests`). Give a new class the trait
if it loads the big demo, plays animations or drives whole panels.

## Windows must not pop up over the screen

Sessions often run while the machine is in use for something else. Never open a window in the foreground.

- Don't launch the desktop app (`dotnet run --project desktop/Flowy.App`, `Flowy Docs.exe`) or a browser window to look at something unless it is needed. For pictures of the desktop app, use `--shot`; if a window still has to open, start it minimized or hidden (`Start-Process -WindowStyle Hidden` or `Minimized`) and close it when done.
- Prefer a built-in browser pane or a headless browser over a visible Chrome window.
- Run builds, tests and servers in the background and with hidden windows.
- Never take focus: no `Start-Process` of an app without a window style, no `start`, no `explorer`.
- Nothing rebuilds an installed copy of the app by itself. After a merge to main that touches `desktop/` (not its tests, fixtures or tools) or `docs/demo`, say that the installed app needs a rebuild (`Rebuild Flowy Docs.bat`, on a machine that has one). Never run a reinstall yourself and never say the app was updated: from inside a sandboxed session an uninstall can remove the real app.
