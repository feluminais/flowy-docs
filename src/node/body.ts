import type { IncomingMessage } from 'node:http'

/** The most a request body may hold. A write carries one file of the model, which stays far below it. */
export const MAX_BODY = 8 * 1024 * 1024

/** A request's JSON body, or undefined when it isn't JSON or is longer than MAX_BODY. Past the limit the rest is read and dropped, so memory stays flat. */
export async function jsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size <= MAX_BODY) chunks.push(chunk)
  }
  if (size > MAX_BODY) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}
