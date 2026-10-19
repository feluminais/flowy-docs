import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { check } from '../core/check.ts'
import { ICON_GROUPS } from '../core/icons.ts'
import { COLOR_NAMES, customIcons, SHAPES } from '../core/look.ts'
import { changedFiles, getObject, OBJECT_TYPES, parseFile, ROOT } from '../core/model.ts'
import type { Model } from '../core/model.ts'
import { connect, deleteFlow, deleteIcon, deleteObject, disconnect, putFlow, putIcon, putObject, refuseNewProblems } from '../core/ops.ts'
import type { FlowInput } from '../core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../core/mermaid.ts'
import { computeView, nameOf, placeStep, stepEnds } from '../core/views.ts'
import { loadDir, missingPaths, saveFile, VersionConflict } from './files.ts'

const INSTRUCTIONS = `Flowy Docs keeps a C4-style architecture model as YAML files in the repo.
Objects nest: actor and system at the top level, app and store inside a system, component inside an app or store.
Connect the most specific objects you know (e.g. component → store); zoomed-out views merge lines automatically.
A flow is a step-by-step walkthrough played on one view: "root" (the top level) or an object with children.
Before you write:
- Read the existing model first. Reuse exact names and never add a second object for something already there. Change only what was asked: fill blanks, don't overwrite or delete.
- Add only what you can point to in the repo, and give it a code path. If you can't, leave it out and say so. Don't add a queue, cache or gateway the code doesn't use. A missing shape is better than an invented one.
- To map a repo, first list the people, apps, stores and outside services you found, each with the file that shows it, and check the list with the user before writing. If you can't tell what something is for, ask; don't guess.
What gets a shape:
- An app runs on its own; a component is a part inside one running program. A folder, package, library, class or file is not a shape. Leave out what no flow touches (logging, config, deploy plumbing). Keep a view to a handful of shapes, a dozen at most.
- Mark services you don't own external: true. A database or bucket the system owns is a store inside it, and so is a named queue or topic.
Looks (shape, color, opacity, icon) are optional; the type already picks a good default:
- Leave them out unless they say something the type doesn't. A decision is a diamond, a message queue a queue, a file or report a document, a group of shapes a folder, a remark a note. A colour means something only if it means the same everywhere in the model: say what it means in the descriptions that use it, and don't colour for decoration.
- Leave opacity alone unless you set a colour: it defaults to a light tint. Pick an icon from the built-in list only when it names the thing better than its type's icon does; put_icon adds one of your own.
Writing text:
- A description's first paragraph is the hover teaser: a sentence on what the object does for others, in words its name doesn't hold. Start apps and components with a verb. No "responsible for", no praise. Later paragraphs: why, limits, risks. No versions, counts or endpoint lists.
- A connection label is a few words from the side that starts it, and reads as a sentence between the two names ("publishes order events to"). Say what moves; never "uses". A reply is not a connection.
- Put long documents (runbooks, decision records, specs, wiki pages) in links, not in a description. code: is where an object lives.
Writing a flow, so it reads the way the code works:
- One trigger, one story, usually 3-9 steps, named for the goal. A failure gets its own flow.
- A step's text says what passes from "from" to "to", from the side of "from": "Hands the order to Billing", "Asks Pricing for the total". When "from" asks and gets its answer in the same step, say so, and don't add a step going back unless something new is sent.
- Say when the sender doesn't wait for the other side (it queues the work, fires and forgets, or runs on a timer).
- Keep to what the flow's trigger causes. Something that happens on its own gets a step that says so, or a flow of its own.
- Play the flow on the view where its ends are separate shapes. put_flow answers with how each step reads there: an end written "X in Y" is drawn as Y.
- A step's More (its description) holds why, timing, failure behaviour or limits, not a repeat of the step.
After writing: every write is checked, and a write that would add a problem is refused and nothing is saved. Read the answer, fix the cause (find the right path, name or end) and write again. Don't repeat the same call or drop the field to get past it. Finish by saying what you read from the code, what you inferred and what you left out.`

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

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }
const ok = (value: unknown): Result => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})
const fail = (e: unknown): Result => ({ ...ok(e instanceof Error ? e.message : String(e)), isError: true })

export function createMcpServer(dir: string): McpServer {
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

  /** Load fresh, apply, refuse new problems, write changed files. Retries once if a file changed underneath. */
  const write = (op: (model: Model) => Model, done: string | ((before: Model) => string)) => inOrder(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const { model, versions } = await loadDir(dir)
        const next = op(model)
        refuseNewProblems(model, next, missingPaths(dir, model, next)) // the canvas refuses the same edits, except missing code paths, which only Node can see
        // Every op changes at most one file today, so a failure can't leave a half-applied multi-file change.
        const changes = changedFiles(model, next)
        // Never write what can't be read back: if saving and loading ever disagree, refuse instead of breaking the folder.
        try {
          for (const [rel, text] of changes) if (text !== null) parseFile(rel, text)
        } catch (e) {
          return fail(`Refused, nothing saved. The result couldn't be read back: ${e instanceof Error ? e.message : String(e)}`)
        }
        for (const [rel, text] of changes) await saveFile(dir, rel, text, versions[rel] ?? null)
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

  // Known limit: returns the whole model; add filters if models grow past a few hundred objects
  server.registerTool('get_model', {
    description: 'Everything in the model: objects, connections, flows, the custom icons put_icon defined (name → SVG path data), and current problems.',
    inputSchema: {}, // without a schema the SDK runs this one step sooner and it overtakes earlier calls
    annotations: readOnly,
  }, () => read(m => ({ objects: m.objects, connections: m.connections, flows: m.flows, icons: customIcons(m.meta), problems: check(m, missingPaths(dir, m)) })))

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
    description: 'Create or update an object. On update, omitted fields stay as they are, "" removes in, shape, color, opacity, icon, tech or description, [] removes code or links, and external: false removes external.',
    inputSchema: {
      id: id('Object id'),
      type: z.enum(OBJECT_TYPES).optional()
        .describe('Required when creating. actor and system: top level. app and store: inside a system. component: inside an app or store.'),
      name: z.string().optional().describe('Display name. Required when creating.'),
      in: z.string().optional().describe('Id of the parent object. Leave it out (never "root") for the top level; "" moves it there.'),
      external: z.boolean().optional()
        .describe('An outside service or system you don\'t own, drawn grey. false removes it. get_model shows it as the text "true".'),
      shape: z.enum([...SHAPES, '']).optional()
        .describe(`How it is drawn: ${SHAPES.join(', ')}. Leave it out to keep the type's own shape (actor: pill, store: cylinder, the rest: rectangle); "" removes it. Pick one only when it says something the type doesn't.`),
      color: z.string().optional()
        .describe(`A name (${COLOR_NAMES.join(', ')}) or a hex like "#3b82f6". Colours the icon, the outline and the fill. Leave it out to keep the type's colour; "" removes it.`),
      opacity: z.union([z.number().int().min(0).max(100), z.literal('')]).optional()
        .describe('How much of the colour the fill holds, in percent. 15 when a colour is set and this is not; 0 draws the plain surface; "" removes it.'),
      icon: z.string().optional()
        .describe('A built-in icon name (see the put_icon description for the list) or one defined with put_icon. Leave it out to keep the default (cloud for external, else the type\'s); "" removes it.'),
      tech: z.string().optional().describe('Technology, e.g. "Postgres"'),
      description: z.string().optional().describe('Markdown. The first paragraph is the short teaser readers see first.'),
      code: z.array(z.string()).optional()
        .describe('Files and folders in the repo this object lives in, relative to the folder that holds flowy/, e.g. ["src/api/"]. Each must exist. [] removes them.'),
      links: z.array(z.object({ url: z.string(), title: z.string().optional() })).optional()
        .describe('Long documents and pages that belong to this object (a runbook, a decision record, a spec, a wiki page). url is a web address (http or https) or a path in the repo, relative to the folder that holds flowy/, which must exist. title is what the reader sees. [] removes them.'),
    },
  }, input => write(m => putObject(m, input), before => `${getObject(before, input.id) ? 'Updated' : 'Created'} ${input.id}.`))

  server.registerTool('put_icon', {
    description: `Define a custom icon for objects to use with put_object's icon. It is SVG path data on a 24x24 grid, drawn as a 2px round line like the built-in ones (copy the "d" of a Tabler or Lucide icon, joining several paths). Built-in names, which can't be reused: ${ICON_GROUPS.map(g => `${g.group}: ${g.names.join(', ')}`).join('. ')}.`,
    inputSchema: {
      name: z.string().max(64).describe('Lowercase letters, digits and dashes, e.g. "stripe"'),
      path: z.string().max(4000).describe('SVG path data, e.g. "M4 4h16v16h-16z". Replaces the icon of that name.'),
    },
  }, input => write(m => putIcon(m, input.name, input.path), `Saved icon ${input.name}.`))

  server.registerTool('delete_icon', {
    description: 'Delete a custom icon. Refused while an object uses it.',
    inputSchema: { name: z.string().max(64).describe('The icon\'s name') },
    annotations: destructive,
  }, input => write(m => deleteIcon(m, input.name), `Deleted icon ${input.name}.`))

  server.registerTool('delete_object', {
    description: 'Delete an object and its connections. Refused while it has children or a flow uses it.',
    inputSchema: { id: id('Object id') },
    annotations: destructive,
  }, input => write(m => deleteObject(m, input.id), `Deleted ${input.id}.`))

  server.registerTool('connect', {
    description: 'Add a connection. Direction matters: from → to. Duplicates and connecting an object to itself are refused.',
    inputSchema: { ...ends, label: z.string().optional().describe('What goes along it, e.g. "REST" or "reads/writes"') },
  }, input => write(m => connect(m, input), `Connected ${input.from} → ${input.to}.`))

  server.registerTool('disconnect', {
    description: 'Remove connections from → to.',
    inputSchema: { ...ends, label: z.string().optional().describe('Only remove the ones with this label; "" means only the unlabelled ones. Leave it out to remove all.') },
    annotations: destructive,
  }, input => write(m => disconnect(m, input), `Disconnected ${input.from} → ${input.to}.`))

  server.registerTool('put_flow', {
    description: 'Create or replace a flow: a step-by-step walkthrough played on one view. Answers with how each step reads there.',
    inputSchema: {
      id: id('Flow id, also its file name'),
      name: z.string().describe('Title, e.g. "Customer checks out"'),
      view: z.string().max(64).describe('"root" or the id of an object with children. Every step must be visible there.'),
      steps: z.array(z.object({
        from: z.string().max(64).describe('Id of the object the step starts at'),
        to: z.string().max(64).optional().describe('Id of the object it goes to. Leave it out for a step where the "from" object does something on its own.'),
        text: z.string().describe('One short sentence'),
        description: z.string().optional().describe('Optional longer detail in markdown, shown only when a reader asks for more'),
      })).min(1),
    },
  }, input => write(m => putFlow(m, input), before => readout(before, input))) // a flow changes no box, so `before` places it right

  server.registerTool('delete_flow', {
    description: 'Delete a flow.',
    inputSchema: { id: id('Flow id (its file name without .yaml)') },
    annotations: destructive,
  }, input => write(m => deleteFlow(m, input.id), `Deleted flow ${input.id}.`))

  return server
}
