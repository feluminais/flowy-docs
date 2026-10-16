# Flowy Docs

Architecture docs you zoom through instead of scrolling through. An open-source take on IcePanel.

Your architecture lives as YAML in your repo, in a `flowy/` folder: systems, apps, stores and
components, the connections between them, and step-by-step flows. Readers start at the big
picture and zoom in only where they need to.

**Status:** early. The model and the MCP server work. The canvas comes next.

## Let Claude build it

Clone this repo and run `npm install` in it (needs Node 22.18 or later). Then, from the root of
the repo you want to document:

```bash
claude mcp add flowy -- node "<path to this repo>/src/cli.ts" mcp
```

Then ask Claude something like "map this repo into Flowy". It writes `flowy/model.yaml` and
`flowy/flows/*.yaml`, and refuses any change that would break the model. Add `--dir <folder>`
after `mcp` to keep the files somewhere other than `./flowy`.

Saving rewrites the file, so YAML comments in `model.yaml` and flow files aren't kept. Put
notes in an object's `description` instead.

## Develop

Needs Node 22.18 or later.

```bash
npm install
npm test
npm run typecheck
```
