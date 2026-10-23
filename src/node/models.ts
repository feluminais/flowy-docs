import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, parse, relative, resolve, sep } from 'node:path'
import type { ModelInfo, ModelList, StoppedBy } from '../core/modellist.ts'

/** One model folder a repo holds. `id` and `where` are its path from the repo root, with `/`; `name` is what a switcher shows. */
export type ModelEntry = ModelInfo & { dir: string }

/** Folders a model is never looked for in: dependencies, build output, test inputs and the repo's own bookkeeping. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'bin', 'obj', 'target', 'vendor', 'coverage', 'publish', 'fixtures', 'AppData', '$RECYCLE.BIN', 'System Volume Information'])

/** How far and how long one search goes: levels of folders below the searched one, folders opened, and milliseconds. */
export type ScanLimits = { depth: number; folders: number; ms: number }

/** The search that runs when flowy starts: shallow and quick, so a wrong folder costs a moment. */
export const QUICK: ScanLimits = { depth: 3, folders: 2000, ms: 1500 }
/** The one the reader asks for on a big project: deep, and it still stops at a size and a time. */
export const DEEP: ScanLimits = { depth: 8, folders: 100_000, ms: 60_000 }

const OPENING_AT_ONCE = 8

/** The model folder at `dir` as an entry: named for the repo folder or system it sits in, like the desktop app's window titles. */
export function entryOf(root: string, dir: string): ModelEntry {
  const full = resolve(dir)
  const where = relative(resolve(root), full).split(sep).join('/')
  const parent = basename(resolve(full, '..'))
  return { id: where, name: basename(full) === 'flowy' && parent !== '' ? parent : basename(full), where, dir: full }
}

const byNearest = (entries: ModelEntry[]): ModelEntry[] => {
  const depth = (e: ModelEntry) => e.where.split('/').length
  return [...entries].sort((a, b) => depth(a) - depth(b) || a.where.localeCompare(b.where))
}

export type ScanResult = { models: ModelEntry[]; looked: number; stoppedBy?: StoppedBy; leftUnopened: boolean }

/**
 * Looks for model folders under `root`, a level at a time so the ones nearest the top come first: a folder called `flowy` that holds a model.yaml.
 * Hidden folders and the ones in SKIPPED are not opened. The search stops at any of `limits`, or when `signal` aborts, and says which; what it
 * found by then is returned. `leftUnopened` is set when a folder was not opened for lying below the depth, so a deeper search may find more.
 */
export async function scanModels(root: string, limits: ScanLimits, { signal, onLooked }: { signal?: AbortSignal; onLooked?: (looked: number) => void } = {}): Promise<ScanResult> {
  const found: ModelEntry[] = []
  const started = Date.now()
  let looked = 0
  let stoppedBy: StoppedBy | undefined
  let leftUnopened = false
  let level = [resolve(root)]
  for (let depth = 1; level.length > 0 && stoppedBy === undefined; depth++) {
    const next: string[] = []
    for (let i = 0; i < level.length && stoppedBy === undefined; i += OPENING_AT_ONCE) {
      const batch = level.slice(i, i + OPENING_AT_ONCE)
      stoppedBy = signal?.aborted ? 'user' : looked + batch.length > limits.folders ? 'folders' : Date.now() - started > limits.ms ? 'time' : undefined
      if (stoppedBy !== undefined) break
      looked += batch.length
      onLooked?.(looked)
      const listed = await Promise.all(batch.map(dir => readdir(dir, { withFileTypes: true }).then(names => ({ dir, names }), () => ({ dir, names: [] as import('node:fs').Dirent[] }))))
      for (const { dir, names } of listed) {
        for (const entry of names) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
          const child = join(dir, entry.name)
          if (entry.name === 'flowy') {
            if (await stat(join(child, 'model.yaml')).then(s => s.isFile(), () => false)) found.push(entryOf(root, child))
            else if (depth < limits.depth) next.push(child)
            else leftUnopened = true
          } else if (depth < limits.depth) next.push(child)
          else leftUnopened = true
        }
      }
    }
    level = next
  }
  return { models: byNearest(found), looked, ...(stoppedBy ? { stoppedBy } : {}), leftUnopened }
}

/** Every model folder under `root` to `depth` levels with no other limit. Empty when there is none. */
export async function findModels(root: string, depth = 5): Promise<ModelEntry[]> {
  return (await scanModels(root, { depth, folders: Infinity, ms: Infinity })).models
}

/** Whether `root` is somewhere nobody keeps one project: a whole drive or the home folder. */
export function broadOf(root: string): 'drive' | 'home' | undefined {
  const full = resolve(root)
  return full === parse(full).root ? 'drive' : full === resolve(homedir()) ? 'home' : undefined
}

/**
 * The models of a folder as the server lists them, and the search for them. The quick search runs first; the deeper one runs when asked and
 * can be stopped. Neither blocks the server: the page asks `list()` while it runs and sees how many folders have been opened.
 * A model found by an earlier search stays listed when a later one stops early.
 */
export class Catalog {
  readonly root: string
  private found = new Map<string, ModelEntry>()
  private result: { looked: number; stoppedBy?: StoppedBy; leftUnopened: boolean } = { looked: 0, leftUnopened: false }
  private running: { looked: number; abort: AbortController } | undefined
  private deeper = false
  private depth = 0 // how many levels the running or last search goes down

  constructor(root: string, seed: ModelEntry[] = []) {
    this.root = resolve(root)
    for (const m of seed) this.found.set(m.id, m)
  }

  /** The folders listed so far, nearest the top first. */
  entries(): ModelEntry[] {
    return byNearest([...this.found.values()])
  }

  /** Lists a folder the search did not find, such as the one flowy makes when the searched folder has no model. */
  add(entry: ModelEntry): void {
    this.found.set(entry.id, entry)
  }

  get(id: string): ModelEntry | undefined {
    return this.found.get(id)
  }

  /** Runs one search to the end and keeps what it found. A second call while one is running waits for that one. */
  async scan(limits: ScanLimits, deeper = false): Promise<void> {
    if (this.running) return
    const abort = new AbortController()
    const running = (this.running = { looked: 0, abort })
    this.deeper = deeper
    this.depth = limits.depth
    try {
      const done = await scanModels(this.root, limits, { signal: abort.signal, onLooked: n => (running.looked = n) })
      for (const m of done.models) this.found.set(m.id, m)
      this.result = { looked: done.looked, stoppedBy: done.stoppedBy, leftUnopened: done.leftUnopened }
    } finally {
      this.running = undefined
    }
  }

  /** Stops the search that is running, keeping what it found. */
  stop(): void {
    this.running?.abort.abort()
  }

  list(): ModelList {
    const { looked, stoppedBy, leftUnopened } = this.result
    const broad = broadOf(this.root)
    return {
      models: this.entries().map(({ id, name, where }) => ({ id, name, where })),
      scope: { root: this.root, depth: this.depth, ...(broad ? { broad } : {}) },
      state: this.running ? 'scanning' : 'done',
      looked: this.running ? this.running.looked : looked,
      ...(!this.running && stoppedBy ? { stoppedBy } : {}),
      canDeepen: !this.running && !this.deeper && (stoppedBy !== undefined || leftUnopened),
      deeper: this.deeper,
    }
  }
}
