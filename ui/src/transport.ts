import { requestMessage, responseOf } from '../../src/core/host.ts'
import type { Outcome, Request } from '../../src/core/host.ts'
import type { State } from '../../src/core/state.ts'
import { apiUrl } from './apiurl.ts'
import { httpHistory } from './historyclient.ts'
import type { HistoryClient } from './historyclient.ts'

/** What a write answers with: the HTTP status and the JSON body, whoever carried it. */
export type Reply = { status: number; body: unknown }

/**
 * How the canvas reaches the flowy/ folder: over HTTP from the local server, or, inside the VS Code extension's
 * webview, by asking the extension. No DOM in here; useModel.ts adds how a page hears that the folder changed.
 */
export type Transport = {
  /** Everything the canvas shows. Rejects with a message for the user when it can't be had. */
  state: () => Promise<State>
  /** PUT a file's content (`body` is `{ version, data }`) or DELETE a flow (`{ version }`). Resolves to the answer, whatever its status. */
  write: (method: 'PUT' | 'DELETE', file: string, body: unknown) => Promise<Reply>
  /** The folder's history, where there is a server that keeps it. The VS Code webview has none, so its YAML tab says why there is no history. */
  history?: HistoryClient
}

/** The local server at `base`: '' for the page's own origin, or an address, for tests. `model` is the one of its models to work on; the first when left out. */
export function httpTransport(base = '', model?: string): Transport {
  let last: { etag: string; state: State } | undefined
  return {
    history: httpHistory(base, model),
    async state() {
      const res = await fetch(apiUrl(base, '/api/state', model))
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
      // The server tags the state it sends. The same tag is the same state, so it is handed on as it was: nothing downstream has anything new to work out.
      const etag = res.headers.get('etag')
      if (etag !== null && last?.etag === etag) {
        void res.body?.cancel()
        return last.state
      }
      const state = (await res.json()) as State
      if (etag !== null) last = { etag, state }
      return state
    },
    async write(method, file, body) {
      const res = await fetch(apiUrl(base, `/api/file/${file}`, model), {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Flowy': '1' },
        body: JSON.stringify(body),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
  }
}

/**
 * The host the page is embedded in. `post` sends a message to it; `listen` is given the function that takes what the host
 * sends, once. A request the host never answers fails after `timeoutMs` so the edit queue behind it doesn't wait forever.
 */
export function hostTransport(post: (message: unknown) => void, listen: (handler: (data: unknown) => void) => void, timeoutMs = 30_000): Transport {
  let next = 0
  const waiting = new Map<number, (outcome: Outcome) => void>()
  listen(data => {
    const answer = responseOf(data)
    if (!answer) return
    waiting.get(answer.id)?.(answer.outcome)
    waiting.delete(answer.id)
  })
  const ask = (request: Request) => new Promise<unknown>((resolve, reject) => {
    const id = next++
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error("VS Code didn't answer"))
    }, timeoutMs)
    waiting.set(id, outcome => {
      clearTimeout(timer)
      if ('error' in outcome) reject(new Error(outcome.error))
      else resolve(outcome.value)
    })
    post(requestMessage(id, request))
  })
  return {
    state: async () => (await ask({ op: 'state' })) as State,
    write: async (method, file, body) => (await ask({ op: 'write', method, file, body })) as Reply,
  }
}
