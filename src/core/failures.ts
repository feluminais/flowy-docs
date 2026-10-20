import type { Problem } from './check.ts'
import { getObject, ID_RULE, isValidId, ROOT } from './model.ts'
import type { Analysis, Mode, Model } from './model.ts'
import { chain, isView, memberIds, nameOf } from './views.ts'

/**
 * Failure analyses. An analysis is a file of failure modes: for a part (a shape or a line), how it fails, what that does, three
 * ratings, and what is done about it. Pure, so the browser and the node side use the same code (desktop/Flowy.Core is to be a port
 * of it, kept equal by fixtures).
 */

export type Band = 'high' | 'medium' | 'low' | 'unrated'
/** The names a reader sees for the bands, worst first. */
export const BAND_NAMES: Record<Band, string> = { high: 'High', medium: 'Medium', low: 'Low', unrated: 'Not rated' }
const BANDS: Band[] = ['high', 'medium', 'low', 'unrated']
export const STATUSES = ['open', 'planned', 'done', 'accepted'] as const
/** The keys a file keeps the ratings under. Detection runs the standard way: 10 means nobody would notice. */
export const RATING_KEYS = ['severity', 'occurrence', 'detection'] as const
export type Rated = { severity?: number; occurrence?: number; detection?: number }

/** A rating written in a file: exactly the text 1 to 10. Anything else (5.5, 07, 0, 11, 1e1, a space) is not a rating. */
export const ratingOf = (text: unknown): number | undefined => (typeof text === 'string' && /^(10|[1-9])$/.test(text) ? Number(text) : undefined)

/** The mode's current ratings. One that is missing or not a rating is left out. */
export function ratingsOf(m: Mode): Rated {
  const out: Rated = {}
  for (const key of RATING_KEYS) {
    const n = ratingOf(m[key])
    if (n !== undefined) out[key] = n
  }
  return out
}

/** The ratings once the next action is done: each from `after` when it holds a rating, else the current one. */
export function ratingsAfter(m: Mode): Rated {
  const out: Rated = {}
  for (const key of RATING_KEYS) {
    const n = ratingOf(m.after?.[key]) ?? ratingOf(m[key])
    if (n !== undefined) out[key] = n
  }
  return out
}

/** Severity times occurrence times detection, 1 to 1000, or none when a rating is missing. */
export const risk = (r: Rated): number | undefined =>
  r.severity === undefined || r.occurrence === undefined || r.detection === undefined ? undefined : r.severity * r.occurrence * r.detection

/** The ratings that count: the after ratings once the mode is done, the current ones otherwise. */
const effective = (m: Mode): Rated => (m.status === 'done' ? ratingsAfter(m) : ratingsOf(m))

/**
 * High when severity is 9 or 10, even with the other ratings missing: a severe failure is never quiet and never hides in Not rated.
 * Otherwise Not rated when a rating is missing, then High from a risk of 150, Medium from 60, Low below. Starting values, as the
 * knee is in Performance.
 */
export function bandOf(m: Mode): Band {
  const r = effective(m)
  if (r.severity !== undefined && r.severity >= 9) return 'high'
  const n = risk(r)
  if (n === undefined) return 'unrated'
  return n >= 150 ? 'high' : n >= 60 ? 'medium' : 'low'
}

export type Ranked = { id: string; mode: Mode; risk?: number; band: Band }

/**
 * The modes worst first: by band, then by risk, highest first. Inside a band a mode with a risk number comes before one without
 * (a severe mode with ratings missing), and those go by severity. Ties keep the order of the file, so the list holds still while it is edited.
 */
export function rank(a: Analysis): Ranked[] {
  const ranked = Object.entries(a.modes).map(([id, mode]): Ranked => {
    const n = risk(effective(mode))
    return { id, mode, band: bandOf(mode), ...(n === undefined ? {} : { risk: n }) }
  })
  const severity = (r: Ranked) => effective(r.mode).severity ?? 0
  return ranked.sort((x, y) =>
    BANDS.indexOf(x.band) - BANDS.indexOf(y.band)
    || (x.risk === undefined ? 1 : 0) - (y.risk === undefined ? 1 : 0)
    || (y.risk ?? 0) - (x.risk ?? 0)
    || severity(y) - severity(x))
}

/**
 * Which shapes the analysis covers. The shapes counted are those with nothing inside, inside `scope` ("root" when it has none), and not
 * actors (nothing of ours fails there). One is analysed when a mode names it, as `on` or as an end of a line. A scope that is not a view counts nothing.
 */
export function coverage(model: Model, a: Analysis): { analysed: string[]; left: string[] } {
  const scope = typeof a.scope === 'string' && a.scope.trim() !== '' ? a.scope : ROOT
  if (!isView(model, scope)) return { analysed: [], left: [] }
  const named = new Set<string>()
  for (const m of Object.values(a.modes)) for (const id of [m.on, m.from, m.to]) if (typeof id === 'string') named.add(id)
  const shapes = Object.keys(model.objects).filter(id =>
    getObject(model, id) && model.objects[id].type !== 'actor' && memberIds(model, id).length === 0 && (scope === ROOT || chain(model, id).includes(scope)))
  return { analysed: shapes.filter(id => named.has(id)), left: shapes.filter(id => !named.has(id)) }
}

/** What a reader calls the part: a shape by the names from the outermost box down ("Shop > API > Auth"), a line by its two ends ("Orders to Mail service"). */
export function partName(model: Model, m: Mode): string {
  if (typeof m.on === 'string' && m.on !== '') return chain(model, m.on).filter(id => id !== ROOT).reverse().map(id => nameOf(model, id)).join(' > ')
  if (typeof m.from === 'string' && typeof m.to === 'string') return `${nameOf(model, m.from)} to ${nameOf(model, m.to)}`
  return ''
}

/** Text with something in it. A blank value in a file is as good as none. */
const has = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * What is wrong with one analysis, given the model it points into: a part that isn't there, a rating that isn't one, a flow or step that
 * doesn't exist. `check` adds these to the model's problems, so an edit that makes one is refused. A mode's problems carry its id and
 * start with it, so a list of problems says which mode. Whether a run exists needs the runs, which are not in the model: see runLinkProblems.
 */
export function analysisProblems(model: Model, aid: string, a: Analysis): Problem[] {
  const file = `failures/${aid}.yaml`
  const problems: Problem[] = []
  if (!isValidId(aid)) problems.push({ file, message: `"${aid}" is not a valid analysis id: the file name must ${ID_RULE}` })
  if (!has(a.name)) problems.push({ file, message: 'name is missing' })
  if (has(a.scope) && !isView(model, a.scope)) problems.push({ file, message: `scope "${a.scope}" must be "root" or an object with children` })
  for (const [mid, m] of Object.entries(a.modes)) {
    const p = (message: string) => problems.push({ file, id: mid, message: `${mid}: ${message}` })
    if (!isValidId(mid)) p(`the id must ${ID_RULE}`)
    if (!has(m.mode)) p('"mode" is missing')

    const line = has(m.from) || has(m.to)
    if (has(m.on) && line) p('has "on" and also "from" or "to"; use one or the other')
    else if (has(m.on)) {
      if (!getObject(model, m.on)) p(`unknown object "${m.on}"`)
    } else if (line) {
      if (!has(m.from) || !has(m.to)) p('"from" and "to" go together')
      else {
        const unknown = [...new Set([m.from, m.to])].filter(end => !getObject(model, end))
        for (const end of unknown) p(`unknown object "${end}"`)
        if (unknown.length === 0 && !model.connections.some(c => c.from === m.from && c.to === m.to)) p(`${m.from} → ${m.to} is not a connection in the model`)
      }
    } else p('needs "on" (a shape) or "from" and "to" (a line)')

    for (const id of m.affects ?? []) if (!getObject(model, id)) p(`affects: unknown object "${id}"`)

    for (const key of RATING_KEYS) if (has(m[key]) && ratingOf(m[key]) === undefined) p(`${key} must be a whole number from 1 to 10`)
    for (const key of RATING_KEYS) if (has(m.after?.[key]) && ratingOf(m.after?.[key]) === undefined) p(`after ${key} must be a whole number from 1 to 10`)

    if (has(m.status) && !(STATUSES as readonly string[]).includes(m.status)) p(`status "${m.status}" must be open, planned, done or accepted`)

    const flow = has(m.flow) ? m.flow : undefined
    const known = flow !== undefined && Object.hasOwn(model.flows, flow)
    if (flow !== undefined && !known) p(`flow "${flow}" doesn't exist`)
    if (has(m.step)) {
      if (flow === undefined) p('step needs a flow')
      else if (!/^[1-9]\d*$/.test(m.step)) p('step must be a whole number from 1')
      else if (known && Number(m.step) > model.flows[flow].steps.length) {
        const count = model.flows[flow].steps.length
        p(`step ${m.step} is outside flow "${flow}", which has ${count === 1 ? '1 step' : `${count} steps`}`)
      }
    }
  }
  return problems
}

/** The modes of an analysis whose `run` names a run that isn't in perf/. Kept apart because the model doesn't hold runs: loadState calls this. */
export function runLinkProblems(aid: string, a: Analysis, runs: Record<string, unknown>): Problem[] {
  return Object.entries(a.modes)
    .filter(([, m]) => has(m.run) && !Object.hasOwn(runs, m.run))
    .map(([mid, m]) => ({ file: `failures/${aid}.yaml`, id: mid, message: `${mid}: run "${m.run}" doesn't exist` }))
}
