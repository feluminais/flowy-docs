/** One line of a diff. `line` is the 1-based line in the new text for `same` and `add`; a `remove` has none. */
export type LineMark = { kind: 'same' | 'add' | 'remove'; text: string; line?: number }

/** Past this many cells (rows × columns of what is left after the shared start and end), the lines are not matched up: every old one goes, every new one comes. */
export const MAX_DIFF_CELLS = 4_000_000

/** The lines of a text. Line endings are not compared, and a final newline adds no empty line. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * What changed between two texts, line by line. The lines both share at the start and the end are set aside; on the rest a table of the
 * longest common run from each pair of positions on says which lines to keep, and at a mismatch the removal comes first when it costs no more.
 * The C# twin (Flowy.Core) does exactly this, so a step reads the same in either app.
 */
export function diffLines(base: string, next: string): LineMark[] {
  const a = linesOf(base)
  const b = linesOf(next)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

  const marks: LineMark[] = []
  for (let i = 0; i < head; i++) marks.push({ kind: 'same', text: a[i], line: i + 1 })
  middle(a.slice(head, a.length - tail), b.slice(head, b.length - tail), head, marks)
  for (let i = 0; i < tail; i++) marks.push({ kind: 'same', text: a[a.length - tail + i], line: b.length - tail + i + 1 })
  return marks
}

/** The differing middle. `offset` is how many lines come before it in the new text. */
function middle(a: string[], b: string[], offset: number, marks: LineMark[]): void {
  const n = a.length
  const m = b.length
  if (n * m > MAX_DIFF_CELLS) {
    for (const text of a) marks.push({ kind: 'remove', text })
    b.forEach((text, j) => marks.push({ kind: 'add', text, line: offset + j + 1 }))
    return
  }
  // run[i * (m + 1) + j]: the longest common run of a[i..] and b[j..].
  const width = m + 1
  const run = new Int32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      run[i * width + j] = a[i] === b[j] ? run[(i + 1) * width + j + 1] + 1 : Math.max(run[(i + 1) * width + j], run[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      marks.push({ kind: 'same', text: a[i], line: offset + j + 1 })
      i++
      j++
    } else if (run[(i + 1) * width + j] >= run[i * width + j + 1]) {
      marks.push({ kind: 'remove', text: a[i] })
      i++
    } else {
      marks.push({ kind: 'add', text: b[j], line: offset + j + 1 })
      j++
    }
  }
  for (; i < n; i++) marks.push({ kind: 'remove', text: a[i] })
  for (; j < m; j++) marks.push({ kind: 'add', text: b[j], line: offset + j + 1 })
}
