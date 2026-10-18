#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { flowToMermaid, viewToMermaid } from './core/mermaid.ts'
import { exportSite } from './node/export.ts'
import { loadDir } from './node/files.ts'
import { createMcpServer } from './node/mcp.ts'
import { startServer } from './node/server.ts'

const args = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      allowNegative: true,
      options: {
        dir: { type: 'string', default: 'flowy' },
        port: { type: 'string', default: '4321' },
        open: { type: 'boolean', default: true }, // --no-open leaves the browser alone
        out: { type: 'string', default: 'flowy-site' },
        flow: { type: 'string' },
        view: { type: 'string' },
      },
    })
  } catch {
    return undefined // an unknown flag: show the usage line, not a stack trace
  }
})()

/** Best effort: the URL is printed too, in case no browser opens. */
function openBrowser(url: string) {
  const [command, ...rest] =
    process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url]
  spawn(command, rest, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
}

// Vite builds the canvas into dist/ui (npm run build:ui). This path works from src/ and from a compiled dist/.
const ui = fileURLToPath(new URL('../dist/ui', import.meta.url))

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// --flow and --view belong to mermaid. Anywhere else they're a typo, so show the usage line instead of ignoring them.
const mermaidFlags = args?.values.flow !== undefined || args?.values.view !== undefined

if (args?.positionals[0] === 'mcp') {
  await createMcpServer(resolve(args.values.dir)).connect(new StdioServerTransport())
} else if (args?.positionals[0] === 'export' && args.positionals.length === 1 && !mermaidFlags) {
  const out = resolve(args.values.out)
  try {
    const { boxes, flows, problems } = await exportSite({ dir: resolve(args.values.dir), ui, out })
    const found = problems === 0 ? '' : ` It has ${count(problems, 'problem')}, listed on the page.`
    console.log(`Exported ${count(boxes, 'box', 'boxes')} and ${count(flows, 'flow')} to ${out}.${found}\n` +
      "Put the folder on any static host, such as GitHub Pages. Browsers won't run it straight from disk.")
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals[0] === 'mermaid' && args.positionals.length === 1 && (args.values.flow === undefined) !== (args.values.view === undefined)) {
  try {
    const { model } = await loadDir(resolve(args.values.dir))
    process.stdout.write(args.values.flow === undefined ? viewToMermaid(model, args.values.view!) : flowToMermaid(model, args.values.flow))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals.length === 0 && !mermaidFlags && /^\d{1,5}$/.test(args.values.port) && Number(args.values.port) <= 65535) {
  try {
    const dir = resolve(args.values.dir)
    const { port } = await startServer({ dir, ui, port: Number(args.values.port) })
    const url = `http://127.0.0.1:${port}/`
    console.log(`Flowy Docs: ${url}\nShowing ${dir}. Press Ctrl+C to stop.`)
    if (args.values.open) openBrowser(url)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else {
  console.error('Usage: flowy [--dir flowy] [--port 4321] [--no-open]\n       flowy export [--dir flowy] [--out flowy-site]\n       flowy mermaid (--flow <id> | --view <id>) [--dir flowy]\n       flowy mcp [--dir flowy]')
  process.exitCode = 1
}
