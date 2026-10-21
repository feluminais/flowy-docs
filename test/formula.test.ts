import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evalFormula, FORMULA_MAX, FORMULA_NAMES, formulaText, linearInRate, parseFormula, usedNames } from '../src/core/formula.ts'
import type { Formula } from '../src/core/formula.ts'

const good = (text: string): Formula => {
  const r = parseFormula(text)
  assert.ok('formula' in r, `"${text}" should read, got ${'problem' in r ? r.problem : ''}`)
  return r.formula
}
const problem = (text: string): string => {
  const r = parseFormula(text)
  assert.ok('problem' in r, `"${text}" should not read`)
  return r.problem
}
const at = (text: string, vars: Parameters<typeof evalFormula>[1] = {}) => evalFormula(good(text), vars)

test('the names a formula may use, and its length limit', () => {
  assert.deepEqual([...FORMULA_NAMES], ['rate', 'bytes', 'p50'])
  assert.equal(FORMULA_MAX, 80)
})

test('operators bind the way arithmetic does, left to right, and brackets override', () => {
  assert.equal(at('1 + 2 * 3'), 7)
  assert.equal(at('(1 + 2) * 3'), 9)
  assert.equal(at('10 - 4 - 3'), 3)
  assert.equal(at('100 / 10 / 5'), 2)
  assert.equal(at('2 * 3 + 4 * 5'), 26)
  assert.equal(at('1 - 2 * 3 - 4'), -9)
})

test('unary minus applies to what follows it, and may be stacked', () => {
  assert.equal(at('-rate / 2 * -1', { rate: 10 }), 5)
  assert.equal(at('--3'), 3)
  assert.equal(at('-(1 + 2)'), -3)
  assert.equal(at('2 * -3'), -6)
  assert.equal(at('-rate', { rate: 4 }), -4)
})

test('numbers: digits and one dot, nothing else', () => {
  assert.equal(at('0.5 * 4'), 2)
  assert.equal(at('.5 * 4'), 2)
  assert.equal(at('5. * 2'), 10)
  assert.equal(at('007'), 7)
})

test('rate / 50 is 2 dots at 100 calls a second and 20 at 1,000', () => {
  assert.equal(at('rate / 50', { rate: 100 }), 2)
  assert.equal(at('rate / 50', { rate: 1000 }), 20)
})

test('the three names read their values', () => {
  assert.equal(at('rate + bytes + p50', { rate: 1, bytes: 20, p50: 300 }), 321)
  assert.equal(at('bytes / 400', { bytes: 1600 }), 4)
  assert.equal(at('p50 * 2', { p50: 15 }), 30)
})

test('a missing name gives no value, and so does anything that is not a finite number', () => {
  assert.equal(at('rate / 50', {}), undefined)
  assert.equal(at('rate / 50', { bytes: 3 }), undefined)
  assert.equal(at('rate / 50', { rate: Number.NaN }), undefined)
  assert.equal(at('rate / 50', { rate: Infinity }), undefined)
  assert.equal(at('rate / 0', { rate: 5 }), undefined)
  assert.equal(at('1 / 0'), undefined)
  assert.equal(at('0 / 0'), undefined)
  assert.equal(at('rate / (rate - rate)', { rate: 5 }), undefined)
  assert.equal(at('1 + rate / 0', { rate: 5 }), undefined)
})

test('a number too big to hold gives no value, never Infinity', () => {
  const big = '9'.repeat(70)
  assert.equal(at(`${big} * rate`, { rate: 1e305 }), undefined)
  assert.equal(at(`1 / (rate * ${'9'.repeat(60)})`, { rate: 1e305 }), undefined) // an intermediate that overflows is no value, not zero
  assert.equal(at('rate * 1000000', { rate: 1e305 }), undefined)
  assert.equal(at('rate * 1000000', { rate: 50 }), 50_000_000)
})

test('a result of zero is plain zero, not negative zero', () => {
  assert.ok(Object.is(at('-rate * 0', { rate: 5 }), 0))
  assert.ok(Object.is(at('0 * -1'), 0))
})

test('what a formula uses, once each, in the order it first uses them', () => {
  assert.deepEqual(usedNames(good('rate / 50')), ['rate'])
  assert.deepEqual(usedNames(good('bytes * rate + bytes - p50')), ['bytes', 'rate', 'p50'])
  assert.deepEqual(usedNames(good('3 * 4')), [])
})

test('a formula is linear in rate when it is a constant times rate, and says the constant', () => {
  const k = (text: string) => linearInRate(good(text))
  assert.ok(Math.abs(k('rate / 50')! - 0.02) < 1e-12)
  assert.equal(k('rate * 3'), 3)
  assert.equal(k('2 * rate + rate'), 3)
  assert.equal(k('(rate + rate) / 4'), 0.5)
  assert.ok(Math.abs(k('rate / 3')! - 1 / 3) < 1e-12)
  assert.equal(k('rate + 1'), undefined)
  assert.equal(k('rate * rate'), undefined)
  assert.equal(k('bytes / 400'), undefined)
  assert.equal(k('rate / 50 + bytes * 0'), undefined) // it uses something else, so it is not "dots per call a second"
  assert.equal(k('50'), undefined)
  assert.equal(k('rate - rate'), undefined) // a scale of zero is no scale
  assert.equal(k('-rate'), undefined)
  assert.equal(k('rate / 0'), undefined)
})

// ---- what cannot be read: each is a worded problem, never a throw or a hang

test('formulas that cannot be read are problems that say what and where', () => {
  assert.equal(problem('rate / 50 + '), 'formula "rate / 50 + ": unexpected end')
  assert.equal(problem('rate *'), 'formula "rate *": unexpected end')
  assert.equal(problem('((rate)'), 'formula "((rate)": missing ")"')
  assert.equal(problem('rate)'), 'formula "rate)": unexpected ")" at 5')
  assert.equal(problem('rate()'), 'formula "rate()": unexpected "(" at 5')
  assert.equal(problem('( )'), 'formula "( )": unexpected ")" at 3')
  assert.equal(problem('rate rate'), 'formula "rate rate": unexpected "rate" at 6')
  assert.equal(problem('foo * 2'), 'formula "foo * 2": unknown name "foo" (use rate, bytes, p50)')
  assert.equal(problem('Rate'), 'formula "Rate": unknown name "Rate" (use rate, bytes, p50)')
  assert.equal(problem('1e3'), 'formula "1e3": unexpected "e3" at 2')
  assert.equal(problem('0x10'), 'formula "0x10": unexpected "x10" at 2')
  assert.equal(problem('1.2.3'), 'formula "1.2.3": bad number "1.2.3" at 1')
  assert.equal(problem('rate * .'), 'formula "rate * .": bad number "." at 8')
  assert.equal(problem('rate ^ 2'), 'formula "rate ^ 2": unexpected "^" at 6')
  assert.equal(problem('Math.max(1)'), 'formula "Math.max(1)": unknown name "Math" (use rate, bytes, p50)')
  assert.equal(problem('+rate'), 'formula "+rate": unexpected "+" at 1')
  assert.equal(problem('rate; 1'), 'formula "rate; 1": unexpected ";" at 5')
  assert.equal(problem('rate\t/ 5'), 'formula "rate\t/ 5": unexpected "\t" at 5')
  assert.equal(problem('٣'), 'formula "٣": unexpected "٣" at 1') // not an ASCII digit
  assert.equal(problem('😀'), 'formula "😀": unexpected "😀" at 1')
})

test('an empty formula, or one that is only spaces, is a problem', () => {
  assert.equal(problem(''), 'formula "": empty')
  assert.equal(problem('    '), 'formula "    ": empty')
})

test('a formula over 80 characters is a problem, and its text is not echoed whole', () => {
  const eighty = `rate${' + 1'.repeat(19)}` // 4 + 76 = 80
  assert.equal(eighty.length, 80)
  assert.ok('formula' in parseFormula(eighty))
  const long = `${eighty} `
  assert.equal(long.length, 81)
  assert.equal(problem(long), `formula "${long.slice(0, 40)}…": at most 80 characters`)
})

test('deep nesting and long chains are read without recursing out of the stack', () => {
  assert.equal(at('('.repeat(39) + '1' + ')'.repeat(39)), 1)
  assert.equal(at('-'.repeat(79) + '1'), -1)
  assert.ok('problem' in parseFormula('('.repeat(80)))
})

test('input that is not text is a problem, never a throw', () => {
  assert.ok('problem' in parseFormula(undefined as unknown as string))
  assert.ok('problem' in parseFormula(5 as unknown as string))
  assert.ok('problem' in parseFormula(null as unknown as string))
})

test('hostile text: eval-ish strings are just names that are not allowed', () => {
  for (const text of ['constructor', '__proto__', 'globalThis', 'process', 'this', 'rate.constructor', 'rate["x"]', '`1`', "'a'", '1; process.exit()'])
    assert.ok('problem' in parseFormula(text), text)
})

test('a formula prints back in a form that reads as the same formula', () => {
  for (const text of ['rate / 50', '1 + 2 * 3', '(1 + 2) * 3', '-rate / 2 * -1', 'bytes / 400 + p50', '--3', '0.5 * 4']) {
    const f = good(text)
    const again = good(formulaText(f))
    for (const vars of [{ rate: 7, bytes: 900, p50: 30 }, { rate: 0, bytes: 1, p50: 2 }])
      assert.equal(evalFormula(again, vars), evalFormula(f, vars), text)
  }
  assert.equal(formulaText(good('1 + 2 * 3')), '1 + (2 * 3)')
  assert.equal(formulaText(good('rate / 50')), 'rate / 50')
  assert.equal(formulaText(good('-(rate + 1)')), '-(rate + 1)')
})

test('a parsed formula serialises as its printed text, so a run can be written to JSON', () => {
  assert.equal(JSON.stringify({ f: good('rate/50') }), '{"f":"rate / 50"}')
})
