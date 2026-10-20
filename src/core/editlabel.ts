import { customIcons } from './look.ts'
import type { Connection, Model } from './model.ts'

const MAX_NAME = 40

/** The same text whatever order an object's keys are in, so a reordered file is not a change. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v)
}

const has = (o: object, key: string) => Object.hasOwn(o, key)
const cut = (name: string) => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME)}…` : name)

/** What a changed key of an object is called in a label. */
function fieldWord(key: string): string {
  if (key === 'type' || key === 'tech' || key === 'description' || key === 'code' || key === 'links' || key === 'external') return key
  return key === 'shape' || key === 'color' || key === 'opacity' || key === 'icon' ? 'look' : 'details'
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

/**
 * What an edit did, in a few words, from the model before it and the model after: "Renamed Web app to Storefront". The first kind of change
 * that happened gives the sentence (shapes added, deleted, renamed, moved into another, other fields, then lines, flows, positions on a view,
 * and the project's settings); each further kind adds " and N other change(s)". What an added or deleted shape carries with it (its lines, its
 * place on a view) is part of that change. Undefined when nothing worth naming differs. The C# twin (Flowy.Core) says the same words.
 */
export function describeEdit(before: Model, after: Model): string | undefined {
  const nameIn = (m: Model, id: string) => cut(m.objects[id]?.name || id)
  const nameOf = (id: string) => (has(after.objects, id) ? nameIn(after, id) : nameIn(before, id))

  const added = Object.keys(after.objects).filter(id => !has(before.objects, id))
  const removed = Object.keys(before.objects).filter(id => !has(after.objects, id))
  const kept = Object.keys(after.objects).filter(id => has(before.objects, id))
  const touched = new Set([...added, ...removed])
  const found: (string | undefined)[] = []

  found.push(added.length === 0 ? undefined : added.length === 1 ? `Added the ${nameIn(after, added[0])} ${after.objects[added[0]].type}` : `Added ${added.length} shapes`)
  found.push(removed.length === 0 ? undefined : removed.length === 1 ? `Deleted ${nameIn(before, removed[0])}` : `Deleted ${removed.length} shapes`)

  const renamed = kept.filter(id => before.objects[id].name !== after.objects[id].name)
  found.push(renamed.length === 0 ? undefined : renamed.length === 1 ? `Renamed ${nameIn(before, renamed[0])} to ${nameIn(after, renamed[0])}` : `Renamed ${renamed.length} shapes`)

  const reparented = kept.filter(id => (before.objects[id].in ?? '') !== (after.objects[id].in ?? ''))
  found.push(reparented.length === 0
    ? undefined
    : reparented.length > 1
      ? `Moved ${reparented.length} shapes`
      : after.objects[reparented[0]].in
        ? `Moved ${nameIn(after, reparented[0])} into ${nameOf(after.objects[reparented[0]].in!)}`
        : `Moved ${nameIn(after, reparented[0])} to the top level`)

  const changedFields = kept.map(id => {
    const [b, a] = [before.objects[id], after.objects[id]]
    const keys = new Set([...Object.keys(b), ...Object.keys(a)])
    keys.delete('name')
    keys.delete('in')
    return { id, words: new Set([...keys].filter(key => canon(b[key]) !== canon(a[key])).map(fieldWord)) }
  }).filter(c => c.words.size > 0)
  found.push(changedFields.length === 0
    ? undefined
    : changedFields.length > 1
      ? `Changed ${changedFields.length} shapes`
      : changedFields[0].words.size === 1
        ? `Changed ${nameIn(after, changedFields[0].id)}'s ${[...changedFields[0].words][0]}`
        : `Changed ${nameIn(after, changedFields[0].id)}`)

  const own = (c: Connection) => !touched.has(c.from) && !touched.has(c.to)
  const [gone, came] = [surplus(tally(before.connections), tally(after.connections)).filter(own), surplus(tally(after.connections), tally(before.connections)).filter(own)]
  found.push(gone.length === 0 && came.length === 0
    ? undefined
    : gone.length === 1 && came.length === 1 && gone[0].from === came[0].from && gone[0].to === came[0].to
      ? `Relabelled ${nameOf(came[0].from)} to ${nameOf(came[0].to)}`
      : gone.length > 0 && came.length > 0
        ? `Changed ${gone.length + came.length} lines`
        : came.length === 1
          ? `Connected ${nameOf(came[0].from)} to ${nameOf(came[0].to)}`
          : came.length > 1
            ? `Added ${came.length} lines`
            : gone.length === 1
              ? `Disconnected ${nameOf(gone[0].from)} from ${nameOf(gone[0].to)}`
              : `Removed ${gone.length} lines`)

  const flowName = (m: Model, id: string) => cut(m.flows[id]?.name || id)
  const flowChanges: string[] = []
  for (const id of new Set([...Object.keys(after.flows), ...Object.keys(before.flows)])) {
    if (!has(before.flows, id)) flowChanges.push(`Added the ${flowName(after, id)} flow`)
    else if (!has(after.flows, id)) flowChanges.push(`Deleted the ${flowName(before, id)} flow`)
    else if (canon(before.flows[id]) !== canon(after.flows[id])) {
      const onlyTheName = canon({ ...before.flows[id], name: '' }) === canon({ ...after.flows[id], name: '' })
      flowChanges.push(onlyTheName ? `Renamed the flow ${flowName(before, id)} to ${flowName(after, id)}` : `Changed the ${flowName(after, id)} flow`)
    }
  }
  found.push(flowChanges.length === 0 ? undefined : flowChanges.length === 1 ? flowChanges[0] : `Changed ${flowChanges.length} flows`)

  const tidied: string[] = []
  const moved: string[] = []
  for (const view of new Set([...Object.keys(before.layout), ...Object.keys(after.layout)])) {
    if (touched.has(view)) continue
    const [b, a] = [before.layout[view] ?? {}, after.layout[view] ?? {}]
    if (Object.keys(b).some(id => !has(a, id) && has(after.objects, id) && !touched.has(id))) tidied.push(view)
    else moved.push(...Object.keys(a).filter(id => !touched.has(id) && !(has(b, id) && canon(a[id]) === canon(b[id]))))
  }
  found.push(tidied.length > 0
    ? tidied.length === 1 ? `Tidied ${tidied[0] === 'root' ? 'the top level' : nameIn(after, tidied[0])}` : `Tidied ${tidied.length} views`
    : moved.length === 0 ? undefined : moved.length === 1 ? `Moved ${nameIn(after, moved[0])}` : `Moved ${moved.length} shapes`)

  const [iconsBefore, iconsAfter] = [customIcons(before.meta), customIcons(after.meta)]
  const iconsAdded = Object.keys(iconsAfter).filter(name => !has(iconsBefore, name))
  const iconsDeleted = Object.keys(iconsBefore).filter(name => !has(iconsAfter, name))
  const otherSettings = [...new Set([...Object.keys(before.meta), ...Object.keys(after.meta)])].some(key => key !== 'lines' && canon(before.meta[key]) !== canon(after.meta[key]))
  found.push(iconsAdded.length + iconsDeleted.length === 1
    ? iconsAdded.length === 1 ? `Added the ${cut(iconsAdded[0])} icon` : `Deleted the ${cut(iconsDeleted[0])} icon`
    : iconsAdded.length + iconsDeleted.length > 1
      ? 'Changed the icons'
      : canon(before.meta.lines) !== canon(after.meta.lines)
        ? 'Changed the line style'
        : otherSettings ? 'Changed the settings' : undefined)

  const sentences = found.filter((s): s is string => s !== undefined)
  if (sentences.length === 0) return undefined
  const others = sentences.length - 1
  return others === 0 ? sentences[0] : `${sentences[0]} and ${others} other change${others === 1 ? '' : 's'}`
}
