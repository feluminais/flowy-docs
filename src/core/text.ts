/** Small checks and writes on loose values, shared by every file that reads a model. Imports nothing, so any module may use it. */

/** A mapping: an object that is neither null nor a list. What a YAML mapping parses to. */
export const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Sets an own property, so an id like "__proto__" is data and never the prototype. */
export function own<T>(target: Record<string, T>, key: string, value: T) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Text with something in it. A blank value in a file is as good as none. */
export const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Whether a value says nothing: not text, or only whitespace. The other side of hasText. */
export const blank = (v: unknown): boolean => !hasText(v)
