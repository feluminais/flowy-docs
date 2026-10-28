import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { RULES } from './rules.ts'

/** The guides an AI can read over MCP, by file name in docs/. They sit next to src/ and dist/, so they exist in a clone and not in a package of dist alone. */
const DOCS = [
  { file: 'format.md', title: 'File format', description: 'Every key of model.yaml, flows, failure analyses and load-test runs, with what each takes. Read it before writing a file by hand.' },
  { file: 'writing.md', title: 'Writing good Flowy docs', description: 'What to put in a model: which shapes to draw, how to word a teaser, a connection label and a step, and how to keep it true.' },
  { file: 'guide.md', title: 'Flowy Docs guide', description: 'Which page holds what, and which to read for a request. Start here.' },
  { file: 'guide/canvas.md', title: 'Guide: the canvas', description: 'Zooming, panels, search, editing, the YAML tab and history.' },
  { file: 'guide/shapes.md', title: 'Guide: shapes, colour and icons', description: 'Which shape, colour, opacity and icon a box takes.' },
  { file: 'guide/flows.md', title: 'Guide: flows', description: 'How a request ends, repeats, branches, parallel steps and shape states.' },
  { file: 'guide/data.md', title: 'Guide: data', description: 'What a store holds: tables, key sets, topics and collections.' },
  { file: 'guide/code.md', title: 'Guide: code', description: 'A few lines of code on a shape.' },
  { file: 'guide/failures.md', title: 'Guide: failure modes', description: 'Rating how each part fails, and reading the ranked list.' },
  { file: 'guide/performance.md', title: 'Guide: performance', description: 'Replaying a load test on the diagram.' },
  { file: 'guide/compare.md', title: 'Guide: compare', description: 'Two flows or two runs side by side, the marks of what changed, a note, and the compare tag that makes a pair.' },
  { file: 'guide/drafts.md', title: 'Guide: drafts', description: 'A sketch of a system or a flow in drafts/<id>/, kept apart from the model: making one, copying shapes into it, and the draft argument of every tool.' },
  { file: 'guide/ai.md', title: 'Guide: AI and MCP', description: 'Setup, the tools, the prompts and what to ask for.' },
  { file: 'guide/share.md', title: 'Guide: check it and share it', description: 'The check command and exporting a read-only site.' },
  { file: 'guide/desktop.md', title: 'Guide: the desktop app', description: 'What the desktop app does and where it differs from the browser.' },
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
      'Do not write anything yet. Call get_model with summary: true to see what exists, then list the people, apps, stores (databases, caches, named queues and topics) and outside services you can find in the code, each with the file or folder that shows it. Mark the ones we do not own. Leave out anything you cannot point to. I will check the list.',
      'Then write in passes, and tell me when each is done: (1) shapes with put_object, each with a code path, a teaser and a real tech; (2) connections with connect, each a verb and what moves, never ending on to or from; (3) three to five plain flows with put_flow; (4) the text. Read the flowy://docs/writing.md resource if you are unsure how to word something.',
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
      'Call get_model with summary: true, then object, flow or analysis for only the parts the change touches. Change only those: a renamed shape, a moved code path, a new connection, a step that no longer happens. Do not rewrite text that is still true, and do not delete what you are unsure of. Mark anything you guessed with "Open question: ..." at the end of its description.',
      'A path that exists proves little: if code changed what a shape does, update its text even though nothing reports a problem.',
      FINISH,
    ].join('\n\n'),
  },
  'write-flow': {
    title: 'Write a flow',
    description: 'Write one flow for a goal, read from the code, one handover to a step.',
    args: { goal: z.string().describe('What happens, as a goal: "Customer places an order".') },
    text: ({ goal }) => [
      `Write a Flowy flow for: ${goal}.`,
      'Read the code that does it, and get_model with summary: true for the shape ids. Name the flow for the goal, start from its one trigger and tell the happy path whole in 3 to 9 steps. Each step is one handover with the sender as the subject: "Hands over the order", "Asks for the total". Say who waits, put why and timing in the step\'s description, and play it on the view where its ends are separate shapes. Give a failure its own flow. Write plain steps; add motion, repeats, branches or states only if I ask, and read flowy://rules/flows first.',
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
      'Read flowy://rules/failures first. Call get_model with summary: true, and get_model with object for the shapes that matter. One row for each way a part fails, the mode a condition stated as a fact ("Stripe does not answer within five seconds"), the effect what a person or another part then sees. Name the part with on, or a line with from and to. Give severity, occurrence and detection (1 to 10, and 10 for detection means nobody would notice) only where you can defend them, and leave out the rest: a mode with no ratings shows as Not rated. Put what exists today in controls, what to do next in action, the flow that tells it in flow, and the shapes it hurts in affects. If a load-test run shows it, name it in run, one of the ids get_model lists.',
      'Use put_failures for the analysis and put_failure to change one mode: put_failure replaces the whole mode, so read it with get_model first.',
      FINISH,
    ].join('\n\n'),
  },
  'review-model': {
    title: 'Review the model',
    description: 'Read the model like a reviewer and report what is wrong, without changing anything.',
    text: () => [
      'Review the Flowy model. Change nothing: report.',
      'Call get_problems, then get_model with summary: true, then read what you need in full. Look for: shapes with no code path, or with a path that proves nothing; a name that is only its type ("Database"); two shapes for one thing; a description that restates its name, or opens with "responsible for"; a teaser that leaves out a warning ("Deprecated") that the panel holds; a connection label that is "uses", or ends on to, from or with; a flow with more than one trigger, a step that names its receiver or ends on a preposition, or a happy path that is not whole; a view with more than a dozen shapes; text that will go stale (versions, counts, endpoint lists); a guess not marked "Open question".',
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
}
