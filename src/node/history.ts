import { randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  changedPaths, CLOSED_LABEL, collapseSteps, fallbackLabel, FIRST_LABEL, HISTORY_LIMIT, HISTORY_SLACK, isLabelled, outsideLabel, planRetention,
  sameFiles, stepId, stepInfos,
} from '../core/history.ts'
import type { Step, StepApp, StepFile, StepInfo, StepSource, StepView, YamlNow } from '../core/history.ts'
import { hashBytes, isAllowedPath, pointsOutside, saveRaw, VersionConflict, WRITTEN_FOLDERS } from './files.ts'
import { defaultStateDir, historyKey, openStore } from './history-store.ts'

export type { StepFile, StepView, YamlNow }

/** The files a step covers, as they are on disk now: each path's version, and the bytes behind each version. */
export type Snapshot = { files: Record<string, string>; bytes: Map<string, Uint8Array> }

/** `saved: false`: the history could not be written. `id`: the step that holds the files as they are now (none when the folder is empty). */
export type Ensured = { saved: boolean; id?: string }

/** `log` is where the one quiet line goes when the history stops being saved: stderr unless given. */
export type HistoryOptions = { app: StepApp; stateDir?: string; now?: () => Date; random?: () => string; log?: (line: string) => void }

/** Why a file is not in the snapshot: it was not there. */
const ABSENT = new Set(['ENOENT', 'ENOTDIR', 'EISDIR'])

/** A blob is only deleted once it is this old: another program may have written it just before the step that names it. */
const PRUNE_GRACE_MS = 60_000

// fatal: bytes that are not UTF-8 are reported as such, never shown with replacement characters. ignoreBOM: keep a BOM in the text.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function decode(bytes: Uint8Array): StepFile {
  try {
    return { text: utf8.decode(bytes) }
  } catch {
    return { notText: true }
  }
}

export type History = {
  /** Where this project's trail is kept. */
  readonly root: string
  /** Why the history could not be written the last time it tried, or undefined while it can. */
  readonly failure: string | undefined
  /** The files as they are on disk now. Reads them, never parses them. */
  snapshot(): Promise<Snapshot>
  /** The files as they are on disk now, as text, with their versions. */
  now(): Promise<YamlNow>
  /** The steps, newest first. */
  list(): Promise<StepInfo[]>
  read(id: string): Promise<StepView | undefined>
  /**
   * Records the files as they are now as a step, unless the newest step already holds them. A labelled step still goes in over an identical
   * unlabelled one, so what happened is told. A missing label becomes "Changed <files>". Never throws; undefined if nothing was written.
   */
  record(label: string | undefined, source: StepSource): Promise<Step | undefined>
  /** Before Flowy writes, or when something noticed a change: makes sure the files as they are now are the newest step. Never throws. */
  ensureCurrent(why: 'open' | 'watch' | 'write'): Promise<Ensured>
  /**
   * Puts the files of an earlier step back: every file the step has is written from its saved bytes, every file Flowy may write that the step
   * lacks is removed, and "Restored" goes on top of the list. `seen` is the version of each file the caller last read (absent: the file was not
   * there); if any file is different now, nothing is written. Works however broken the files are.
   */
  restore(id: string, seen: Record<string, string | null>, label: string): Promise<RestoreResult>
  /** Deletes the whole trail. Never throws. */
  clear(): Promise<void>
}

/** `before` is the step that holds the files as they were just before the restore, so a restore can be undone by restoring it. */
export type RestoreResult =
  | { ok: true; versions: Record<string, string | null>; before?: string }
  | { ok: false; kind: 'unknown' | 'conflict' | 'unsaved' | 'failed'; message: string }

const CHANGED_OUTSIDE = 'This file changed outside Flowy. Reloaded.'

export function openHistory(dir: string, options: HistoryOptions): History {
  const root = join(options.stateDir ?? defaultStateDir(), 'history', historyKey(resolve(dir)))
  const store = openStore(root)
  const clock = options.now ?? (() => new Date())
  const random = options.random ?? (() => randomBytes(3).toString('hex'))
  const log = options.log ?? ((line: string) => console.error(line))
  let failure: string | undefined
  let lastMs = 0

  async function snapshot(): Promise<Snapshot> {
    const files: Record<string, string> = {}
    const bytes = new Map<string, Uint8Array>()
    const add = async (rel: string) => {
      if (await pointsOutside(dir, rel)) return // a link out of the folder is not part of the model, so it is not kept in its history
      let data: Uint8Array
      try {
        const file = await readFile(join(dir, rel))
        data = new Uint8Array(file.buffer, file.byteOffset, file.length) // a plain Uint8Array, not a Buffer
      } catch (e) {
        if (ABSENT.has((e as NodeJS.ErrnoException).code ?? '')) return
        throw e
      }
      const hash = hashBytes(data)
      files[rel] = hash
      bytes.set(hash, data)
    }
    await add('model.yaml')
    await add('layout.yaml')
    for (const folder of WRITTEN_FOLDERS) {
      let names: string[] = []
      try {
        names = (await readdir(join(dir, folder))).sort()
      } catch (e) {
        if (!ABSENT.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      }
      for (const name of names) if (isAllowedPath(`${folder}/${name}`)) await add(`${folder}/${name}`)
    }
    return { files, bytes }
  }

  /** Writes a step for a snapshot, then trims the trail when it has grown past the limit. */
  async function append(snap: Snapshot, label: string, source: StepSource): Promise<Step> {
    // Never earlier than, or the same millisecond as, the step this program wrote before, so ids keep the order the steps were made in.
    const time = new Date(Math.max(clock().getTime(), lastMs + 1))
    lastMs = time.getTime()
    const step: Step = { id: stepId(time, random()), time: time.toISOString(), label, source, app: options.app, files: snap.files }
    await store.putStep(step, snap.bytes)
    failure = undefined
    // Trimming reads every step, so it waits until there are HISTORY_SLACK more than the limit. It is housekeeping: the step is written, whatever happens here.
    try {
      if ((await store.count()) > HISTORY_LIMIT + HISTORY_SLACK) await store.prune(planRetention(await store.steps(), HISTORY_LIMIT), PRUNE_GRACE_MS)
    } catch {
      // the next step tries again
    }
    return step
  }

  /** Runs work that must never fail its caller: an error becomes `failure` (and one quiet line when it is a new one) and the fallback. */
  async function guarded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message !== failure) log(`Flowy history isn't being saved: ${message}`)
      failure = message
      return fallback
    }
  }

  /** The step the list shows for the newest run of steps with the same files, as collapseSteps picks it, reading only as far back as the run goes. */
  async function shownStepId(): Promise<string | undefined> {
    for (let look = 4; ; look *= 4) {
      const tail = await store.tail(look)
      if (tail.length === 0) return undefined
      let start = tail.length - 1
      while (start > 0 && sameFiles(tail[start - 1].files, tail[tail.length - 1].files)) start--
      // Either the run begins inside what was read, or what was read is the whole trail.
      if (start > 0 || tail.length < look) return collapseSteps(tail.slice(start)).at(-1)?.id
    }
  }

  /** The files of a step, or undefined when a blob they name is gone. */
  async function load(files: Record<string, string>): Promise<Record<string, StepFile> | undefined> {
    const loaded: Record<string, StepFile> = {}
    for (const [path, hash] of Object.entries(files)) {
      const bytes = await store.blob(hash)
      if (!bytes) return undefined
      loaded[path] = decode(bytes)
    }
    return loaded
  }

  const record: History['record'] = (label, source) => guarded(async () => {
    const snap = await snapshot()
    const newest = await store.latest()
    if (!newest && Object.keys(snap.files).length === 0) return undefined
    if (newest && sameFiles(newest.files, snap.files) && !(isLabelled(source) && !isLabelled(newest.source))) return undefined
    return await append(snap, label ?? fallbackLabel(changedPaths(newest?.files ?? {}, snap.files)), source)
  }, undefined)

  const ensureCurrent: History['ensureCurrent'] = why => guarded<Ensured>(async () => {
    const snap = await snapshot()
    const newest = await store.latest()
    if (!newest) {
      if (Object.keys(snap.files).length === 0) return { saved: true }
      return { saved: true, id: (await append(snap, FIRST_LABEL, 'first')).id }
    }
    if (sameFiles(newest.files, snap.files)) return { saved: true, id: await shownStepId() }
    const label = why === 'open' ? CLOSED_LABEL : outsideLabel(changedPaths(newest.files, snap.files))
    return { saved: true, id: (await append(snap, label, 'outside')).id }
  }, { saved: false })

  return {
    root,
    get failure() {
      return failure
    },
    snapshot,

    async now() {
      const { files, bytes } = await snapshot()
      return { files: Object.fromEntries(Object.entries(files).map(([path, hash]) => [path, decode(bytes.get(hash)!)])), versions: files }
    },

    async list() {
      return stepInfos(collapseSteps(await store.steps()))
    },

    async read(id) {
      const visible = collapseSteps(await store.steps())
      const index = visible.findIndex(step => step.id === id)
      if (index < 0) return undefined
      const files = await load(visible[index].files)
      if (!files) return undefined
      const info = stepInfos(visible)[visible.length - 1 - index]
      if (index === 0) return { step: info, files }
      const before = await load(visible[index - 1].files)
      return before ? { step: info, files, previous: { id: visible[index - 1].id, files: before } } : { step: info, files }
    },

    record,
    ensureCurrent,

    async restore(id, seen, label) {
      const failed = (e: unknown): RestoreResult => ({ ok: false, kind: 'failed', message: `Couldn't restore: ${e instanceof Error ? e.message : String(e)}` })
      try {
        const target = collapseSteps(await store.steps()).find(step => step.id === id)
        if (!target) return { ok: false, kind: 'unknown', message: 'That version is gone.' }
        // Everything the restore will write is read before anything changes: recording the files as they are now can trim the trail,
        // and a step that went missing half way would leave a mix of two versions.
        const wanted = new Map<string, Uint8Array>()
        for (const [path, hash] of Object.entries(target.files)) {
          if (!isAllowedPath(path)) return { ok: false, kind: 'failed', message: "That version can't be restored: it names a file Flowy doesn't write." }
          const bytes = await store.blob(hash)
          if (!bytes) return { ok: false, kind: 'failed', message: `Couldn't restore: the saved copy of ${path} is gone.` }
          wanted.set(path, bytes)
        }
        // The files as they are now are saved first, so a restore can never lose work that was never recorded.
        const ensured = await ensureCurrent('write')
        if (!ensured.saved) return { ok: false, kind: 'unsaved', message: `Can't restore: history isn't being saved (${failure ?? 'unknown reason'}).` }
        const before = await snapshot()
        const paths = [...new Set([...Object.keys(target.files), ...Object.keys(before.files)])].sort(restoreOrder)
        const conflict: RestoreResult = { ok: false, kind: 'conflict', message: CHANGED_OUTSIDE }
        if (paths.some(path => (before.files[path] ?? null) !== (seen[path] ?? null))) return conflict
        try {
          for (const path of paths) {
            if (target.files[path] === before.files[path]) continue
            await saveRaw(dir, path, wanted.get(path) ?? null, before.files[path] ?? null)
          }
        } catch (e) {
          await ensureCurrent('write') // a restore that stopped half way leaves a mix; keep it as a step
          return e instanceof VersionConflict ? conflict : failed(e)
        }
        await record(label, 'restore')
        const after = await snapshot()
        return { ok: true, versions: Object.fromEntries(paths.map(path => [path, after.files[path] ?? null])), ...(ensured.id ? { before: ensured.id } : {}) }
      } catch (e) {
        return failed(e)
      }
    },

    clear: () => guarded(() => store.clear(), undefined),
  }
}

/** model.yaml, layout.yaml, then the flows by name. */
const restoreOrder = (a: string, b: string): number => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
const rank = (path: string): number => (path === 'model.yaml' ? 0 : path === 'layout.yaml' ? 1 : 2)
