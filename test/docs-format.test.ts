import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ANIMATION_KINDS, OUTCOMES } from '../src/core/animation.ts'
import { STATUSES } from '../src/core/failures.ts'
import { COLOR_NAMES, SHAPES } from '../src/core/look.ts'
import { LINE_STYLES, OBJECT_TYPES } from '../src/core/model.ts'
import { STATE_NAMES } from '../src/core/states.ts'
import { GROUP_KINDS } from '../src/core/structure.ts'

const format = readFileSync('docs/format.md', 'utf8')

test('docs/format.md names every word the files accept', () => {
  const words: [string, readonly string[]][] = [
    ['object types', OBJECT_TYPES], ['shapes', SHAPES], ['colours', COLOR_NAMES], ['line styles', LINE_STYLES], ['states', STATE_NAMES],
    ['animation kinds', ANIMATION_KINDS], ['outcomes', OUTCOMES], ['group kinds', GROUP_KINDS], ['statuses', STATUSES],
  ]
  for (const [what, list] of words) {
    const missing = list.filter(w => !new RegExp(`\`${w}\``).test(format))
    assert.deepEqual(missing, [], `${what} missing from docs/format.md`)
  }
})

test('docs/format.md names every key the files read', () => {
  const keys = {
    model: ['objects', 'connections', 'lines', 'icons'],
    object: ['type', 'name', 'in', 'external', 'shape', 'color', 'opacity', 'icon', 'tech', 'description', 'code', 'links', 'snippets', 'data'],
    connection: ['from', 'to', 'label'],
    flow: ['name', 'view', 'steps', 'groups', 'states', 'compare'],
    step: ['from', 'to', 'text', 'description', 'animation', 'group', 'lane', 'flow', 'states'],
    animation: ['kind', 'trigger', 'carries', 'outcome', 'share', 'reason', 'by', 'at', 'effect', 'depth', 'returns'],
    group: ['kind', 'times', 'until', 'text'],
    analysis: ['name', 'about', 'scope', 'scale', 'modes'],
    mode: ['mode', 'on', 'from', 'to', 'effect', 'cause', 'severity', 'occurrence', 'detection', 'controls', 'action', 'owner', 'status', 'after', 'affects', 'flow', 'step', 'run', 'description'],
  }
  // Each list is checked in its own part of the page, so a key that two tables share (flow, text, from) can't be missing from one.
  const part = (from: string, to: string) => format.slice(format.indexOf(from), format.indexOf(to, format.indexOf(from) + from.length))
  const parts: Record<keyof typeof keys, string> = {
    model: part('## model.yaml', '### An object'), object: part('### An object', '### A connection'), connection: part('### A connection', '## flows/'),
    flow: part('## flows/', '### A step'), step: part('### A step', 'An **animation**'), animation: part('An **animation**', '### A group'),
    group: part('### A group', '## failures/'), analysis: part('## failures/', 'A **mode**'), mode: part('A **mode**', '## perf/'),
  }
  for (const [what, list] of Object.entries(keys)) {
    const missing = list.filter(k => !new RegExp(`^\\| [^|]*\`${k}\`[^|]*\\|`, 'm').test(parts[what as keyof typeof keys]))
    assert.deepEqual(missing, [], `${what} keys missing from docs/format.md`)
  }
})

test('docs/format.md describes the compare key of a run, its long form and who holds it', () => {
  const runs = format.slice(format.indexOf('## perf/'), format.indexOf('## What writes what over MCP'))
  for (const word of ['`compare`', '`with`', '`note`', 'The holder is the newer one']) assert.ok(runs.includes(word), `${word} missing from the perf part of docs/format.md`)
  assert.match(format, /`set_compare`/)
})

test('every relative link and anchor in the docs leads somewhere', () => {
  const slug = (h: string) => h.toLowerCase().replace(/[`*_]/g, '').replace(/&lt;|&gt;/g, '').replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ /g, '-')
  const anchors = (file: string) => new Set([...readFileSync(file, 'utf8').matchAll(/^#{1,6} +(.+)$/gm)].map(m => slug(m[1])))
  const files = ['README.md', 'CONTRIBUTING.md', 'vscode/README.md', ...readdirSync('docs').filter(f => f.endsWith('.md')).map(f => `docs/${f}`)]
  const broken: string[] = []
  for (const file of files) {
    // A link inside a code span or a fence is an example of a link, not a link.
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    for (const [, url] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(url)) continue
      const [path, hash] = url.split('#')
      const target = path === '' ? file : join(dirname(file), path)
      if (!existsSync(target)) broken.push(`${file}: ${url} (no such file)`)
      else if (hash && target.endsWith('.md') && !anchors(target).has(hash)) broken.push(`${file}: ${url} (no such heading)`)
    }
  }
  assert.deepEqual(broken, [])
})
