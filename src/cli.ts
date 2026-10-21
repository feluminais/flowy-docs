#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { flowToMermaid, viewToMermaid } from './core/mermaid.ts'
import { analysisText } from './core/failures.ts'
import { FILE_KINDS, kindOfPath, pathOf } from './core/filekinds.ts'
import { modelOf } from './core/state.ts'
import { exportSite } from './node/export.ts'
import { loadDir, loadReport, loadState } from './node/files.ts'
import { openHistory } from './node/history.ts'
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
        analysis: { type: 'string' },
        format: { type: 'string' },
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
// --analysis and --format belong to failures, in the same way.
const failuresFlags = args?.values.analysis !== undefined || args?.values.format !== undefined

/**
 * `flowy failures`: each analysis as a table. What is wrong with the files goes to stderr, one line each, and makes the exit code 1, so the
 * command can gate a build. Resolves to the exit code.
 */
async function printFailures(dir: string, analysis: string | undefined, format: string): Promise<number> {
  if (format !== 'markdown' && format !== 'csv') {
    console.error(`The format must be markdown or csv, not "${format}".`)
    return 1
  }
  const state = await loadState(dir)
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    console.error(`${file}${line === undefined ? '' : `:${line}`}: ${message}`)
    return 1
  }
  const model = modelOf(state)
  if (analysis !== undefined && !Object.hasOwn(model.failures, analysis)) {
    console.error(`unknown analysis "${analysis}"`)
    return 1
  }
  const ids = analysis === undefined ? Object.keys(model.failures) : [analysis]
  const problems = [...state.problems.filter(p => kindOfPath(p.file) === FILE_KINDS.failure), ...(state.failureProblems ?? [])]
    .filter(p => analysis === undefined || p.file === pathOf(FILE_KINDS.failure, analysis))
  if (ids.length === 0 && problems.length === 0) {
    console.error(`No failure analyses in ${dir}.`)
    return 1
  }
  if (ids.length > 0) process.stdout.write(`${ids.map(id => analysisText(model, id, model.failures[id], format)).join('\n\n')}\n`)
  for (const p of problems) console.error(`${p.file}: ${p.message}`)
  return problems.length > 0 ? 1 : 0
}

/**
 * `flowy check`: every problem in the folder, one line each on stderr, and exit code 1 if there is any, so a person, an AI or a build can tell
 * that a model is sound. It reads what the canvas reads, and also writes every file back in memory, which catches a file that loads but could
 * not be saved again. A model or flow file that can't be read at all is the one error line. Resolves to the exit code.
 */
async function printCheck(dir: string): Promise<number> {
  const { model, runs, problems } = await loadReport(dir)
  for (const p of problems) console.error(`${p.file}: ${p.message}`)
  const what = `${count(Object.keys(model.objects).length, 'shape')}, ${count(Object.keys(model.flows).length, 'flow')}, ${count(Object.keys(model.failures).length, 'failure analysis', 'failure analyses')} and ${count(Object.keys(runs).length, 'load-test run')} in ${dir}`
  if (problems.length === 0) console.log(`No problems in ${what}.`)
  else console.error(`${count(problems.length, 'problem')} in ${what}.`)
  return problems.length > 0 ? 1 : 0
}

if (args?.positionals[0] === 'mcp') {
  const dir = resolve(args.values.dir)
  await createMcpServer(dir, openHistory(dir, { app: 'mcp' })).connect(new StdioServerTransport())
} else if (args?.positionals[0] === 'export' && args.positionals.length === 1 && !mermaidFlags && !failuresFlags) {
  const out = resolve(args.values.out)
  try {
    const { boxes, flows, problems } = await exportSite({ dir: resolve(args.values.dir), ui, out })
    const found = problems === 0 ? '' : ` It has ${count(problems, 'problem')}, listed on the page.`
    console.log(`Exported ${count(boxes, 'shape', 'shapes')} and ${count(flows, 'flow')} to ${out}.${found}\n` +
      "Put the folder on any static host, such as GitHub Pages. Browsers won't run it straight from disk.")
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals[0] === 'mermaid' && args.positionals.length === 1 && !failuresFlags && (args.values.flow === undefined) !== (args.values.view === undefined)) {
  try {
    const { model } = await loadDir(resolve(args.values.dir))
    process.stdout.write(args.values.flow === undefined ? viewToMermaid(model, args.values.view!) : flowToMermaid(model, args.values.flow))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals[0] === 'check' && args.positionals.length === 1 && !mermaidFlags && !failuresFlags) {
  try {
    process.exitCode = await printCheck(resolve(args.values.dir))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals[0] === 'failures' && args.positionals.length === 1 && !mermaidFlags) {
  try {
    process.exitCode = await printFailures(resolve(args.values.dir), args.values.analysis, args.values.format ?? 'markdown')
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else if (args?.positionals.length === 0 && !mermaidFlags && !failuresFlags && /^\d{1,5}$/.test(args.values.port) && Number(args.values.port) <= 65535) {
  try {
    const dir = resolve(args.values.dir)
    const { port } = await startServer({ dir, ui, port: Number(args.values.port), history: openHistory(dir, { app: 'browser' }) })
    const url = `http://127.0.0.1:${port}/`
    console.log(`Flowy Docs: ${url}\nShowing ${dir}. Press Ctrl+C to stop.`)
    if (args.values.open) openBrowser(url)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
} else {
  console.error('Usage: flowy [--dir flowy] [--port 4321] [--no-open]\n       flowy export [--dir flowy] [--out flowy-site]\n       flowy mermaid (--flow <id> | --view <id>) [--dir flowy]\n       flowy check [--dir flowy]\n       flowy failures [--analysis <id>] [--format markdown|csv] [--dir flowy]\n       flowy mcp [--dir flowy]')
  process.exitCode = 1
}
