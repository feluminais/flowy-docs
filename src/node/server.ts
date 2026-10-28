import { createHash } from 'node:crypto'
import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { draftFolder, splitDraftModelId } from '../core/drafts.ts'
import type { ModelList } from '../core/modellist.ts'
import type { State } from '../core/state.ts'
import { jsonBody } from './body.ts'
import { draftDir, hasDraft } from './drafts.ts'
import { loadState } from './files.ts'
import type { History } from './history.ts'
import { createHistoryApi } from './history-api.ts'
import type { HistoryApi } from './history-api.ts'
import { DEEP } from './models.ts'
import type { Catalog, ModelEntry } from './models.ts'
import { PAGE_POLICY } from './policy.ts'
import { applyNewDraft, applyWrite } from './writes.ts'

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

/** Sent with every answer: the page's policy (see PAGE_POLICY), and no other site may frame the page. */
const SECURITY_HEADERS = {
  'Content-Security-Policy': `${PAGE_POLICY}; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** A state as it is sent: its text and tag made once, and its compressed text the first time a page asks for it. */
type Sent = { body: Buffer; etag: string; packed?: Promise<Buffer> }
const sent = new WeakMap<State, Sent>()
const GZIP_FROM = 32 * 1024 // under this the saving is not worth the wait

/**
 * GET /api/state. The same state (loadState gives the same object while the files are unchanged) is turned into text once, tagged with a hash of it and compressed once. A page that
 * already holds that text is told so (304) instead of being sent it again; the tag is why the answer is `no-cache` (keep it, but ask) and not `no-store`.
 */
async function sendState(req: IncomingMessage, res: ServerResponse, state: State) {
  let made = sent.get(state)
  if (!made) {
    const body = Buffer.from(JSON.stringify(state))
    sent.set(state, (made = { body, etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"` }))
  }
  const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: made.etag, Vary: 'Accept-Encoding' }
  if (req.headers['if-none-match'] === made.etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  if (made.body.length >= GZIP_FROM && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    made.packed ??= promisify(gzip)(made.body)
    const packed = await made.packed
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': packed.length })
    res.end(packed)
    return
  }
  res.writeHead(200, { ...headers, 'Content-Length': made.body.length })
  res.end(made.body)
}

/**
 * The path a request names: each part of it percent-decoded, since a folder of flows can have a space or an & in its name and the page sends it encoded. A part that does not decode,
 * or that decodes to a slash or a backslash (a %2f stays a literal character, as in serveUi), makes the whole path unwritable ("").
 */
export function writtenPath(encoded: string): string {
  try {
    const parts = encoded.split('/').map(decodeURIComponent)
    return parts.some(p => p.includes('/') || p.includes('\\')) ? '' : parts.join('/')
  } catch {
    return ''
  }
}

/** PUT /api/file/<path> { version, data } writes a file; DELETE /api/file/flows/<id>.yaml { version } removes a flow. See applyWrite. */
async function write(dir: string, req: IncomingMessage, res: ServerResponse, rel: string, history?: HistoryApi) {
  const body = await jsonBody(req)
  const answer = await applyWrite(dir, req.method ?? '', rel, body, history && (() => history.beforeWrite()))
  send(res, answer.status, answer.body)
}

async function makeDraft(dir: string, req: IncomingMessage, res: ServerResponse, model: string) {
  const answer = await applyNewDraft(dir, model, await jsonBody(req))
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
type Host = { served: Served; steps?: HistoryApi; clients: Set<ServerResponse>; close: () => Promise<void> }

/** A served model opened: its folder made if missing so it can be watched, its history looked at, and the page told when the files change. */
async function openHost(served: Served, gateMs?: number): Promise<Host> {
  const { dir } = served
  const steps = served.history ? createHistoryApi(served.history, { gateMs }) : undefined
  const clients = new Set<ServerResponse>()
  await mkdir(dir, { recursive: true })
  await steps?.opened() // the first look at a folder, or what changed while nothing was watching, is a step before the first request is answered
  let timer: ReturnType<typeof setTimeout> | undefined
  const recording = new Set<Promise<void>>() // what the watcher has started writing, which close waits for
  const watcher = watch(dir, { recursive: true }, (_event, name) => {
    if (name?.endsWith('.tmp')) return // saveFile's temp files; the rename that follows is reported on its own
    clearTimeout(timer)
    timer = setTimeout(() => {
      const changed = (async () => {
        // A change nobody labelled is recorded before the page hears of it, so the list it then asks for already has the step.
        await steps?.filesChanged().catch(() => undefined)
        for (const client of clients) client.write('data: changed\n\n')
      })()
      recording.add(changed)
      void changed.finally(() => recording.delete(changed))
    }, 100)
  })
  watcher.on('error', e => console.error(`Stopped watching ${dir} (${e.message}). Restart flowy to get live updates.`))
  return {
    served, steps, clients,
    close: async () => {
      watcher.close()
      clearTimeout(timer)
      await Promise.allSettled(recording)
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
    if (found) return await open({ ...found, history: discovery?.historyFor?.(found) })
    return await draftHost(asked)
  }
  /** The host of a draft of a served model, when `asked` names one that is there. A draft keeps no history: the history is its model folder's. */
  const draftHost = async (asked: string): Promise<Host | undefined> => {
    const named = splitDraftModelId(asked)
    if (!named) return undefined
    const owner = await hostFor(named.model === '' ? null : named.model)
    if (!owner || !hasDraft(owner.served.dir, named.id)) return undefined
    const where = owner.served.where === '' ? draftFolder(named.id) : `${owner.served.where}/${draftFolder(named.id)}`
    return await open({ id: asked, name: named.id, where, dir: draftDir(owner.served.dir, named.id) })
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
        if (req.method === 'GET' && url.pathname === '/api/state') return await sendState(req, res, await loadState(dir))
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
          return await write(dir, req, res, writtenPath(url.pathname.slice('/api/file/'.length)), steps)
        }
        if (req.method === 'POST' && url.pathname === '/api/drafts') {
          if (req.headers['x-flowy'] !== '1') return send(res, 403, { error: 'missing X-Flowy: 1 header' })
          return await makeDraft(dir, req, res, host.served.id)
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
        await Promise.all([...hosts.values()].map(host => host.close()))
        throw e
      }
    }
  }

  return {
    port: actualPort,
    close: async () => {
      discovery?.catalog.stop()
      await Promise.allSettled(opening.values()) // a model still opening has a watcher that would keep the process alive
      await Promise.all([...hosts.values()].map(host => host.close())) // a step the watcher is writing is finished, so nothing is written after close
      await new Promise<void>(done => {
        server.close(() => done())
        server.closeAllConnections()
      })
    },
  }
}
