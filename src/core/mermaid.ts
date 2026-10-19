import { colorPair, isColor, isOpacity, fillOpacity, shapeOf, typeColor } from './look.ts'
import type { Shape } from './look.ts'
import { animationOf } from './animation.ts'
import { getObject, ROOT } from './model.ts'
import type { Model } from './model.ts'
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
  const steps = flow.steps.map(s => ({
    ends: placeStep(model, flow.view, s) ?? [s.from, s.to || s.from],
    text: mermaidText(String(s.text ?? '')),
    recursion: animationOf(s)?.kind === 'recurse', // a good tag on a step with no "to"; anything else that looks like one is not
  }))
  const n = ids([...new Set(steps.flatMap(s => s.ends))])
  return [
    'sequenceDiagram',
    ...[...n].map(([id, m]) => `  ${getObject(model, id)?.type === 'actor' ? 'actor' : 'participant'} ${m} as ${nameOf(model, id)}`),
    // A step one box does on its own is a note over it, unless it is a recursion: that is an arrow back to the same box.
    ...steps.map(({ ends: [a, b], text, recursion }) => (a === b ? (recursion ? `  ${n.get(a)}->>${n.get(a)}: ${text}` : `  Note over ${n.get(a)}: ${text}`) : `  ${n.get(a)}->>${n.get(b)}: ${text}`)),
  ].join('\n') + '\n'
}
