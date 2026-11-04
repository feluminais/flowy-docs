import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'
import { modelFiles } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'

/** A project of systems with the given ids, joined by the given connections, in a folder of its own: for the tests that need a model the Plum demo does not have. */
export function systems(ids: string[], connections: Connection[], meta: Model['meta'] = {}): Model {
  return { ...emptyModel(), meta, objects: Object.fromEntries(ids.map(id => [id, { type: 'system' as const, name: id.toUpperCase() }])), connections }
}

/** Serves `model` from a temporary folder with the project's own server and the built page; `close` stops it and removes the folder. */
export async function serveModel(model: Model, prefix = 'flowy-browser-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  return { dir, url: `http://127.0.0.1:${server.port}/`, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}
