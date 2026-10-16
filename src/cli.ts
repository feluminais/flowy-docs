#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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

if (args?.positionals[0] === 'mcp') {
  await createMcpServer(resolve(args.values.dir)).connect(new StdioServerTransport())
} else if (args?.positionals.length === 0 && /^\d{1,5}$/.test(args.values.port) && Number(args.values.port) <= 65535) {
  const dir = resolve(args.values.dir)
  // Vite builds the canvas into dist/ui (npm run build:ui). This path works from src/ and from a compiled dist/.
  const ui = fileURLToPath(new URL('../dist/ui', import.meta.url))
  const { port } = await startServer({ dir, ui, port: Number(args.values.port) })
  const url = `http://127.0.0.1:${port}/`
  console.log(`Flowy Docs: ${url}\nShowing ${dir}. Press Ctrl+C to stop.`)
  if (args.values.open) openBrowser(url)
} else {
  console.error('Usage: flowy [--dir flowy] [--port 4321] [--no-open]\n       flowy mcp [--dir flowy]')
  process.exitCode = 1
}
