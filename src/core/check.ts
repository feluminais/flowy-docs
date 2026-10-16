import { getObject, isValidId, OBJECT_TYPES, ROOT } from './model.ts'
import type { Model, ObjectType } from './model.ts'
import { hasChildren, placeEnds } from './views.ts'

export type Problem = { file: string; id?: string; message: string }

const PARENTS: Record<ObjectType, readonly ObjectType[]> = {
  actor: [],
  system: [],
  app: ['system'],
  store: ['system'],
  component: ['app', 'store'],
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim() !== ''

/**
 * Every problem in the model. Never throws.
 * The MCP server refuses writes that add problems, so a message must not change when an
 * unrelated part of the model changes: no connection positions, names or descriptions in
 * messages. Step numbers are fine; they only shift inside the flow being edited.
 */
export function check(model: Model): Problem[] {
  const problems: Problem[] = []
  const add = (file: string, id: string | undefined, message: string) =>
    problems.push(id === undefined ? { file, message } : { file, id, message })
  const checkEnds = (p: (message: string) => void, from: unknown, to: unknown) => {
    if (from === undefined) p('"from" is missing')
    if (to === undefined) p('"to" is missing')
    for (const end of new Set([from, to])) if (end !== undefined && !getObject(model, end)) p(`unknown object "${end}"`)
  }

  for (const [id, o] of Object.entries(model.objects)) {
    const p = (message: string) => add('model.yaml', id, `${id}: ${message}`)
    if (!isValidId(id)) p('ids use lowercase letters, digits and dashes ("root" is reserved)')
    if (!nonEmpty(o.name)) p('name is missing')
    if (o.type === undefined) {
      p('type is missing')
      continue
    }
    if (!Object.hasOwn(PARENTS, o.type)) {
      p(`unknown type "${o.type}" (use ${OBJECT_TYPES.join(', ')})`)
      continue
    }
    const allowed = PARENTS[o.type]
    const parent = getObject(model, o.in)
    if (o.in === undefined) {
      if (allowed.length) p(`${o.type} must be inside ${allowed.join(' or ')}`)
    } else if (!parent) p(`"in" points to unknown object "${o.in}"`)
    else if (!allowed.includes(parent.type))
      p(allowed.length ? `${o.type} must be inside ${allowed.join(' or ')}, not ${parent.type}` : `${o.type} can't be inside anything`)
  }

  const seen = new Set<string>()
  for (const c of model.connections) {
    const p = (message: string) => add('model.yaml', undefined, `connection ${c.from ?? '?'} → ${c.to ?? '?'}: ${message}`)
    checkEnds(p, c.from, c.to)
    if (c.from !== undefined && c.from === c.to) p('connects an object to itself')
    const key = JSON.stringify([c.from, c.to, c.label ?? ''])
    if (seen.has(key)) p(`duplicate${c.label ? ` "${c.label}"` : ''}`)
    seen.add(key)
  }

  for (const [fid, f] of Object.entries(model.flows)) {
    const p = (message: string) => add(`flows/${fid}.yaml`, undefined, message)
    if (!isValidId(fid)) p(`"${fid}" is not a valid flow id: the file name must use lowercase letters, digits and dashes ("root" is reserved)`)
    if (!nonEmpty(f.name)) p('name is missing')
    const viewOk = f.view === ROOT || (getObject(model, f.view) !== undefined && hasChildren(model, f.view))
    if (f.view === undefined) p('view is missing')
    else if (!viewOk) p(`view "${f.view}" must be "root" or an object with children`)
    if (f.steps.length === 0) p('has no steps')
    f.steps.forEach((s, i) => {
      const sp = (message: string) => p(`step ${i + 1}: ${message}`)
      checkEnds(sp, s.from, s.to)
      if (!nonEmpty(s.text)) sp('text is missing')
      if (s.from !== undefined && s.from === s.to) sp('goes from an object to itself')
      else if (viewOk && getObject(model, s.from) && getObject(model, s.to) && !placeEnds(model, f.view, s.from, s.to))
        sp(`${s.from} → ${s.to} can't be shown in view "${f.view}"`)
    })
  }
  return problems
}

const key = (p: Problem) => JSON.stringify([p.file, p.id ?? '', p.message])

/** Problems in `after` that weren't already in `before`. Repeats count: a second copy of an old problem is new. */
export function newProblems(before: Problem[], after: Problem[]): Problem[] {
  const remaining = new Map<string, number>()
  for (const p of before) remaining.set(key(p), (remaining.get(key(p)) ?? 0) + 1)
  return after.filter(p => {
    const left = remaining.get(key(p)) ?? 0
    remaining.set(key(p), left - 1)
    return left <= 0
  })
}
