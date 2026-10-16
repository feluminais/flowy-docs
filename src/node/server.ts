import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, sep } from 'node:path'
import { json } from 'node:stream/consumers'
import { check } from '../core/check.ts'
import { ParseError, parseFile, serializeFile } from '../core/model.ts'
import type { State } from '../core/state.ts'
import { isAllowedPath, loadDir, saveFile, VersionConflict } from './files.ts'

export type Running = { port: number; close: () => Promise<void> }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function state(dir: string): Promise<State> {
  try {
    const { model, versions } = await loadDir(dir)
    const { flows, layout, ...rest } = model
    return { model: rest, layout, flows, problems: check(model), versions }
  } catch (e) {
    if (e instanceof ParseError) return { parseError: { file: e.file, line: e.line, message: e.reason } }
    throw e
  }
}

/** PUT /api/file/<path> { version, data } writes a file; DELETE /api/file/flows/<id>.yaml { version } removes a flow. */
async function write(dir: string, req: IncomingMessage, res: ServerResponse, rel: string) {
  if (!isAllowedPath(rel) || (req.method === 'DELETE' && !rel.startsWith('flows/')))
    return send(res, 400, { error: `can't write "${rel}"` })
  const body = (await json(req).catch(() => undefined)) as { version?: unknown; data?: unknown } | undefined
  const version = body?.version
  if (typeof version !== 'string' && version !== null)
    return send(res, 400, { error: 'the body needs "version": the file\'s version from /api/state, or null for a new file' })
  if (req.method === 'PUT' && body?.data === undefined) return send(res, 400, { error: 'the body needs "data"' })
  try {
    await loadDir(dir) // nothing is written while any file fails to parse
  } catch (e) {
    if (e instanceof ParseError) return send(res, 409, { error: e.message })
    throw e
  }
  let text: string | null = null
  if (req.method === 'PUT') {
    try {
      text = serializeFile(rel, body?.data)
      parseFile(rel, text) // never write what can't be read back
    } catch (e) {
      return send(res, 400, { error: `not a valid ${rel}: ${e instanceof ParseError ? e.reason : String(e)}` })
    }
  }
  try {
    send(res, 200, { version: await saveFile(dir, rel, text, version) })
  } catch (e) {
    if (e instanceof VersionConflict) return send(res, 409, { version: e.version })
    throw e
  }
}

async function serveUi(ui: string, res: ServerResponse, pathname: string) {
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
 * `dir` is the flowy/ folder. `ui` is the built canvas.
 */
export async function startServer({ dir, ui, port }: { dir: string; ui: string; port: number }): Promise<Running> {
  let actualPort = 0

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // A website can point its own domain at 127.0.0.1 (DNS rebinding); its requests then carry that domain as Host.
      if (req.headers.host !== `127.0.0.1:${actualPort}` && req.headers.host !== `localhost:${actualPort}`)
        return send(res, 403, { error: 'wrong Host header' })
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, await state(dir))
      if ((req.method === 'PUT' || req.method === 'DELETE') && url.pathname.startsWith('/api/file/')) {
        // Browsers only let a page send a custom header to its own origin, so other sites can't write.
        if (req.headers['x-flowy'] !== '1') return send(res, 403, { error: 'missing X-Flowy: 1 header' })
        return await write(dir, req, res, url.pathname.slice('/api/file/'.length))
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' })
      if (req.method === 'GET' || req.method === 'HEAD') return await serveUi(ui, res, url.pathname)
      send(res, 405, { error: 'method not allowed' })
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      else res.end()
    }
  })

  for (let p = port; ; p++) {
    try {
      actualPort = await listen(server, p)
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || p === 0 || p >= port + 20) throw e
    }
  }

  return {
    port: actualPort,
    close: () => new Promise(done => {
      server.close(() => done())
      server.closeAllConnections()
    }),
  }
}
