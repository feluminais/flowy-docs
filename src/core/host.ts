/**
 * What a page embedded in a host (the VS Code extension's webview) and the host say to each other. The page has no server
 * to ask, so it asks the host: for the folder's State, and to write a file. The host tells it when the folder changes.
 * Messages are plain JSON; ids pair an answer with its request.
 */

/** The `type` of the message that has the host put text on the clipboard. A webview may not be allowed to write there itself. */
export const COPY_MESSAGE = 'flowy-copy'

/** The message that asks the host to copy `text`. */
export const copyMessage = (text: string) => ({ type: COPY_MESSAGE, text })

/** The text a message asks the host to copy, or undefined when `data` is some other message. */
export function textToCopy(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || (data as { type?: unknown }).type !== COPY_MESSAGE) return undefined
  const text = (data as { text?: unknown }).text
  return typeof text === 'string' ? text : undefined
}

/** What the page asks of the host: what GET /api/state, and PUT or DELETE /api/file/<file> with `body`, do over HTTP. */
export type Request =
  | { op: 'state' }
  | { op: 'write'; method: 'PUT' | 'DELETE'; file: string; body: unknown }

export const REQUEST_MESSAGE = 'flowy-request'
export const RESPONSE_MESSAGE = 'flowy-response'
export const CHANGED_MESSAGE = 'flowy-changed'

/** The message that asks the host for `request`, numbered `id` so its answer can be matched. */
export const requestMessage = (id: number, request: Request) => ({ type: REQUEST_MESSAGE, id, request })

const isObject = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null && !Array.isArray(data)
const isId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0

/** The request a message makes and its id, or undefined when `data` is not a well-formed request. */
export function requestOf(data: unknown): { id: number; request: Request } | undefined {
  if (!isObject(data) || data.type !== REQUEST_MESSAGE || !isId(data.id) || !isObject(data.request)) return undefined
  const { op, method, file, body } = data.request
  if (op === 'state') return { id: data.id, request: { op } }
  if (op === 'write' && (method === 'PUT' || method === 'DELETE') && typeof file === 'string') return { id: data.id, request: { op, method, file, body } }
  return undefined
}

/** What the host made of a request: its value (the State, or a write's status and body), or why it couldn't. */
export type Outcome = { value: unknown } | { error: string }

/** The message that answers request `id`. */
export const responseMessage = (id: number, outcome: Outcome) => ({ type: RESPONSE_MESSAGE, id, ...outcome })

/** The answer a message carries and the id of the request it answers, or undefined when `data` is not an answer. */
export function responseOf(data: unknown): { id: number; outcome: Outcome } | undefined {
  if (!isObject(data) || data.type !== RESPONSE_MESSAGE || !isId(data.id)) return undefined
  if (typeof data.error === 'string') return { id: data.id, outcome: { error: data.error } }
  if ('value' in data) return { id: data.id, outcome: { value: data.value } }
  return undefined
}

/** The message that tells the page something under the flowy/ folder changed, so it asks for the State again. */
export const changedMessage = () => ({ type: CHANGED_MESSAGE })

export const isChanged = (data: unknown): boolean => isObject(data) && data.type === CHANGED_MESSAGE

export const OPEN_MESSAGE = 'flowy-open'

/** The message that asks the host to open `path`, a path in the repo as `code` lists it (a trailing "/" is a folder), in the editor. */
export const openMessage = (path: string) => ({ type: OPEN_MESSAGE, path })

/** The path a message asks the host to open, or undefined when `data` is some other message. */
export function pathToOpen(data: unknown): string | undefined {
  if (!isObject(data) || data.type !== OPEN_MESSAGE) return undefined
  return typeof data.path === 'string' && data.path !== '' ? data.path : undefined
}

export const OPEN_URL_MESSAGE = 'flowy-open-url'

/** The message that asks the host to open the web address `url` in the reader's browser. The page sends it rather than leaving a link to the webview, which sends every link it is given to the browser, prevented or not. */
export const openUrlMessage = (url: string) => ({ type: OPEN_URL_MESSAGE, url })

/** The web address a message asks the host to open, or undefined when `data` is some other message or the address isn't http(s). */
export function urlToOpen(data: unknown): string | undefined {
  if (!isObject(data) || data.type !== OPEN_URL_MESSAGE || typeof data.url !== 'string') return undefined
  return /^https?:\/\/\S+$/i.test(data.url) ? data.url : undefined
}

/** What the host can ask the page to show: a shape (it is drawn where it sits and selected) or a flow (it plays). */
export type Target = { shape: string } | { flow: string }
export const REVEAL_MESSAGE = 'flowy-reveal'

/** The message that asks the page to show `target`. */
export const revealMessage = (target: Target) => ({ type: REVEAL_MESSAGE, target })

/** The target a message asks the page to show, or undefined when `data` is some other message. */
export function revealOf(data: unknown): Target | undefined {
  if (!isObject(data) || data.type !== REVEAL_MESSAGE || !isObject(data.target)) return undefined
  const { shape, flow } = data.target
  if (typeof shape === 'string' && shape !== '') return { shape }
  if (typeof flow === 'string' && flow !== '') return { flow }
  return undefined
}
