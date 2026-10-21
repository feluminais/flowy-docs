/**
 * The traffic formula: plain arithmetic a run's `source:` uses to say how many dots a line shows and how big each is.
 * Numbers, the names `rate`, `bytes` and `p50`, `+ - * /`, brackets and unary minus, nothing else: no functions, no
 * exponents, and nothing here ever hands text to `eval` or `Function`. It is read by a hand-written tokenizer and a
 * recursive-descent parser, so a formula that can't be read is a worded problem and never a throw. Pure, with a C# twin
 * (desktop/Flowy.Core/Formula.cs) that must give the same answers and the same words; the fixtures hold them equal.
 *
 * Grammar:  expr = term { ("+" | "-") term }    term = unary { ("*" | "/") unary }
 *           unary = "-" unary | number | name | "(" expr ")"
 */

/** The numbers a formula may name: a connection's `rate` (calls a second), `bytes` (bytes a call) and `p50` (the expected call, in ms). */
export const FORMULA_NAMES = ['rate', 'bytes', 'p50'] as const
export type FormulaName = (typeof FORMULA_NAMES)[number]
/** The longest formula there is room for: enough for any real ratio, short enough to read at a glance and to bound the work. */
export const FORMULA_MAX = 80
/** How much of a formula a problem quotes, so a hostile or runaway text doesn't fill the problem list. */
const QUOTED = 40

/** The tree a formula reads into. Nothing outside this file needs to look inside it. */
export type FormulaNode = { n: number } | { v: FormulaName } | { neg: FormulaNode } | { op: '+' | '-' | '*' | '/'; a: FormulaNode; b: FormulaNode }

/**
 * A formula that was read. Opaque: ask it through evalFormula, usedNames and linearInRate. It writes itself to JSON as its printed text,
 * so a run that holds one can be dumped (the fixtures do) without the tree in it.
 */
export class Formula {
  readonly node: FormulaNode

  constructor(node: FormulaNode) {
    this.node = node
  }

  toJSON(): string {
    return formulaText(this)
  }
}

/** Raised inside the parser and caught at its edge, so what a caller sees is a problem, never an exception. */
class Unreadable extends Error {}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isName = (v: string): v is FormulaName => FORMULA_NAMES.some(n => n === v)

/** The character at `i` as a reader sees it: a pair of UTF-16 halves is one character. */
const charAt = (text: string, i: number): string => {
  const code = text.charCodeAt(i)
  return code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff ? text.slice(i, i + 2) : text[i]
}

/** A piece of the text: a number, a name, a sign or bracket, or the place the text stops making sense (`bad` holds the problem). */
type Token = { kind: 'number' | 'name' | 'sign' | 'bad'; text: string; at: number }

/** The text as tokens, 1-based places. It stops at the first thing it can't read, which comes last as a `bad` token the parser reports if it gets that far. */
function tokenize(text: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === ' ') {
      i++
    } else if (isDigit(c) || c === '.') {
      let j = i
      let dots = 0
      let digits = 0
      while (j < text.length && (isDigit(text[j]) || text[j] === '.')) {
        if (text[j] === '.') dots++
        else digits++
        j++
      }
      const piece = text.slice(i, j)
      out.push(dots > 1 || digits === 0 ? { kind: 'bad', text: `bad number "${piece}" at ${i + 1}`, at: i + 1 } : { kind: 'number', text: piece, at: i + 1 })
      if (dots > 1 || digits === 0) return out
      i = j
    } else if (isLetter(c)) {
      let j = i + 1
      while (j < text.length && (isLetter(text[j]) || isDigit(text[j]))) j++
      out.push({ kind: 'name', text: text.slice(i, j), at: i + 1 })
      i = j
    } else if (c === '+' || c === '-' || c === '*' || c === '/' || c === '(' || c === ')') {
      out.push({ kind: 'sign', text: c, at: i + 1 })
      i++
    } else {
      const ch = charAt(text, i)
      out.push({ kind: 'bad', text: `unexpected "${ch}" at ${i + 1}`, at: i + 1 })
      return out
    }
  }
  return out
}

/** A problem's quote of the text. */
const quote = (text: string): string => `formula "${text.length > QUOTED ? `${text.slice(0, QUOTED)}…` : text}"`

/**
 * Read a formula. A formula that can't be read gives the problem instead, worded `formula "<text>": <what>`: what is empty,
 * too long, an unknown name, a character or token in the wrong place (with its place), a bracket left open, or text that ends too soon.
 */
export function parseFormula(text: string): { formula: Formula } | { problem: string } {
  if (typeof text !== 'string') return { problem: 'formula "": must be text' }
  const say = (what: string) => ({ problem: `${quote(text)}: ${what}` })
  if (/^ *$/.test(text)) return say('empty') // a space is the only blank there is
  if (text.length > FORMULA_MAX) return say(`at most ${FORMULA_MAX} characters`)

  const tokens = tokenize(text)
  let at = 0
  const peek = (): Token | undefined => tokens[at]
  /** What is wrong with the token in hand: its own problem when it was unreadable, else that it is in the wrong place. */
  const wrong = (t: Token | undefined, expected?: string): never => {
    if (t === undefined) throw new Unreadable(expected === undefined ? 'unexpected end' : `missing "${expected}"`)
    throw new Unreadable(t.kind === 'bad' ? t.text : `unexpected "${t.text}" at ${t.at}`)
  }

  const primary = (): FormulaNode => {
    const t = peek()
    if (t === undefined || t.kind === 'bad') return wrong(t)
    if (t.kind === 'number') {
      at++
      return { n: Number(t.text) }
    }
    if (t.kind === 'name') {
      if (!isName(t.text)) throw new Unreadable(`unknown name "${t.text}" (use ${FORMULA_NAMES.join(', ')})`)
      at++
      return { v: t.text }
    }
    if (t.text === '(') {
      at++
      const inside = expr()
      const close = peek()
      if (close?.kind !== 'sign' || close.text !== ')') return wrong(close, ')')
      at++
      return inside
    }
    return wrong(t)
  }
  const unary = (): FormulaNode => {
    const t = peek()
    if (t?.kind === 'sign' && t.text === '-') {
      at++
      return { neg: unary() }
    }
    return primary()
  }
  const chain = (next: () => FormulaNode, ops: readonly string[]): FormulaNode => {
    let left = next()
    for (let t = peek(); t?.kind === 'sign' && ops.includes(t.text); t = peek()) {
      at++
      left = { op: t.text as '+' | '-' | '*' | '/', a: left, b: next() }
    }
    return left
  }
  const term = (): FormulaNode => chain(unary, ['*', '/'])
  const expr = (): FormulaNode => chain(term, ['+', '-'])

  try {
    const node = expr()
    if (at < tokens.length) wrong(tokens[at])
    return { formula: new Formula(node) }
  } catch (e) {
    if (e instanceof Unreadable) return say(e.message)
    throw e
  }
}

/** Whether a number can be a result: finite, so it is never Infinity or NaN. Zero is plain zero, never negative zero. */
const finite = (n: number): number | undefined => (Number.isFinite(n) ? (n === 0 ? 0 : n) : undefined)

function evalNode(node: FormulaNode, vars: Partial<Record<FormulaName, number>>): number | undefined {
  if ('n' in node) return finite(node.n)
  if ('v' in node) {
    const v = Object.hasOwn(vars, node.v) ? vars[node.v] : undefined
    return v === undefined ? undefined : finite(v)
  }
  if ('neg' in node) {
    const v = evalNode(node.neg, vars)
    return v === undefined ? undefined : finite(-v)
  }
  const a = evalNode(node.a, vars)
  const b = evalNode(node.b, vars)
  if (a === undefined || b === undefined) return undefined
  switch (node.op) {
    case '+': return finite(a + b)
    case '-': return finite(a - b)
    case '*': return finite(a * b)
    default: return b === 0 ? undefined : finite(a / b)
  }
}

/**
 * The formula's value for these numbers. Undefined ("no value", never Infinity or NaN) when a name it uses has no number,
 * when it divides by zero, or when any step is too big to hold.
 */
export function evalFormula(f: Formula, vars: Partial<Record<FormulaName, number>>): number | undefined {
  return evalNode(f.node, vars)
}

/** The names a formula uses, each once, in the order it first uses them. */
export function usedNames(f: Formula): FormulaName[] {
  const seen: FormulaName[] = []
  const walk = (node: FormulaNode) => {
    if ('v' in node) {
      if (!seen.includes(node.v)) seen.push(node.v)
    } else if ('neg' in node) walk(node.neg)
    else if ('op' in node) {
      walk(node.a)
      walk(node.b)
    }
  }
  walk(f.node)
  return seen
}

/**
 * The constant `k` when the formula is `k * rate` for every rate and uses nothing else, so a key can say "1 dot = 50 calls/s". Undefined
 * for anything else, and for a `k` that is not above zero. Found by trying four rates: a formula this simple can't hide a bend between them.
 */
export function linearInRate(f: Formula): number | undefined {
  const k = evalFormula(f, { rate: 1 })
  if (k === undefined || !(k > 0)) return undefined
  for (const rate of [2, 10, 1000]) {
    const v = evalFormula(f, { rate })
    if (v === undefined || Math.abs(v - k * rate) > 1e-9 * Math.max(1, Math.abs(k * rate))) return undefined
  }
  return k
}

/** The formula as text, every sum or product inside another in brackets (the outermost bare): how the fixtures write a formula down, and how a test compares two. */
export function formulaText(f: Formula): string {
  const show = (node: FormulaNode, root: boolean): string => {
    if ('n' in node) return String(node.n)
    if ('v' in node) return node.v
    if ('neg' in node) return `-${show(node.neg, false)}`
    const text = `${show(node.a, false)} ${node.op} ${show(node.b, false)}`
    return root ? text : `(${text})`
  }
  return show(f.node, true)
}
