import { FILE_KINDS, pathOf } from './filekinds.ts'
import type { Problem } from './problem.ts'
import { getObject, ID_RULE, isValidId, ROOT } from './model.ts'
import type { Analysis, Mode, Model } from './model.ts'
import { hasText, own } from './text.ts'
import { chain, isView, memberIds, nameOf, parentOf, placeEnds, placeStep } from './views.ts'

/**
 * Failure analyses. An analysis is a file of failure modes: for a part (a shape or a line), how it fails, what that does, three
 * ratings, and what is done about it. Pure, so the browser and the node side use the same code (desktop/Flowy.Core has a port
 * of it, kept equal by fixtures).
 */

export type Band = 'high' | 'medium' | 'low' | 'unrated'
/** The names a reader sees for the bands, worst first. */
export const BAND_NAMES: Record<Band, string> = { high: 'High', medium: 'Medium', low: 'Low', unrated: 'Not rated' }
const BANDS: Band[] = ['high', 'medium', 'low', 'unrated']
/** Where the bands start: High from a risk of 150 or a severity of 9, Medium from a risk of 60. Starting values, as the knee is in Performance. */
const HIGH_RISK = 150
const HIGH_SEVERITY = 9
const MEDIUM_RISK = 60
/** What each band stands for, as the key says it beside the band's count. Built from the numbers `bandOf` uses, so the two cannot drift. */
export const BAND_RULES: Record<Band, string> = {
  high: `Risk ${HIGH_RISK}+ or severity ${HIGH_SEVERITY}+`,
  medium: `Risk ${MEDIUM_RISK} to ${HIGH_RISK - 1}`,
  low: `Risk under ${MEDIUM_RISK}`,
  unrated: 'A rating missing',
}
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

/** The risk of the ratings that count (the after ratings once the mode is done), or none when one is missing. */
export const riskOf = (m: Mode): number | undefined => risk(effective(m))

/**
 * High when severity is 9 or 10, even with the other ratings missing: a severe failure is never quiet and never hides in Not rated.
 * Otherwise Not rated when a rating is missing, then High from a risk of 150, Medium from 60, Low below. Starting values, as the
 * knee is in Performance.
 */
export function bandOf(m: Mode): Band {
  const r = effective(m)
  if (r.severity !== undefined && r.severity >= HIGH_SEVERITY) return 'high'
  const n = risk(r)
  if (n === undefined) return 'unrated'
  return n >= HIGH_RISK ? 'high' : n >= MEDIUM_RISK ? 'medium' : 'low'
}

/**
 * The severity that made the mode High when its risk alone would not: severity 9 or 10 with a risk under 150 or none. Nothing for any
 * other mode, so a High row that is High by its risk says nothing extra.
 */
function severityOnly(m: Mode): number | undefined {
  const r = effective(m)
  const n = risk(r)
  return r.severity !== undefined && r.severity >= HIGH_SEVERITY && (n === undefined || n < HIGH_RISK) ? r.severity : undefined
}

/** Why the mode is in its band, when its risk does not say it: "Severity 9" for a High row that is High by severity alone. Shown beside the row's risk. */
export const bandReason = (m: Mode): string | undefined => {
  const s = severityOnly(m)
  return s === undefined ? undefined : `Severity ${s}`
}

/** The band as the picked mode's card says it: "High: severity 9" when severity alone made it High, else just the band's name. */
export const bandLabel = (m: Mode): string => {
  const s = severityOnly(m)
  return s === undefined ? BAND_NAMES[bandOf(m)] : `${BAND_NAMES.high}: severity ${s}`
}

/** How the risk is made: "8 × 4 × 3", severity times likelihood times hard to spot, of the ratings that count. Nothing when a rating is missing. */
export function riskProduct(m: Mode): string | undefined {
  const r = effective(m)
  return risk(r) === undefined ? undefined : `${r.severity} × ${r.occurrence} × ${r.detection}`
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

/**
 * What a screen reader says for a row of the list: the part's own name and the mode, then the band with its risk and, for a High row made so by severity alone, that severity, then where the part sits
 * ("Refunds: Stripe refunds the money but the database write fails. High, risk 126, severity 9. Ordering > Order API").
 */
export function rowName(model: Model, r: Ranked): string {
  const part = partName(model, r.mode)
  const at = part.lastIndexOf(' > ')
  const rating = [BAND_NAMES[r.band], r.risk === undefined ? '' : `risk ${r.risk}`, bandReason(r.mode)?.toLowerCase() ?? ''].filter(x => x !== '').join(', ')
  return [`${at === -1 ? part : part.slice(at + 3)}: ${r.mode.mode ?? ''}`, rating, at === -1 ? '' : part.slice(0, at)].filter(x => x !== '').join('. ')
}

/** What a badge on a line says: the line by its two ends, how many modes, and the worst band. A shape's badge leaves the line out. */
export const badgeName = (mark: Mark, line?: string): string =>
  `${line === undefined ? '' : `${line}, `}${mark.count} failure${mark.count === 1 ? '' : 's'}, ${BAND_NAMES[mark.band]}`

/** The columns of the exported table, in order: the words a reader sees, which are not the keys a file keeps. The After columns follow when some mode has an `after`. */
const COLUMNS = ['Risk band', 'Part', 'Mode', 'Effect', 'Cause', 'Severity', 'Likelihood', 'Hard to spot', 'Risk', 'Controls', 'Next action', 'Owner', 'Status']
const AFTER_COLUMNS = ['Severity after', 'Likelihood after', 'Hard to spot after']

/** A cell for a spreadsheet that opens a CSV: one that starts with = + - @ or a tab or return would run as a formula, so it gets a leading quote mark. */
const guarded = (cell: string) => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell)
const csvCell = (cell: string) => {
  const safe = guarded(cell)
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}
const markdownCell = (cell: string) => cell.replaceAll('|', '\\|').replace(/\r\n|\r|\n/g, '<br>')

/**
 * The modes as a table, worst first, with the words the screen uses. Risk and Risk band follow the ratings that count, so a done mode shows
 * its after ratings' risk. The After columns appear only when some mode has an `after`. A Markdown cell escapes | and line breaks; a CSV
 * cell is quoted when it needs it and guarded against running as a formula.
 */
export function table(model: Model, a: Analysis, format: 'markdown' | 'csv'): string {
  const ranked = rank(a)
  const withAfter = ranked.some(r => r.mode.after !== undefined)
  const head = withAfter ? [...COLUMNS, ...AFTER_COLUMNS] : COLUMNS
  const rows = ranked.map(({ mode: m, risk: n, band }) => [
    BAND_NAMES[band], partName(model, m), m.mode ?? '', m.effect ?? '', m.cause ?? '',
    m.severity ?? '', m.occurrence ?? '', m.detection ?? '', n === undefined ? '' : String(n),
    m.controls ?? '', m.action ?? '', m.owner ?? '', typeof m.status === 'string' && m.status.trim() !== '' ? m.status : 'open',
    ...(withAfter ? RATING_KEYS.map(key => m.after?.[key] ?? '') : []),
  ])
  if (format === 'csv') return [head, ...rows].map(cells => cells.map(csvCell).join(',')).join('\n')
  const line = (cells: string[]) => `| ${cells.map(markdownCell).join(' | ')} |`
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n')
}

/** "Analysed 15 of 26 shapes": what the panel says under the band counts. The shapes are those that hold no others, actors left out. */
export const analysedText = (analysed: number, total: number): string => `Analysed ${analysed} of ${total} ${total === 1 ? 'shape' : 'shapes'}`

/** "Analysed 3 of 4 shapes", and when some are left a second line naming them by their path. */
export function coverageText(model: Model, a: Analysis): string {
  const { analysed, left } = coverage(model, a)
  const first = analysedText(analysed.length, analysed.length + left.length)
  return left.length === 0 ? first : `${first}\nNot analysed: ${left.map(id => partName(model, { on: id })).join(', ')}`
}

/** One analysis for a reader: in Markdown a heading, the coverage and the table; in CSV the table alone, since anything else would break the file. */
export function analysisText(model: Model, id: string, a: Analysis, format: 'markdown' | 'csv'): string {
  if (format === 'csv') return table(model, a, 'csv')
  return `## ${a.name.trim() === '' ? id : `${a.name} (${id})`}\n\n${coverageText(model, a)}\n\n${table(model, a, 'markdown')}`
}

/** The text a drawn line is known by. ui/src/graph.ts draws the lines with it. */
export const lineKey = (from: string, to: string): string => `${from} ${to}`

/** What a shape or a line wears on the canvas: the worst band of the modes it carries, and how many. */
export type Mark = { band: Band; count: number }
export type Marks = { boxes: Record<string, Mark>; lines: Record<string, Mark> }
/** A shape or a line as the canvas draws it in one view. */
export type Part = { box: string } | { line: [string, string] }
export type Reach = { fails: string[]; failsLine?: string; affects: string[] }

/** The box in `view` that stands for a shape: itself, or the box it is inside. None when the view does not draw it (and none for the view's own frame). */
const drawn = (model: Model, view: string, id: string): string | undefined => placeStep(model, view, { from: id })?.[0]

/**
 * The view that draws a mode's part: a shape's parent; for a line, the lowest view up from its start in which both ends are drawn (one may
 * stand beside the view as an outsider). The overview when nothing resolves.
 */
export function homeView(model: Model, m: Mode): string {
  if (hasText(m.on)) return getObject(model, m.on) ? parentOf(model, m.on) : ROOT
  if (hasText(m.from) && hasText(m.to) && getObject(model, m.from)) {
    for (const view of chain(model, m.from)) if (placeEnds(model, view, m.from, m.to)) return view
  }
  return ROOT
}

/** Whether a view is where a mode belongs: its shape is the view or inside it at any depth, or for a line one of its ends is. Every mode is in the overview. */
export function inView(model: Model, view: string, m: Mode): boolean {
  if (view === ROOT) return true
  const inside = (id: unknown) => typeof id === 'string' && getObject(model, id) !== undefined && chain(model, id).includes(view)
  return hasText(m.on) ? inside(m.on) : inside(m.from) || inside(m.to)
}

/** What carries a mode in a view: a box, or a drawn line (by its key). A line whose two ends sit in one drawn box is carried by that box. */
type Carrier = { box: string } | { line: string }
function carrierOf(model: Model, view: string, m: Mode): Carrier | undefined {
  if (hasText(m.on)) {
    const box = drawn(model, view, m.on)
    return box === undefined ? undefined : { box }
  }
  if (hasText(m.from) && hasText(m.to)) {
    const ends = placeEnds(model, view, m.from, m.to)
    if (ends) return { line: lineKey(...ends) }
    const a = drawn(model, view, m.from)
    if (a !== undefined && a === drawn(model, view, m.to)) return { box: a }
  }
  return undefined
}
const carrierKey = (c: Carrier): string => ('box' in c ? `box ${c.box}` : `line ${c.line}`)

/** The marks for one view, so the overview shows the red system and the reader zooms in to find it. A mode the view cannot draw marks nothing. */
export function rollUp(model: Model, a: Analysis, view: string): Marks {
  const marks: Marks = { boxes: {}, lines: {} }
  for (const m of Object.values(a.modes)) {
    const carrier = carrierOf(model, view, m)
    if (carrier === undefined) continue
    const table = 'box' in carrier ? marks.boxes : marks.lines
    const key = 'box' in carrier ? carrier.box : carrier.line
    const band = bandOf(m)
    const old = Object.hasOwn(table, key) ? table[key] : undefined
    own(table, key, { band: old !== undefined && BANDS.indexOf(old.band) <= BANDS.indexOf(band) ? old.band : band, count: (old?.count ?? 0) + 1 })
  }
  return marks
}

/** Whether a view draws a mode anywhere: as a box, as a line, or as the box that holds both ends of its line. Not the frame the reader is inside, nor a line that touches it. */
export const drawnIn = (model: Model, view: string, m: Mode): boolean => carrierOf(model, view, m) !== undefined

/** The ids of the modes a drawn shape or line carries in a view, worst first. */
export function carried(model: Model, a: Analysis, view: string, part: Part): string[] {
  const wanted = carrierKey('box' in part ? { box: part.box } : { line: lineKey(...part.line) })
  return rank(a).filter(r => {
    const carrier = carrierOf(model, view, r.mode)
    return carrier !== undefined && carrierKey(carrier) === wanted
  }).map(r => r.id)
}

/** What to light for a selected mode in a view: the drawn boxes (and line) of its part, and the drawn boxes of the shapes it hurts that are not already failing. */
export function reach(model: Model, view: string, m: Mode): Reach {
  const fails: string[] = []
  let failsLine: string | undefined
  if (hasText(m.on)) {
    const box = drawn(model, view, m.on)
    if (box !== undefined) fails.push(box)
  } else if (hasText(m.from) && hasText(m.to)) {
    const ends = placeEnds(model, view, m.from, m.to)
    if (ends) {
      fails.push(...new Set(ends))
      failsLine = lineKey(...ends)
    } else {
      const a = drawn(model, view, m.from)
      if (a !== undefined && a === drawn(model, view, m.to)) fails.push(a)
    }
  }
  const affects = [...new Set((m.affects ?? []).flatMap(id => drawn(model, view, id) ?? []))].filter(box => !fails.includes(box))
  return { fails, ...(failsLine === undefined ? {} : { failsLine }), affects }
}

/** What to light for a picked mode: `reach`, but only when the view draws a part of it that fails. Otherwise lighting would fade everything and outline nothing. */
export function lightFor(model: Model, view: string, m: Mode): Reach | undefined {
  const r = reach(model, view, m)
  return r.fails.length > 0 || r.failsLine !== undefined ? r : undefined
}

/**
 * What is wrong with one analysis, given the model it points into: a part that isn't there, a rating that isn't one, a flow or step that
 * doesn't exist. `check` adds these to the model's problems, so an edit that makes one is refused. A mode's problems carry its id and
 * start with it, so a list of problems says which mode. Whether a run exists needs the runs, which are not in the model: see runLinkProblems.
 */
export function analysisProblems(model: Model, aid: string, a: Analysis): Problem[] {
  const file = pathOf(FILE_KINDS.failure, aid)
  const problems: Problem[] = []
  if (!isValidId(aid)) problems.push({ file, message: `"${aid}" is not a valid analysis id: the file name must ${ID_RULE}` })
  if (!hasText(a.name)) problems.push({ file, message: 'name is missing' })
  if (hasText(a.scope) && !isView(model, a.scope)) problems.push({ file, message: `scope "${a.scope}" must be "root" or an object with children` })
  for (const [mid, m] of Object.entries(a.modes)) {
    // No `id`: on a problem that means "this object" to the problem list and the canvas, and a mode id is not an object id.
    const p = (message: string) => problems.push({ file, message: `${mid}: ${message}` })
    if (!isValidId(mid)) p(`the id must ${ID_RULE}`)
    if (!hasText(m.mode)) p('"mode" is missing')

    const line = hasText(m.from) || hasText(m.to)
    if (hasText(m.on) && line) p('has "on" and also "from" or "to"; use one or the other')
    else if (hasText(m.on)) {
      if (!getObject(model, m.on)) p(`unknown object "${m.on}"`)
    } else if (line) {
      if (!hasText(m.from) || !hasText(m.to)) p('"from" and "to" go together')
      else {
        const unknown = [...new Set([m.from, m.to])].filter(end => !getObject(model, end))
        for (const end of unknown) p(`unknown object "${end}"`)
        if (unknown.length === 0 && !model.connections.some(c => c.from === m.from && c.to === m.to)) p(`${m.from} → ${m.to} is not a connection in the model`)
      }
    } else p('needs "on" (a shape) or "from" and "to" (a line)')

    for (const id of m.affects ?? []) if (!getObject(model, id)) p(`affects: unknown object "${id}"`)

    for (const key of RATING_KEYS) if (hasText(m[key]) && ratingOf(m[key]) === undefined) p(`${key} must be a whole number from 1 to 10`)
    for (const key of RATING_KEYS) if (hasText(m.after?.[key]) && ratingOf(m.after?.[key]) === undefined) p(`after ${key} must be a whole number from 1 to 10`)

    if (hasText(m.status) && !(STATUSES as readonly string[]).includes(m.status)) p(`status "${m.status}" must be open, planned, done or accepted`)

    const flow = hasText(m.flow) ? m.flow : undefined
    const known = flow !== undefined && Object.hasOwn(model.flows, flow)
    if (flow !== undefined && !known) p(`flow "${flow}" doesn't exist`)
    if (hasText(m.step)) {
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

/** The analyses that name a shape: as a mode's part or the end of its line, in its `affects`, or as the scope. */
export function usersOfObject(model: Model, id: string): string[] {
  return Object.entries(model.failures)
    .filter(([, a]) => a.scope === id || Object.values(a.modes).some(m => m.on === id || m.from === id || m.to === id || (m.affects ?? []).includes(id)))
    .map(([aid]) => aid)
}

/** The analyses with a line mode on from → to. */
export function usersOfConnection(model: Model, from: string, to: string): string[] {
  return Object.entries(model.failures).filter(([, a]) => Object.values(a.modes).some(m => m.from === from && m.to === to)).map(([aid]) => aid)
}

/** How a refusal names the analyses in the way: "failure analysis ordering", "failure analyses a, b". */
export const analysesText = (ids: string[]): string => `${ids.length === 1 ? 'failure analysis' : 'failure analyses'} ${ids.join(', ')}`

/** The modes of an analysis whose `run` names a run that isn't in perf/. Kept apart because the model doesn't hold runs: loadState calls this. */
export function runLinkProblems(aid: string, a: Analysis, runs: Record<string, unknown>): Problem[] {
  return Object.entries(a.modes)
    .filter(([, m]) => hasText(m.run) && !Object.hasOwn(runs, m.run))
    .map(([mid, m]) => ({ file: pathOf(FILE_KINDS.failure, aid), message: `${mid}: run "${m.run}" doesn't exist` }))
}
