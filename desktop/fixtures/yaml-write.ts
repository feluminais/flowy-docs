import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fileData, serializeFile, serializeLayout } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { loadState } from '../../src/node/files.ts'
import { fixtureDirs } from './dump.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Awkward text: what a plain scalar can't hold, what needs quotes, what becomes a block, and what only looks special. */
const STRINGS = [
  '', ' ', '  ', 'plain', 'with space', ' leading', 'trailing ', '  both  ', 'a: b', 'a:b', 'a #b', 'a#b', '#x', '- x', '-', '-x', '--', '? x', '?x', ':x', 'x:', 'x::',
  '[x]', '{x}', 'a [b]', 'a {b}', 'a, b', ',x', '&x', '*x', '!x', '!!x', '|x', '>x', "'x'", '"x"', 'say "hi"', "it's", "a'b\"c", '"', "'", '%x', '@x', '`x', '= x', '<<', '* ',
  'null', 'true', 'false', '007', '3.10', '~', 'yes', 'no', '1e3', '0x10', '.inf', 'a\nb', 'a\nb\n', 'a\nb\n\n', 'a\nb\n\n\n', '\nstart', '\n\nstart', 'a\n\nb', 'a\n\n\nb',
  'a\n  indented\nb', ' lead\nb', 'a\n lead2', '  two\nb', 'a\n', '\n', '\n\n', 'a \nb', 'a\nb \n', 'a\n \nb', 'tab\there', 'a\tb', '\ttab', 'trailing tab\t', 'a\n\tb',
  'back\\slash', 'unicode é ü ✓ 日本', 'emoji 😀', '---', '...', '--- x', '... x', 'a\r\nb', 'a\rb', 'x\u2028y', 'x\u2029y', 'x\u0085y', '\u00a0nbsp', 'a\u0007b', '\u001bx', 'a\u0000b', '\uFEFFbom',
  'Line one\nLine two\n- a list\n- of things\n\n```ts\nconst x = 1\n```\n',
  'key: value\nsecond: line', '# comment\nline', 'text with `code` and **bold**', 'GET /menus/:restaurant reads a menu', 'POST /orders → places', 'a — b', 'x y z'.repeat(60),
  'one very long line with many words '.repeat(12).trim(), 'a: b\n', '- a\n- b', '{"json": true}', '[1, 2]', 'http://example.com/a?b=c#d', 'C:\\path\\file', 'a | b', 'a > b', 'a ? b', 'a & b', 'a * b', 'a ! b', 'a @ b',
]

type Tree = string | Tree[] | { [key: string]: Tree }

const SHAPES: { name: string; data: Tree }[] = [
  { name: 'empty map', data: {} },
  { name: 'empty list in map', data: { items: [] } },
  { name: 'empty map in map', data: { a: {} } },
  { name: 'list of maps', data: { connections: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c', label: 'two words' }] } },
  { name: 'list of lists', data: { m: [['a', 'b'], [], ['c']] } },
  { name: 'list in list in map', data: { m: [[['x']]] } },
  { name: 'map in list in map', data: { m: [{ a: { b: { c: 'd' } } }] } },
  { name: 'list of maps with lists', data: { steps: [{ from: 'a', code: ['x/y', 'z'], text: 'hi' }, { text: 'second', more: [] }] } },
  { name: 'nested maps', data: { objects: { a: { type: 'system', name: 'A' }, b: { type: 'app', in: 'a', name: 'B', code: ['x/'] } } } },
  { name: 'integer-like keys', data: { '10': 'a', '2': 'b', x: 'c', '007': 'd' } },
  { name: 'odd keys', data: { 'a b': '1', 'a: b': '2', '': '3', '#k': '4', '- k': '5', '[k]': '6', 'k:': '7', '"q"': '8', "it's": '9', 'é': '10' } },
  { name: 'multiline in list in map', data: { items: ['a\nb', 'c', 'd\ne\n'] } },
  { name: 'multiline in nested map', data: { objects: { a: { description: 'Line one\n\nLine two\n' } } } },
  { name: 'multiline in list item map', data: { steps: [{ text: 'x', description: 'More\nlines here\n' }] } },
  { name: 'top-level list', data: ['a', 'b', { c: 'd' }] },
]

const out = (rel: string, data: unknown) => {
  try {
    return { text: serializeFile(rel, data) }
  } catch (e) {
    return { error: String(e) }
  }
}

/** What the `yaml` package writes for each awkward string as a value, a list item and a key, and for each shape. */
export async function dumpYamlWrite(): Promise<unknown> {
  const strings = STRINGS.map(s => ({
    s,
    value: out('flows/x.yaml', { k: s }),
    item: out('flows/x.yaml', { k: [s] }),
    key: out('flows/x.yaml', { [s]: 'v' }),
    nested: out('flows/x.yaml', { a: { b: [{ c: s, d: 'x' }] } }),
  }))
  const shapes = SHAPES.map(({ name, data }) => ({ name, data, ...out('flows/x.yaml', data) }))
  const samples: Record<string, Record<string, string[]>>[] = [
    {}, { root: { a: ['10', '20'] } }, { root: { a: ['10', '20'], b: ['-5', '7.5'] }, shop: { web: ['0', '0'] } },
  ]
  const layouts = samples.map(l => ({ layout: l, text: serializeLayout(Object.fromEntries(Object.entries(l).map(([v, boxes]) => [v, Object.fromEntries(Object.entries(boxes).map(([id, p]) => [id, p.map(Number)]))])) as never) }))
  // Every file of every fixture folder, as the TypeScript reads and writes it again: the whole path an edit takes.
  const files: { folder: string; rel: string; data: unknown; text: string }[] = []
  for (const dir of [...Object.values(fixtureDirs()), 'docs/demo/flowy', 'example']) {
    const state = await loadState(join(root, dir))
    if ('parseError' in state) continue
    const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
    const rels = ['model.yaml', ...Object.keys(model.flows).map(id => `flows/${id}.yaml`)]
    for (const rel of rels) {
      // A file with an empty value the failsafe schema reads as null can't be written by the TypeScript either: the editor refuses it.
      try {
        files.push({ folder: dir, rel, data: fileData(model, rel), text: serializeFile(rel, fileData(model, rel)) })
      } catch {
        continue
      }
    }
  }
  return { strings, shapes, layouts, files }
}
