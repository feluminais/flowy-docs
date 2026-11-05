import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WRITING = fileURLToPath(new URL('../../docs/writing.md', import.meta.url))

/** docs/writing.md, split at its H2 headings. Read on first use, so only the MCP server needs the file and `flowy check` runs without it. */
let sections: Map<string, string> | undefined

function readSections(): Map<string, string> {
  if (sections) return sections
  let text: string
  try {
    text = readFileSync(WRITING, 'utf8')
  } catch (cause) {
    throw new Error(`The MCP rules are served from ${WRITING}, which could not be read. package.json "files" must ship it.`, { cause })
  }
  sections = new Map<string, string>()
  for (const part of text.replace(/\r\n/g, '\n').split(/^## /m).slice(1)) {
    const end = part.indexOf('\n')
    sections.set(part.slice(0, end).trim(), part.slice(end).trim())
  }
  return sections
}

function rule(heading: string, title: string, description: string) {
  return {
    title,
    description,
    get text(): string {
      const text = readSections().get(heading)
      if (text === undefined) throw new Error(`${WRITING} has no "## ${heading}" section, which an MCP rule is served from.`)
      return text
    },
  }
}

/**
 * What the AI reads as resources, flowy://rules/<topic>: the sections of docs/writing.md, so the one text has two addresses. `writing` is how the default is
 * written, read before the first write, and the server's instructions stay short because Claude Code cuts them off past about 4,000 characters. The other
 * topics are the parts most requests leave out, each read only when the user asked for that part. A heading renamed in writing.md is renamed here.
 */
export const RULES = {
  writing: rule('Write the model', 'What gets a shape, and how to word it', 'What gets a shape, names, code paths, looks, teasers, descriptions, connection labels, and how a plain flow reads. Read once before the first write.'),
  code: rule('Show a few lines of code', 'Writing code on a shape', 'Snippets on a shape: what to copy, how much, what to leave out. Read before adding code to a shape.'),
  data: rule('Data', 'Writing what a store holds', 'Tables, key sets, topics, collections, sample rows, notes and limits. Read before saying what a store holds.'),
  flows: rule('Flows beyond plain steps', 'Motion, failed requests, repeats, branches, states and payloads in a flow', 'Animation, outcomes, repeats, branches, parallel lanes, shape states, open streams, via, payloads, folders and tags. Read before a flow goes beyond plain steps.'),
  failures: rule('Failure modes', 'Writing a failure analysis', 'Modes, effects, ratings, controls and actions. Read before writing a failure analysis.'),
}

export type RuleTopic = keyof typeof RULES
