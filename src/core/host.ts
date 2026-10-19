/** What a page embedded in a host (the VS Code extension) says to it. What the host says back is a State: see state.ts. */

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
