/**
 * What a reader is told about a stop: the words on the card and on the canvas, and where the stop sits in the progress bar.
 * They are decided here once, so the browser and the desktop app say the same things. Nothing here draws.
 * desktop/Flowy.Core/Captions.cs is a port, and desktop/fixtures/structure.ts keeps the two equal.
 */
import { isMap } from './model.ts'
import type { Flow } from './model.ts'
import { blank } from './structure.ts'
import type { GroupKind, Stop } from './structure.ts'

/**
 * `chip` is the card's words for the group ("" outside one); `text` is the group's own `text`. A branch lists its lanes as `tabs`
 * and says which this stop is in (`tab`, -1 elsewhere). A parallel stop names the lane of each of its steps in `lanes`. `marks` has
 * one short mark for each step of the stop, drawn on its line ("" for none). No glyphs: each reader adds its own icon.
 */
export type Caption = { chip: string; text: string; tabs: string[]; tab: number; lanes: string[]; marks: string[] }

const part = (v: unknown): string => (blank(v) ? '' : String(v).trim())

export function captionOf(flow: Flow, stop: Stop): Caption {
  const none: Caption = { chip: '', text: '', tabs: [], tab: -1, lanes: [], marks: stop.steps.map(() => '') }
  if (stop.group === undefined || stop.kind === undefined) return none
  const g = isMap(flow.groups) && Object.hasOwn(flow.groups, stop.group) && isMap(flow.groups[stop.group]) ? flow.groups[stop.group] : {}
  const text = part(g.text)
  const labels = stop.laneLabels ?? []
  const laneOf = (i: number): string => labels[stop.lanes?.[i] ?? -1] ?? ''
  if (stop.kind === 'repeat') {
    const times = part(g.times)
    const until = part(g.until)
    const words = [times === '' ? '' : `up to ${times} times`, until === '' ? '' : `until ${until}`].filter(w => w !== '').join(', ')
    const mark = times !== '' ? `up to ${times}` : until !== '' ? `until ${until}` : ''
    return { ...none, chip: words === '' ? 'Repeats' : `Repeats ${words}`, text, marks: stop.steps.map(() => mark) }
  }
  if (stop.kind === 'branch') {
    return { ...none, chip: labels.length > 1 ? `One of ${labels.length}` : 'Only if', text, tabs: labels, tab: stop.lanes?.[0] ?? -1, marks: stop.steps.map((_, i) => laneOf(i)) }
  }
  const lanes = stop.steps.map((_, i) => laneOf(i))
  return { ...none, chip: labels.length > 1 ? `At the same time, ${labels.length} lanes` : 'At the same time', text, lanes, marks: lanes }
}

/**
 * The progress bar: a cell for each stop, in `col` and `row`, and a bracket for each group over the columns it covers. Most stops take the next
 * column on row 0. The lanes of a branch start in the same column and sit on rows of their own, each lane's stops in the columns after it,
 * and what follows the branch starts after its longest lane. `rows` is the most any branch needs, and at least 1.
 */
export type Progress = {
  cols: number
  rows: number
  cells: { stop: number; col: number; row: number }[]
  brackets: { kind: GroupKind; from: number; to: number; text: string }[]
}

export function progressOf(flow: Flow, stops: Stop[]): Progress {
  const cells: Progress['cells'] = []
  const brackets: Progress['brackets'] = []
  let col = 0
  let rows = 1
  for (let k = 0; k < stops.length;) {
    const s = stops[k]
    if (s.group === undefined || s.kind === undefined) {
      cells.push({ stop: k, col: col++, row: 0 })
      k++
      continue
    }
    let end = k
    while (end + 1 < stops.length && stops[end + 1].group === s.group) end++
    const start = col
    if (s.kind === 'branch') {
      const lanes = s.laneLabels?.length ?? 1
      const used: number[] = []
      for (let j = k; j <= end; j++) {
        const lane = stops[j].lanes?.[0] ?? 0
        const at = used[lane] ?? 0
        cells.push({ stop: j, col: start + at, row: lane })
        used[lane] = at + 1
      }
      const longest = Math.max(1, ...used.map(n => n ?? 0))
      rows = Math.max(rows, lanes)
      brackets.push({ kind: 'branch', from: start, to: start + longest - 1, text: lanes > 1 ? `one of ${lanes}` : 'only if' })
      col = start + longest
    } else {
      for (let j = k; j <= end; j++) cells.push({ stop: j, col: col++, row: 0 })
      const g = isMap(flow.groups) && Object.hasOwn(flow.groups, s.group) && isMap(flow.groups[s.group]) ? flow.groups[s.group] : {}
      const times = part(g.times)
      brackets.push({ kind: s.kind, from: start, to: col - 1, text: s.kind === 'repeat' ? (times === '' ? '' : `×${times}`) : 'together' })
    }
    k = end + 1
  }
  return { cols: col, rows, cells, brackets }
}
