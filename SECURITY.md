# Security

## Reporting a vulnerability

Please report a vulnerability privately, not in a public issue. Use
[Report a vulnerability](https://github.com/feluminais/flowy-docs/security/advisories/new) on the Security tab. Say what you
found, the version or commit, and how to reproduce it. This is a one-person project, so a first answer can take a few days.

Only the latest release and `main` get fixes.

## What Flowy touches

Flowy runs on your machine and touches only its model folder and its own folder under your application data.

- The browser version listens on 127.0.0.1, so other computers can't reach it. It refuses a request whose Host isn't
  `127.0.0.1` or `localhost` on its own port, and it saves only when a request carries a header that a web page open in
  another tab can't send. A website can't change your files through it. Every answer carries a content policy: the page loads only
  its own files and talks only to this server, and no other site may frame it. The server doesn't follow a link inside the model
  folder that leads outside it, to read or to write.
- Saving, from the canvas or from an AI, writes `model.yaml`, `layout.yaml`, `flows/*.yaml` and `failures/*.yaml` in the model folder and
  nothing else; the load-test runs in `perf/` are only ever read. `export` writes only to its output folder. The desktop app writes only when you edit, and only `model.yaml`, `layout.yaml` and `flows/*.yaml`, each
  through a temporary file and only if the file is still as it was read, so it can't overwrite a change made elsewhere.
- The browser version's YAML history is in its own folder under your application data (`FLOWY_STATE_DIR` moves it), never in the
  repo. Opening a folder stores a copy of its YAML there, and each change adds another.
- It never opens your code. For `code:` paths it checks that they exist, and it runs `git` with fixed arguments to read
  the `origin` URL and the branch for the links.
- It makes no network requests of its own: no telemetry, no CDN, no fonts. The page talks only to its local server.
  The desktop app adds one: a few seconds after it starts, an installed copy asks GitHub's Releases whether a newer version
  exists, and **Help › Check for updates automatically** turns that off. It fetches no remote images from descriptions (they show
  as their description in brackets) and shows where a link goes when you point at it. A web link opens only if it is an `http`
  or `https` address. A repo path opens only if it is a real file or folder inside the repo: a folder in the explorer, a
  document in its default app, anything else shown in its folder and not run (an app you pick under **File › Open Files
  With** may open any file in the repo). It keeps its recent folders, window size, line-style pick and that app in
  `state.json` in its own folder under your application data.
- Through the `mcp` command, an AI client gets seventeen tools: five read the model and twelve change its objects, icons,
  connections, flows and failure analyses. None runs a command or reads a file outside the model folder.

Treat a `flowy/` folder you didn't write like any other text from that repo. In the browser, descriptions are Markdown. An
image in one is not fetched, because the page's content policy allows only its own files, and an AI reads the descriptions back through MCP.
