import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { typesIn } from '../../src/core/check.ts'
import { ROOT } from '../../src/core/model.ts'
import { modelFiles, serializeLayout } from '../../src/core/modelfiles.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model, Step } from '../../src/core/model.ts'
import { connect, deleteFlow, deleteObject, deleteObjects, deleteWith, forgetLayout, groupSteps, OpError, placeBoxes, putFlow, putGroup, putObject, refuseNewProblems, relabel, removeConnection, removeGroup, removeStep, setCompare, setGroupKind, setLines, setProject, setStepAnimation, setStepGroup, setStepStates, updateFlow } from '../../src/core/ops.ts'
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
  { op: 'setCompare', id: 'retry-pay', with: 'browse' },
  { op: 'setCompare', id: 'retry-pay', with: 'browse', note: 'Retries loop three times now' },
  { op: 'setCompare', id: 'retry-pay', with: 'order' },
  { op: 'setCompare', id: 'retry-pay', with: 'retry-pay' },
  { op: 'setCompare', id: 'retry-pay', with: 'nope' },
  { op: 'setCompare', id: 'nope', with: 'browse' },
  { op: 'updateFlow', id: 'retry-pay', name: 'Customer pays once more' },
  { op: 'setCompare', id: 'retry-pay' },
  { op: 'setCompare', id: 'retry-pay' },
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
  { op: 'putFlow', id: 'play', name: 'Customer plays', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Asks', description: 'More', note: 'x' }, { from: 'shop', to: 'customer', text: 'Answers', animation: { kind: 'call', outcome: 'timeout' } }, { from: 'shop', text: 'Thinks' }] },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'send', outcome: 'lost', share: '30', reason: 'Packet dropped' } },
  { op: 'setStepAnimation', id: 'play', index: 1, animation: 'send' },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'call', outcome: 'intercepted', by: { name: 'Café wifi proxy' }, share: '50' } },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'call', outcome: 'intercepted', by: 'pay' } },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'call', outcome: 'intercepted', by: 'shop' } },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'call', outcome: 'intercepted', by: 'ghost' } },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'callback', outcome: 'lost' } },
  { op: 'setStepAnimation', id: 'play', index: 0, animation: { kind: 'send', outcome: 'lost', share: '101' } },
  { op: 'setStepAnimation', id: 'play', index: 2, animation: 'call' },
  { op: 'setStepAnimation', id: 'play', index: 0 },
  { op: 'setStepAnimation', id: 'play', index: 0 },
  { op: 'setStepAnimation', id: 'play', index: 9, animation: 'call' },
  { op: 'setStepAnimation', id: 'nope', index: 0, animation: 'call' },
  { op: 'deleteFlow', id: 'play' },
  { op: 'putFlow', id: 'outage', name: 'The shop goes down', view: 'root', states: { web: 'degraded' }, steps: [{ from: 'customer', to: 'shop', text: 'Orders' }, { from: 'shop', text: 'Stops answering', states: { api: 'stopped' } }, { from: 'customer', text: 'Waits', states: {} }, { from: 'shop', text: 'Is back', description: ' ', states: { api: 'running', web: 'running' } }] },
  { op: 'putFlow', id: 'no-states', name: 'An empty set writes none', view: 'root', states: {}, steps: [{ from: 'customer', text: 'Only step', states: {} }] },
  { op: 'putFlow', id: 'bad-state', name: 'A word that is not a state', view: 'root', states: { web: 'asleep' }, steps: [{ from: 'customer', text: 'x' }] },
  { op: 'putFlow', id: 'bad-shape', name: 'A shape nobody has', view: 'root', steps: [{ from: 'customer', text: 'x', states: { ghost: 'stopped' } }] },
  { op: 'setStepStates', id: 'outage', index: 0, states: { api: 'starting' } },
  { op: 'setStepStates', id: 'outage', index: 0, states: { web: 'degraded', db: 'stopping', api: 'restarting' } },
  { op: 'setStepStates', id: 'outage', index: 1, states: { db: 'stopped' } },
  { op: 'setStepStates', id: 'outage', index: 3, states: {} },
  { op: 'setStepStates', id: 'outage', index: 2, states: {} },
  { op: 'setStepStates', id: 'outage', index: 0, states: { api: 'asleep' } },
  { op: 'setStepStates', id: 'outage', index: 0, states: { ghost: 'stopped' } },
  { op: 'setStepStates', id: 'outage', index: 0, states: { root: 'stopped' } },
  { op: 'setStepStates', id: 'outage', index: 9, states: { api: 'stopped' } },
  { op: 'setStepStates', id: 'nope', index: 0, states: { api: 'stopped' } },
  { op: 'setStepStates', id: 'tagged-bad', index: 0, states: { api: 'stopped' } },
  { op: 'setStepStates', id: 'outage', index: 1, states: { db: 'stopped', cache: 'degraded' } },
  { op: 'deleteObject', id: 'cache' }, // a step of outage sets it
  { op: 'deleteFlow', id: 'no-states' },
  { op: 'deleteFlow', id: 'outage' },
  { op: 'placeBoxes', view: 'root', boxes: { customer: [12, 34], shop: [300.5, 40], ghost: [1, 2] } },
  { op: 'placeBoxes', view: 'shop', boxes: { api: [5, 6], web: [0, 0] } },
  { op: 'placeBoxes', view: 'nowhere', boxes: { api: [5, 6] } },
  { op: 'setLines', style: 'angled' },
  { op: 'setLines', style: 'straight' },
  { op: 'setLines', style: 'curved' },
  { op: 'setProject', about: 'Sells things.\n\nMore about it.\n' },
  { op: 'setProject', name: ' Shop ' },
  { op: 'setProject', name: 'Store' },
  { op: 'setProject', about: 'Changed.' },
  { op: 'setProject', name: '   ' },
  { op: 'setProject' },
  { op: 'setProject', name: 'Plum', about: '' },
  { op: 'setLines' },
  { op: 'setProject', name: '', about: 'Last.' },
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

/** Deleting what other parts depend on, from a folder with flows, groups, states and a failure analysis (desktop/fixtures/cases/delete). Each edit starts from what the one before left. */
export const DELETE_STEPS: Spec[] = [
  { op: 'removeStep', id: 'pay', index: 0 }, // the mode on step 2 of pay moves to step 1
  { op: 'deleteObject', id: 'cache' }, // a mode sits on it
  { op: 'deleteObject', id: 'mail' },
  { op: 'deleteObject', id: 'api' },
  { op: 'deleteWith', targets: [{ object: 'cache' }], resolutions: [] },
  { op: 'deleteWith', targets: [{ object: 'cache' }], resolutions: [{ key: 'mode:ordering:cache-cold:on', action: 'removeMode' }] }, // its states, its line and its affects entry go along
  { op: 'deleteWith', targets: [{ object: 'db' }], resolutions: [{ key: 'step:checkout:3', action: 'changeView' }, { key: 'mode:ordering:db-down:on', action: 'removeMode' }] },
  { op: 'deleteWith', targets: [{ object: 'db' }], resolutions: [{ key: 'step:checkout:3', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'db' }] },
  { op: 'deleteWith', targets: [{ object: 'db' }], resolutions: [{ key: 'step:checkout:3', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'nowhere' }] },
  { op: 'deleteWith', targets: [{ object: 'db' }], resolutions: [{ key: 'step:checkout:3', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'web' }, { key: 'step:checkout:9', action: 'removeStep' }] },
  { op: 'deleteWith', targets: [{ object: 'db' }], resolutions: [{ key: 'step:checkout:3', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'web' }] }, // the steps after it move up a number
  { op: 'deleteWith', targets: [{ line: { from: 'api', to: 'mail', label: 'sends receipts' } }], resolutions: [] },
  { op: 'deleteWith', targets: [{ line: { from: 'api', to: 'mail', label: 'second' } }], resolutions: [] }, // the mode on that line has nothing left
  { op: 'deleteWith', targets: [{ line: { from: 'api', to: 'mail', label: 'second' } }], resolutions: [{ key: 'mode:ordering:mail-late:line', action: 'removeMode' }] },
  { op: 'deleteWith', targets: [{ line: { from: 'api', to: 'nowhere' } }], resolutions: [] },
  { op: 'deleteWith', targets: [{ object: 'mail' }], resolutions: [{ key: 'step:checkout:3', action: 'reroute', to: 'web' }, { key: 'step:solo:1', action: 'removeStep' }] }, // that would leave solo with no steps
  { op: 'deleteWith', targets: [{ object: 'mail' }], resolutions: [{ key: 'step:checkout:3', action: 'reroute', to: 'web' }, { key: 'step:solo:1', action: 'deleteFlow' }, { key: 'start:checkout', action: 'removeStep' }] },
  { op: 'deleteWith', targets: [{ object: 'mail' }], resolutions: [{ key: 'step:checkout:3', action: 'reroute', to: 'web' }, { key: 'step:solo:1', action: 'deleteFlow' }] },
  { op: 'deleteWith', targets: [{ object: 'api' }], resolutions: [{ key: 'child:auth', action: 'deleteWith' }, { key: 'step:checkout:2', action: 'removeStep' }, { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:1', action: 'removeStep' }, { key: 'mode:ordering:api-slow:on', action: 'removeMode' }] }, // that would leave pay with no steps
  { op: 'deleteWith', targets: [{ object: 'api' }], resolutions: [{ key: 'child:auth', action: 'deleteWith' }, { key: 'step:checkout:2', action: 'removeStep' }, { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:1', action: 'deleteFlow' }, { key: 'mode:ordering:api-slow:on', action: 'removeMode' }] },
  { op: 'putObject', id: 'store2', type: 'system', name: 'Store 2' },
  { op: 'deleteWith', targets: [{ object: 'shop' }], resolutions: [{ key: 'view:checkout', action: 'changeView', to: 'nowhere' }, { key: 'child:web', action: 'moveOut' }] },
  { op: 'deleteWith', targets: [{ object: 'shop' }], resolutions: [{ key: 'view:checkout', action: 'changeView' }, { key: 'scope:ordering', action: 'changeScope' }, { key: 'child:web', action: 'moveOut' }] }, // web can't stand outside a system
  { op: 'deleteWith', targets: [{ object: 'shop' }], resolutions: [{ key: 'view:checkout', action: 'changeView' }, { key: 'scope:ordering', action: 'changeScope' }, { key: 'child:web', action: 'moveOut', to: 'store2' }] },
]

function apply(model: Model, s: Spec): Model {
  switch (s.op) {
    case 'putObject': {
      const { op: _, ...input } = s
      return putObject(model, input as ObjectInput)
    }
    case 'deleteObject': return deleteObject(model, s.id)
    case 'deleteObjects': return deleteObjects(model, s.ids)
    case 'deleteWith': return deleteWith(model, s.targets, s.resolutions)
    case 'connect': return connect(model, { from: s.from, to: s.to, label: s.label })
    case 'removeConnection': return removeConnection(model, { from: s.from, to: s.to, label: s.which })
    case 'relabel': return relabel(model, { from: s.from, to: s.to, label: s.which }, s.label)
    case 'putFlow': return putFlow(model, { id: s.id, name: s.name, view: s.view, steps: s.steps as Step[], ...(s.groups === undefined ? {} : { groups: s.groups }), ...(s.states === undefined ? {} : { states: s.states }) })
    case 'setCompare': return setCompare(model, s.id, s.with === undefined ? undefined : s.note === undefined ? { with: s.with } : { with: s.with, note: s.note })
    case 'updateFlow': return updateFlow(model, s.id, { ...(s.name === undefined ? {} : { name: s.name }), ...(s.steps === undefined ? {} : { steps: s.steps as Step[] }), ...(s.groups === undefined ? {} : { groups: s.groups }) })
    case 'removeStep': return removeStep(model, s.id, s.index)
    case 'putGroup': return putGroup(model, s.id, s.group, s.options)
    case 'removeGroup': return removeGroup(model, s.id, s.group)
    case 'setStepGroup': return setStepGroup(model, s.id, s.index, s.group)
    case 'setStepAnimation': return setStepAnimation(model, s.id, s.index, s.animation)
    case 'setStepStates': return setStepStates(model, s.id, s.index, s.states)
    case 'setGroupKind': return setGroupKind(model, s.id, s.group, s.kind)
    case 'groupSteps': return groupSteps(model, s.id, s.group, s.kind, s.first, s.last)
    case 'deleteFlow': return deleteFlow(model, s.id)
    case 'placeBoxes': return placeBoxes(model, s.view, s.boxes)
    case 'setLines': return setLines(model, s.style)
    case 'setProject': return setProject(model, { name: s.name, about: s.about })
    case 'forgetLayout': return forgetLayout(model, s.view)
    default: throw new Error(`unknown op ${s.op}`)
  }
}

const filesOf = (m: Model) => ({ ...modelFiles(m), 'layout.yaml': serializeLayout(m.layout) })

/** What each edit of a script writes or says, starting from a folder. An edit that is refused changes nothing, as in the app. */
async function run(dir: string, steps: Spec[]): Promise<{ initial: Record<string, string>; results: unknown[] }> {
  const state = await loadState(dir)
  if ('parseError' in state) throw new Error(`${dir} can't be read`)
  let model: Model = modelOf(state)
  const initial = filesOf(model)
  const results = steps.map(spec => {
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
  return { initial, results }
}

/** The folders the edits start from, as files, and what each edit writes or says. */
export async function dumpOps(): Promise<unknown> {
  const dir = join(root, 'desktop/fixtures/cases/edit/flowy')
  const state = await loadState(dir)
  if ('parseError' in state) throw new Error("the edit case can't be read")
  const { initial, results } = await run(dir, STEPS)
  const names = ['Orders DB', 'orders db', 'Café Étoile', 'Naïve  Résumé', '日本語', '---', 'x'.repeat(100), '  Spaces  ', 'What?!', '1st place', 'API', 'api', 'Ünïcödé 2', 'a/b\c', '']
  const ids = names.flatMap(name => [[], ['orders-db', 'orders-db-2', 'API']].map(taken => ({ name, taken, id: newId(name, taken, 'component') })))
  const start: Model = modelOf(state)
  const types = [ROOT, ...Object.keys(start.objects), 'nowhere'].map(view => ({ view, types: typesIn(start, view) }))
  return { initial, results, ids, types, remove: await run(join(root, 'desktop/fixtures/cases/delete/flowy'), DELETE_STEPS) }
}
