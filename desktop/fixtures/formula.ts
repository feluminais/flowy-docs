import { evalFormula, formulaText, linearInRate, parseFormula, usedNames } from '../../src/core/formula.ts'
import type { FormulaName } from '../../src/core/formula.ts'

/** Texts as they can be written: ones that read (and in what shape), and every kind that does not, with the words the problem uses. */
const PARSE: string[] = [
  'rate / 50', 'rate/50', '1 + 2 * 3', '(1 + 2) * 3', '10 - 4 - 3', '100 / 10 / 5', '-rate / 2 * -1', '--3', '-(1 + 2)', '2 * -3', '0.5 * 4', '.5 * 4', '5. * 2', '007',
  'rate + bytes + p50', 'bytes * rate + bytes - p50', '3 * 4', 'bytes / 400', 'rate / 12.5', 'rate * 2', 'rate / 3', 'rate / 50 + 1', 'rate * rate', '2 * rate + rate', '(rate + rate) / 4',
  'rate - rate', '-rate', 'rate / 0', '50', 'rate / 50 + bytes * 0', 'rate / 1000000000000', `rate${' + 1'.repeat(19)}`, `${'('.repeat(39)}1${')'.repeat(39)}`, '-'.repeat(79) + '1',
  '', '    ', 'rate / 50 + ', 'rate *', '((rate)', 'rate)', 'rate()', '( )', 'rate rate', 'foo * 2', 'Rate', '1e3', '0x10', '1.2.3', 'rate * .', 'rate ^ 2', 'Math.max(1)', '+rate', 'rate; 1',
  'rate\t/ 5', '٣', '😀', 'rate * 😀', 'rate.constructor', '__proto__', 'constructor', 'rate["x"]', '1; process.exit()', '(', ')', '*', '/ 2', '1 +', '1 + + 1', '2 3', '( ( ( 1',
  `${`rate${' + 1'.repeat(19)}`} `, ' '.repeat(81), 'x'.repeat(200), '('.repeat(80), 'rate / 50 )', '1..2', '..', '.', '5.5.', 'p50p50', 'p 50', 'rate_2', '_',
]

type Vars = Partial<Record<FormulaName, number>>
const EVAL: [text: string, vars: Vars][] = [
  ['rate / 50', { rate: 100 }], ['rate / 50', { rate: 1000 }], ['rate / 50', {}], ['rate / 50', { bytes: 3 }], ['rate / 50', { rate: 0 }], ['rate / 0', { rate: 5 }], ['1 / 0', {}], ['0 / 0', {}],
  ['rate / (rate - rate)', { rate: 5 }], ['1 + rate / 0', { rate: 5 }], ['1 + 2 * 3', {}], ['(1 + 2) * 3', {}], ['10 - 4 - 3', {}], ['100 / 10 / 5', {}], ['1 - 2 * 3 - 4', {}],
  ['-rate / 2 * -1', { rate: 10 }], ['--3', {}], ['-rate', { rate: 4 }], ['rate + bytes + p50', { rate: 1, bytes: 20, p50: 300 }], ['bytes / 400', { bytes: 1600 }], ['p50 * 2', { p50: 15 }],
  ['rate / 3', { rate: 10 }], ['0.1 + 0.2', {}], ['0.5 * 4', {}], ['.5 * 4', {}], ['007', {}], ['rate * 1000000', { rate: 50 }], ['rate * 1000000', { rate: 1e305 }],
  [`${'9'.repeat(70)} * rate`, { rate: 1e305 }], [`1 / (rate * ${'9'.repeat(60)})`, { rate: 1e305 }], ['-rate * 0', { rate: 5 }], ['0 * -1', {}], ['rate - rate', { rate: 7 }],
  ['bytes * rate + bytes - p50', { rate: 2, bytes: 3, p50: 4 }], ['rate / 50 + bytes * 0', { rate: 5 }], ['rate / 50 + bytes * 0', { rate: 5, bytes: 9 }], ['p50', { p50: 0 }],
]

/** What src/core/formula.ts says: how texts read (or why not, in words), what each formula uses and prints back as, and what it evaluates to. The C# port (Flowy.Core/Formula.cs) must say the same. */
export function dumpFormula(): unknown {
  const reads = PARSE.map(text => {
    const r = parseFormula(text)
    return 'formula' in r
      ? { text, formula: formulaText(r.formula), names: usedNames(r.formula), linear: linearInRate(r.formula) ?? null }
      : { text, problem: r.problem }
  })
  const values = EVAL.map(([text, vars]) => {
    const r = parseFormula(text)
    if (!('formula' in r)) throw new Error(`the fixture formula "${text}" must read`)
    return { text, vars, value: evalFormula(r.formula, vars) ?? null }
  })
  return { reads, values }
}
