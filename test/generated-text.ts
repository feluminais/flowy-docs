import fc from 'fast-check'

/**
 * Text that has broken a reader or a writer in this project's history, in pieces that can be joined in any order: separators and
 * quotes YAML treats as syntax, line breaks of every kind, words YAML would turn into other types, a name that is also a property of
 * every object, and ordinary letters, so the odd pieces sit next to plain text the way they do in a real label.
 */
const PIECES = [
  ',', ':', ': ', '#', ' #', '- ', '-', '?', '"', "'", '{', '}', '[', ']', '&', '*', '!', '|', '>', '%', '@', '`', '\\', '/', '=',
  ' ', '  ', '\t', '\n', '\n\n', '\r\n', '\r', ' ', ' ', '\u0085', ' ',
  'null', '~', 'true', 'no', '007', '3.10', '1e3', '0x10', '.inf', '<<', '---', '...', '<<<<<<<', '=======', '>>>>>>>',
  '__proto__', 'constructor', 'toString',
  'é', '日本', '😀',
]

/** A label, a description or a step's words: usually short, sometimes empty, with the awkward pieces among plain ones. */
export const text = fc
  .array(fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...PIECES) }, { weight: 3, arbitrary: fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,8}$/) }), { maxLength: 8 })
  .map(parts => parts.join(''))
