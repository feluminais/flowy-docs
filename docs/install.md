# Install

Flowy Docs comes three ways. All three read the same `flowy/` folder, edit it the same way and show every save as it happens, so the
desktop app and a browser can be open on one model at once.

## The desktop app

Download the installer for your system from [Releases](https://github.com/feluminais/flowy-docs/releases), start it, and open a repo with
**File › Open Folder** (Ctrl+O). It finds the repo's `flowy/` folder, draws it, and redraws it whenever a file changes. No repo handy?
**Help › Open the Demo** shows Plum. [The guide](guide.md#the-desktop-app) lists what the app does.

Windows is where it has been built and tried. The macOS and Linux packages are built by the same workflow but haven't been run.
None of them is signed yet, so Windows shows SmartScreen the first time, and the macOS app needs right-click, then Open, and
doesn't update itself.

## The browser version

It runs on any system that has Node 22.18 or later, and it is where `export`, Claude's MCP server, the YAML tab and failure modes live.
There is no npm package yet, so it runs from a clone. Build it once:

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

It prints a local address (port 4321, or the next free one) and opens it in your browser. The model lives in `./flowy`,
which Flowy creates if it's missing. `--dir <folder>` uses another folder, `--port <number>` picks the port, and
`--no-open` skips the browser. It does everything the app does, plus the commands below, each of which takes `--dir`:

| Command | Does |
| --- | --- |
| `check` | Prints every problem in the folder, one line each, and exits 1 if there is any. The one to run in a build |
| `export` | Writes a read-only copy of the canvas to `./flowy-site` (`--out` picks the folder) |
| `mermaid --flow <id>` or `--view <id>` | Prints a flow as a sequence diagram or a view as a flowchart |
| `failures` | Prints the failure analyses as tables (`--format csv`, `--analysis <id>`) |
| `mcp` | Runs the MCP server for Claude |

`flowy.sh` (macOS, Linux, Git Bash) and `flowy.cmd` (Windows) in the clone run the same command with the same flags, and
build on the first run. After a `git pull`, run `npm install` and `npm run build` again.

## The VS Code extension

It shows the same canvas in an editor tab, and reads and edits there too. It isn't on the Marketplace yet, so you install it from a
file you build yourself. From a clone of this repo (Node 22.18 or later):

```bash
npm install
npm install --prefix vscode
npm run package:vscode
```

That writes `vscode/flowy-docs-<version>.vsix`. In VS Code, open the Extensions view, choose **… › Install from VSIX…** and pick the
file, or run:

```bash
code --install-extension vscode/flowy-docs-<version>.vsix
```

Then open a repo that has a `flowy/` folder and run **Flowy: Open Docs** from the command palette (Ctrl+Shift+P). It needs VS Code
1.95 or later and a folder on disk that you trust. To update, pull, build the file again and install it again (add `--force` to the
command above if the version didn't change). More in [vscode/README.md](../vscode/README.md), and how it is packaged in
[CONTRIBUTING.md](../CONTRIBUTING.md#packaging-it).

## Let Claude write the model

From the root of the repo you want to document, once the clone is built:

```bash
claude mcp add flowy -- node /path/to/flowy-docs/dist/cli.js mcp
```

Any other MCP client takes that command over stdio. Then ask Claude "map this repo into Flowy". [The guide](guide.md#let-claude-build-it)
says what it writes and lists the tools.
