import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { json } from 'node:stream/consumers'
import { loadState } from './files.ts'
import type { History } from './history.ts'
import { createHistoryApi } from './history-api.ts'
import type { HistoryApi } from './history-api.ts'
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
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
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
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

/**
 * The local server behind the canvas, on 127.0.0.1 only, at `port` or the next free one (0 = any).
 * `dir` is the flowy/ folder, created if missing so it can be watched. `ui` is the built canvas.
 * `history` turns on the step history: the routes under /api/history, recording of the page's edits and of changes made outside.
 * `gateMs` is how long an edit the page never labels waits before it is recorded without one.
 */
export async function startServer({ dir, ui, port, history, gateMs }: { dir: string; ui: string; port: number; history?: History; gateMs?: number }): Promise<Running> {
  const uiDir = resolve(ui) // serveUi's containment check needs a normalized path
  const clients = new Set<ServerResponse>()
  const steps = history ? createHistoryApi(history, { gateMs }) : undefined
  let actualPort = 0

  const server = createServer(async (req, res) => {
    try {
      // A website can point its own domain at 127.0.0.1 (DNS rebinding); its requests then carry that domain as Host.
      if (req.headers.host !== `127.0.0.1:${actualPort}` && req.headers.host !== `localhost:${actualPort}`)
        return send(res, 403, { error: 'wrong Host header' })
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await loadState(dir))
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
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
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      if (req.method === 'GET' || req.method === 'HEAD') return await serveUi(uiDir, res, url.pathname)
      send(res, 405, { error: 'method not allowed' })
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      else res.end()
    }
  })

  await mkdir(dir, { recursive: true })
  await steps?.opened() // the first look at a folder, or what changed while nothing was watching, is a step before the first request is answered
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(dir, { recursive: true }, (_event, name) => {
    if (name?.endsWith('.tmp')) return // saveFile's temp files; the rename that follows is reported on its own
    clearTimeout(timer)
    timer = setTimeout(() => {
      for (const client of clients) client.write('data: changed\n\n')
      void steps?.filesChanged().catch(() => undefined) // a change nobody labelled
    }, 100)
  })
  watcher.on('error', e => console.error(`Stopped watching ${dir} (${e.message}). Restart flowy to get live updates.`))

  for (let p = port; ; p++) {
    try {
      actualPort = await listen(server, p)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || p === 0 || p >= port + 20) {
        watcher.close()
        throw e
      }
    }
  }

  return {
    port: actualPort,
    close: () => new Promise(done => {
      watcher.close()
      clearTimeout(timer)
      steps?.close()
      server.close(() => done())
      server.closeAllConnections()
    }),
  }
}
