import { colorPair, isColor, isOpacity, fillOpacity, shapeOf, typeColor } from './look.ts'
import type { Shape } from './look.ts'
import { getObject, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { blank, runsOf } from './structure.ts'
import type { Run } from './structure.ts'
import { computeView, placeStep } from './views.ts'

/**
 * Text as Mermaid shows it, never as its syntax: quotes, brackets, backticks, # and ; (a line break in sequence
 * diagrams) become Mermaid's #code; entities, and new lines become spaces.
 */
export function mermaidText(text: string): string {
  // One pass, so the ; of an entity just written is never escaped again.
  return text.replace(/\s*\n\s*/g, ' ').replace(/[#;"<>`]/g, c => `#${ENTITIES[c]};`)
}
const ENTITIES: Record<string, string> = { '#': '35', ';': '59', '"': 'quot', '<': 'lt', '>': 'gt', '`': '96' } // a backtick after " starts Mermaid markdown

const nameOf = (model: Model, id: string) => mermaidText(String(getObject(model, id)?.name || id))

/** Mermaid ids are made up (n0, n1, …): Flowy ids like "end" or "a-b" would read as Mermaid syntax. */
function ids(boxes: string[]): Map<string, string> {
  return new Map(boxes.map((id, i) => [id, `n${i}`]))
}

/**
 * A shape as the closest Mermaid node. The newer ones (queue, document, note, cloud) use the `@{ shape: }` form,
 * which Mermaid 11.3 and later draw, as GitHub and GitLab do; a folder has no Mermaid shape and stays a rectangle.
 */
const NODES: Record<Shape, (id: string, label: string) => string> = {
  rectangle: (id, l) => `${id}["${l}"]`,
  pill: (id, l) => `${id}(["${l}"])`,
  ellipse: (id, l) => `${id}(("${l}"))`,
  diamond: (id, l) => `${id}{"${l}"}`,
  hexagon: (id, l) => `${id}{{"${l}"}}`,
  parallelogram: (id, l) => `${id}[/"${l}"/]`,
  cylinder: (id, l) => `${id}[("${l}")]`,
  arrow: (id, l) => `${id}>"${l}"]`,
  queue: (id, l) => `${id}@{ shape: h-cyl, label: "${l}" }`,
  document: (id, l) => `${id}@{ shape: doc, label: "${l}" }`,
  folder: (id, l) => `${id}["${l}"]`,
  note: (id, l) => `${id}@{ shape: fold-rect, label: "${l}" }`,
  cloud: (id, l) => `${id}@{ shape: cloud, label: "${l}" }`,
}

/** A `style` line for an object that sets a colour or an opacity: its fill at that opacity, and its outline in the colour when one is set. */
function styleLine(model: Model, id: string, node: string): string[] {
  const o = getObject(model, id)!
  if (!isColor(o.color) && !isOpacity(o.opacity)) return []
  const [hex] = colorPair(isColor(o.color) ? o.color : typeColor(o))!
  return [`  style ${node} fill:${hex},fill-opacity:${fillOpacity(o) / 100}${isColor(o.color) ? `,stroke:${hex}` : ''}`]
}

/** A view as a Mermaid flowchart: its boxes, the boxes around it drawn dashed, and its merged lines. */
export function viewToMermaid(model: Model, view: string): string {
  if (view !== ROOT && !getObject(model, view)) throw new Error(`unknown view "${view}"`)
  const v = computeView(model, view)
  const n = ids([...v.members, ...v.outsiders])
  const box = (id: string) => {
    const o = getObject(model, id)!
    const label = `${nameOf(model, id)}<br/>${mermaidText(String(o.type))}${o.tech ? ` · ${mermaidText(String(o.tech))}` : ''}`
    return `  ${NODES[shapeOf(o)](n.get(id)!, label)}`
  }
  const lines = [
    'flowchart TB',
    ...[...n.keys()].map(box),
    ...v.edges.map(e => `  ${n.get(e.from)} ${e.label ? `-- "${mermaidText(e.label)}" ` : ''}--> ${n.get(e.to)}`),
    ...[...n].flatMap(([id, node]) => styleLine(model, id, node)),
  ]
  if (v.outsiders.length) lines.push('  classDef outsider stroke-dasharray: 4 3', `  class ${v.outsiders.map(id => n.get(id)).join(',')} outsider`)
  return lines.join('\n') + '\n'
}

/** A flow as a Mermaid sequence diagram, with each step's ends as the boxes its view shows. */
export function flowToMermaid(model: Model, flowId: string): string {
  const flow = Object.hasOwn(model.flows, flowId) ? model.flows[flowId] : undefined
  if (!flow) throw new Error(`unknown flow "${flowId}"`)
  // A step the view can't show (the checker reports it) keeps its own ends.
  const steps = flow.steps.map(s => ({ ends: placeStep(model, flow.view, s) ?? [s.from, s.to || s.from], text: mermaidText(String(s.text ?? '')) }))
  const n = ids([...new Set(steps.flatMap(s => s.ends))])
  // A step one box does on its own is a note over it. A step that continues in another flow says so in a note over its end.
  const line = (i: number, indent: string): string[] => {
    const { ends: [a, b], text } = steps[i]
    const out = [a === b ? `${indent}Note over ${n.get(a)}: ${text}` : `${indent}${n.get(a)}->>${n.get(b)}: ${text}`]
    const link = blank(flow.steps[i].flow) ? undefined : String(flow.steps[i].flow).trim()
    if (link !== undefined && Object.hasOwn(model.flows, link))
      out.push(`${indent}Note over ${n.get(b)}: ${mermaidText(`Continues in "${String(model.flows[link].name || link)}"`)}`)
    return out
  }
  const keyword = (word: string, label: string) => `  ${word}${label === '' ? '' : ` ${label}`}`
  // A group is Mermaid's own block, one level: a repeat is a loop, a branch is alt and else (opt for one lane), parallel lanes are par and and.
  const block = (run: Run): string[] => {
    const inside = (from: number[]) => from.flatMap(i => line(i, '    '))
    if (run.kind === 'repeat') {
      const g = flow.groups?.[run.group] ?? {}
      const part = (v: unknown) => (blank(v) ? '' : String(v).trim())
      const times = part(g.times)
      const until = part(g.until)
      const head = [times === '' ? '' : `Up to ${times} times`, until === '' ? '' : `${times === '' ? 'Until' : 'until'} ${until}`].filter(w => w !== '').join(', ')
      const label = [head, part(g.text)].filter(w => w !== '').join(': ')
      return [keyword('loop', mermaidText(label)), ...inside(Array.from({ length: run.end - run.start + 1 }, (_, k) => run.start + k)), '  end']
    }
    const [first, next] = run.kind === 'branch' ? [run.lanes.length > 1 ? 'alt' : 'opt', 'else'] : ['par', 'and']
    return [...run.lanes.flatMap((lane, k) => [keyword(k === 0 ? first : next, mermaidText(lane.label)), ...inside(lane.steps)]), '  end']
  }
  const runs = runsOf(flow)
  const body: string[] = []
  for (let i = 0; i < steps.length;) {
    const run = runs.find(r => r.start === i)
    if (run === undefined) body.push(...line(i++, '  '))
    else {
      body.push(...block(run))
      i = run.end + 1
    }
  }
  return [
    'sequenceDiagram',
    ...[...n].map(([id, m]) => `  ${getObject(model, id)?.type === 'actor' ? 'actor' : 'participant'} ${m} as ${nameOf(model, id)}`),
    ...body,
  ].join('\n') + '\n'
}
