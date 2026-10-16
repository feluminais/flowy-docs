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

export function check(model: Model): Problem[] {
  const problems: Problem[] = []
  const add = (file: string, id: string | undefined, message: string) =>
    problems.push(id === undefined ? { file, message } : { file, id, message })

  for (const [id, o] of Object.entries(model.objects)) {
    const p = (message: string) => add('model.yaml', id, `${id}: ${message}`)
    if (!isValidId(id)) p('ids use lowercase letters, digits and dashes ("root" is reserved)')
    if (!nonEmpty(o.name)) p('name is missing')
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
    const p = (message: string) => add('model.yaml', undefined, `connection ${c.from} → ${c.to}: ${message}`)
    for (const end of [c.from, c.to]) if (!getObject(model, end)) p(`unknown object "${end}"`)
    if (c.from === c.to) p('connects an object to itself')
    const key = JSON.stringify([c.from, c.to, c.label ?? ''])
    if (seen.has(key)) p(`duplicate${c.label ? ` "${c.label}"` : ''}`)
    seen.add(key)
  }

  for (const [fid, f] of Object.entries(model.flows)) {
    const p = (message: string) => add(`flows/${fid}.yaml`, undefined, message)
    if (!isValidId(fid)) p(`"${fid}" is not a valid flow id (it is the file name)`)
    if (!nonEmpty(f.name)) p('name is missing')
    const viewOk = f.view === ROOT || (getObject(model, f.view) !== undefined && hasChildren(model, f.view))
    if (!viewOk) p(`view "${f.view}" must be "root" or an object with children`)
    if (f.steps.length === 0) p('has no steps')
    f.steps.forEach((s, i) => {
      const sp = (message: string) => p(`step ${i + 1}: ${message}`)
      for (const end of [s.from, s.to]) if (!getObject(model, end)) sp(`unknown object "${end}"`)
      if (!nonEmpty(s.text)) sp('text is missing')
      if (s.from === s.to) sp('goes from an object to itself')
      else if (viewOk && getObject(model, s.from) && getObject(model, s.to) && !placeEnds(model, f.view, s.from, s.to))
        sp(`${s.from} → ${s.to} can't be shown in view "${f.view}"`)
    })
  }
  return problems
}

const key = (p: Problem) => JSON.stringify([p.file, p.id ?? '', p.message])

/** Problems in `after` that weren't already in `before`. */
export function newProblems(before: Problem[], after: Problem[]): Problem[] {
  const old = new Set(before.map(key))
  return after.filter(p => !old.has(key(p)))
}
