import { colorPair } from '../look.ts'
import { parseFormula } from '../formula.ts'
import type { Formula } from '../formula.ts'
import { brief } from './util.ts'
import { isTime } from './types.ts'
import type { Run, SourceFormula } from './types.ts'

/** What the sources of a run share: colours, formulas read from text, and which runs another can add. */

/** Whether two colours draw the same: a name and its own hex are one colour. */
export function sameColor(a: string, b: string): boolean {
  const [pa, pb] = [colorPair(a), colorPair(b)]
  return pa !== undefined && pb !== undefined && pa[0] === pb[0] && pa[1] === pb[1]
}

/** A problem for each pair of the colours (in the order they come) that draw the same, naming the sources by `names`. */
export function sharedColors(colors: (string | undefined)[], names: string[], add: (message: string) => void) {
  colors.forEach((c, i) => {
    if (c === undefined) return
    const first = colors.findIndex(d => d !== undefined && sameColor(c, d))
    if (first !== i) add(`${names[first]} and ${names[i]} both draw in ${brief(c)}: give each its own colour`)
  })
}

/** Formulas already read, by their text, so a line that is drawn twenty times a second doesn't read its formula each time. Kept small: a run has two. */
const READ = new Map<string, Formula | undefined>()

/** The formula a source's text says, or undefined for a text that doesn't read (a run that was not through parseRun). */
export function formulaOf(f: SourceFormula): Formula | undefined {
  if (!READ.has(f.text)) {
    if (READ.size >= 64) READ.clear()
    const read = parseFormula(f.text)
    READ.set(f.text, 'formula' in read ? read.formula : undefined)
  }
  return READ.get(f.text)
}

/** Why a run can't be one of those an adder adds, or undefined when it can: it is a load run with levels of its own, and one source. */
export function whyNotAdded(runs: Record<string, Run>, id: string): string | undefined {
  if (!Object.hasOwn(runs, id)) return 'which is not a run'
  const run = runs[id]
  if (run.adds !== undefined) return 'which adds runs itself'
  if (run.sources !== undefined) return 'which is tested with several sources'
  if (isTime(run)) return 'which is a run over time'
  return undefined
}
