import type { Report } from '../../src/node/files.ts'
import type { Model } from '../../src/core/model.ts'
import * as ops from '../../src/core/ops.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import { isView } from '../../src/core/views.ts'
import { MAKERS } from './moves.ts'
import type { Move } from './moves.ts'
import { Rng } from './rng.ts'

/**
 * What an AI does with the MCP server: reads, writes, sends back what it read, sends several calls at once, and now and then sends an argument the
 * wrong way round (a number as text, a flag as a word, a key left out, a stray key). A write is the same edit a move in moves.ts makes through ops.ts,
 * so the result of the tool can be compared with the result of the op (the `twin`).
 */
export type Call = { tool: string; args: Record<string, unknown> }

export type McpMove = {
  /** Names the move in a report: the tool, or what the move does with several. */
  op: string
  label: string
  calls: Call[]
  /** Every call is sent at once, as an AI client does. */
  together?: boolean
  /** `read` changes nothing and must answer; `write` may be refused; `echo` reads one thing and sends it straight back, which must be accepted and change nothing. */
  kind: 'read' | 'write' | 'echo'
  /** For an echo: the call that sends back what the first call answered. */
  sendBack?: (answer: string) => Call | undefined
  /** The edit in ops.ts that the call stands for. Left out when the call is sent the wrong way round, since the op would not take it. */
  twin?: Move
  expect?: Move['expect']
  /** For a read: what is wrong with the answer, given what the folder holds. */
  answer?: (text: string, report: Report) => string | undefined
}
export type McpMaker = (report: Report, rng: Rng) => McpMove | undefined

const ids = (o: object) => Object.keys(o)

/** Any value of the arguments, as a path to it, so one can be sent the wrong way round. */
function leaves(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]))
  return value === undefined ? [] : [path]
}

/** The arguments with one thing sent the way a hurried AI might: a number or flag as text, a value as a list, a key dropped, null, or a key the tool does not have. */
export function sloppy(args: Record<string, unknown>, rng: Rng): { args: Record<string, unknown>; how: string } {
  const copy = structuredClone(args)
  const found = leaves(copy)
  if (found.length === 0 || rng.chance(0.15)) return { args: { ...copy, note: 'extra' }, how: 'an extra key' }
  const path = rng.pick(found)
  let holder: any = copy
  for (const key of path.slice(0, -1)) holder = holder[key]
  const last = path[path.length - 1]
  const value = holder[last]
  const where = path.join('.')
  if (typeof value === 'number') return holder[last] = String(value), { args: copy, how: `${where} as text` }
  if (typeof value === 'boolean') return holder[last] = String(value), { args: copy, how: `${where} as "${value}"` }
  switch (rng.int(4)) {
    case 0: holder[last] = null; return { args: copy, how: `${where} null` }
    case 1: holder[last] = [value]; return { args: copy, how: `${where} in a list` }
    case 2: holder[last] = ''; return { args: copy, how: `${where} empty` }
    default:
      if (Array.isArray(holder)) holder.splice(Number(last), 1)
      else delete holder[last as string]
      return { args: copy, how: `${where} left out` }
  }
}

/** An edit in moves.ts, sent to the tool that makes it. */
const write: McpMaker = ({ model }, rng) => {
  for (let tries = 0; tries < 12; tries++) {
    const move = MAKERS[rng.pick(Object.keys(MAKERS))](model, rng)
    if (!move?.call) continue
    if (rng.chance(0.25)) {
      const { args, how } = sloppy(move.call.args, rng)
      return { op: move.call.tool, label: `${move.call.tool} ${how}: ${move.label}`, kind: 'write', calls: [{ tool: move.call.tool, args }] }
    }
    return { op: move.call.tool, label: move.label, kind: 'write', calls: [move.call], twin: move, expect: move.expect }
  }
  return undefined
}

/**
 * Deleting something that the op takes. Most plain deletes are refused (a shape that is used, a line a mode names), which leaves untried what
 * happens when one goes through, so this looks for one that does.
 */
const deleteSomething: McpMaker = ({ model }, rng) => {
  const candidates: Move[] = [
    ...ids(model.objects).map((id): Move => ({ op: 'delete_object', label: `deleteObject ${id}`, call: { tool: 'delete_object', args: { id } }, run: m => ops.deleteObject(m, id) })),
    ...ids(model.flows).map((id): Move => ({ op: 'delete_flow', label: `deleteFlow ${id}`, call: { tool: 'delete_flow', args: { id } }, run: m => ops.deleteFlow(m, id) })),
    ...ids(model.failures).map((id): Move => ({ op: 'delete_failures', label: `deleteAnalysis ${id}`, call: { tool: 'delete_failures', args: { id } }, run: m => ops.deleteAnalysis(m, id) })),
    ...model.connections.map((c): Move => ({ op: 'disconnect', label: `disconnect ${c.from} → ${c.to}`, call: { tool: 'disconnect', args: { from: c.from, to: c.to } }, run: m => ops.disconnect(m, { from: c.from, to: c.to }) })),
  ]
  for (const move of rng.some(candidates, 10)) {
    try {
      refuseNewProblems(model, move.run(model))
    } catch {
      continue
    }
    return { op: move.op, label: move.label, kind: 'write', calls: [move.call!], twin: move }
  }
  return undefined
}

/** An icon made and then deleted, one call after the other: a delete_icon is refused unless an icon is there, and nothing else makes one. */
const icon: McpMaker = (_, rng) => {
  const name = `icon-${rng.int(40)}`
  return {
    op: 'delete_icon', label: `put_icon then delete_icon ${name}`, kind: 'write',
    calls: [{ tool: 'put_icon', args: { name, path: 'M0 0h10v10z' } }, { tool: 'delete_icon', args: { name } }],
    expect: (_, after) => (Object.hasOwn((after.meta.icons as object | undefined) ?? {}, name) ? `icon ${name} is still there` : undefined),
  }
}

/** Two or three edits sent at once. The server takes them one at a time, in the order they came. */
const together: McpMaker = (report, rng) => {
  const moves = Array.from({ length: 2 + rng.int(2) }, () => write(report, rng)).filter((m): m is McpMove => m !== undefined)
  if (moves.length < 2) return undefined
  return { op: 'at-once', label: `at once: ${moves.map(m => m.label).join(' | ')}`, kind: 'write', together: true, calls: moves.flatMap(m => m.calls) }
}

const view = (model: Model, rng: Rng) => rng.pick(['root', ...ids(model.objects).filter(id => isView(model, id))])

const read = (op: string, label: string, args: Record<string, unknown>, answer?: McpMove['answer']): McpMove => ({ op, label: `${op} ${label}`.trim(), kind: 'read', calls: [{ tool: op, args }], answer })

const reads: Record<string, McpMaker> = {
  summary: () => read('get_model', 'summary', { summary: true }),
  object: ({ model }, rng) => (ids(model.objects).length ? (id => read('get_model', `object ${id}`, { object: id }))(rng.pick(ids(model.objects))) : undefined),
  flow: ({ model }, rng) => (ids(model.flows).length ? (id => read('get_model', `flow ${id}`, { flow: id }))(rng.pick(ids(model.flows))) : undefined),
  analysis: ({ model }, rng) => (ids(model.failures).length ? (id => read('get_model', `analysis ${id}`, { analysis: id }))(rng.pick(ids(model.failures))) : undefined),
  everything: () => read('get_model', 'everything', {}),
  problems: () => read('get_problems', '', {}, (text, { problems }) => {
    const said = text === 'No problems.' ? 0 : text.split('\n').length
    return said === problems.length ? undefined : `answers ${said} problem(s) where the folder has ${problems.length}`
  }),
  view: ({ model }, rng) => (v => read('get_view', v, { view: v }))(view(model, rng)),
  mermaidView: ({ model }, rng) => (v => read('get_mermaid', `view ${v}`, { view: v }))(view(model, rng)),
  mermaidFlow: ({ model }, rng) => (ids(model.flows).length ? (id => read('get_mermaid', `flow ${id}`, { flow: id }))(rng.pick(ids(model.flows))) : undefined),
  failures: ({ model }, rng) => read('get_failures', '', rng.chance(0.5) || ids(model.failures).length === 0 ? {} : { analysis: rng.pick(ids(model.failures)), format: rng.pick(['markdown', 'csv']) }),
}

/** get_model says everything it shows can be sent back to a put_ tool as it is: read one thing and send it back, which must be accepted and change nothing. */
function echo(op: string, label: string, ask: Call, back: (answer: Record<string, unknown>) => Call | undefined): McpMove {
  return { op, label, kind: 'echo', calls: [ask], sendBack: text => back(JSON.parse(text)) }
}

const echoes: Record<string, McpMaker> = {
  object: ({ model }, rng) => {
    if (ids(model.objects).length === 0) return undefined
    const id = rng.pick(ids(model.objects))
    return echo('echo-object', `echo object ${id}`, { tool: 'get_model', args: { object: id } }, a => ({ tool: 'put_object', args: { id, ...(a.object as object) } }))
  },
  flow: ({ model }, rng) => {
    if (ids(model.flows).length === 0) return undefined
    const id = rng.pick(ids(model.flows))
    return echo('echo-flow', `echo flow ${id}`, { tool: 'get_model', args: { flow: id } }, a => ({ tool: 'put_flow', args: { id, ...(a.flow as object) } }))
  },
  analysis: ({ model }, rng) => {
    if (ids(model.failures).length === 0) return undefined
    const id = rng.pick(ids(model.failures))
    return echo('echo-analysis', `echo analysis ${id}`, { tool: 'get_model', args: { analysis: id } }, a => ({ tool: 'put_failures', args: { id, ...(a.analysis as object) } }))
  },
  mode: ({ model }, rng) => {
    const modes = Object.entries(model.failures).flatMap(([aid, a]) => ids(a.modes).map(mid => [aid, mid] as const))
    if (modes.length === 0) return undefined
    const [aid, mid] = rng.pick(modes)
    return echo('echo-mode', `echo mode ${aid}/${mid}`, { tool: 'get_model', args: { analysis: aid } }, a => ({ tool: 'put_failure', args: { analysis: aid, id: mid, ...((a.analysis as { modes: Record<string, object> }).modes[mid]) } }))
  },
}

/** What a scenario draws from. Edits come up most; the rest keep the reads and the send-backs honest. */
export const MCP_MAKERS: Record<string, McpMaker> = {
  write1: write, write2: write, write3: write, write4: write, write5: write, write6: write,
  delete1: deleteSomething, delete2: deleteSomething,
  icon,
  together,
  ...Object.fromEntries(Object.entries(reads).map(([k, f]) => [`read-${k}`, f])),
  ...Object.fromEntries(Object.entries(echoes).map(([k, f]) => [`echo-${k}`, f])),
}
