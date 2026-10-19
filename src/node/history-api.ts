import type { IncomingMessage } from 'node:http'
import { json } from 'node:stream/consumers'
import type { History } from './history.ts'

/** What the server answers with. */
export type Answer = { status: number; body: unknown }

export type HistoryApi = {
  /** Answers the history routes. Returns undefined for any other path or method, so the server can go on to its own routes. */
  handle(req: IncomingMessage, url: URL): Promise<Answer | undefined>
  /** Called before a file write from the page: makes sure the files as they were are a step first. */
  beforeWrite(): Promise<void>
  /** Called when the folder's files changed on disk. */
  filesChanged(): Promise<void>
  /** Called once when the server starts. */
  opened(): Promise<void>
  close(): void
}

const STEP = '/api/history/steps/'
const MAX_LABEL = 200

const bad = (error: string): Answer => ({ status: 400, body: { error } })

/** Reads a JSON object body, or undefined when it is not one. */
async function objectBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const body: unknown = await json(req).catch(() => undefined)
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined
}

const isLabel = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= MAX_LABEL

/**
 * `gateMs`: how long a page's edit may stay unfinished. The page writes one file per request, so the server cannot tell where one edit ends;
 * the first write of an edit opens a gate (after recording the files as they were), the page's label closes it and records the step, and a
 * page that never says is given `gateMs` before the step is recorded without one. While the gate is open the folder watcher stays quiet,
 * because those changes are the edit's own.
 */
export function createHistoryApi(history: History, options: { gateMs?: number } = {}): HistoryApi {
  const gateMs = options.gateMs ?? 5000
  /** Set while the gate is open: settles once the files as they were are recorded. */
  let gate: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const closeGate = () => {
    clearTimeout(timer)
    timer = undefined
    gate = undefined
  }

  async function post(req: IncomingMessage, pathname: string): Promise<Answer | undefined> {
    if (pathname !== '/api/history/steps' && pathname !== '/api/history/restore' && pathname !== '/api/history/clear') return undefined
    // Browsers only let a page send a custom header to its own origin, so other sites can't write.
    if (req.headers['x-flowy'] !== '1') return { status: 403, body: { error: 'missing X-Flowy: 1 header' } }

    if (pathname === '/api/history/clear') {
      await history.clear()
      return { status: 200, body: {} }
    }
    const body = await objectBody(req)
    if (pathname === '/api/history/steps') {
      if (!body || !isLabel(body.label)) return bad(`the body needs "label": a sentence of 1 to ${MAX_LABEL} characters`)
      closeGate()
      return { status: 200, body: { recorded: (await history.record(body.label, 'you')) !== undefined } }
    }

    const { id, versions, label } = body ?? {}
    const seen = typeof versions === 'object' && versions !== null && !Array.isArray(versions) ? (versions as Record<string, unknown>) : undefined
    if (typeof id !== 'string' || id === '' || !seen || !Object.values(seen).every(v => typeof v === 'string' || v === null) || !isLabel(label))
      return bad('the body needs "id", "versions" (each file\'s version from /api/yaml, or null) and "label"')
    const result = await history.restore(id, seen as Record<string, string | null>, label)
    if (result.ok) return { status: 200, body: { versions: result.versions, ...(result.before ? { before: result.before } : {}) } }
    const status = { unknown: 404, conflict: 409, unsaved: 503, failed: 500 }[result.kind]
    return { status, body: { error: result.message } }
  }

  return {
    async handle(req, url) {
      const { pathname } = url
      if (req.method === 'POST') return post(req, pathname)
      if (req.method !== 'GET') return undefined
      if (pathname === '/api/history') {
        const reason = history.failure
        const steps = await history.list().catch(() => [])
        return { status: 200, body: { saving: reason === undefined, ...(reason === undefined ? {} : { reason }), steps } }
      }
      if (pathname.startsWith(STEP)) {
        const view = await history.read(pathname.slice(STEP.length))
        return view ? { status: 200, body: view } : { status: 404, body: { error: 'That version is gone.' } }
      }
      if (pathname === '/api/yaml') return { status: 200, body: await history.now() }
      return undefined
    },
    beforeWrite() {
      if (!gate) {
        gate = history.ensureCurrent('write').then(() => undefined)
        timer = setTimeout(() => {
          closeGate()
          void history.record(undefined, 'you')
        }, gateMs)
      }
      return gate
    },
    async filesChanged() {
      if (!gate) await history.ensureCurrent('watch')
    },
    async opened() {
      await history.ensureCurrent('open')
    },
    close: closeGate,
  }
}
