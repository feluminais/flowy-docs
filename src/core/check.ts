import { COLOR_NAMES, iconProblem, isColor, isKnownIcon, isOpacity, isShape, OBJECT_TYPE_INFO, SHAPES } from './look.ts'
import { getObject, ID_RULE, isValidId, LINE_STYLES, OBJECT_TYPES, ROOT } from './model.ts'
import type { Model, ObjectType } from './model.ts'
import { animationProblem, interceptorProblem } from './animation.ts'
import { compareOf, compareProblem } from './compare.ts'
import { dataProblems } from './data.ts'
import { analysisProblems } from './failures.ts'
import { FILE_KINDS, pathOf } from './filekinds.ts'
import { isRepoPath, isWebAddress } from './paths.ts'
import { stepPrefix, withoutStep } from './problem.ts'
import type { Problem } from './problem.ts'
import { snippetProblems } from './snippets.ts'
import { stateProblems } from './states.ts'
import { structureProblems, stopsOf } from './structure.ts'
import { hasText, isMap } from './text.ts'
import { isView, placeStep } from './views.ts'

/** The types an object may have when it sits right inside `view` (root or an object id). */
export function typesIn(model: Model, view: string): ObjectType[] {
  const parent = view === ROOT ? undefined : getObject(model, view)
  if (view !== ROOT && !parent) return []
  return OBJECT_TYPES.filter(t => (parent ? OBJECT_TYPE_INFO[t].parents.includes(parent.type) : OBJECT_TYPE_INFO[t].parents.length === 0))
}

/** Absent, or a key with nothing after it (`type:`), which reads as "". Not the opposite of hasText: whitespace is present here, and a value that is not text is too. */
const missing = (v: unknown) => v === undefined || v === ''

/** A `links` entry whose known fields are text. A missing `url` is reported separately, as "a link has no url". */
const isLinkEntry = (l: unknown): l is { url?: string; title?: string } => {
  if (!isMap(l)) return false
  const { url, title } = l
  return (url === undefined || typeof url === 'string') && (title === undefined || typeof title === 'string')
}

/**
 * The keys in `value` that hold nothing, each as the path of keys down to it. In `{ text: Sets the time zone, if it has one }` the comma ends the
 * text and `if it has one` becomes a key with no colon, which reads as null. Every other value reads as text, so null is the only odd one, and
 * it can't be written back: saving fails with "Tag not resolved for null value" long after the file loaded without a complaint.
 */
function emptyKeys(value: unknown, path: string[] = []): string[][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => emptyKeys(v, [...path, `item ${i + 1}`]))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([k, v]) => (v === null ? [[...path, k]] : emptyKeys(v, [...path, k])))
}

const emptyKeyMessage = (path: string[]) => `"${path.join(' → ')}" has no value (a comma ends unquoted text: put text that has a comma in double quotes)`

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

  for (const path of emptyKeys(model.meta)) add('model.yaml', undefined, emptyKeyMessage(path))

  const icons = model.meta.icons
  if (icons !== undefined && icons !== '') {
    if (!isMap(icons)) add('model.yaml', undefined, 'icons must map names to SVG path data')
    else for (const [name, d] of Object.entries(icons)) {
      const why = iconProblem(name, d)
      if (why) add('model.yaml', undefined, `icon ${name}: ${why}`)
    }
  }

  for (const [id, o] of Object.entries(model.objects)) {
    const p = (message: string) => add('model.yaml', id, `${id}: ${message}`)
    if (!isValidId(id)) p(`ids ${ID_RULE}`)
    if (!hasText(o.name)) p('name is missing')
    for (const path of emptyKeys(o)) p(emptyKeyMessage(path))
    if (o.external !== undefined && o.external !== 'true' && o.external !== 'false') p('external must be true or false')
    if (!missing(o.shape) && !isShape(o.shape)) p(`unknown shape "${o.shape}" (use ${SHAPES.join(', ')})`)
    if (!missing(o.color) && !isColor(o.color)) p(`color "${o.color}" must be a name (${COLOR_NAMES.join(', ')}) or a hex like #3b82f6`)
    if (!missing(o.opacity) && !isOpacity(o.opacity)) p(`opacity "${o.opacity}" must be a whole number from 0 to 100`)
    if (!missing(o.icon) && !isKnownIcon(model.meta, o.icon)) p(`unknown icon "${o.icon}" (use a built-in name, or define it under icons: in model.yaml)`)
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
    for (const message of snippetProblems(o)) p(message)
    for (const message of dataProblems(o)) p(message)
    if (missing(o.type)) {
      p('type is missing')
      continue
    }
    if (!Object.hasOwn(OBJECT_TYPE_INFO, o.type)) {
      p(`unknown type "${o.type}" (use ${OBJECT_TYPES.join(', ')})`)
      continue
    }
    const allowed = OBJECT_TYPE_INFO[o.type].parents
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
    for (const path of emptyKeys(c)) p(emptyKeyMessage(path))
    if (!missing(c.from) && c.from === c.to) p('connects an object to itself')
    const key = JSON.stringify([c.from, c.to, c.label ?? ''])
    if (seen.has(key)) p(`duplicate${c.label ? ` "${c.label}"` : ''}`)
    seen.add(key)
  })

  for (const [fid, f] of Object.entries(model.flows)) {
    const p = (message: string, at?: { step: number }) => add(pathOf(FILE_KINDS.flow, fid), undefined, message, at)
    // A problem that belongs to a step reads "step N: ..." (N counts from 1) and points the canvas at it.
    const at = (message: string, step?: number) => (step === undefined ? p(message) : p(stepPrefix(step) + message, { step }))
    if (!isValidId(fid)) p(`"${fid}" is not a valid flow id: the file name must ${ID_RULE}`)
    if (!hasText(f.name)) p('name is missing')
    const viewOk = isView(model, f.view)
    if (missing(f.view)) p('view is missing')
    else if (!viewOk) p(`view "${f.view}" must be "root" or an object with children`)
    if (f.steps.length === 0) p('has no steps')
    // The steps are read one at a time below, so each says its own number; compare says what is wrong with it in the lines after.
    for (const path of emptyKeys({ ...f, steps: [], compare: undefined })) p(emptyKeyMessage(path))
    const compareWhy = compareProblem(f.compare, 'flow')
    const tag = compareOf(f.compare)
    if (compareWhy !== undefined) p(compareWhy)
    else if (tag?.with === fid) p('compare points at this flow itself')
    else if (tag && !Object.hasOwn(model.flows, tag.with)) p(`compare "${tag.with}" is not a flow`)
    f.steps.forEach((s, i) => {
      const sp = (message: string) => at(message, i)
      for (const path of emptyKeys(s)) sp(emptyKeyMessage(path))
      const alone = s.to === undefined // one box doing something on its own; a blank "to:" is still a missing end
      if (!alone) checkEnds(sp, s.from, s.to)
      else if (missing(s.from)) sp('"from" is missing')
      else if (!getObject(model, s.from)) sp(`unknown object "${s.from}"`)
      if (!hasText(s.text)) sp('text is missing')
      const animation = animationProblem(s.animation, !alone) ?? interceptorProblem(s.animation, s, id => getObject(model, id) !== undefined)
      if (animation) sp(animation)
      if (alone) {
        if (viewOk && getObject(model, s.from) && !placeStep(model, f.view, s)) sp(`${s.from} can't be shown in view "${f.view}"`)
        return
      }
      if (!missing(s.from) && s.from === s.to) sp('goes from an object to itself (leave out "to" for a step one shape does on its own)')
      else if (viewOk && getObject(model, s.from) && getObject(model, s.to) && !placeStep(model, f.view, s))
        sp(`${s.from} → ${s.to} can't be shown in view "${f.view}"`)
    })
    for (const sq of structureProblems(f, id => Object.hasOwn(model.flows, id))) at(sq.message, sq.step)
    for (const sq of stateProblems(f, stopsOf(f), id => getObject(model, id) !== undefined)) at(sq.message, sq.step)
  }

  for (const [aid, a] of Object.entries(model.failures)) {
    problems.push(...analysisProblems(model, aid, a))
    for (const path of emptyKeys(a)) add(`failures/${aid}.yaml`, undefined, emptyKeyMessage(path))
  }
  return problems
}

// A step's number is left out: deleting or moving a step renumbers the problems after it, and they're still the same problems.
const key = (p: Problem) => JSON.stringify([p.file, p.id ?? '', withoutStep(p)])

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
