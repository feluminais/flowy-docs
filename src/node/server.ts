import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { json } from 'node:stream/consumers'
import type { ModelList } from '../core/modellist.ts'
import { loadState } from './files.ts'
import type { History } from './history.ts'
import { createHistoryApi } from './history-api.ts'
import type { HistoryApi } from './history-api.ts'
import { DEEP } from './models.ts'
import type { Catalog, ModelEntry } from './models.ts'
import { applyWrite } from './writes.ts'

export type Running = { port: number; close: () => Promise<void> }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', // the licence files: shown, not downloaded
  '.md': 'text/plain; charset=utf-8',
}

/**
 * Sent with every answer. The canvas loads only its own files, draws images from them or inline, and talks only to this server. A model's Markdown can
 * name any image address, so an outside one must not load (the desktop app and the VS Code panel already refuse it). No other site may frame the page.
 * Style attributes stay allowed because the canvas positions its shapes with them.
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** PUT /api/file/<path> { version, data } writes a file; DELETE /api/file/flows/<id>.yaml { version } removes a flow. See applyWrite. */
async function write(dir: string, req: IncomingMessage, res: ServerResponse, rel: string, history?: HistoryApi) {
  const body = await json(req).catch(() => undefined)
  const answer = await applyWrite(dir, req.method ?? '', rel, body, history && (() => history.beforeWrite()))
  send(res, answer.status, answer.body)
}

async function serveUi(ui: string, res: ServerResponse, pathname: string) {
  // The path is never URL-decoded: new URL already resolved `..`, and %2f or %5c stay literal characters.
  // Vite's file names are plain ASCII, so they need no decoding.
  const file = join(ui, pathname === '/' ? 'index.html' : pathname)
  try {
    if (!file.startsWith(ui + sep)) throw new Error('outside the UI folder')
    const body = await readFile(file)
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(pathname === '/' ? 'The canvas is not built yet. Run: npm run build:ui' : 'Not found')
  }
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', fail)
      done((server.address() as AddressInfo).port)
    })
  })
}

/** One model the server shows: its folder and, where the server keeps one, its history. `id` is what `?model=` names. */
export type Served = { id: string; name: string; where: string; dir: string; history?: History }

/** The models a search found: listed at /api/models, each opened (history, watcher) when the page first asks for it. */
export type Discovery = { catalog: Catalog; historyFor?: (m: ModelEntry) => History | undefined }

/** A served model with what the server holds for it: the history API, the pages listening for its changes and the folder watcher. */
type Host = { served: Served; steps?: HistoryApi; clients: Set<ServerResponse>; close: () => void }

/** A served model opened: its folder made if missing so it can be watched, its history looked at, and the page told when the files change. */
async function openHost(served: Served, gateMs?: number): Promise<Host> {
  const { dir } = served
  const steps = served.history ? createHistoryApi(served.history, { gateMs }) : undefined
  const clients = new Set<ServerResponse>()
  await mkdir(dir, { recursive: true })
  await steps?.opened() // the first look at a folder, or what changed while nothing was watching, is a step before the first request is answered
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(dir, { recursive: true }, (_event, name) => {
    if (name?.endsWith('.tmp')) return // saveFile's temp files; the rename that follows is reported on its own
    clearTimeout(timer)
    timer = setTimeout(async () => {
      // A change nobody labelled is recorded before the page hears of it, so the list it then asks for already has the step.
      await steps?.filesChanged().catch(() => undefined)
      for (const client of clients) client.write('data: changed\n\n')
    }, 100)
  })
  watcher.on('error', e => console.error(`Stopped watching ${dir} (${e.message}). Restart flowy to get live updates.`))
  return {
    served, steps, clients,
    close: () => {
      watcher.close()
      clearTimeout(timer)
      steps?.close()
    },
  }
}

/** What /api/models answers for models that were named, not searched for. */
const listOf = (models: Served[]): ModelList => ({ models: models.map(({ id, name, where }) => ({ id, name, where })), state: 'done', looked: 0, canDeepen: false, deeper: false })

/**
 * The local server behind the canvas, on 127.0.0.1 only, at `port` or the next free one (0 = any).
 * `dir` is the flowy/ folder, created if missing so it can be watched. `ui` is the built canvas.
 * `history` turns on the step history: the routes under /api/history, recording of the page's edits and of changes made outside.
 * `models` serves several folders instead: every /api route takes `?model=<id>`, and the first one is the default when it is left out.
 * `discovery` lists the folders a search finds under the folder it searches, on top of `models`: the page can start a deeper search and stop it, and a found model is opened on its first request.
 * `gateMs` is how long an edit the page never labels waits before it is recorded without one.
 */
export async function startServer({ dir, ui, port, history, gateMs, models, discovery }: { dir: string; ui: string; port: number; history?: History; gateMs?: number; models?: Served[]; discovery?: Discovery }): Promise<Running> {
  const uiDir = resolve(ui) // serveUi's containment check needs a normalized path
  const first = models ?? [{ id: '', name: '', where: '', dir, history }]
  const hosts = new Map<string, Host>()
  const opening = new Map<string, Promise<Host>>()
  let actualPort = 0

  /** The model's host, opened the first time it is asked for: its folder watched and its history looked at. */
  const open = (served: Served): Promise<Host> => {
    let host = opening.get(served.id)
    if (!host) {
      host = openHost(served, gateMs)
      opening.set(served.id, host)
      void host.then(h => hosts.set(served.id, h), () => opening.delete(served.id))
    }
    return host
  }
  /** The host for `?model=`: the first when it is left out, else a listed one; none when it names nothing. */
  const hostFor = async (asked: string | null): Promise<Host | undefined> => {
    if (asked === null) return await open(first[0])
    const named = first.find(m => m.id === asked)
    if (named) return await open(named)
    const opened = opening.get(asked)
    if (opened) return await opened // its history is made once, with the host
    const found = discovery?.catalog.get(asked)
    return found ? await open({ ...found, history: discovery?.historyFor?.(found) }) : undefined
  }

  const server = createServer(async (req, res) => {
    try {
      // A website can point its own domain at 127.0.0.1 (DNS rebinding); its requests then carry that domain as Host.
      if (req.headers.host !== `127.0.0.1:${actualPort}` && req.headers.host !== `localhost:${actualPort}`)
        return send(res, 403, { error: 'wrong Host header' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/api/models') {
        if (req.method === 'GET') return send(res, 200, discovery ? discovery.catalog.list() : listOf(first))
        return send(res, 405, { error: 'method not allowed' })
      }
      if (url.pathname === '/api/models/scan' && discovery && (req.method === 'POST' || req.method === 'DELETE')) {
        // A search opens many folders, so like a write it takes the header other sites can't send.
        if (req.headers['x-flowy'] !== '1') return send(res, 403, { error: 'missing X-Flowy: 1 header' })
        if (req.method === 'POST') void discovery.catalog.scan(DEEP, true)
        else discovery.catalog.stop()
        await new Promise(r => setTimeout(r, 0)) // the search has marked itself as running
        return send(res, 202, discovery.catalog.list())
      }
      const asked = url.searchParams.get('model')
      const host = await hostFor(asked)
      if (url.pathname.startsWith('/api/') && !host) return send(res, 404, { error: 'unknown model' })
      if (host) {
        const { served: { dir }, steps, clients } = host
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await loadState(dir))
        if (req.method === 'GET' && url.pathname === '/api/events') {
          res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
          // Reconnect 1 s after flowy restarts. Writing at once also pushes the headers through proxies (Vite's dev server).
          res.write('retry: 1000\n\n')
          clients.add(res)
          req.on('close', () => clients.delete(res))
          return
        }
        if ((req.method === 'PUT' || req.method === 'DELETE') && url.pathname.startsWith('/api/file/')) {
          // Browsers only let a page send a custom header to its own origin, so other sites can't write.
          if (req.headers['x-flowy'] !== '1') return send(res, 403, { error: 'missing X-Flowy: 1 header' })
          return await write(dir, req, res, url.pathname.slice('/api/file/'.length), steps)
        }
        const answer = await steps?.handle(req, url)
        if (answer) return send(res, answer.status, answer.body)
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      if (req.method === 'GET' || req.method === 'HEAD') return await serveUi(uiDir, res, url.pathname)
      send(res, 405, { error: 'method not allowed' })
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      else res.end()
    }
  })

  for (const served of first) await open(served)

  for (let p = port; ; p++) {
    try {
      actualPort = await listen(server, p)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || p === 0 || p >= port + 20) {
        for (const host of hosts.values()) host.close()
        throw e
      }
    }
  }

  return {
    port: actualPort,
    close: async () => {
      discovery?.catalog.stop()
      await Promise.allSettled(opening.values()) // a model still opening has a watcher that would keep the process alive
      for (const host of hosts.values()) host.close()
      await new Promise<void>(done => {
        server.close(() => done())
        server.closeAllConnections()
      })
    },
  }
}
