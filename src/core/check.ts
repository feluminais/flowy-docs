import { getObject, ID_RULE, isValidId, LINE_STYLES, OBJECT_TYPES, ROOT } from './model.ts'
import type { Model, ObjectType } from './model.ts'
import { isView, placeStep } from './views.ts'

/**
 * `connection` (a place in model.connections) and `step` (a place in the flow's steps) tell the
 * canvas where to point. They aren't part of what a problem is: newProblems ignores them, so
 * deleting one connection doesn't make the problems after it look new.
 */
export type Problem = { file: string; id?: string; message: string; connection?: number; step?: number }

const PARENTS: Record<ObjectType, readonly ObjectType[]> = {
  actor: [],
  system: [],
  app: ['system'],
  store: ['system'],
  component: ['app', 'store'],
}

/** The types an object may have when it sits right inside `view` (root or an object id). */
export function typesIn(model: Model, view: string): ObjectType[] {
  const parent = view === ROOT ? undefined : getObject(model, view)
  if (view !== ROOT && !parent) return []
  return OBJECT_TYPES.filter(t => (parent ? PARENTS[t].includes(parent.type) : PARENTS[t].length === 0))
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim() !== ''
/** Absent, or a key with nothing after it (`type:`), which reads as "". */
const missing = (v: unknown) => v === undefined || v === ''

/** A path in the repo as `code` takes it: relative, with / between folders, and no "." or ".." parts. A trailing / is a folder. */
export const isRepoPath = (path: string): boolean =>
  !/^\/|\\|:/.test(path) && path.split('/').every((part, i, all) => (part !== '' || (i === all.length - 1 && i > 0)) && part !== '.' && part !== '..')

/** A web address as a link takes it: http or https, then a host. Checks.cs spells the same pattern out character for character, so the two never disagree about a parse. */
export const isWebAddress = (url: string): boolean => /^https?:\/\/[^\t\n\v\f\r \/?#][^\t\n\v\f\r ]*$/i.test(url)

/** A `links` entry whose known fields are text. A missing `url` is reported separately, as "a link has no url". */
const isLinkEntry = (l: unknown): l is { url?: string; title?: string } => {
  if (typeof l !== 'object' || l === null || Array.isArray(l)) return false
  const { url, title } = l as Record<string, unknown>
  return (url === undefined || typeof url === 'string') && (title === undefined || typeof title === 'string')
}

/** A path made safe for a URL one part at a time, so a # or ? in a name stays part of the name. */
export const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')

/**
 * Every problem in the model. Never throws. `absent` holds the code paths that don't exist; only Node
 * can tell, so the browser leaves it empty.
 * The MCP server refuses writes that add problems, so a message must not change when an
 * unrelated part of the model changes: no connection positions, names or descriptions in
 * messages (the only extras are a duplicate's label and a misplaced object's parent type).
 * Step numbers are fine: newProblems leaves them out.
 */
export function check(model: Model, absent: ReadonlySet<string> = new Set()): Problem[] {
  const problems: Problem[] = []
  const add = (file: string, id: string | undefined, message: string, at?: Pick<Problem, 'connection' | 'step'>) =>
    problems.push({ file, ...(id === undefined ? {} : { id }), message, ...at })
  const checkEnds = (p: (message: string) => void, from: unknown, to: unknown) => {
    if (missing(from)) p('"from" is missing')
    if (missing(to)) p('"to" is missing')
    for (const end of new Set([from, to])) if (!missing(end) && !getObject(model, end)) p(`unknown object "${end}"`)
  }

  if (model.meta.lines !== undefined && !LINE_STYLES.some(s => s === model.meta.lines))
    add('model.yaml', undefined, 'lines must be straight, curved or angled')

  for (const [id, o] of Object.entries(model.objects)) {
    const p = (message: string) => add('model.yaml', id, `${id}: ${message}`)
    if (!isValidId(id)) p(`ids ${ID_RULE}`)
    if (!nonEmpty(o.name)) p('name is missing')
    if (o.external !== undefined && o.external !== 'true' && o.external !== 'false') p('external must be true or false')
    if (o.code !== undefined) {
      if (!Array.isArray(o.code) || o.code.some(c => typeof c !== 'string')) p('code must be a list of paths')
      else for (const path of o.code as string[]) {
        if (!isRepoPath(path)) p(`code path "${path}" must be relative, with / between folders and no "." or ".." parts`)
        else if (absent.has(path)) p(`code path "${path}" doesn't exist`)
      }
    }
    if (o.links !== undefined) {
      if (!Array.isArray(o.links) || !o.links.every(isLinkEntry)) p('links must be a list of entries with a url and, if you like, a title')
      else for (const { url } of o.links) {
        if (typeof url !== 'string' || url.trim() === '') p('a link has no url')
        else if (!isWebAddress(url)) {
          if (!isRepoPath(url)) p(`link "${url}" must be a web address (http or https) or a path in the repo, relative, with / between folders and no "." or ".." parts`)
          else if (absent.has(url)) p(`link path "${url}" doesn't exist`)
        }
      }
    }
    if (missing(o.type)) {
      p('type is missing')
      continue
    }
    if (!Object.hasOwn(PARENTS, o.type)) {
      p(`unknown type "${o.type}" (use ${OBJECT_TYPES.join(', ')})`)
      continue
    }
    const allowed = PARENTS[o.type]
    const parent = getObject(model, o.in)
    if (missing(o.in)) {
      if (allowed.length) p(`${o.type} must be inside ${allowed.join(' or ')}`)
    } else if (!parent) p(`"in" points to unknown object "${o.in}"`)
    else if (!allowed.includes(parent.type))
      p(allowed.length ? `${o.type} must be inside ${allowed.join(' or ')}, not ${parent.type}` : `${o.type} can't be inside anything`)
  }

  const seen = new Set<string>()
  model.connections.forEach((c, i) => {
    const end = (v: unknown) => (missing(v) ? '?' : v)
    const p = (message: string) => add('model.yaml', undefined, `connection ${end(c.from)} → ${end(c.to)}: ${message}`, { connection: i })
    checkEnds(p, c.from, c.to)
    if (!missing(c.from) && c.from === c.to) p('connects an object to itself')
    const key = JSON.stringify([c.from, c.to, c.label ?? ''])
    if (seen.has(key)) p(`duplicate${c.label ? ` "${c.label}"` : ''}`)
    seen.add(key)
  })

  for (const [fid, f] of Object.entries(model.flows)) {
    const p = (message: string, at?: { step: number }) => add(`flows/${fid}.yaml`, undefined, message, at)
    if (!isValidId(fid)) p(`"${fid}" is not a valid flow id: the file name must ${ID_RULE}`)
    if (!nonEmpty(f.name)) p('name is missing')
    const viewOk = isView(model, f.view)
    if (missing(f.view)) p('view is missing')
    else if (!viewOk) p(`view "${f.view}" must be "root" or an object with children`)
    if (f.steps.length === 0) p('has no steps')
    f.steps.forEach((s, i) => {
      const sp = (message: string) => p(`step ${i + 1}: ${message}`, { step: i })
      const alone = s.to === undefined // one box doing something on its own; a blank "to:" is still a missing end
      if (!alone) checkEnds(sp, s.from, s.to)
      else if (missing(s.from)) sp('"from" is missing')
      else if (!getObject(model, s.from)) sp(`unknown object "${s.from}"`)
      if (!nonEmpty(s.text)) sp('text is missing')
      if (alone) {
        if (viewOk && getObject(model, s.from) && !placeStep(model, f.view, s)) sp(`${s.from} can't be shown in view "${f.view}"`)
        return
      }
      if (!missing(s.from) && s.from === s.to) sp('goes from an object to itself (leave out "to" for a step one box does on its own)')
      else if (viewOk && getObject(model, s.from) && getObject(model, s.to) && !placeStep(model, f.view, s))
        sp(`${s.from} → ${s.to} can't be shown in view "${f.view}"`)
    })
  }
  return problems
}

// A step's number is left out: deleting or moving a step renumbers the problems after it, and they're still the same problems.
const key = (p: Problem) => JSON.stringify([p.file, p.id ?? '', p.step === undefined ? p.message : p.message.replace(/^step \d+: /, '')])

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
