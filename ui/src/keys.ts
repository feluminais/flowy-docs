/**
 * The letter a shortcut means: the one typed when it's Latin, otherwise the key's place on a US
 * keyboard, so E, Ctrl+K and Ctrl+Z work on a Ukrainian or Greek layout too.
 */
export function letter(e: { key: string; code: string }): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key
}
