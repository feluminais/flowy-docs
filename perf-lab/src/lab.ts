import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { Agent, createServer, request } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { Lru } from './cache.ts'
import { Db, PAGES } from './db.ts'
import { JobQueue, Slots } from './queue.ts'
import { Busy, Ratio, Stats } from './stats.ts'

export type LabOptions = {
  /** A folder for the database and the uploaded files. */
  dir: string
  /** Where the payment gateway listens, e.g. http://127.0.0.1:4801. */
  gatewayUrl: string
  /** Jobs the fulfilment worker runs at once. */
  workers?: number
  /** Uploads written to disk at once. */
  writeSlots?: number
  /** Catalog pages the cache holds, of 60. */
  cachePages?: number
  /** Rounds of hashing a report does. */
  reportRounds?: number
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const json = (res: ServerResponse, status: number, body: unknown): number => {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  return status
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'the body is too big')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * The shop: a web API (catalog, orders, reports), a file API (uploads and downloads), one SQLite database, a catalog
 * cache, an order queue with a fulfilment worker, and calls out to a payment gateway. Every part is real code with a
 * limit of its own, and everything it does is measured into `stats`, which `GET /__stats` hands out and resets.
 */
export function createLab(options: LabOptions) {
  const { dir, gatewayUrl } = options
  const workers = options.workers ?? 4
  const writeSlots = options.writeSlots ?? 8
  const reportRounds = options.reportRounds ?? 40_000
  mkdirSync(join(dir, 'uploads'), { recursive: true })
  writeFileSync(join(dir, 'seed.bin'), randomBytes(200_000))

  const stats = new Stats()
  const db = new Db(join(dir, 'shop.db'))
  const cache = new Lru<unknown[]>(options.cachePages ?? 20)
  const slots = new Slots(writeSlots)
  const reportBusy = new Busy()
  const jobs = new Ratio()
  const responses = new Ratio()
  const agent = new Agent({ keepAlive: true, maxSockets: 256 })

  const toWebApi = stats.edge('shopper', 'web-api')
  const toFileApi = stats.edge('shopper', 'file-api')
  const catalogToCache = stats.edge('catalog', 'cache')
  const catalogToDb = stats.edge('catalog', 'sqlite')
  const ordersToDb = stats.edge('orders', 'sqlite')
  const ordersToPayments = stats.edge('orders', 'payments')
  const ordersToQueue = stats.edge('orders', 'queue')
  const queueToWorker = stats.edge('queue', 'worker')
  const workerToDb = stats.edge('worker', 'sqlite')
  const workerToPayments = stats.edge('worker', 'payments')
  const fileApiToFiles = stats.edge('file-api', 'files')
  const reportsToDb = stats.edge('reports', 'sqlite')

  const callGateway = (op: 'authorize' | 'capture', id: number, amount: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const req = request(new URL(`/${op}`, gatewayUrl), { method: 'POST', agent, timeout: 5000 }, res => {
        res.resume()
        res.on('end', () => ((res.statusCode ?? 500) < 300 ? resolve() : reject(new Error(`the gateway answered ${res.statusCode}`))))
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('the gateway timed out')))
      req.end(JSON.stringify({ id, amount }))
    })

  const queue = new JobQueue(workers, async (id, waited) => {
    queueToWorker.record(waited)
    try {
      db.get(workerToDb, 'SELECT status FROM orders WHERE id = ?', id)
      await workerToPayments.track(() => callGateway('capture', id, 0))
      db.run(workerToDb, "UPDATE orders SET status = 'fulfilled' WHERE id = ?", id)
      jobs.hit(true)
    } catch {
      db.run(workerToDb, "UPDATE orders SET status = 'capture_failed' WHERE id = ?", id)
      jobs.hit(false)
    }
  })

  // What each object reports at a snapshot: how busy, how many are waiting, how many went wrong.
  let eventLoop = performance.eventLoopUtilization()
  stats.probe('web-api', 'util', () => {
    const now = performance.eventLoopUtilization()
    const share = performance.eventLoopUtilization(now, eventLoop).utilization
    eventLoop = now
    return share
  })
  stats.probe('web-api', 'errors', () => responses.take())
  stats.probe('reports', 'util', () => reportBusy.take(1))
  stats.probe('sqlite', 'util', () => db.busy.take(1))
  stats.probe('files', 'util', () => slots.busy.take(writeSlots))
  stats.probe('files', 'queue', () => slots.queued)
  stats.probe('queue', 'queue', () => queue.depth)
  stats.probe('worker', 'util', () => queue.busy.take(workers))
  stats.probe('worker', 'errors', () => jobs.take())

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<number> {
    const { pathname } = url
    if (req.method === 'GET' && pathname === '/catalog') {
      const page = Math.min(PAGES, Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1))
      const t = performance.now()
      const hit = cache.get(page)
      catalogToCache.record(performance.now() - t)
      if (hit) return json(res, 200, hit)
      const rows = db.all(catalogToDb, 'SELECT id, name, price FROM products WHERE page = ?', page)
      cache.set(page, rows)
      return json(res, 200, rows)
    }
    if (req.method === 'POST' && pathname === '/orders') {
      const body = await readBody(req, 10_000)
      const amount = Number((JSON.parse(body.toString() || '{}') as { amount?: unknown }).amount) || 10
      const id = db.run(ordersToDb, 'INSERT INTO orders (status, amount, created) VALUES (?, ?, ?)', 'placed', amount, Date.now())
      try {
        await ordersToPayments.track(() => callGateway('authorize', id, amount))
      } catch {
        db.run(ordersToDb, "UPDATE orders SET status = 'declined' WHERE id = ?", id)
        throw new HttpError(502, 'the payment could not be authorized')
      }
      db.run(ordersToDb, "UPDATE orders SET status = 'authorized' WHERE id = ?", id)
      const t = performance.now()
      queue.push(id)
      ordersToQueue.record(performance.now() - t)
      return json(res, 201, { id })
    }
    if (req.method === 'GET' && pathname === '/reports') {
      const rows = db.all(reportsToDb, 'SELECT id, status, amount FROM orders ORDER BY id DESC LIMIT 200')
      reportBusy.enter()
      let digest = Buffer.from(JSON.stringify(rows))
      for (let i = 0; i < reportRounds; i++) digest = createHash('sha256').update(digest).digest()
      reportBusy.leave()
      return json(res, 200, { rows: rows.length, digest: digest.toString('hex') })
    }
    if (req.method === 'POST' && pathname === '/uploads') {
      const body = await readBody(req, 1_000_000)
      const id = randomBytes(8).toString('hex')
      await fileApiToFiles.track(() => slots.run(() => writeFile(join(dir, 'uploads', id), body, { flush: true })))
      return json(res, 201, { id })
    }
    if (req.method === 'GET' && pathname === '/files/seed') {
      await fileApiToFiles.track(async () => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        await pipeline(createReadStream(join(dir, 'seed.bin')), res)
      })
      return 200
    }
    return json(res, 404, { error: 'not found' })
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://lab')
      if (url.pathname === '/__stats') {
        json(res, 200, stats.snapshot())
        return
      }
      const t = performance.now()
      const files = url.pathname.startsWith('/uploads') || url.pathname.startsWith('/files')
      let status: number
      try {
        status = await route(req, res, url)
      } catch (e) {
        status = e instanceof HttpError ? e.status : 500
        if (res.headersSent) res.destroy()
        else json(res, status, { error: e instanceof Error ? e.message : 'failed' })
      }
      ;(files ? toFileApi : toWebApi).record(performance.now() - t, status < 500)
      if (!files) responses.hit(status < 500)
    })().catch(() => res.destroy())
  })

  // A client that keeps one connection for a long while (the harness reading stats) must not find it closed.
  server.keepAliveTimeout = 600_000

  return {
    stats,
    /** Start listening on a free port; gives the port. */
    listen: () =>
      new Promise<number>(resolve =>
        server.listen({ port: 0, host: '127.0.0.1', backlog: 1024 }, () => {
          const address = server.address()
          resolve(typeof address === 'object' && address ? address.port : 0)
        }),
      ),
    close: async (): Promise<void> => {
      agent.destroy()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      db.close()
    },
  }
}
