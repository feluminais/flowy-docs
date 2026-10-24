# Contributing

Flowy Docs is TypeScript. The server, CLI and MCP server are in `src/node`. Logic that must not touch
Node or the DOM is in `src/core`: its tsconfig has no types, so the typecheck fails if it does. The
canvas is in `ui/` (React and React Flow). Tests are in `test/` and use Node's own runner.

## Before you send a change

```bash
npm install
npm test
npm run typecheck
npm run check:layers
npm run check:unused
node src/cli.ts check
```

`check` lists every problem in `flowy/`, this repo's own model, and exits 1 if there is any. Run it after changing the model, a `code:` path or the checks.
`check:layers` fails when `src/core` imports the server, the page or a Node built-in, or when files import each other in a circle. `check:unused` fails on a file or a
dependency nothing uses.

The same checks run on every pull request (`.github/workflows/ci.yml`): the tests on Windows and Linux, the layer and unused-code checks, an audit of the workflows,
`dotnet test desktop` on both systems, and a browser run (`npm run test:browser`, needs `npx playwright install chromium` once) that opens the built page over the demo
in light and dark and checks it draws, reports no error, fits its window, prints no shape or label over another, and has no serious accessibility problem. Its report
keeps a picture of every page.

`test/properties.test.ts` tries many generated texts (commas, quotes, line breaks, `__proto__`) through the writer and back. When it fails it prints the seed and the
smallest text that breaks it; paste that text into a normal test next to the fix.

Commit messages follow the existing style: `feat(ui): ...`, `fix: ...`, `docs: ...`.

This repo documents itself: `flowy/` is Flowy Docs' own architecture, and `node src/cli.ts` opens it
(after `npm run build:ui`). If a change adds, moves or removes a box, a connection or a flow, update
`flowy/` in the same change. Every `code:` path in it has to exist, so the canvas shows no problems.

## Run it from source

`npm run build` puts the canvas in `dist/ui` and the server in `dist/`. In a clone, `node src/cli.ts` does what
`node dist/cli.js` does, once `npm run build:ui` has built the canvas.

To work on the canvas with hot reload, run Flowy on the example model, then Vite, and open http://localhost:5173:

```bash
node src/cli.ts --dir example --no-open
npm run dev:ui
```

`node src/cli.ts --dir docs/demo/flowy` opens Plum, the made-up delivery service in the README.

## More

[docs/maintaining.md](docs/maintaining.md) has the rest: retaking the pictures and animations, the animation showcase, the
desktop app, the VS Code extension and its packaging, the performance lab, the benchmarks, and the
[canvas checklist](docs/maintaining.md#canvas-checklist) to run before a change to the canvas or the app is merged.
