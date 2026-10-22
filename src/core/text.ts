/** Small checks and writes on loose values, shared by every file that reads a model. Imports nothing, so any module may use it. */

/** A mapping: an object that is neither null nor a list. What a YAML mapping parses to. */
export const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Sets an own property, so an id like "__proto__" is data and never the prototype. */
export function own<T>(target: Record<string, T>, key: string, value: T) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Text with something in it. A blank value in a file is as good as none. */
export const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * A number written in a file: decimal digits with an optional sign, fraction and exponent, and nothing else. JavaScript's own `Number()` also takes `0x10`, `0b11`
 * and `0o7`, which the desktop app does not, so a file would then mean one thing in the browser and another in the app. Undefined for anything else, and for a
 * number too big to be finite. The same grammar is written in desktop/Flowy.Core/JsCompat.cs, and desktop/fixtures/numbers.ts keeps the two equal.
 */
export const plainNumber = (v: unknown): number | undefined => {
  if (typeof v !== 'string' || !/^[ \t\n\v\f\r]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\v\f\r]*$/.test(v)) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Whether a value says nothing: not text, or only whitespace. The other side of hasText. */
export const blank = (v: unknown): boolean => !hasText(v)
