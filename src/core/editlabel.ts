import { customIcons } from './look.ts'
import { isMap } from './text.ts'
import type { Analysis, Connection, Flow, Model } from './model.ts'
import { isStateName, STATE_LABELS } from './states.ts'
import type { StateName } from './states.ts'

const MAX_NAME = 40

/** The same text whatever order an object's keys are in, so a reordered file is not a change. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isMap(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v)
}

const has = (o: object, key: string) => Object.hasOwn(o, key)
const cut = (name: string) => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME)}…` : name)

/** What a changed key of an object is called in a label: the name its panel gives it ("source" for the files in `code`, "code" for the `snippets`). */
function fieldWord(key: string): string {
  if (key === 'code') return 'source'
  if (key === 'snippets') return 'code'
  if (key === 'type' || key === 'tech' || key === 'description' || key === 'links' || key === 'data' || key === 'external') return key
  return key === 'shape' || key === 'color' || key === 'opacity' || key === 'icon' ? 'look' : 'details'
}

/**
 * When the only difference between two versions of a flow is one shape's state in the flow's `states` or in one step's, that change: the shape
 * and its new state, or undefined for a state taken out. Nothing when anything else differs, or when more than one state does.
 */
function stateEdit(before: Flow, after: Flow): { id: string; state: StateName | undefined } | undefined {
  if (before.steps.length !== after.steps.length) return undefined
  const bare = (f: Flow) => canon({ ...f, states: undefined, steps: f.steps.map(step => ({ ...step, states: undefined })) })
  if (bare(before) !== bare(after)) return undefined
  const changes: { id: string; state: StateName | undefined }[] = []
  let odd = false // a word that is not a state is not an edit worth a sentence
  const compare = (b: unknown, a: unknown) => {
    const [was, now] = [isMap(b) ? b : {}, isMap(a) ? a : {}]
    for (const id of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (canon(was[id]) === canon(now[id])) continue
      const state = has(now, id) ? now[id] : undefined
      if (state !== undefined && !isStateName(state)) odd = true
      changes.push({ id, state: isStateName(state) ? state : undefined })
    }
  }
  compare(before.states, after.states)
  before.steps.forEach((step, i) => compare(step.states, after.steps[i].states))
  return changes.length === 1 && !odd ? changes[0] : undefined
}

/** Connections as a multiset, so two identical lines are two. */
function tally(list: Connection[]): Map<string, { connection: Connection; count: number }> {
  const counts = new Map<string, { connection: Connection; count: number }>()
  for (const connection of list) {
    const key = canon(connection)
    const seen = counts.get(key)
    if (seen) seen.count++
    else counts.set(key, { connection, count: 1 })
  }
  return counts
}

/** The connections `from` has more of than `than`. */
function surplus(from: Map<string, { connection: Connection; count: number }>, than: Map<string, { connection: Connection; count: number }>): Connection[] {
  return [...from].flatMap(([key, { connection, count }]) => Array.from({ length: count - (than.get(key)?.count ?? 0) }, () => connection))
}

/** One kind of change between two models, as a sentence, or undefined when that kind did not happen. */
type Detector = (before: Model, after: Model) => string | undefined

const nameIn = (m: Model, id: string) => cut(m.objects[id]?.name || id)
/** A shape's name after the edit, else the name it had (a deleted shape). */
const nameOf = (before: Model, after: Model, id: string) => (has(after.objects, id) ? nameIn(after, id) : nameIn(before, id))

/** The shapes the edit added, deleted and kept. `touched` is the first two: what they carry with them (their lines, their place on a view) is part of that change. */
function shapesOf(before: Model, after: Model) {
  const added = Object.keys(after.objects).filter(id => !has(before.objects, id))
  const removed = Object.keys(before.objects).filter(id => !has(after.objects, id))
  const kept = Object.keys(after.objects).filter(id => has(before.objects, id))
  return { added, removed, kept, touched: new Set([...added, ...removed]) }
}

const shapesAdded: Detector = (before, after) => {
  const { added } = shapesOf(before, after)
  if (added.length === 0) return undefined
  return added.length === 1 ? `Added the ${nameIn(after, added[0])} ${after.objects[added[0]].type}` : `Added ${added.length} shapes`
}

const shapesDeleted: Detector = (before, after) => {
  const { removed } = shapesOf(before, after)
  if (removed.length === 0) return undefined
  return removed.length === 1 ? `Deleted ${nameIn(before, removed[0])}` : `Deleted ${removed.length} shapes`
}

const shapesRenamed: Detector = (before, after) => {
  const renamed = shapesOf(before, after).kept.filter(id => before.objects[id].name !== after.objects[id].name)
  if (renamed.length === 0) return undefined
  return renamed.length === 1 ? `Renamed ${nameIn(before, renamed[0])} to ${nameIn(after, renamed[0])}` : `Renamed ${renamed.length} shapes`
}

const shapesReparented: Detector = (before, after) => {
  const reparented = shapesOf(before, after).kept.filter(id => (before.objects[id].in ?? '') !== (after.objects[id].in ?? ''))
  if (reparented.length === 0) return undefined
  if (reparented.length > 1) return `Moved ${reparented.length} shapes`
  const [id] = reparented
  const parent = after.objects[id].in
  return parent ? `Moved ${nameIn(after, id)} into ${nameOf(before, after, parent)}` : `Moved ${nameIn(after, id)} to the top level`
}

const shapesChanged: Detector = (before, after) => {
  const changed = shapesOf(before, after).kept.map(id => {
    const [b, a] = [before.objects[id], after.objects[id]]
    const keys = new Set([...Object.keys(b), ...Object.keys(a)])
    keys.delete('name')
    keys.delete('in')
    return { id, words: new Set([...keys].filter(key => canon(b[key]) !== canon(a[key])).map(fieldWord)) }
  }).filter(c => c.words.size > 0)
  if (changed.length === 0) return undefined
  if (changed.length > 1) return `Changed ${changed.length} shapes`
  const [{ id, words }] = changed
  return words.size === 1 ? `Changed ${nameIn(after, id)}'s ${[...words][0]}` : `Changed ${nameIn(after, id)}`
}

const linesChanged: Detector = (before, after) => {
  const { touched } = shapesOf(before, after)
  const own = (c: Connection) => !touched.has(c.from) && !touched.has(c.to)
  const [gone, came] = [surplus(tally(before.connections), tally(after.connections)).filter(own), surplus(tally(after.connections), tally(before.connections)).filter(own)]
  if (gone.length === 0 && came.length === 0) return undefined
  if (gone.length === 1 && came.length === 1 && gone[0].from === came[0].from && gone[0].to === came[0].to)
    return `Relabelled ${nameOf(before, after, came[0].from)} to ${nameOf(before, after, came[0].to)}`
  if (gone.length > 0 && came.length > 0) return `Changed ${gone.length + came.length} lines`
  if (came.length === 1) return `Connected ${nameOf(before, after, came[0].from)} to ${nameOf(before, after, came[0].to)}`
  if (came.length > 1) return `Added ${came.length} lines`
  if (gone.length === 1) return `Disconnected ${nameOf(before, after, gone[0].from)} from ${nameOf(before, after, gone[0].to)}`
  return `Removed ${gone.length} lines`
}

const flowsChanged: Detector = (before, after) => {
  const flowName = (m: Model, id: string) => cut(m.flows[id]?.name || id)
  const changes: string[] = []
  for (const id of new Set([...Object.keys(after.flows), ...Object.keys(before.flows)])) {
    if (!has(before.flows, id)) changes.push(`Added the ${flowName(after, id)} flow`)
    else if (!has(after.flows, id)) changes.push(`Deleted the ${flowName(before, id)} flow`)
    else if (canon(before.flows[id]) !== canon(after.flows[id])) {
      const onlyTheName = canon({ ...before.flows[id], name: '' }) === canon({ ...after.flows[id], name: '' })
      const state = stateEdit(before.flows[id], after.flows[id])
      changes.push(onlyTheName
        ? `Renamed the flow ${flowName(before, id)} to ${flowName(after, id)}`
        : state === undefined ? `Changed the ${flowName(after, id)} flow` : state.state === undefined ? `Cleared ${nameOf(before, after, state.id)}'s state` : `Set ${nameOf(before, after, state.id)} to ${STATE_LABELS[state.state]}`)
    }
  }
  return changes.length === 0 ? undefined : changes.length === 1 ? changes[0] : `Changed ${changes.length} flows`
}

const analysisName = (m: Model, id: string) => cut(m.failures[id]?.name || id)
const modeName = (a: Analysis, id: string) => cut(a.modes[id]?.mode || id)

/** What changed in each analysis that is in both models: renamed, its modes added, deleted and changed (by id), and anything else it holds. */
function analysisChanges(before: Model, after: Model) {
  return Object.keys(after.failures).filter(id => has(before.failures, id)).map(id => {
    const [b, a] = [before.failures[id], after.failures[id]]
    const modesIn = (from: Analysis, other: Analysis, kept: boolean) => Object.keys(from.modes).filter(m => has(other.modes, m) === kept)
    return {
      id,
      renamed: b.name !== a.name,
      added: modesIn(a, b, false),
      deleted: modesIn(b, a, false),
      changed: modesIn(a, b, true).filter(m => canon(b.modes[m]) !== canon(a.modes[m])),
      // What the analysis is about, its scope, its scale and any other key.
      other: canon({ ...b, name: '', modes: undefined }) !== canon({ ...a, name: '', modes: undefined }),
    }
  })
}

const analysesAdded: Detector = (before, after) => {
  const added = Object.keys(after.failures).filter(id => !has(before.failures, id))
  if (added.length === 0) return undefined
  return added.length === 1 ? `Added the ${analysisName(after, added[0])} failure analysis` : `Added ${added.length} failure analyses`
}

const analysesDeleted: Detector = (before, after) => {
  const deleted = Object.keys(before.failures).filter(id => !has(after.failures, id))
  if (deleted.length === 0) return undefined
  return deleted.length === 1 ? `Deleted the ${analysisName(before, deleted[0])} failure analysis` : `Deleted ${deleted.length} failure analyses`
}

const analysesRenamed: Detector = (before, after) => {
  const renamed = analysisChanges(before, after).filter(c => c.renamed)
  if (renamed.length === 0) return undefined
  return renamed.length === 1
    ? `Renamed the failure analysis ${analysisName(before, renamed[0].id)} to ${analysisName(after, renamed[0].id)}`
    : `Renamed ${renamed.length} failure analyses`
}

/** A detector for the modes of the analyses that stayed: `pick` says which of a change's modes count, and the one mode is named from the model it is in. */
const modeDetector = (verb: string, pick: (c: ReturnType<typeof analysisChanges>[number]) => string[], named: 'before' | 'after'): Detector => (before, after) => {
  const modes = analysisChanges(before, after).flatMap(c => pick(c).map(mode => ({ analysis: c.id, mode })))
  if (modes.length === 0) return undefined
  if (modes.length > 1) return `${verb} ${modes.length} failure modes`
  const [{ analysis, mode }] = modes
  return `${verb} the ${modeName((named === 'before' ? before : after).failures[analysis], mode)} failure mode`
}
const modesAdded = modeDetector('Added', c => c.added, 'after')
const modesDeleted = modeDetector('Deleted', c => c.deleted, 'before')
const modesChanged = modeDetector('Changed', c => c.changed, 'after')

const analysesChanged: Detector = (before, after) => {
  const changed = analysisChanges(before, after).filter(c => c.other)
  if (changed.length === 0) return undefined
  return changed.length === 1 ? `Changed the ${analysisName(after, changed[0].id)} failure analysis` : `Changed ${changed.length} failure analyses`
}

const positionsChanged: Detector = (before, after) => {
  const { touched } = shapesOf(before, after)
  // The page saves every box of a view the first time one is dragged in it, so a view with its first positions was arranged, not moved shape by shape.
  const [tidied, arranged, moved]: [string[], string[], string[]] = [[], [], []]
  for (const view of new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])) {
    if (touched.has(view)) continue
    const [b, a] = [before.layout[view] ?? {}, after.layout[view] ?? {}]
    const placed = Object.keys(a).filter(id => !touched.has(id))
    if (Object.keys(b).some(id => !has(a, id) && has(after.objects, id) && !touched.has(id))) tidied.push(view)
    else if (Object.keys(b).length === 0 && placed.length > 0) arranged.push(view)
    else moved.push(...placed.filter(id => !(has(b, id) && canon(a[id]) === canon(b[id]))))
  }
  const viewName = (view: string) => (view === 'root' ? 'the top level' : nameIn(after, view))
  if (tidied.length > 0) return tidied.length === 1 ? `Tidied ${viewName(tidied[0])}` : `Tidied ${tidied.length} views`
  if (arranged.length > 0) return arranged.length === 1 ? `Arranged ${viewName(arranged[0])}` : `Arranged ${arranged.length} views`
  return moved.length === 0 ? undefined : moved.length === 1 ? `Moved ${nameIn(after, moved[0])}` : `Moved ${moved.length} shapes`
}

const settingsChanged: Detector = (before, after) => {
  const [iconsBefore, iconsAfter] = [customIcons(before.meta), customIcons(after.meta)]
  const iconsAdded = Object.keys(iconsAfter).filter(name => !has(iconsBefore, name))
  const iconsDeleted = Object.keys(iconsBefore).filter(name => !has(iconsAfter, name))
  if (iconsAdded.length + iconsDeleted.length === 1) return iconsAdded.length === 1 ? `Added the ${cut(iconsAdded[0])} icon` : `Deleted the ${cut(iconsDeleted[0])} icon`
  if (iconsAdded.length + iconsDeleted.length > 1) return 'Changed the icons'
  const differs = (key: string) => canon(before.meta[key]) !== canon(after.meta[key])
  if (differs('name') && differs('about')) return 'Changed the project name and description'
  if (differs('name')) return 'Renamed the project'
  if (differs('about')) return 'Changed the project description'
  if (differs('lines')) return 'Changed the line style'
  const otherSettings = [...new Set([...Object.keys(before.meta), ...Object.keys(after.meta)])].some(differs)
  return otherSettings ? 'Changed the settings' : undefined
}

/** In the order the first sentence is picked. */
const DETECTORS: readonly Detector[] = [
  shapesAdded, shapesDeleted, shapesRenamed, shapesReparented, shapesChanged,
  linesChanged, flowsChanged,
  analysesAdded, analysesDeleted, analysesRenamed, modesAdded, modesDeleted, modesChanged, analysesChanged,
  positionsChanged, settingsChanged,
]

/**
 * What an edit did, in a few words, from the model before it and the model after: "Renamed Web app to Storefront". The first kind of change
 * that happened gives the sentence (shapes added, deleted, renamed, moved into another, other fields, then lines, flows, failure analyses
 * and their modes, positions on a view, and the project's settings); each further kind adds " and N other change(s)". What an added or
 * deleted shape carries with it (its lines, its place on a view) is part of that change. Undefined when nothing worth naming differs.
 * The C# twin (Flowy.Core) says the same words, except for failure analyses, which the desktop app does not edit yet.
 */
export function describeEdit(before: Model, after: Model): string | undefined {
  const sentences = DETECTORS.map(detect => detect(before, after)).filter((s): s is string => s !== undefined)
  if (sentences.length === 0) return undefined
  const others = sentences.length - 1
  return others === 0 ? sentences[0] : `${sentences[0]} and ${others} other change${others === 1 ? '' : 's'}`
}
