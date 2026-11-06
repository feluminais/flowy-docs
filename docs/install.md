# Install

Flowy Docs comes three ways. All three read the same `flowy/` folder, edit it the same way and show every save as it happens, so the desktop app and a browser can be open on one model at once.

## The desktop app

There is no release yet. Until the first installer is on [Releases](https://github.com/feluminais/flowy-docs/releases), run the app from a clone with the .NET 10 SDK: `dotnet run --project desktop/Flowy.App`.

**File › Open Folder** opens a repo, and the app redraws whenever a file changes. A repo with several `flowy/` folders has a Model picker in the top bar that opens another in a new tab. [The desktop app](guide/desktop.md#the-desktop-app) lists how it differs from the browser.

Windows is where it has been built and tried. The macOS and Linux packages come from the same workflow but haven't been run. None is signed yet, so Windows shows SmartScreen the first time, and the macOS app needs right-click, then Open, and doesn't update itself.

## The browser version

It runs on any system with Node 22.18 or later, and it is where `export`, the MCP server and the history of the YAML tab live. There is no npm package yet, so it runs from a clone. Build it once:

```bash
git clone https://github.com/feluminais/flowy-docs
cd flowy-docs
npm install
npm run build
```

Then, from the root of the repo you want to document:

```bash
node /path/to/flowy-docs/dist/cli.js
```

It prints a local address (port 4321, or the next free one) and opens it in your browser. The model lives in `./flowy`, which Flowy creates if it's missing. In a whole drive or your home folder with no model, it stops instead.

| Flag | Does |
| --- | --- |
| `--dir <folder>` | Uses another folder. Repeat it to show only some models. The other commands take one |
| `--port <number>` | Picks the port |
| `--no-open` | Skips the browser |

A repo with a model per system (`services/billing/flowy`, `services/dispatch/flowy`) lists every `flowy/` folder under the folder you started in, as a tree in the Model picker. The first search looks 3 levels down and stops at 2,000 folders or 1.5 seconds. **Scan deeper** looks 8 levels down and can be stopped. Hidden folders and `node_modules`, `dist`, `build`, `out`, `bin`, `obj`, `target`, `vendor`, `coverage`, `publish` and `fixtures` are skipped.

`flowy.sh` (macOS, Linux, Git Bash) and `flowy.cmd` (Windows) in the clone run the same command with the same flags, and build on the first run. After a `git pull`, run `npm install` and `npm run build` again. The commands are in [Check it and share it](guide/share.md).

## The VS Code extension

It shows the same canvas in an editor tab, and reads and edits there too. It isn't on the Marketplace yet, so you install a file you build yourself. From a clone of this repo (Node 22.18 or later):

```bash
npm install
npm install --prefix vscode
npm run package:vscode
```

That writes `vscode/flowy-docs-<version>.vsix`. In VS Code, open the Extensions view and choose **… › Install from VSIX…**, or run:

```bash
code --install-extension vscode/flowy-docs-<version>.vsix
```

Then open a repo that has a `flowy/` folder and run **Flowy: Open Docs** from the command palette. It needs VS Code 1.95 or later and a folder on disk that you trust. To update, pull, build the file again and install it again (add `--force` if the version didn't change). More in [vscode/README.md](../vscode/README.md), and how it is packaged in [Maintaining](maintaining.md#packaging-it).

## Let an AI write the model

From the root of the repo you want to document, once the clone is built:

```bash
claude mcp add flowy -- node /path/to/flowy-docs/dist/cli.js mcp
```

That command is for Claude Code. Any other MCP client takes the same command over stdio. Add `--dir <folder>` after `mcp` to keep the files somewhere other than `./flowy`. Then see [Let an AI build it](guide/ai.md#let-an-ai-build-it).
