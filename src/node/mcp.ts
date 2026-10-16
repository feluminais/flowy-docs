import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { check, newProblems } from '../core/check.ts'
import { changedFiles, getObject, OBJECT_TYPES, parseFlowFile, parseModelFile, ROOT } from '../core/model.ts'
import type { Model } from '../core/model.ts'
import { connect, deleteFlow, deleteObject, disconnect, putFlow, putObject } from '../core/ops.ts'
import { computeView } from '../core/views.ts'
import { loadDir, saveFile, VersionConflict } from './files.ts'

const INSTRUCTIONS = `Flowy Docs keeps a C4-style architecture model as YAML files in the repo.
Objects nest: actor and system at the top level, app and store inside a system, component inside an app or store.
Connect the most specific objects you know (e.g. component → store); zoomed-out views merge lines automatically.
A flow is a step-by-step walkthrough played on one view: "root" (the top level) or an object with children.
Every write is checked. A write that would add a problem is refused and nothing is saved.`

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }
const ok = (value: unknown): Result => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})
const fail = (e: unknown): Result => ({ ...ok(e instanceof Error ? e.message : String(e)), isError: true })

/** Never write what can't be read back: if saving and loading ever disagree, refuse instead of breaking the folder. */
function assertReadable(rel: string, text: string) {
  if (rel === 'model.yaml') parseModelFile(text)
  else parseFlowFile(rel.slice('flows/'.length, -'.yaml'.length), text)
}

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
        const added = newProblems(check(model), check(next))
        if (added.length) return fail(`Refused, nothing saved. This would add:\n${added.map(p => `- ${p.file}: ${p.message}`).join('\n')}`)
        // Every op changes at most one file today, so a failure can't leave a half-applied multi-file change.
        const changes = changedFiles(model, next)
        try {
          for (const [rel, text] of changes) if (text !== null) assertReadable(rel, text)
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

  const id = (what: string) => z.string().max(64).describe(`${what}: lowercase letters, digits and dashes, e.g. "orders-api"`)
  const ends = {
    from: z.string().max(64).describe('Id of the object the connection starts at'),
    to: z.string().max(64).describe('Id of the object it goes to'),
  }
  const readOnly = { readOnlyHint: true }
  const destructive = { destructiveHint: true }

  // ponytail: returns the whole model; add filters if models grow past a few hundred objects
  server.registerTool('get_model', {
    description: 'Everything in the model: objects, connections, flows, and current problems.',
    inputSchema: {}, // without a schema the SDK runs this one step sooner and it overtakes earlier calls
    annotations: readOnly,
  }, () => read(m => ({ objects: m.objects, connections: m.connections, flows: m.flows, problems: check(m) })))

  server.registerTool('get_view', {
    description: 'What one diagram shows: members (its boxes), outsiders (faded boxes from elsewhere that connect in) and edges (connections merged to that zoom level).',
    inputSchema: { view: z.string().max(64).describe('"root" for the top level, or the id of an object with children') },
    annotations: readOnly,
  }, ({ view }) => read(m => {
    if (view !== ROOT && !getObject(m, view)) throw new Error(`unknown view "${view}"`)
    const v = computeView(m, view)
    const box = (boxId: string) => ({ id: boxId, name: m.objects[boxId].name, type: m.objects[boxId].type })
    return { view, members: v.members.map(box), outsiders: v.outsiders.map(box), edges: v.edges }
  }))

  server.registerTool('put_object', {
    description: 'Create or update an object. On update, omitted fields stay as they are, and "" removes in, tech or description.',
    inputSchema: {
      id: id('Object id'),
      type: z.enum(OBJECT_TYPES).optional()
        .describe('Required when creating. actor and system: top level. app and store: inside a system. component: inside an app or store.'),
      name: z.string().optional().describe('Display name. Required when creating.'),
      in: z.string().optional().describe('Id of the parent object. Leave it out (never "root") for the top level; "" moves it there.'),
      tech: z.string().optional().describe('Technology, e.g. "Postgres"'),
      description: z.string().optional().describe('Markdown. The first paragraph is the short teaser readers see first.'),
    },
  }, input => write(m => putObject(m, input), before => `${getObject(before, input.id) ? 'Updated' : 'Created'} ${input.id}.`))

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
    description: 'Create or replace a flow: a step-by-step walkthrough played on one view.',
    inputSchema: {
      id: id('Flow id, also its file name'),
      name: z.string().describe('Title, e.g. "Customer checks out"'),
      view: z.string().max(64).describe('"root" or the id of an object with children. Every step must be visible there.'),
      steps: z.array(z.object({
        from: z.string().max(64).describe('Id of the object the step starts at'),
        to: z.string().max(64).describe('Id of the object it goes to'),
        text: z.string().describe('One short sentence'),
      })).min(1),
    },
  }, input => write(m => putFlow(m, input), `Saved flow ${input.id}.`))

  server.registerTool('delete_flow', {
    description: 'Delete a flow.',
    inputSchema: { id: id('Flow id (its file name without .yaml)') },
    annotations: destructive,
  }, input => write(m => deleteFlow(m, input.id), `Deleted flow ${input.id}.`))

  return server
}
