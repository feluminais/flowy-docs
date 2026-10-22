import { blank, hasText, plainNumber } from '../../src/core/text.ts'

// What counts as a number in a file ("0.35", not "0x10"), and what counts as blank. The cases are the one table the TypeScript test and the C# tests both read:
// each is some text, the number it reads as (null when it reads as none) and whether it is blank. The C# side loads them from the file `dumpNumbers` writes.

/** The texts, in the order the C# test reports a failure in. */
const TEXTS = [
  '0', '12', '-3.5', '+7', '.5', '5.', '-.5', '1e3', '1E-3', '  42  ', '\t8\n', '007', '1.5e+2',
  '0x10', '0b11', '0o7', 'Infinity', '-Infinity', 'NaN', '1e999', '-1e999', '1_000', '1,5', '', ' ', '.', '+', '--1', '1 2', '1e', 'e5', '0x',
  '\u00a05', '\u3000 5', '\ufeff5', '٣', '１', '5\u0000',
  '\ufeff', ' \u00a0\u2028 ', '\u0085', '\u001f', '\u200b', 'x',
]

export function dumpNumbers() {
  return TEXTS.map(text => ({ text, value: plainNumber(text) ?? null, blank: blank(text), hasText: hasText(text) }))
}
