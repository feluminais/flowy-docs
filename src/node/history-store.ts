import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import type { Step, StepApp, StepSource } from '../core/history.ts'
import { isMap } from '../core/text.ts'
import { hashBytes } from './files.ts'

/**
 * Where the app keeps what it remembers for one person: FLOWY_STATE_DIR if set, else the application-data folder the desktop app already
 * uses (what .NET calls ApplicationData: %APPDATA% on Windows, ~/.config or XDG_CONFIG_HOME elsewhere), in a folder called "Flowy Docs".
 */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (env.FLOWY_STATE_DIR) return env.FLOWY_STATE_DIR
  if (platform === 'win32') return win32.join(env.APPDATA || win32.join(home, 'AppData', 'Roaming'), 'Flowy Docs')
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, '.config'), 'Flowy Docs')
}

/**
 * The folder name of one project's history: the first 16 hex digits of the SHA-256 of its full path, without one trailing separator, with
 * ASCII letters upper-cased where the file system ignores case (Windows, macOS). Only a to z are folded, so the C# side can match it exactly.
 */
export function historyKey(fullPath: string, platform: NodeJS.Platform = process.platform): string {
  let key = fullPath.replace(/[\\/]$/, '')
  if (platform === 'win32' || platform === 'darwin') key = key.replace(/[a-z]/g, letter => letter.toUpperCase())
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export type Retention = { dropSteps: string[]; keepBlobs: Set<string> }

/** One project's steps and the file contents they name, as plain files under a root. Rules about what to record live in history.ts. */
export type Store = {
  /** Writes each blob that is not there yet, then the step. A half-written file is never visible under its final name. */
  putStep(step: Step, blobs: Map<string, Uint8Array>): Promise<void>
  /** Every readable step, oldest first. A file that is not a step (cut off, misshapen, a temporary file) is skipped. */
  steps(): Promise<Step[]>
  /** The last `count` readable steps, oldest first, reading as few files as it takes. */
  tail(count: number): Promise<Step[]>
  /** The newest readable step, reading as few files as it takes. */
  latest(): Promise<Step | undefined>
  /** How many step files there are, readable or not. */
  count(): Promise<number>
  blob(hash: string): Promise<Uint8Array | undefined>
  /** Deletes the dropped steps, then every blob nothing keeps that is at least `graceMs` old (another program may be about to name a fresh one). */
  prune(plan: Retention, graceMs: number): Promise<void>
  clear(): Promise<void>
}

const SOURCES = new Set<string>(['you', 'ai', 'outside', 'restore', 'first'])
/** Steps recorded before the source was called `ai` say `claude`; they read as `ai`. */
const LEGACY_SOURCES: Record<string, string> = { claude: 'ai' }
const APPS = new Set<string>(['browser', 'desktop', 'mcp'])
const isHash = (text: string): boolean => /^[0-9a-f]{16}$/.test(text)

function parseStep(id: string, text: string): Step | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof body !== 'object' || body === null) return undefined
  const { time, label, source: stored, app, files } = body as Record<string, unknown>
  if (typeof time !== 'string' || typeof label !== 'string') return undefined
  const source = typeof stored === 'string' ? (Object.hasOwn(LEGACY_SOURCES, stored) ? LEGACY_SOURCES[stored] : stored) : undefined
  if (source === undefined || !SOURCES.has(source) || typeof app !== 'string' || !APPS.has(app)) return undefined
  if (!isMap(files)) return undefined
  const named: Record<string, string> = {}
  for (const [path, hash] of Object.entries(files)) {
    if (typeof hash !== 'string' || !isHash(hash)) return undefined
    named[path] = hash
  }
  return { id, time, label, source: source as StepSource, app: app as StepApp, files: named }
}


export function openStore(root: string): Store {
  const stepsDir = `${root}/steps`
  const blobsDir = `${root}/blobs`

  /** Writes through a temporary file, flushed to the disk before the rename, so a power cut leaves the old file or the whole new one. */
  async function writeWhole(path: string, data: string | Uint8Array): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      const file = await open(temp, 'w')
      try {
        await file.writeFile(data)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temp, path)
    } catch (e) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw e
    }
  }

  /** The blob's bytes when they are what its name says; a cut-off or damaged blob reads as missing. */
  async function readBlob(hash: string): Promise<Uint8Array | undefined> {
    try {
      const bytes = new Uint8Array(await readFile(`${blobsDir}/${hash}`))
      return hashBytes(bytes) === hash ? bytes : undefined
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }

  /** The names of the step files, oldest first. */
  async function stepFiles(): Promise<string[]> {
    try {
      return (await readdir(stepsDir)).filter(name => name.endsWith('.json')).sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async function readStep(name: string): Promise<Step | undefined> {
    const text = await readFile(`${stepsDir}/${name}`, 'utf8').catch(() => undefined)
    return text === undefined ? undefined : parseStep(name.slice(0, -'.json'.length), text)
  }

  return {
    async putStep(step, blobs) {
      for (const hash of [...blobs.keys(), ...Object.values(step.files)]) if (!isHash(hash)) throw new Error(`"${hash}" is not a blob name`)
      await mkdir(blobsDir, { recursive: true })
      await mkdir(stepsDir, { recursive: true })
      for (const [hash, bytes] of blobs) {
        if (await readBlob(hash)) continue // a damaged one is written again
        // Two programs can write the same blob at once; they write the same bytes, so whoever lost the rename has nothing to redo.
        await writeWhole(`${blobsDir}/${hash}`, bytes).catch(async e => {
          if (!(await readBlob(hash))) throw e
        })
      }
      const { id, ...body } = step
      await writeWhole(`${stepsDir}/${id}.json`, `${JSON.stringify(body)}\n`)
    },

    async steps() {
      return (await Promise.all((await stepFiles()).map(readStep))).filter((step): step is Step => step !== undefined)
    },

    async tail(count) {
      const names = await stepFiles()
      const tail: Step[] = []
      for (let i = names.length - 1; i >= 0 && tail.length < count; i--) {
        const step = await readStep(names[i])
        if (step) tail.unshift(step)
      }
      return tail
    },

    async latest() {
      const names = await stepFiles()
      for (let i = names.length - 1; i >= 0; i--) {
        const step = await readStep(names[i])
        if (step) return step
      }
      return undefined
    },

    async count() {
      return (await stepFiles()).length
    },

    async blob(hash) {
      return isHash(hash) ? readBlob(hash) : undefined
    },

    async prune(plan, graceMs) {
      // Housekeeping that more than one program may do at once, on files a virus scanner may hold: a file that will not go is left for the next trim.
      for (const id of plan.dropSteps) await rm(`${stepsDir}/${id}.json`, { force: true }).catch(() => undefined)
      let names: string[]
      try {
        names = await readdir(blobsDir)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
        throw e
      }
      const now = Date.now()
      for (const name of names) {
        if (!isHash(name) || plan.keepBlobs.has(name)) continue
        try {
          if (now - (await stat(`${blobsDir}/${name}`)).mtimeMs >= graceMs) await rm(`${blobsDir}/${name}`, { force: true })
        } catch {
          // gone already, or in use
        }
      }
    },

    async clear() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
