// node bench/server.ts : what the server does to answer a page, for a folder of 2,000 shapes and 300 flows on disk.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gen, load, fmt } from './gen.ts'
import { modelFiles, serializeLayout } from '../src/core/modelfiles.ts'

const files = await load<typeof import('../src/node/files.ts')>('src/node/files.ts')
const server = await load<typeof import('../src/node/server.ts')>('src/node/server.ts')

const model = gen({ systems: 25, apps: 6, components: 12, linesPerShape: 1.8, flows: 300, stepsPerFlow: 20, modes: 150, savedLayout: true })
const root = await mkdtemp(join(tmpdir(), 'flowy-bench-'))
const dir = join(root, 'flowy')
await mkdir(join(dir, 'flows'), { recursive: true })
await mkdir(join(dir, 'failures'), { recursive: true })
for (const [rel, text] of Object.entries(modelFiles(model))) await writeFile(join(dir, rel), text)
await writeFile(join(dir, 'layout.yaml'), serializeLayout(model.layout))
console.log(`${Object.keys(model.objects).length} shapes, ${model.connections.length} lines, ${Object.keys(model.flows).length} flows`)

const once = async (fn: () => unknown) => {
  const t = performance.now()
  await fn()
  return performance.now() - t
}
const row = (what: string, ms: number) => console.log(what.padEnd(64) + fmt(ms).padStart(8) + ' ms')
row('first read of the folder', await once(() => files.loadState(dir)))
let ms = 0
for (let i = 0; i < 5; i++) ms += await once(() => files.loadState(dir))
row('read again, nothing changed (mean of 5)', ms / 5)
row('20 pages ask at once, after a save', await once(async () => { await Promise.all(Array.from({ length: 20 }, () => files.loadState(dir))) }))

// One flow edited: what a page waits for after its own save.
const flow = join(dir, 'flows', 'flow-0.yaml')
const { readFile } = await import('node:fs/promises')
await writeFile(flow, (await readFile(flow, 'utf8')) + '\n# edited\n')
row('read after one flow file changed', await once(() => files.loadState(dir)))

const running = await server.startServer({ dir, ui: join(root, 'ui'), port: 0 })
const url = `http://127.0.0.1:${running.port}/api/state`
const ask = async (headers: Record<string, string> = {}) => {
  const t = performance.now()
  const res = await fetch(url, { headers: { Host: `127.0.0.1:${running.port}`, ...headers } })
  const body = await res.arrayBuffer()
  return { ms: performance.now() - t, res, size: body.byteLength }
}
const first = await ask({ 'Accept-Encoding': 'identity' })
row(`GET /api/state, first (${(first.size / 1024).toFixed(0)} KB)`, first.ms)
const again = await ask({ 'Accept-Encoding': 'identity' })
row('GET /api/state, again', again.ms)
const tag = first.res.headers.get('etag')
if (tag) {
  const same = await ask({ 'If-None-Match': tag, 'Accept-Encoding': 'identity' })
  row(`GET /api/state with the tag (status ${same.res.status})`, same.ms)
}
const packed = await ask({ 'Accept-Encoding': 'gzip' })
row(`GET /api/state with gzip (${packed.res.headers.get('content-encoding') ?? 'no encoding'}, ${(packed.size / 1024).toFixed(0)} KB after unpacking)`, packed.ms)
await running.close()
await rm(root, { recursive: true, force: true })
