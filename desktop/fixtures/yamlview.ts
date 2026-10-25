import { readSnapshot } from '../../src/node/history.ts'
import { blockOf, defaultFile, fileOrder, tabName } from '../../ui/src/yamlview.ts'

// What the YAML tab says about the files: the order they are listed in, the one shown first, what a tab is called, where a shape's block is in
// model.yaml, and which files of the demo are listed at all. The C# side (YamlFiles in Flowy.Core) loads this from the file `dumpYamlView` writes.

const PATHS = [
  ['layout.yaml', 'flows/b.yaml', 'model.yaml', 'flows/a.yaml'],
  ['flows/z/checkout.yaml', 'flows/a.yaml', 'failures/ordering.yaml', 'model.yaml', 'flows/B.yaml'],
  ['layout.yaml', 'flows/a.yaml'],
  [],
]

const DEFAULTS: [string[], string | undefined][] = [
  [['model.yaml', 'flows/checkout.yaml', 'layout.yaml'], 'checkout'],
  [['model.yaml', 'flows/checkout.yaml', 'layout.yaml'], 'gone'],
  [['model.yaml', 'flows/checkout.yaml', 'layout.yaml'], undefined],
  [['model.yaml', 'flows/rush/checkout.yaml'], 'checkout'],
  [['layout.yaml', 'flows/a.yaml'], undefined],
  [[], undefined],
]

const NAMES = ['model.yaml', 'layout.yaml', 'flows/a.yaml', 'flows/rush/a.yaml', 'flows/model.yaml', 'flows/layout.yaml', 'failures/ordering.yaml']

const MODEL = [
  'title: Shop',
  '',
  'objects:',
  '  # the shop',
  '  shop:',
  '    type: system',
  '    name: Shop',
  '',
  '  web:',
  '    type: app',
  '    in: shop',
  '  web-2: { type: app, name: Second, in: shop }',
  "  'quoted':",
  '    type: actor',
  '  "double": { type: actor }',
  '',
  'connections: []',
].join('\n')

const BLOCKS: [string, string][] = [
  [MODEL, 'shop'], [MODEL, 'web'], [MODEL, 'web-2'], [MODEL, 'quoted'], [MODEL, 'double'], [MODEL, 'missing'],
  ['title: x\nconnections: []\n', 'shop'], ['objects: {}\n', 'shop'], ['objects:\r\n  a:\r\n    type: system\r\nconnections: []\r\n', 'a'],
  ['objects:  # the shapes\n    a:\n        type: system\n    b: {}\n', 'a'],
]

export async function dumpYamlView() {
  return {
    order: PATHS.map(paths => ({ paths, order: fileOrder(paths) })),
    defaults: DEFAULTS.map(([paths, flow]) => ({ paths, flow: flow ?? null, file: defaultFile(paths, { flow }) })),
    names: NAMES.map(path => ({ path, name: tabName(path) })),
    blocks: BLOCKS.map(([text, id]) => ({ text, id, block: blockOf(text, id) ?? null })),
    demo: fileOrder(Object.keys((await readSnapshot('docs/demo/flowy')).files)),
  }
}
