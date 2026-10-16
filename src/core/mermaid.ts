import { getObject, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { computeView, placeEnds } from './views.ts'

/**
 * Text as Mermaid shows it, never as its syntax: quotes, brackets, # and ; (a line break in sequence
 * diagrams) become Mermaid's #code; entities, and new lines become spaces.
 */
export function mermaidText(text: string): string {
  // One pass, so the ; of an entity just written is never escaped again.
  return text.replace(/\s*\n\s*/g, ' ').replace(/[#;"<>]/g, c => `#${ENTITIES[c]};`)
}
const ENTITIES: Record<string, string> = { '#': '35', ';': '59', '"': 'quot', '<': 'lt', '>': 'gt' }

const nameOf = (model: Model, id: string) => mermaidText(String(getObject(model, id)?.name || id))

/** Mermaid ids are made up (n0, n1, …): Flowy ids like "end" or "a-b" would read as Mermaid syntax. */
function ids(boxes: string[]): Map<string, string> {
  return new Map(boxes.map((id, i) => [id, `n${i}`]))
}

/** A view as a Mermaid flowchart: its boxes, the boxes around it drawn dashed, and its merged lines. */
export function viewToMermaid(model: Model, view: string): string {
  if (view !== ROOT && !getObject(model, view)) throw new Error(`unknown view "${view}"`)
  const v = computeView(model, view)
  const n = ids([...v.members, ...v.outsiders])
  const box = (id: string) => {
    const o = getObject(model, id)!
    const label = `${nameOf(model, id)}<br/>${mermaidText(String(o.type))}${o.tech ? ` · ${mermaidText(String(o.tech))}` : ''}`
    if (o.type === 'actor') return `  ${n.get(id)}(["${label}"])`
    if (o.type === 'store') return `  ${n.get(id)}[("${label}")]`
    return `  ${n.get(id)}["${label}"]`
  }
  const lines = [
    'flowchart TB',
    ...[...n.keys()].map(box),
    ...v.edges.map(e => `  ${n.get(e.from)} ${e.label ? `-- "${mermaidText(e.label)}" ` : ''}--> ${n.get(e.to)}`),
  ]
  if (v.outsiders.length) lines.push('  classDef outsider stroke-dasharray: 4 3', `  class ${v.outsiders.map(id => n.get(id)).join(',')} outsider`)
  return lines.join('\n') + '\n'
}

/** A flow as a Mermaid sequence diagram, with each step's ends as the boxes its view shows. */
export function flowToMermaid(model: Model, flowId: string): string {
  const flow = Object.hasOwn(model.flows, flowId) ? model.flows[flowId] : undefined
  if (!flow) throw new Error(`unknown flow "${flowId}"`)
  // A step the view can't show (the checker reports it) keeps its own ends.
  const steps = flow.steps.map(s => ({ ends: placeEnds(model, flow.view, s.from, s.to) ?? [s.from, s.to], text: s.text }))
  const n = ids([...new Set(steps.flatMap(s => s.ends))])
  return [
    'sequenceDiagram',
    ...[...n].map(([id, m]) => `  ${getObject(model, id)?.type === 'actor' ? 'actor' : 'participant'} ${m} as ${nameOf(model, id)}`),
    ...steps.map(s => `  ${n.get(s.ends[0])}->>${n.get(s.ends[1])}: ${mermaidText(String(s.text ?? ''))}`),
  ].join('\n') + '\n'
}
