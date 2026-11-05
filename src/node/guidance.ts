import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { RULES } from './rules.ts'

/** The guides an AI can read over MCP, by file name in docs/, which package.json ships beside dist/. Each description is what starts a read: what the page holds and when, in a task's words. */
const DOCS = [
  { file: 'format.md', title: 'File format', description: 'Every key you write by hand, with limits, defaults and quoting: model.yaml, flows, failures, data, snippets. Read before editing YAML. Run file keys: guide/performance.md.' },
  { file: 'writing.md', title: 'Writing good Flowy docs', description: 'All judgement on what to draw and how to word it. Holds what flowy://rules/* serve, plus comparison notes, load-test runs and what stays outside Flowy.' },
  { file: 'guide.md', title: 'Flowy Docs guide', description: 'Which page holds what, by request. Read when the rules do not answer a question about Flowy.' },
  { file: 'guide/canvas.md', title: 'Guide: the canvas', description: 'Using the app: panels, search, player, edit forms, YAML tab, history. Read when asked how to do something on screen or what a mark means.' },
  { file: 'guide/shapes.md', title: 'Guide: shapes, colour and icons', description: 'Which shape, colour, opacity and icon a box can take. Read when asked for a look.' },
  { file: 'guide/flows.md', title: 'Guide: flows', description: 'How a flow plays: what a step sends, how a request ends, which line a step rides, repeats, branches, parallel steps, shape states, streams and listeners.' },
  { file: 'guide/kinds.md', title: 'Guide: connection kinds', description: 'The six connection kinds (request and reply, request then stream, publish, cached publish, object updates, extension point) and how a line draws each.' },
  { file: 'guide/data.md', title: 'Guide: data', description: 'How a store shows what it holds: tables, key sets, topics and collections. Read to explain what the Data section shows.' },
  { file: 'guide/failures.md', title: 'Guide: failure modes', description: 'How Flowy ranks a failure analysis: risk, bands, what Analysed counts. Read to explain or check a rating.' },
  { file: 'guide/performance.md', title: 'Guide: performance', description: 'Replaying a load test on the diagram, and the run file keys. Read to write an exporter or a run, or to explain what the Performance tab shows.' },
  { file: 'guide/compare.md', title: 'Guide: compare', description: 'Two flows or runs side by side: the compare tag that makes a pair, the note, the marks of what changed. Read to set up or explain a comparison.' },
  { file: 'guide/sketches.md', title: 'Guide: sketches', description: 'Sketches and drafts kept apart from the model in sketches/<id>/: making one, copying shapes, the sketch argument, and a line for each connection (pairs: separate).' },
  { file: 'guide/ai.md', title: 'Guide: AI and MCP', description: 'What to ask an AI for, how to review its first pass, and what the server offers. Setup is in install.md.' },
  { file: 'guide/share.md', title: 'Guide: check it and share it', description: 'Command line: check, export a read-only site, Mermaid, tidy, with exit codes. Read to run Flowy in CI or publish a model.' },
  { file: 'guide/desktop.md', title: 'Guide: the desktop app', description: 'How the desktop app differs from the browser. Read when a question names the desktop app.' },
  { file: 'shortcuts.md', title: 'Shortcuts', description: 'Every keyboard shortcut in the app and the browser. Read when asked which key does something.' },
  { file: 'install.md', title: 'Install', description: 'Installing the desktop app, the browser version and the VS Code extension, and adding the MCP server. Read for setup problems.' },
] as const

const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url))

/** What every prompt ends with: the check, then the account the user is owed of how much of the model is read and how much guessed. */
const FINISH = 'When you have written, call tidy_layout once, then get_problems and fix what it lists. Then say what you read from the code, what you inferred and what you left out. Last, name what Flowy could add that the code gave you material for (data, code on shapes, failures, motion in flows, performance, more flows), one line each, and skip any you saw nothing for.'

type Prompt = { title: string; description: string; args?: Record<string, z.ZodType<string | undefined>>; text: (args: Record<string, string | undefined>) => string }

const PROMPTS: Record<string, Prompt> = {
  'map-repo': {
    title: 'Map this repo',
    description: 'Survey the repo first, check the list with the user, then write the model in passes.',
    args: {
      focus: z.string().optional().describe('Who will read the model and what they want to know, in one line. Leave out to ask.'),
      also: z.string().optional().describe('Parts to add to the default (shapes, connections, plain flows): data, code, failures, motion in flows. Leave out for the default.'),
    },
    text: ({ focus, also }) => [
      `Map this repository into Flowy.${focus ? ` The reader: ${focus}` : ' First ask me who will read the model and what they want to know, in one line.'}`,
      'Do not write anything yet. Read flowy://rules/writing. Call get_model with summary: true to see what exists, then list the people, apps, stores (databases, caches, named queues and topics) and outside services you can find in the code, each with the file or folder that shows it. Mark the ones we do not own. Leave out anything you cannot point to. I will check the list.',
      'Then write in passes, and tell me when each is done: (1) shapes with put_object; (2) connections with connect; (3) three to five plain flows with put_flow; (4) the text, with a name and short about through put_project.',
      also ? `Beyond that, add: ${also}. Read flowy://rules/ for each of these before you write it (flows, data, code, failures).` : 'Add nothing beyond that: no failure modes, data, code on shapes, motion or looks. I will ask for them by name.',
      FINISH,
    ].join('\n\n'),
  },
  'update-after-change': {
    title: 'Update the model after a code change',
    description: 'Change only the parts a code change affects, and say what was left alone.',
    args: { change: z.string().optional().describe('The diff, a branch or a commit, or a sentence on what changed. Leave out to use the uncommitted changes.') },
    text: ({ change }) => [
      `Update the Flowy model for this change: ${change || 'the uncommitted changes in the repo'}.`,
      'Read flowy://rules/writing. Call get_model with summary: true, then object, flow or analysis for only the parts the change touches. Change only those: a renamed shape, a moved code path, a new connection, a step that no longer happens. Do not rewrite text that is still true, and do not delete what you are unsure of.',
      FINISH,
    ].join('\n\n'),
  },
  'write-flow': {
    title: 'Write a flow',
    description: 'Write one flow for a goal, read from the code, one handover to a step.',
    args: { goal: z.string().describe('What happens, as a goal: "Customer places an order".') },
    text: ({ goal }) => [
      `Write a Flowy flow for: ${goal}.`,
      'Read flowy://rules/writing, the code that does it, and get_model with summary: true for the shape ids. Write it with put_flow. For motion, repeats, branches or states, which only I ask for, read flowy://rules/flows first.',
      'put_flow answers with how each step reads on its view: check that it reads like the code works.',
      FINISH,
    ].join('\n\n'),
  },
  'failure-analysis': {
    title: 'Write a failure analysis',
    description: 'Rank how the system breaks, one row to each way a part fails, rating only what can be defended.',
    args: { scope: z.string().optional().describe('The shape id the analysis covers, or "root" for everything. Leave out to choose.') },
    text: ({ scope }) => [
      `Write a Flowy failure analysis${scope ? ` for ${scope}` : ''}.`,
      'Read flowy://rules/failures first. Call get_model with summary: true, and get_model with object for the shapes that matter.',
      'Use put_failures for the analysis and put_failure to change one mode.',
      FINISH,
    ].join('\n\n'),
  },
  'review-model': {
    title: 'Review the model',
    description: 'Read the model like a reviewer and report what is wrong, without changing anything.',
    text: () => [
      'Review the Flowy model. Change nothing: report.',
      'Read flowy://rules/writing, and flowy://rules/<topic> for each part the model has (flows, data, code, failures). Call get_problems, then get_model with summary: true, then read what you need in full.',
      'Look for: an app, store or component with no real tech, no code path, or a path that proves nothing; a name that is only its type ("Database"); two shapes for one thing; an acronym not explained where it is used; a teaser that restates its name or opens with "responsible for"; a warning ("Deprecated", "planned") the teaser leaves out; a procedure, table or decision in a panel that a linked document should hold; a connection label that is "uses", or ends on to, from or with; a flow not named for a goal, with more than one trigger, or not starting with whoever sets it off; a step whose sender is not the subject, that names its receiver or ends on a preposition; a happy path that is not whole; a view with more than a dozen shapes; a look that says nothing, or a colour with two meanings; a store showing more than the tables a flow touches, rows that look real, or a note that does not say why; a failure mode that names more than one way of failing, an effect a reader could not see, or a rating nobody can defend; text that will go stale (versions, counts, endpoint lists); a guess not marked "Open question".',
      'Give each finding as the shape or flow id, what is wrong, and what you would change, worst first.',
    ].join('\n\n'),
  },
}

/** The prompts and the guides the server offers beside its tools, so an AI starts from the way Flowy is meant to be used. */
export function registerGuidance(server: McpServer): void {
  for (const [name, { title, description, args, text }] of Object.entries(PROMPTS)) {
    server.registerPrompt(name, { title, description, ...(args ? { argsSchema: args } : {}) }, (given: Record<string, string | undefined>) => ({
      messages: [{ role: 'user', content: { type: 'text', text: text(given ?? {}) } }],
    }))
  }
  for (const [topic, { title, description, text }] of Object.entries(RULES)) {
    server.registerResource(`rules-${topic}`, `flowy://rules/${topic}`, { title, description, mimeType: 'text/markdown' }, async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text }],
    }))
  }
  for (const { file, title, description } of DOCS) {
    const path = `${docsDir}${file}`
    if (!existsSync(path)) continue
    server.registerResource(file.replace(/\.md$/, '').replace('/', '-'), `flowy://docs/${file}`, { title, description, mimeType: 'text/markdown' }, async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(path, 'utf8') }],
    }))
  }
  const sketches = `${docsDir}guide/sketches.md`
  if (existsSync(sketches)) {
    // The sketches guide was flowy://docs/guide/drafts.md. It still reads there, but a listing shows only the new address.
    server.registerResource('guide-drafts', new ResourceTemplate('flowy://docs/guide/drafts.md', { list: undefined }), { title: 'Guide: sketches (old address)', description: 'Deprecated, read flowy://docs/guide/sketches.md.', mimeType: 'text/markdown' }, async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await readFile(sketches, 'utf8') }],
    }))
  }
}
