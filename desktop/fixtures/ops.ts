import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typesIn } from '../../src/core/check.ts'
import { modelFiles, ROOT, serializeLayout } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model, Step } from '../../src/core/model.ts'
import { connect, deleteFlow, deleteObject, deleteObjects, forgetLayout, groupSteps, OpError, placeBoxes, putFlow, putGroup, putObject, refuseNewProblems, relabel, removeConnection, removeGroup, removeStep, setGroupKind, setLines, setStepGroup, updateFlow } from '../../src/core/ops.ts'
import type { ObjectInput } from '../../src/core/ops.ts'
import { loadState } from '../../src/node/files.ts'
import { newId } from '../../ui/src/edit.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

type Spec = { op: string; [key: string]: any }

/** Every edit the app makes, as data: the C# tests run the same list through EditOps, and every file it writes must be equal. */
export const STEPS: Spec[] = [
  { op: 'putObject', id: 'checkout', type: 'component', name: 'Checkout', in: 'api', description: 'Line one\n\nLine two\n', code: ['src/a.ts', 'src/b/'] },
  { op: 'putObject', id: 'web', tech: 'Next.js', external: true },
  { op: 'putObject', id: 'web', tech: '', external: false },
  { op: 'putObject', id: 'customer', name: 'Shopper' },
  { op: 'putObject', id: 'Bad Id', type: 'actor', name: 'X' },
  { op: 'putObject', id: 'ghost', name: 'No type' },
  { op: 'putObject', id: 'weird', type: 'actor', name: 'a: b # c', description: '  leading\nsecond' },
  { op: 'putObject', id: 'checkout', code: [] },
  { op: 'putObject', id: 'api', links: [{ url: 'docs/api.md', title: 'API notes' }, { url: 'https://status.example.com', title: '  ' }, { url: 'docs/x.md', note: 'keep' }] },
  { op: 'putObject', id: 'api', links: [] },
  { op: 'putObject', id: 'api', links: [{ title: 'Back again', url: 'docs/api.md' }] },
  { op: 'putObject', id: 'shop', description: '' },
  { op: 'putObject', id: 'cache', type: 'store', name: 'Cache', in: 'shop', tech: 'Redis' },
  { op: 'putObject', id: 'cache', icon: 'mail', opacity: 30, color: 'amber', shape: 'queue' },
  { op: 'putObject', id: 'cache', shape: 'blob' },
  { op: 'putObject', id: 'cache', color: 'bluish', opacity: 120 },
  { op: 'putObject', id: 'cache', icon: 'nope' },
  { op: 'putObject', id: 'web', color: '#C026D3', opacity: 0, icon: 'truck', shape: 'hexagon' },
  { op: 'putObject', id: 'cache', color: '', opacity: '' },
  { op: 'putObject', id: 'cache', shape: '', icon: '' },
  { op: 'putObject', id: 'cache', data: [{ limits: '', name: 'Keys', kind: '', columns: ['Key', { note: 'n', to: 't', key: 'primary', name: 'Value' }, { name: 'Expires', to: '' }], rows: [['menu:42', 2490, true]] }, { notes: { hours: 'Inside.' }, sample: { rating: 4.6, open: false, tags: ['a', 'b'], hours: { mon: '11-22' } }, name: 'doc' }] },
  { op: 'putObject', id: 'cache', data: [{ name: 'refunds', columns: ['id'] }] },
  { op: 'putObject', id: 'cache', tech: 'Valkey' },
  { op: 'putObject', id: 'shop', data: [{ name: 'x', columns: ['a'] }] },
  { op: 'putObject', id: 'cache', data: [{ name: 'x', columns: ['a', 'b'], rows: [['1']] }] },
  { op: 'putObject', id: 'cache', data: [{ name: 'x', columns: ['a'], rows: [['a\nb']] }] },
  { op: 'putObject', id: 'cache', data: 'oops' },
  { op: 'putObject', id: 'cache', data: [{ name: 'a', columns: 'c', rows: 'r' }] },
  { op: 'putObject', id: 'cache', data: [] },
  { op: 'putObject', id: 'api', snippets: [{ language: 'TS', text: '\nconst a = 1\r\nconst b = 2\n\n', title: '  Fee  ', note: 'kept' }, { text: 'SELECT 1', title: '  ', language: ' ' }] },
  { op: 'putObject', id: 'api', snippets: [{ text: '# comment\n  indented\n\tafter a tab\n\nlast   \n' }, { text: 'x', language: 'klingon' }] },
  { op: 'putObject', id: 'api', snippets: [{ text: ' \n ', title: 'Blank' }] },
  { op: 'putObject', id: 'api', snippets: [{ text: `one${String.fromCharCode(0x2028)}two${String.fromCharCode(0x2029)}three${String.fromCharCode(0x85)}four\u0007\r\n\r\n  five\u007f\n\n`, title: 'Separators' }] },
  { op: 'putObject', id: 'api', snippets: [{ text: 'x'.repeat(8001) }] },
  { op: 'putObject', id: 'api', tech: 'Fastify' },
  { op: 'putObject', id: 'api', snippets: [] },
  { op: 'putObject', id: 'misplaced', type: 'app', name: 'Loose' },
  { op: 'connect', from: 'web', to: 'api', label: 'REST again' },
  { op: 'connect', from: 'api', to: 'cache' },
  { op: 'connect', from: 'api', to: 'nowhere' },
  { op: 'connect', from: 'web', to: 'web' },
  { op: 'relabel', from: 'web', to: 'api', which: 'REST', label: 'HTTP' },
  { op: 'relabel', from: 'customer', to: 'web', which: 'browses', label: '' },
  { op: 'relabel', from: 'web', to: 'api', which: 'missing', label: 'x' },
  { op: 'removeConnection', from: 'api', to: 'db', which: '' },
  { op: 'removeConnection', from: 'api', to: 'db', which: '' },
  { op: 'putFlow', id: 'pay', name: 'Customer pays', view: 'root', steps: [{ from: 'customer', to: 'pay', text: 'Pays' }, { from: 'customer', text: 'Waits', description: '   ' }, { from: 'pay', text: 'Confirms', description: 'It takes a second.' }] },
  { op: 'putFlow', id: 'Pay', name: 'Same name, other case', view: 'root', steps: [{ from: 'customer', text: 'x' }] },
  { op: 'putFlow', id: 'bad id', name: 'Bad', view: 'root', steps: [{ from: 'customer', text: 'x' }] },
  { op: 'putFlow', id: 'order', name: 'Replaced', view: 'root', steps: [{ from: 'customer', text: 'Only step' }] },
  { op: 'putFlow', id: 'tagged', name: 'Tagged', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Pays', animation: 'call' }, { from: 'shop', to: 'customer', text: 'Rings back', animation: { kind: 'callback', trigger: 'outside', carries: 'receipt' } }] },
  { op: 'updateFlow', id: 'tagged', name: 'Tagged again' },
  { op: 'putFlow', id: 'tagged-bad', name: 'Bad tag', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Pays', animation: 'zoom' }] },
  { op: 'deleteFlow', id: 'tagged' },
  { op: 'updateFlow', id: 'browse', name: 'Customer looks around' },
  { op: 'updateFlow', id: 'browse', steps: [{ from: 'customer', to: 'web', text: 'Opens the site' }, { from: 'web', text: 'Shows the shop', description: 'More\nlines here\n' }] },
  { op: 'updateFlow', id: 'nope', name: 'x' },
  { op: 'deleteFlow', id: 'pay' },
  { op: 'deleteFlow', id: 'pay' },
  { op: 'putFlow', id: 'retry-pay', name: 'Customer pays, with a retry', view: 'root', groups: { retry: { kind: 'repeat', times: 3 }, result: { kind: 'branch', text: 'Depends on the bank' } }, steps: [{ from: 'customer', to: 'shop', text: 'Pays', group: 'retry' }, { from: 'shop', to: 'customer', text: 'Asks again', group: 'retry' }, { from: 'shop', text: 'Accepts', group: 'result', lane: 'Accepted' }, { from: 'shop', text: 'Writes it down', group: 'result' }, { from: 'shop', text: 'Declines', group: 'result', lane: 'Declined' }, { from: 'shop', to: 'customer', text: 'Done' }] },
  { op: 'putFlow', id: 'no-groups', name: 'An empty set writes none', view: 'root', groups: {}, steps: [{ from: 'customer', text: 'Only step' }] },
  { op: 'putFlow', id: 'bad-groups', name: 'A group nobody is in', view: 'root', groups: { lonely: { kind: 'branch' } }, steps: [{ from: 'customer', text: 'x' }] },
  { op: 'removeStep', id: 'retry-pay', index: 1 },
  { op: 'removeStep', id: 'retry-pay', index: 1 },
  { op: 'removeStep', id: 'retry-pay', index: 2 },
  { op: 'removeStep', id: 'retry-pay', index: 9 },
  { op: 'removeStep', id: 'retry-pay', index: -1 },
  { op: 'removeStep', id: 'nope', index: 0 },
  { op: 'putGroup', id: 'retry-pay', group: 'retry', options: { kind: 'repeat', until: 'the bank answers', times: '  ', text: 'Every second' } },
  { op: 'putGroup', id: 'retry-pay', group: 'retry', options: { kind: 'repeat', times: '1' } },
  { op: 'putGroup', id: 'retry-pay', group: 'retry', options: { kind: 'repeat', times: '100' } },
  { op: 'putGroup', id: 'retry-pay', group: 'retry', options: { kind: 'repeat', times: ' 5 ' } },
  { op: 'putGroup', id: 'retry-pay', group: 'retry', options: { kind: 'repeat', times: '12' } },
  { op: 'putGroup', id: 'retry-pay', group: 'poll', options: { kind: 'repeat', times: '5' } },
  { op: 'putGroup', id: 'retry-pay', group: 'Bad Id', options: { kind: 'branch' } },
  { op: 'putGroup', id: 'nope', group: 'x', options: { kind: 'branch' } },
  { op: 'putGroup', id: 'retry-pay', group: 'result', options: { kind: 'parallel' } },
  { op: 'removeGroup', id: 'retry-pay', group: 'result' },
  { op: 'removeGroup', id: 'retry-pay', group: 'nope' },
  { op: 'removeGroup', id: 'browse', group: 'together' },
  { op: 'updateFlow', id: 'retry-pay', groups: { retry: { kind: 'repeat', times: '4' } } },
  { op: 'updateFlow', id: 'retry-pay', name: 'Customer pays again' },
  { op: 'updateFlow', id: 'retry-pay', groups: {} },
  { op: 'removeStep', id: 'retry-pay', index: 0 },
  { op: 'removeStep', id: 'browse', index: 0 },
  { op: 'removeStep', id: 'browse', index: 0 },
  { op: 'deleteFlow', id: 'retry-pay' },
  { op: 'deleteFlow', id: 'no-groups' },
  { op: 'putFlow', id: 'plan', name: 'Customer plans', view: 'root', steps: [{ from: 'customer', text: 'Looks' }, { from: 'customer', to: 'shop', text: 'Asks' }, { from: 'shop', text: 'Answers' }, { from: 'shop', to: 'customer', text: 'Confirms' }, { from: 'customer', text: 'Leaves' }] },
  { op: 'groupSteps', id: 'plan', group: 'asking', kind: 'repeat', first: 1, last: 2 },
  { op: 'groupSteps', id: 'plan', group: 'asking', kind: 'branch', first: 3, last: 3 },
  { op: 'groupSteps', id: 'plan', group: 'Bad Id', kind: 'repeat', first: 3, last: 3 },
  { op: 'groupSteps', id: 'plan', group: 'again', kind: 'zig', first: 3, last: 3 },
  { op: 'groupSteps', id: 'plan', group: 'again', kind: 'repeat', first: 2, last: 3 },
  { op: 'groupSteps', id: 'plan', group: 'again', kind: 'repeat', first: 4, last: 3 },
  { op: 'groupSteps', id: 'plan', group: 'again', kind: 'repeat', first: 3, last: 9 },
  { op: 'groupSteps', id: 'nope', group: 'again', kind: 'repeat', first: 0, last: 0 },
  { op: 'groupSteps', id: 'plan', group: 'ending', kind: 'branch', first: 3, last: 4 },
  { op: 'setStepGroup', id: 'plan', index: 0, group: 'asking' },
  { op: 'setStepGroup', id: 'plan', index: 0, group: 'asking' },
  { op: 'setStepGroup', id: 'plan', index: 0, group: 'nope' },
  { op: 'setStepGroup', id: 'plan', index: 9, group: 'asking' },
  { op: 'setStepGroup', id: 'plan', index: 0, group: '' },
  { op: 'setStepGroup', id: 'plan', index: 2, group: 'ending' },
  { op: 'setStepGroup', id: 'plan', index: 4, group: '' },
  { op: 'setStepGroup', id: 'plan', index: 4, group: 'ending' },
  { op: 'setStepGroup', id: 'plan', index: 3, group: '' },
  { op: 'setGroupKind', id: 'plan', group: 'ending', kind: 'repeat' },
  { op: 'setGroupKind', id: 'plan', group: 'ending', kind: 'parallel' },
  { op: 'setGroupKind', id: 'plan', group: 'ending', kind: 'branch' },
  { op: 'setGroupKind', id: 'plan', group: 'ending', kind: 'zig' },
  { op: 'setGroupKind', id: 'plan', group: 'asking', kind: 'parallel' },
  { op: 'setGroupKind', id: 'plan', group: 'asking', kind: 'branch' },
  { op: 'setGroupKind', id: 'plan', group: 'nope', kind: 'repeat' },
  { op: 'setGroupKind', id: 'nope', group: 'ending', kind: 'repeat' },
  { op: 'deleteFlow', id: 'plan' },
  { op: 'placeBoxes', view: 'root', boxes: { customer: [12, 34], shop: [300.5, 40], ghost: [1, 2] } },
  { op: 'placeBoxes', view: 'shop', boxes: { api: [5, 6], web: [0, 0] } },
  { op: 'placeBoxes', view: 'nowhere', boxes: { api: [5, 6] } },
  { op: 'setLines', style: 'angled' },
  { op: 'setLines', style: 'straight' },
  { op: 'setLines', style: 'curved' },
  { op: 'setLines' },
  { op: 'forgetLayout', view: 'shop' },
  { op: 'forgetLayout', view: 'shop' },
  { op: 'deleteObject', id: 'shop' },
  { op: 'deleteObject', id: 'customer' },
  { op: 'deleteObject', id: 'nothing' },
  { op: 'deleteObject', id: 'cache' },
  { op: 'deleteObject', id: '10' },
  { op: 'deleteObject', id: '2' },
  { op: 'deleteObjects', ids: ['weird', 'pay'] }, // two at once, and the line to pay goes with it
  { op: 'deleteObjects', ids: ['checkout', 'customer'] }, // customer is used by a flow: nothing goes, not even checkout
  { op: 'deleteObjects', ids: ['db', 'ghost'] },
  { op: 'deleteObjects', ids: ['shop', 'web'] }, // shop still has api and db inside
  { op: 'deleteObjects', ids: [] },
  { op: 'deleteFlow', id: 'browse' },
  { op: 'deleteFlow', id: 'order' },
  { op: 'deleteObjects', ids: ['shop', 'api', 'web', 'db', 'checkout'] }, // a box with what is inside it, the inner ones first
]

function apply(model: Model, s: Spec): Model {
  switch (s.op) {
    case 'putObject': {
      const { op: _, ...input } = s
      return putObject(model, input as ObjectInput)
    }
    case 'deleteObject': return deleteObject(model, s.id)
    case 'deleteObjects': return deleteObjects(model, s.ids)
    case 'connect': return connect(model, { from: s.from, to: s.to, label: s.label })
    case 'removeConnection': return removeConnection(model, { from: s.from, to: s.to, label: s.which })
    case 'relabel': return relabel(model, { from: s.from, to: s.to, label: s.which }, s.label)
    case 'putFlow': return putFlow(model, { id: s.id, name: s.name, view: s.view, steps: s.steps as Step[], ...(s.groups === undefined ? {} : { groups: s.groups }) })
    case 'updateFlow': return updateFlow(model, s.id, { ...(s.name === undefined ? {} : { name: s.name }), ...(s.steps === undefined ? {} : { steps: s.steps as Step[] }), ...(s.groups === undefined ? {} : { groups: s.groups }) })
    case 'removeStep': return removeStep(model, s.id, s.index)
    case 'putGroup': return putGroup(model, s.id, s.group, s.options)
    case 'removeGroup': return removeGroup(model, s.id, s.group)
    case 'setStepGroup': return setStepGroup(model, s.id, s.index, s.group)
    case 'setGroupKind': return setGroupKind(model, s.id, s.group, s.kind)
    case 'groupSteps': return groupSteps(model, s.id, s.group, s.kind, s.first, s.last)
    case 'deleteFlow': return deleteFlow(model, s.id)
    case 'placeBoxes': return placeBoxes(model, s.view, s.boxes)
    case 'setLines': return setLines(model, s.style)
    case 'forgetLayout': return forgetLayout(model, s.view)
    default: throw new Error(`unknown op ${s.op}`)
  }
}

const filesOf = (m: Model) => ({ ...modelFiles(m), 'layout.yaml': serializeLayout(m.layout) })

/** The folder the edits start from, as files, and what each edit writes or says. An edit that is refused changes nothing, as in the app. */
export async function dumpOps(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/edit/flowy'))
  if ('parseError' in state) throw new Error('the edit case can\'t be read')
  let model: Model = modelOf(state)
  const initial = filesOf(model)
  const results = STEPS.map(spec => {
    try {
      const next = apply(model, spec)
      refuseNewProblems(model, next)
      model = next
      return { spec, files: filesOf(model) }
    } catch (e) {
      if (!(e instanceof OpError)) throw e
      return { spec, error: e.message }
    }
  })
  const names = ['Orders DB', 'orders db', 'Café Étoile', 'Naïve  Résumé', '日本語', '---', 'x'.repeat(100), '  Spaces  ', 'What?!', '1st place', 'API', 'api', 'Ünïcödé 2', 'a/b\c', '']
  const ids = names.flatMap(name => [[], ['orders-db', 'orders-db-2', 'API']].map(taken => ({ name, taken, id: newId(name, taken, 'component') })))
  const start: Model = modelOf(state)
  const types = [ROOT, ...Object.keys(start.objects), 'nowhere'].map(view => ({ view, types: typesIn(start, view) }))
  return { initial, results, ids, types }
}
