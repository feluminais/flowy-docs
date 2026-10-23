import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ANIMATION_KINDS, EFFECTS } from '../core/animation.ts'
import { check, newProblems } from '../core/check.ts'
import { compareOf } from '../core/compare.ts'
import type { CompareTag } from '../core/compare.ts'
import { analysisText, BAND_NAMES, bandOf, riskOf, runLinkProblems, STATUSES } from '../core/failures.ts'
import { FILE_KINDS, kindOfPath, pathOf } from '../core/filekinds.ts'
import { mcpLabel } from '../core/history.ts'
import { ICON_GROUPS } from '../core/icons.ts'
import { sideReport } from '../core/layout.ts'
import type { SideProblem } from '../core/layout.ts'
import { COLOR_NAMES, customIcons, SHAPES } from '../core/look.ts'
import { getObject, OBJECT_TYPES, projectAbout, projectName, ROOT } from '../core/model.ts'
import { changedFiles, changedLayout } from '../core/modelfiles.ts'
import type { Model } from '../core/model.ts'
import { describeDependent } from '../core/dependents.ts'
import type { Dependent } from '../core/dependents.ts'
import { connect, deleteAnalysis, deleteFlow, deleteIcon, deleteMode, deleteObject, deleteWith, disconnect, OpError, putAnalysis, putFlow, putIcon, putMode, putObject, refuseNewProblems, setCompare, setProject, tidyViews } from '../core/ops.ts'
import type { FlowInput } from '../core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../core/mermaid.ts'
import { LANGUAGES, SNIPPET_MAX } from '../core/snippets.ts'
import { STATE_NAMES } from '../core/states.ts'
import { GROUP_KINDS } from '../core/structure.ts'
import { computeView, nameOf, placeStep, stepEnds } from '../core/views.ts'
import { blockedMessage, firstBlocked, firstUnreadable } from './commit.ts'
import { hashBytes, loadDir, loadReport, loadRuns, missingPaths, saveFiles, saveRunCompare, VersionConflict } from './files.ts'
import type { Report } from './files.ts'
import { registerGuidance } from './guidance.ts'
import type { History } from './history.ts'

const INSTRUCTIONS = `Flowy Docs keeps a C4-style architecture model as YAML files in the repo.
Objects nest: actor and system at the top level, app and store inside a system, component inside an app or store.
Connect the most specific objects you know (e.g. component → store); zoomed-out views merge lines automatically.
A flow is a step-by-step walkthrough played on one view: "root" (the top level) or an object with children.
Tools: read with get_model (give summary: true first, then object, flow or analysis for what you need: the whole model is large), get_problems (everything wrong right now, cheap), get_view, get_mermaid and get_failures. Write with put_object, connect and disconnect, put_flow, put_failures and put_failure, put_project (the system's name and what it is), put_icon, tidy_layout (where shapes sit on the canvas), set_compare (the flow or run an older one is compared with) and the delete_ tools. Everything get_model shows can be sent back to a put_ tool as it is. The prompts map-repo, update-after-change, write-flow, failure-analysis and review-model hold the usual jobs. The guides are resources: flowy://docs/guide.md says which page holds what, flowy://docs/format.md lists every key and flowy://docs/writing.md says how to word things.
What to document, and what to read for it:
- A request that only says to document, map or describe the repo ("make Flowy docs") gets the default and nothing else: the system's name and a short about (put_project), the people, apps, stores, components and outside services you can point to, how they connect, and three to five plain flows (no animation, no looks). Don't read the topic rules below, and don't write failure modes, data, snippets, animation or performance.
- Everything beyond that is the user's to ask for by name. If they ask for more without saying what ("everything", "in detail", "make it complete"), ask which parts, listing these: flows with motion, repeats, branches or failed requests; what the stores hold; code on shapes; a failure analysis; looks. Performance runs are files a load test makes, which you can't write.
- When they name a part, read its rules first and only those. They are resources: flowy://rules/flows (animation, outcomes, groups, states), flowy://rules/data, flowy://rules/code and flowy://rules/failures.
- The last thing you say is the account in "After writing" and then what Flowy could add, from what you saw while reading and never as a general list: one line for each of data (a store with a schema or migration), code (a formula, a query or a payload that explains a shape), failures (outside services, retries, timeouts), motion in flows (call, send and event steps), performance (load-test results or a load-test tool in the repo) and more flows (name the ones you left out). Leave a part out when you saw nothing for it, and say that you did not write any of them.
Before you write:
- Read the existing model first. Reuse exact names and never add a second object for something already there. Change only what was asked: fill blanks, don't overwrite or delete.
- Add only what you can point to in the repo, and give it a code path. If you can't, leave it out and say so. Don't add a queue, cache or gateway the code doesn't use. A missing shape is better than an invented one.
- To map a repo, first list the people, apps, stores and outside services you found, each with the file that shows it, and check the list with the user before writing. If you can't tell what something is for, ask; don't guess. Then write in passes, shapes, then connections, then flows, then the text, and say when each is done.
What gets a shape:
- An app runs on its own; a component is a part inside one running program. A folder, package, library, class or file is not a shape. Leave out what no flow touches (logging, config, deploy plumbing). Keep a view to a handful of shapes, a dozen at most.
- Mark services you don't own external: true. A database or bucket the system owns is a store inside it, and so is a named queue or topic.
- Name a shape for what it holds or does ("Orders DB"), never for its type ("Database"), in words a new teammate knows, and use one name for one thing everywhere. Name an outside service for the vendor (Stripe) and say its role in the teaser. Fill tech on every app, store and component with the real stack, short ("Node, Fastify"). Give every app, store and component a code path: two or three, folders before files.
Looks (shape, color, opacity, icon) are optional; the type already picks a good default:
- Leave them out unless they say something the type doesn't. A decision is a diamond, a message queue a queue, a file or report a document, a group of shapes a folder, a remark a note. A colour means something only if it means the same everywhere in the model: say what it means in the descriptions that use it, and don't colour for decoration.
- Leave opacity alone unless you set a colour: it defaults to a light tint. Pick an icon from the built-in list only when it names the thing better than its type's icon does; put_icon adds one of your own.
Writing text:
- A description's first paragraph is the hover teaser: a sentence on what the object does for others, in words its name doesn't hold. Start apps and components with a verb. No "responsible for", no praise. Later paragraphs: why, limits, risks. No versions, counts or endpoint lists.
- A connection label is a few words, a verb and what moves, said from the side that starts it ("publishes order events", "reads menus"). The arrow already shows which way it goes, so never end a label on "to", "from", "with" or another preposition. Never "uses". A reply is not a connection.
- Put warnings first in the teaser ("Deprecated: ...", "(planned)"), since a reader may stop there. Write for any day: no "currently" or "soon". Behaviour, not implementation: leave out versions, counts and file lists that go stale. Where something is a guess, end its description with "Open question: ..." and never a plausible sentence.
- Put long documents (runbooks, decision records, specs, wiki pages) in links, not in a description. code: is the files and folders an object lives in.
Writing a flow, so it reads the way the code works:
- One trigger, one story, usually 3-9 steps, named for the goal. A failure gets its own flow.
- A step's text says what passes between "from" and "to", from the side of "from": "Hands over the order", "Asks for the total". The step already shows both ends, so leave the receiver's name out unless the text needs it, and never end a text on "to", "from" or another preposition. When "from" asks and gets its answer in the same step, say so, and don't add a step going back unless something new is sent.
- Say when the sender doesn't wait for the other side (it queues the work, fires and forgets, or runs on a timer).
- Keep to what the flow's trigger causes. Something that happens on its own gets a step that says so, or a flow of its own.
- Play the flow on the view where its ends are separate shapes. put_flow answers with how each step reads there: an end written "X in Y" is drawn as Y.
- A step's More (its description) holds why, timing, failure behaviour or limits, not a repeat of the step.
- Write plain steps. Motion (animation), repeats, branches, parallel lanes and shape states are for a user who asked for them: read flowy://rules/flows first.
After writing: every write is checked, and a write that would add a problem is refused and nothing is saved. Read the answer, fix the cause (find the right path, name or end) and write again. Don't repeat the same call or drop the field to get past it. After a run of writes, or after you change a file by hand, call get_problems: no problems means it is sound. When the shapes and connections are in, call tidy_layout once: it puts each neighbour in a view on the side it has in the view above, so zooming from one box to the next doesn't lead the same way twice. Finish by saying what you read from the code, what you inferred and what you left out.`

/** `{ compare }` when the flow or run has a readable tag, so an entry without one stays as it was. */
const withTag = (value: unknown): { compare?: CompareTag } => {
  const compare = compareOf(value)
  return compare === undefined ? {} : { compare }
}

/**
 * What put_flow answers: each step as a reader will see it on the flow's view. When an end is drawn as
 * the box that holds it, a hint says so, since two steps on two parts of one box can read as a round trip.
 */
function readout(model: Model, flow: FlowInput): string {
  const steps = flow.steps.map((s, i) => {
    const placed = placeStep(model, flow.view, s)
    const inside = placed !== null && (placed[0] !== s.from || placed[1] !== (s.to ?? s.from))
    return { line: `${i + 1}. ${stepEnds(model, s, placed)}: ${s.text}`, inside }
  })
  const hint = 'Ends written "X in Y" are drawn as Y on this view. If two steps then seem to go to Y and back, say in the text which part of Y is meant, or play the flow inside Y.'
  return [`Saved flow ${flow.id}. On ${nameOf(model, flow.view)} it reads:`, ...steps.map(s => s.line), ...(steps.some(s => s.inside) ? [hint] : [])].join('\n')
}

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
const ok = (value: unknown): Result => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/**
 * A refusal because other parts depend on what was to be deleted says so in words, then lists each row that needs a decision with the actions it takes, and
 * how to settle them: the same call again with `resolve`. The rows are also the result's structured content (`dependents`, as dependents() returns them).
 */
function refusedForDependents(message: string, rows: Dependent[]): Result {
  const list = rows.map(r => `- ${r.key} (${describeDependent(r)}): ${r.actions.join(', ')}`).join('\n')
  const how = 'To delete it anyway, call this tool again with "resolve": one { key, action, to } for each row above, taking one of the actions listed for it, the first being the usual one. "to" is the shape to send the step or mode to (reroute, repoint), a view for changeView, changeScope or moveOut ("root" is the top level), and is left out for the other actions. A row of a flow you delete needs nothing more. Lines, state entries and affects entries that name it go along without a choice. Nothing is saved until every row is settled.'
  return { ...ok(`${message}\n\n${list}\n\n${how}`), structuredContent: { dependents: rows }, isError: true }
}
const fail = (e: unknown): Result =>
  e instanceof OpError && e.dependents !== undefined && e.dependents.length > 0 ? refusedForDependents(e.message, e.dependents) : { ...ok(e instanceof Error ? e.message : String(e)), isError: true }

/** How one row of a refusal is settled when the delete is asked again: the row's key, one of its actions, and where to when the action points somewhere. */
const resolution = z.object({
  key: z.string().max(200).describe('The key of a row of the refusal, e.g. "step:checkout:3"'),
  action: z.enum(['removeStep', 'reroute', 'deleteFlow', 'changeView', 'removeMode', 'repoint', 'changeScope', 'moveOut', 'deleteWith']).describe('One of the actions the row lists'),
  to: z.string().max(64).optional().describe('Where to, for reroute, repoint, changeView, changeScope and moveOut; "root" is the top level'),
})
const resolve = z.array(resolution).max(500).optional().describe('How to settle what depends on it, one entry for each row of an earlier refusal. Left out, the call is refused while anything depends on it.')

/**
 * get_model shows every number and flag as the text the file holds ("7", "true"), so what was read can be sent straight back: digits are taken
 * as the number they say and "true" and "false" as the flag. Anything else is left for the schema to refuse.
 */
const asNumber = (v: unknown) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v)
const asFlag = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v)

/** A state is checked by the checker, not here, so a wrong word is refused in the checker's words. */
const stateMap = z.record(z.string().max(64), z.string())
const dataText = z.union([z.string(), z.number(), z.boolean()])
const sampleValue: z.ZodType<unknown> = z.lazy(() => z.union([dataText, z.array(sampleValue), z.record(z.string(), sampleValue)]))
const dataEntry = z.object({
  name: z.string().describe('The table, key set, topic or collection, as a developer names it, e.g. "orders" or "Keys".'),
  kind: z.string().optional().describe('A word for what it is, shown small beside the name: "table", "collection", "topic".'),
  limits: z.string().optional().describe('One line on how long the data is kept or how much fits, e.g. "Kept 7 years, then archived".'),
  note: z.string().optional().describe('One line on why it is this way. Not what it is.'),
  columns: z.array(z.union([z.string(), z.object({
    name: z.string(),
    type: z.string().optional().describe('The data type as the code names it, e.g. "int", "text", "timestamp". End it with ? when the column can be empty: "int?". At most 40 characters.'),
    key: z.literal('primary').optional().describe('Only "primary", for a primary key.'),
    to: z.string().optional().describe('The table this column points to, which makes it a foreign key.'),
    note: z.string().optional().describe('One line on why, shown under the data.'),
  })])).optional().describe('A grid: the column headings. A bare string is a column with nothing else. At most 12. Give columns or sample, not both.'),
  rows: z.array(z.array(dataText)).optional().describe('Invented sample rows, each as many cells as there are columns. At most 8. Numbers are written as text.'),
  sample: z.record(z.string(), sampleValue).optional().describe('A document: one invented sample, as nested fields (3 levels at most, 20 fields at most). Instead of columns.'),
  notes: z.record(z.string(), z.string()).optional().describe('For a sample: a field (a dotted path like "hours.mon" for a nested one) mapped to a one-line note.'),
})

/** The system's name and what it is, when the file has them, in the shape put_project takes. */
const project = (m: Model) => ({ ...(projectName(m) ? { name: projectName(m) } : {}), ...(projectAbout(m) ? { about: projectAbout(m) } : {}) })

/** `history`: when given, every write is also a step in the folder's history. A history that can't be written never fails a tool call. */
export function createMcpServer(dir: string, history?: History): McpServer {
  const server = new McpServer({ name: 'flowy-docs', version: '0.1.0' }, { instructions: INSTRUCTIONS })

  // AI clients often send several tool calls at once. Run them one at a time, in arrival
  // order, so each call sees what the calls sent before it wrote.
  let queue: Promise<unknown> = Promise.resolve()
  const inOrder = (fn: () => Promise<Result>): Promise<Result> => {
    const run = queue.then(fn)
    queue = run.catch(() => undefined)
    return run
  }

  const read = (fn: (model: Model) => unknown) => inOrder(async () => {
    try {
      return ok(fn((await loadDir(dir)).model))
    } catch (e) {
      return fail(e)
    }
  })

  /** Like read, but with the whole report: the load-test runs and every problem in the folder, not only the model. */
  const reading = (fn: (report: Report) => unknown) => inOrder(async () => {
    try {
      return ok(fn(await loadReport(dir)))
    } catch (e) {
      return fail(e)
    }
  })

  /**
   * Load fresh, apply, refuse new problems, write changed files. Retries once if a file changed underneath. With history on, the files as
   * they were become a step first, and `label` is the step the write makes.
   */
  const write = (op: (model: Model) => Model, done: string | ((before: Model) => string), label: string, withLayout = false) => inOrder(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const loaded = await loadDir(dir)
        const { model, versions } = loaded
        const next = op(model)
        // A run is a file in perf/, which the model doesn't hold: it can name a shape or a line the edit takes away, or be named by a failure mode.
        const { runs } = await loadRuns(dir, model)
        refuseNewProblems(model, next, missingPaths(dir, model, next), runs) // the canvas refuses the same edits, except missing code paths, which only Node can see
        if (next.failures !== model.failures) {
          const links = (m: Model) => Object.entries(m.failures).flatMap(([aid, a]) => runLinkProblems(aid, a, runs))
          const added = newProblems(links(model), links(next))
          if (added.length > 0) {
            const known = Object.keys(runs)
            return fail(`Refused, nothing saved. This would add:\n${added.map(p => `- ${p.file}: ${p.message}`).join('\n')}\n${known.length > 0 ? `The runs in perf/ are: ${known.join(', ')}.` : 'There are no load-test runs in perf/, so leave run out.'}`)
          }
        }
        const changes = [...changedFiles(model, next), ...(withLayout ? changedLayout(model, next) : [])]
        // An analysis file that was skipped because it can't be read holds someone's work: it is never replaced or deleted.
        const blocked = firstBlocked(loaded, changes.map(([rel]) => rel))
        if (blocked) return fail(`Refused, nothing saved. ${blockedMessage(blocked.blocking, blocked.rel)}`)
        // Never write what can't be read back: if saving and loading ever disagree, refuse instead of breaking the folder.
        const unreadable = firstUnreadable(changes)
        if (unreadable) return fail(`Refused, nothing saved. The result couldn't be read back: ${unreadable.error instanceof Error ? unreadable.error.message : String(unreadable.error)}`)
        await history?.ensureCurrent('write')
        await saveFiles(dir, changes.map(([rel, text]) => ({ rel, text, expected: versions[rel] ?? null }))) // all or none
        await history?.record(label, 'ai')
        return ok(typeof done === 'function' ? done(model) : done)
      } catch (e) {
        if (!(e instanceof VersionConflict)) return fail(e)
        if (attempt === 2) return fail(`Nothing saved: ${e.message}, twice in a row. Try again.`)
      }
    }
  })

  const id = (what: string) => z.string().max(64).describe(`${what}: lowercase letters, digits and dashes, not starting with a dash, e.g. "orders-api"`)
  const ends = {
    from: z.string().max(64).describe('Id of the object the connection starts at'),
    to: z.string().max(64).describe('Id of the object it goes to'),
  }
  const readOnly = { readOnlyHint: true }
  const destructive = { destructiveHint: true }

  server.registerTool('get_model', {
    description: 'The model: objects, connections, flows, failure analyses, the custom icons put_icon defined (name → SVG path data), the load-test runs (id and name; a failure mode\'s run is one of these ids) and current problems. Everything it shows can be sent back to put_object, put_flow and the failure tools as it is. A big model is a lot to read, so ask for less: summary gives one short line for each thing, and object, flow or analysis gives that one thing in full (an object with its connections, the flows that use it and the failure modes that name it). Give at most one of the four.',
    inputSchema: {
      summary: z.boolean().optional().describe('true: only ids, names, types, parents and tech of the objects, each connection as one line, and each flow, analysis and run with its name and size. Read this first, then ask for what you need.'),
      object: z.string().max(64).optional().describe('An object id: that object in full, with the connections that touch it, the flows that use it and the failure modes that name it.'),
      flow: z.string().max(64).optional().describe('A flow id: that flow in full.'),
      analysis: z.string().max(64).optional().describe('A failure analysis id: that analysis in full, every field of every mode.'),
    },
    annotations: readOnly,
  }, ({ summary, object, flow, analysis }) => reading(({ model: m, runs, problems }) => {
    if ([summary === true, object !== undefined, flow !== undefined, analysis !== undefined].filter(Boolean).length > 1) throw new Error('Give at most one of summary, object, flow and analysis.')
    const runList = Object.entries(runs).map(([runId, r]) => ({ id: runId, name: r.name, ...withTag(r.compare) }))
    const about = (pick: (p: Report['problems'][number]) => boolean) => problems.filter(pick)
    if (summary === true) {
      const objects = Object.entries(m.objects).map(([oid, o]) => ({ id: oid, type: o.type, name: o.name, ...(o.in ? { in: o.in } : {}), ...(o.tech ? { tech: o.tech } : {}), ...(o.external === 'true' ? { external: true } : {}) }))
      return {
        ...project(m),
        objects,
        connections: m.connections.map(c => `${c.from} → ${c.to}${c.label ? `: ${c.label}` : ''}`),
        flows: Object.entries(m.flows).map(([fid, f]) => ({ id: fid, name: f.name, view: f.view, steps: f.steps.length, ...withTag(f.compare) })),
        failures: Object.entries(m.failures).map(([aid, a]) => ({ id: aid, name: a.name, modes: Object.keys(a.modes).length })),
        icons: Object.keys(customIcons(m.meta)),
        runs: runList,
        problems,
      }
    }
    if (object !== undefined) {
      const o = getObject(m, object)
      if (!o) throw new Error(`unknown object "${object}"`)
      return {
        id: object, object: o,
        connections: m.connections.filter(c => c.from === object || c.to === object),
        flows: Object.entries(m.flows).filter(([, f]) => f.steps.some(s => s.from === object || s.to === object)).map(([fid]) => fid),
        failureModes: Object.entries(m.failures).flatMap(([aid, a]) => Object.entries(a.modes).filter(([, x]) => x.on === object || x.from === object || x.to === object || x.affects?.includes(object)).map(([mid]) => `${aid}/${mid}`)),
        problems: about(p => p.file === 'model.yaml' && (p.id === object || p.message.startsWith(`connection ${object} →`) || p.message.includes(`→ ${object}:`))),
      }
    }
    if (flow !== undefined) {
      if (!Object.hasOwn(m.flows, flow)) throw new Error(`unknown flow "${flow}"`)
      return { id: flow, flow: m.flows[flow], problems: about(p => p.file === `flows/${flow}.yaml`) }
    }
    if (analysis !== undefined) {
      if (!Object.hasOwn(m.failures, analysis)) throw new Error(`unknown analysis "${analysis}"`)
      return { id: analysis, analysis: m.failures[analysis], problems: about(p => p.file === `failures/${analysis}.yaml`) }
    }
    return { ...project(m), objects: m.objects, connections: m.connections, flows: m.flows, failures: m.failures, icons: customIcons(m.meta), runs: runList, problems }
  }))

  server.registerTool('get_problems', {
    description: 'Everything wrong with the folder right now, one line each, the same list `flowy check` prints: model, flows, failure analyses and load-test runs, a failure mode whose run does not exist, a file Flowy skips, and a file that loads but could not be saved again. "No problems." means it is sound. Cheaper than get_model, so use it to check your work after a run of writes, and after changing a file by hand.',
    inputSchema: {},
    annotations: readOnly,
  }, () => reading(({ problems }) => (problems.length === 0 ? 'No problems.' : problems.map(p => `${p.file}: ${p.message}`).join('\n'))))

  server.registerTool('get_view', {
    description: 'What one diagram shows: members (its shapes), outsiders (faded shapes from elsewhere that connect in) and edges (connections merged to that zoom level).',
    inputSchema: { view: z.string().max(64).describe('"root" for the top level, or the id of an object with children') },
    annotations: readOnly,
  }, ({ view }) => read(m => {
    if (view !== ROOT && !getObject(m, view)) throw new Error(`unknown view "${view}"`)
    const v = computeView(m, view)
    const box = (boxId: string) => ({ id: boxId, name: m.objects[boxId].name, type: m.objects[boxId].type })
    return { view, members: v.members.map(box), outsiders: v.outsiders.map(box), edges: v.edges }
  }))

  server.registerTool('get_mermaid', {
    description: 'One view as a Mermaid flowchart, or one flow as a Mermaid sequence diagram, for a README or PR (GitHub draws Mermaid). Give view or flow, not both.',
    inputSchema: {
      view: z.string().max(64).optional().describe('"root" for the top level, or the id of an object with children'),
      flow: z.string().max(64).optional().describe('A flow id'),
    },
    annotations: readOnly,
  }, ({ view, flow }) => read(m => {
    if ((view === undefined) === (flow === undefined)) throw new Error('Give either view or flow.')
    return flow === undefined ? viewToMermaid(m, view!) : flowToMermaid(m, flow)
  }))

  server.registerTool('put_object', {
    description: 'Create or update an object. On update, omitted fields stay as they are, "" removes in, shape, color, opacity, icon, tech or description, [] removes code, links, snippets or data, and external: false removes external.',
    inputSchema: {
      id: id('Object id'),
      type: z.enum(OBJECT_TYPES).optional()
        .describe('Required when creating. actor and system: top level. app and store: inside a system. component: inside an app or store.'),
      name: z.string().optional().describe('Display name. Required when creating.'),
      in: z.string().optional().describe('Id of the parent object. Leave it out (never "root") for the top level; "" moves it there.'),
      external: z.preprocess(asFlag, z.boolean()).optional()
        .describe('An outside service or system you don\'t own, drawn grey. false removes it. "true" and "false" as text are taken too, since that is how get_model shows it.'),
      shape: z.enum([...SHAPES, '']).optional()
        .describe(`How it is drawn: ${SHAPES.join(', ')}. Leave it out to keep the type's own shape (actor: pill, store: cylinder, the rest: rectangle); "" removes it. Pick one only when it says something the type doesn't.`),
      color: z.string().optional()
        .describe(`A name (${COLOR_NAMES.join(', ')}) or a hex like "#3b82f6". Colours the icon, the outline and the fill. Leave it out to keep the type's colour; "" removes it.`),
      opacity: z.preprocess(asNumber, z.union([z.number().int().min(0).max(100), z.literal('')])).optional()
        .describe('How much of the colour the fill holds, in percent. 15 when a colour is set and this is not; 0 draws the plain surface; "" removes it.'),
      icon: z.string().optional()
        .describe('A built-in icon name (see the put_icon description for the list) or one defined with put_icon. Leave it out to keep the default (cloud for external, else the type\'s); "" removes it.'),
      tech: z.string().optional().describe('Technology, e.g. "Postgres"'),
      description: z.string().optional().describe('Markdown. The first paragraph is the short teaser readers see first.'),
      code: z.array(z.string()).optional()
        .describe('Files and folders in the repo this object lives in, relative to the folder that holds flowy/, e.g. ["src/api/"]. Each must exist. [] removes them.'),
      links: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional()
        .describe('Long documents and pages that belong to this object (a runbook, a decision record, a spec, a wiki page). url is a web address (http or https) or a path in the repo, relative to the folder that holds flowy/, which must exist. title is what the reader sees. [] removes them.'),
      // Loose, so a key Flowy doesn't know that get_model shows on a snippet comes back with it. The limits are the checks' (the same ones the app refuses on).
      snippets: z.array(z.looseObject({ text: z.string(), title: z.string().optional(), language: z.string().optional() })).optional()
        .describe(`A few lines of code that explain this object (the formula, the query, the request it takes), each shown in its panel with colours. At most ${SNIPPET_MAX.snippets} snippets of ${SNIPPET_MAX.lines} lines and ${SNIPPET_MAX.chars} characters. Long code belongs in a file, listed in code. title is a short name. language is one of ${LANGUAGES.map(l => l.id).join(', ')}; leave it out and Flowy works it out from the code, which is right for most snippets of five lines or more. Replaces the whole list, so read the object with get_model first and send every snippet to keep. [] removes them.`),
      data: z.array(dataEntry).optional()
        .describe('What a store holds, drawn in its panel as tables with sample rows, key sets, topics or documents. Only a store can have it. Replaces the whole list, so read the store with get_model first and send every entry to keep. [] removes it. Sample rows are invented, never real data.'),
    },
  }, input => write(m => putObject(m, input), before => `${getObject(before, input.id) ? 'Updated' : 'Created'} ${input.id}.`, mcpLabel('put_object', input)))

  server.registerTool('put_project', {
    description: 'Set the name of the system and what it is: the first thing a reader sees when nothing is selected. Omitted fields stay as they are, "" removes one.',
    inputSchema: {
      name: z.string().max(200).optional().describe('What the system is called, e.g. "Plum".'),
      about: z.string().max(4000).optional().describe('Markdown. What the system is for and who uses it, in a paragraph or two. Long documents belong in links on the top-level system.'),
    },
  }, input => write(m => setProject(m, input), 'Saved the project details.', mcpLabel('put_project', input)))

  server.registerTool('put_icon', {
    description: `Define a custom icon for objects to use with put_object's icon. It is SVG path data on a 24x24 grid, drawn as a 2px round line like the built-in ones (copy the "d" of a Tabler or Lucide icon, joining several paths). Built-in names, which can't be reused: ${ICON_GROUPS.map(g => `${g.group}: ${g.names.join(', ')}`).join('. ')}.`,
    inputSchema: {
      name: z.string().max(64).describe('Lowercase letters, digits and dashes, e.g. "stripe"'),
      path: z.string().max(4000).describe('SVG path data, e.g. "M4 4h16v16h-16z". Replaces the icon of that name.'),
    },
  }, input => write(m => putIcon(m, input.name, input.path), `Saved icon ${input.name}.`, mcpLabel('put_icon', input)))

  server.registerTool('delete_icon', {
    description: 'Delete a custom icon. Refused while an object uses it.',
    inputSchema: { name: z.string().max(64).describe('The icon\'s name') },
    annotations: destructive,
  }, input => write(m => deleteIcon(m, input.name), `Deleted icon ${input.name}.`, mcpLabel('delete_icon', input)))

  server.registerTool('delete_object', {
    description: 'Delete an object, its connections, and the flow states and failure-mode affects entries that name it. Refused while it has children, a flow step or flow view uses it, or a failure mode names it: the refusal lists each of those as a row with the actions that settle it (also as structured content), and the same call with `resolve` settles them and deletes in one edit, or saves nothing.',
    inputSchema: { id: id('Object id'), resolve },
    annotations: destructive,
  }, input => write(m => (input.resolve === undefined ? deleteObject(m, input.id) : deleteWith(m, [{ object: input.id }], input.resolve)), `Deleted ${input.id}.`, mcpLabel('delete_object', input)))

  server.registerTool('connect', {
    description: 'Add a connection. Direction matters: from → to. Duplicates and connecting an object to itself are refused.',
    inputSchema: { ...ends, label: z.string().optional().describe('What goes along it, e.g. "REST" or "reads/writes"') },
  }, input => write(m => connect(m, input), `Connected ${input.from} → ${input.to}.`, mcpLabel('connect', input)))

  server.registerTool('disconnect', {
    description: 'Remove connections from → to. Refused while a failure mode is on that line and no other from → to line is left: the refusal lists the mode as a row, and the same call with `resolve` removes the mode and the line in one edit.',
    inputSchema: { ...ends, label: z.string().optional().describe('Only remove the ones with this label; "" means only the unlabelled ones. Leave it out to remove all.'), resolve },
    annotations: destructive,
  }, input => write(m => (input.resolve === undefined ? disconnect(m, input) : deleteWith(m, [{ line: { from: input.from, to: input.to, ...(input.label === undefined ? {} : { label: input.label }), all: true } }], input.resolve)), `Disconnected ${input.from} → ${input.to}.`, mcpLabel('disconnect', input)))

  server.registerTool('tidy_layout', {
    description: 'Put the shapes of a view where they read the same from every side. A view shows the shapes around it too, and each one belongs on the side it has in the view above: if Back office is right of Ordering at the top level, Ordering shows it on the right and Back office shows Ordering on the left. Views that already agree are left as they are, and the rest are laid out again (layout.yaml, which replaces any positions dragged by hand there). Call it once when the shapes and connections are in. check: true only lists what is on the wrong side and saves nothing.',
    inputSchema: {
      view: z.string().max(64).optional().describe('"root" for the top level, or the id of an object with children. Leave it out for every view.'),
      check: z.boolean().optional().describe('true: only list what is on the wrong side.'),
    },
  }, ({ view, check: only }) => {
    if (only === true) return read(m => sideReport(m, tidyViews(m, view).found, false))
    let found: SideProblem[] = []
    return write(m => {
      const tidied = tidyViews(m, view)
      found = tidied.found
      return tidied.model
    }, before => sideReport(before, found, true), mcpLabel('tidy_layout', { id: view ?? 'all views' }), true)
  })

  server.registerTool('put_flow', {
    description: 'Create or replace a flow: a step-by-step walkthrough played on one view. Answers with how each step reads there.',
    inputSchema: {
      id: id('Flow id, also its file name'),
      name: z.string().describe('Title, e.g. "Customer checks out"'),
      view: z.string().max(64).describe('"root" or the id of an object with children. Every step must be visible there.'),
      states: stateMap.optional().describe(`Where shapes stand before step 1: shape id to ${STATE_NAMES.join(', ')}. Leave it out for every shape Running (the default). Only for a flow that starts with a shape not running.`),
      groups: z.record(z.string().max(64), z.strictObject({
        kind: z.enum(GROUP_KINDS).describe('repeat (the same steps again), branch (one of several lanes) or parallel (every lane at the same time)'),
        times: z.union([z.number().int(), z.string()]).optional().describe('repeat only: how many times in all, the first run included, 2 to 99. The limit the code really has.'),
        until: z.string().optional().describe('repeat only: what stops it, in words'),
        text: z.string().optional().describe('A few words for what the kind does not say, such as the backoff'),
      })).optional().describe('Groups of neighbouring steps, by id (lowercase letters, digits and dashes). A step joins one with its "group".'),
      steps: z.array(z.object({
        from: z.string().max(64).describe('Id of the object the step starts at'),
        to: z.string().max(64).optional().describe('Id of the object it goes to. Leave it out for a step where the "from" object does something on its own.'),
        text: z.string().describe('One short sentence'),
        description: z.string().optional().describe('Optional longer detail in markdown, shown only when a reader asks for more'),
        animation: z.union([
          z.string(),
          z.strictObject({
            kind: z.string(), trigger: z.string().optional(), carries: z.string().optional(), outcome: z.string().optional(),
            share: z.union([z.number(), z.string()]).optional(), reason: z.string().optional(),
            by: z.union([z.string(), z.strictObject({ name: z.string() })]).optional(), at: z.union([z.number(), z.string()]).optional(),
            effect: z.enum(EFFECTS).optional().describe('Only for fun: what the moving label does on its way, without bending its shape. Leave it out for the plain default.'),
          }),
        ]).optional().describe(`How the step plays when a reader steps to it: ${ANIMATION_KINDS.join(', ')}, or { kind, trigger: "inside" | "outside" (callback only), carries: a word, outcome (only where the step really ends that way): "fail" (a send or call that is refused) | "timeout" (a call nobody answers) | "lost" (vanishes on the way; at: how far along the line, 0.1 to 0.9) | "rejected" (turned away at the receiver's door) | "intercepted" (taken by a third party, which needs by: a shape id that is not an end of the step, or { name: up to 24 characters }) | "duplicated" (handled twice) | "delayed" (held up on the way), reason: up to 40 characters on why, share: the whole percent of the requests that meet the outcome (1 to 100; leave it out for one request) }. Optional: a step without one does not move.`),
        group: z.string().max(64).optional().describe('The id of the group (under groups) this step belongs to. The steps of a group sit next to each other.'),
        lane: z.string().optional().describe('Branch and parallel groups only: starts a lane at this step, named in plain words (for a branch, the condition). The steps after it in the group belong to it until the next lane. The first step of a branch or parallel group needs one.'),
        flow: z.string().max(64).optional().describe('The id of another flow that tells what happens next. It must exist.'),
        states: stateMap.optional().describe(`The shapes this step changes: shape id to ${STATE_NAMES.join(', ')}. The change holds from this step until another step changes it, so set a shape back to running when it recovers. Only where the step really takes a shape down, brings it up or hurts it.`),
      })).min(1),
    },
  }, input => write(m => putFlow(m, input), before => readout(before, input), mcpLabel('put_flow', input))) // a flow changes no box, so `before` places it right

  server.registerTool('delete_flow', {
    description: 'Delete a flow.',
    inputSchema: { id: id('Flow id (its file name without .yaml)') },
    annotations: destructive,
  }, input => write(m => deleteFlow(m, input.id), `Deleted flow ${input.id}.`, mcpLabel('delete_flow', input)))

  /** A run is read-only except for its `compare` tag, which is written in place with the helper the app's own write uses. */
  const setRunTag = (runId: string, tag: CompareTag | undefined, done: string, label: string) => inOrder(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const loaded = await loadDir(dir)
        const { runs } = await loadRuns(dir, loaded.model)
        if (!Object.hasOwn(runs, runId)) return fail(`unknown run "${runId}"`)
        if (tag?.with === runId) return fail(`run "${runId}" cannot compare with itself`)
        if (tag !== undefined && !Object.hasOwn(runs, tag.with)) return fail(`unknown run "${tag.with}"`)
        const rel = pathOf(FILE_KINDS.run, runId)
        const blocked = firstBlocked(loaded, [rel])
        if (blocked) return fail(`Refused, nothing saved. ${blockedMessage(blocked.blocking, rel)}`)
        const version = hashBytes(await readFile(join(dir, rel)))
        await saveRunCompare(dir, rel, tag, version, async () => { await history?.ensureCurrent('write') })
        await history?.record(label, 'ai')
        return ok(done)
      } catch (e) {
        if (!(e instanceof VersionConflict)) return fail(e)
        if (attempt === 2) return fail(`Nothing saved: ${e.message}, twice in a row. Try again.`)
      }
    }
  })

  server.registerTool('set_compare', {
    description: 'Say which flow or load-test run this one compares with, or take that out. The one you tag is the newer one, the id you give in "with" the older one, and the reader opens the pair side by side. The tag only helps people find a pair; it limits nothing. A flow is changed like any write (an id that is not a flow is refused). A run is a file in perf/ that is otherwise read only: only its compare line is written, and the rest of the file stays as it is. Leave "with" out to remove the tag.',
    inputSchema: {
      kind: z.enum(['flow', 'run']).describe('What is tagged: a flow or a load-test run.'),
      id: z.string().max(64).describe('The id of the flow or run that gets the tag, the newer one.'),
      with: z.string().max(64).optional().describe('The id of the older flow or run it compares with, of the same kind. Leave it out to remove the tag.'),
      note: z.string().optional().describe('A line on what changed between the two, shown with the pair. Needs "with".'),
    },
  }, input => {
    if (input.with === undefined && input.note !== undefined) return inOrder(async () => fail('A note needs "with": the id it compares with.'))
    const tag: CompareTag | undefined = input.with === undefined ? undefined : input.note === undefined ? { with: input.with } : { with: input.with, note: input.note }
    const done = tag === undefined ? `Removed the compare tag of ${input.kind} ${input.id}.` : `Saved: ${input.kind} ${input.id} compares with ${tag.with}.`
    const label = mcpLabel('set_compare', input)
    return input.kind === 'flow' ? write(m => setCompare(m, input.id, tag), done, label) : setRunTag(input.id, tag, done, label)
  })

  const rating = z.preprocess(asNumber, z.number().int().min(1).max(10))
  const modeFields = {
    mode: z.string().describe('How the part fails, as a condition stated as a fact: "Stripe doesn\'t answer within five seconds"'),
    on: z.string().max(64).optional().describe('Id of the shape that fails. Give this, or from and to for a line, not both'),
    from: z.string().max(64).optional().describe('For a line: the id of the shape it starts at. It must be a connection in the model, in that direction'),
    to: z.string().max(64).optional().describe('For a line: the id of the shape it goes to'),
    effect: z.string().optional().describe('What a person or another part then sees'),
    cause: z.string().optional().describe('Why it happens'),
    severity: rating.optional().describe('1 to 10: how bad the effect is. 9 or 10 is always High'),
    occurrence: rating.optional().describe('1 to 10: how likely it is'),
    detection: rating.optional().describe('1 to 10: how hard it is to spot. 10 means nobody would notice'),
    controls: z.string().optional().describe('What exists today to prevent it or catch it'),
    action: z.string().optional().describe('What to do next'),
    owner: z.string().optional().describe('Who does it'),
    status: z.enum(STATUSES).optional().describe('open (the default), planned, done, or accepted (known and left alone). Once done, the after ratings count'),
    after: z.strictObject({ severity: rating.optional(), occurrence: rating.optional(), detection: rating.optional() }).optional()
      .describe('The ratings once the next action is done; a rating left out stays as it is'),
    affects: z.array(z.string().max(64)).optional().describe('Ids of the shapes the failure hurts, written by you and never worked out from the lines'),
    flow: z.string().max(64).optional().describe('The id of the flow that tells this failure'),
    step: z.preprocess(asNumber, z.number().int().min(1)).optional().describe('Which step of that flow, counting from 1'),
    run: z.string().max(64).optional().describe('The id of a performance run that shows it'),
    description: z.string().optional().describe('More, in markdown: why the ratings are what they are'),
  }
  const analysisSaved = (model: Model, aid: string) => {
    const counts = { high: 0, medium: 0, low: 0, unrated: 0 }
    const modes = Object.values(model.failures[aid].modes)
    for (const m of modes) counts[bandOf(m)]++
    return `Saved failure analysis ${aid}: ${modes.length} mode${modes.length === 1 ? '' : 's'}, ${counts.high} High, ${counts.medium} Medium, ${counts.low} Low, ${counts.unrated} Not rated.`
  }
  const modeSaved = (model: Model, aid: string, mid: string) => {
    const m = model.failures[aid].modes[mid]
    const n = riskOf(m)
    const band = BAND_NAMES[bandOf(m)]
    return `Saved ${mid} in ${aid}: ${n === undefined ? band : `Risk ${n}, ${band}`}.`
  }

  server.registerTool('get_failures', {
    description: 'The failure analyses, worst mode first, each as a table with its coverage (which shapes have no analysis yet), then the problems their files have. Give an analysis id for one, and format csv for a table to paste into a spreadsheet.',
    inputSchema: {
      analysis: z.string().max(64).optional().describe('An analysis id. Leave out for all of them'),
      format: z.enum(['markdown', 'csv']).optional().describe('markdown (the default) or csv'),
    },
    annotations: readOnly,
  }, ({ analysis, format }) => inOrder(async () => {
    try {
      const loaded = await loadDir(dir)
      const { model } = loaded
      if (analysis !== undefined && !Object.hasOwn(model.failures, analysis)) throw new Error(`unknown analysis "${analysis}"`)
      const ids = analysis === undefined ? Object.keys(model.failures) : [analysis]
      const problems = [...check(model, missingPaths(dir, model)).filter(p => kindOfPath(p.file) === FILE_KINDS.failure), ...loaded.failureProblems]
        .filter(p => analysis === undefined || p.file === pathOf(FILE_KINDS.failure, analysis))
      const parts = ids.map(aid => analysisText(model, aid, model.failures[aid], format ?? 'markdown'))
      if (problems.length > 0) parts.push(`Problems:\n${problems.map(p => `- ${p.file}: ${p.message}`).join('\n')}`)
      return ok(parts.length > 0 ? parts.join('\n\n') : 'No failure analyses yet. Add one with put_failures.')
    } catch (e) {
      return fail(e)
    }
  }))

  server.registerTool('put_failures', {
    description: 'Create or replace a failure analysis (FMEA): a file of failure modes, one per way a part fails. Replacing drops everything the old one had. Answers with how many modes are High, Medium, Low and Not rated.',
    inputSchema: {
      id: id('Analysis id, also its file name'),
      name: z.string().describe('Title, e.g. "Ordering"'),
      about: z.string().optional().describe('Who rated it, when, and what the ratings rest on'),
      scope: z.string().max(64).optional().describe('"root" or the id of a shape with children: the shapes the coverage counts. Leave out for everything'),
      scale: z.record(z.string(), z.strictObject({ low: z.string().optional(), high: z.string().optional() })).optional()
        .describe('What the ends of each rating mean: { severity: { low, high }, occurrence: { low, high }, detection: { low, high } }'),
      modes: z.record(z.string().max(64), z.strictObject(modeFields)).describe('The modes, by id (lowercase letters, digits and dashes)'),
    },
  }, input => write(m => putAnalysis(m, input), before => analysisSaved(putAnalysis(before, input), input.id), mcpLabel('put_failures', input)))

  server.registerTool('delete_failures', {
    description: 'Delete a failure analysis and all its modes.',
    inputSchema: { id: id('Analysis id (its file name without .yaml)') },
    annotations: destructive,
  }, input => write(m => deleteAnalysis(m, input.id), `Deleted failure analysis ${input.id}.`, mcpLabel('delete_failures', input)))

  server.registerTool('put_failure', {
    description: 'Create or replace one failure mode of an analysis that exists (put_failures makes one). Replacing drops everything the old mode had, so read it with get_model first (get_failures is only the table) and send every field to keep. Answers with its risk and band.',
    inputSchema: { analysis: id('Analysis id'), id: id('Mode id'), ...modeFields },
  }, input => write(
    m => putMode(m, input.analysis, input.id, input),
    before => modeSaved(putMode(before, input.analysis, input.id, input), input.analysis, input.id),
    mcpLabel('put_failure', input),
  ))

  server.registerTool('delete_failure', {
    description: 'Delete one failure mode from an analysis.',
    inputSchema: { analysis: id('Analysis id'), id: id('Mode id') },
    annotations: destructive,
  }, input => write(m => deleteMode(m, input.analysis, input.id), `Deleted ${input.id} from ${input.analysis}.`, mcpLabel('delete_failure', input)))

  registerGuidance(server)
  return server
}
