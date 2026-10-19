import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typesIn } from '../../src/core/check.ts'
import { modelFiles, ROOT, serializeLayout } from '../../src/core/model.ts'
import type { Model, Step } from '../../src/core/model.ts'
import { connect, deleteFlow, deleteObject, forgetLayout, OpError, placeBoxes, putFlow, putObject, refuseNewProblems, relabel, removeConnection, setLines, updateFlow } from '../../src/core/ops.ts'
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
  { op: 'putObject', id: 'shop', description: '' },
  { op: 'putObject', id: 'cache', type: 'store', name: 'Cache', in: 'shop', tech: 'Redis' },
  { op: 'putObject', id: 'cache', icon: 'mail', opacity: 30, color: 'amber', shape: 'queue' },
  { op: 'putObject', id: 'cache', shape: 'blob' },
  { op: 'putObject', id: 'cache', color: 'bluish', opacity: 120 },
  { op: 'putObject', id: 'cache', icon: 'nope' },
  { op: 'putObject', id: 'web', color: '#C026D3', opacity: 0, icon: 'truck', shape: 'hexagon' },
  { op: 'putObject', id: 'cache', color: '', opacity: '' },
  { op: 'putObject', id: 'cache', shape: '', icon: '' },
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
  { op: 'updateFlow', id: 'browse', name: 'Customer looks around' },
  { op: 'updateFlow', id: 'browse', steps: [{ from: 'customer', to: 'web', text: 'Opens the site' }, { from: 'web', text: 'Shows the shop', description: 'More\nlines here\n' }] },
  { op: 'updateFlow', id: 'nope', name: 'x' },
  { op: 'deleteFlow', id: 'pay' },
  { op: 'deleteFlow', id: 'pay' },
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
]

function apply(model: Model, s: Spec): Model {
  switch (s.op) {
    case 'putObject': {
      const { op: _, ...input } = s
      return putObject(model, input as ObjectInput)
    }
    case 'deleteObject': return deleteObject(model, s.id)
    case 'connect': return connect(model, { from: s.from, to: s.to, label: s.label })
    case 'removeConnection': return removeConnection(model, { from: s.from, to: s.to, label: s.which })
    case 'relabel': return relabel(model, { from: s.from, to: s.to, label: s.which }, s.label)
    case 'putFlow': return putFlow(model, { id: s.id, name: s.name, view: s.view, steps: s.steps as Step[] })
    case 'updateFlow': return updateFlow(model, s.id, { ...(s.name === undefined ? {} : { name: s.name }), ...(s.steps === undefined ? {} : { steps: s.steps as Step[] }) })
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
  let model: Model = { ...state.model, flows: state.flows, layout: state.layout }
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
  const start: Model = { ...state.model, flows: state.flows, layout: state.layout }
  const types = [ROOT, ...Object.keys(start.objects), 'nowhere'].map(view => ({ view, types: typesIn(start, view) }))
  return { initial, results, ids, types }
}
