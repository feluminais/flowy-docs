import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextOf, dispatch, helpRows, HELP_GROUPS, keyOf, KEYMAP, match } from '../ui/src/keymap.ts'
import type { KeyActions, KeyEvent, KeyState } from '../ui/src/keymap.ts'

/** A key press: a plain one unless told otherwise. `key` is what was typed, `code` the key's place on a US keyboard. */
const press = (key: string, more: Partial<KeyEvent> = {}): KeyEvent => ({
  key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: null, ...more,
})

const nothing: KeyState = {
  editing: false, justMoved: false, shortcuts: false, navigatorOpen: false, navigatorUsed: false, flow: false, compare: false, swap: false, runCompare: false, halfStep: false, panel: false, inside: false, recording: false,
  perfOpen: false, failuresOpen: false, analysis: false, readOnly: false, showFlows: false, showYaml: false, canPerf: false,
}

/** Actions that only write down their name (and what they were asked), so a test can say which one a key reached. */
function recorder(): { act: KeyActions; calls: string[] } {
  const calls: string[] = []
  const act = new Proxy({}, {
    get: (_, name: string) => (...args: unknown[]) => {
      calls.push(args.length === 0 ? name : `${name}(${args.join(',')})`)
      return name === 'enter' ? true : undefined
    },
  }) as KeyActions
  return { act, calls }
}

/** Which entry a key reaches, and what it did. */
function reach(e: KeyEvent, s: Partial<KeyState> = {}, inNavigator = false) {
  const { act, calls } = recorder()
  const ctx = contextOf(e, inNavigator, { ...nothing, ...s }, act)
  const hit = match(ctx)
  return { id: hit?.id, calls, handled: hit ? dispatch(ctx) : false }
}
const idOf = (e: KeyEvent, s: Partial<KeyState> = {}) => reach(e, s).id

test('every entry has its own name', () => {
  const ids = KEYMAP.map(k => k.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('single letters need a plain press, and most ignore a key held down', () => {
  assert.equal(idOf(press('e')), 'edit')
  assert.equal(idOf(press('e', { repeat: true })), undefined)
  assert.equal(idOf(press('e', { ctrlKey: true })), undefined)
  assert.equal(idOf(press('e', { altKey: true })), undefined)
  assert.equal(idOf(press('e'), { readOnly: true }), undefined, 'a page that cannot edit has no E')
  assert.equal(idOf(press('f')), 'fit')
  assert.equal(idOf(press('f', { repeat: true })), 'fit', 'F may repeat')
  assert.equal(idOf(press('f', { metaKey: true })), undefined)
  assert.equal(idOf(press('o')), 'explorer')
  assert.equal(idOf(press('o', { repeat: true })), undefined)
})

test('a tab key only works where the tab is', () => {
  assert.equal(idOf(press('l')), undefined)
  assert.equal(idOf(press('l'), { showFlows: true }), 'flows')
  assert.equal(idOf(press('y')), undefined)
  assert.equal(idOf(press('y'), { showYaml: true }), 'yaml')
  assert.equal(idOf(press('t')), undefined)
  assert.equal(idOf(press('t'), { canPerf: true }), 'perf')
  assert.equal(idOf(press('m')), 'failures') // always there: with no analysis its panel offers to make one
})

test('a key on another layout means the Latin letter on the same key', () => {
  assert.equal(idOf(press('у', { code: 'KeyE' })), 'edit') // Ukrainian
  assert.equal(idOf(press('я', { code: 'KeyZ' }), { inside: true }), 'up')
})

test('find: Ctrl+K, Cmd+K, / and the slash key; ? opens the list instead', () => {
  assert.equal(idOf(press('k', { ctrlKey: true })), 'search')
  assert.equal(idOf(press('k', { metaKey: true })), 'search')
  assert.equal(idOf(press('k')), undefined)
  assert.equal(idOf(press('/', { code: 'Slash' })), 'search')
  assert.equal(idOf(press('.', { code: 'Slash' })), 'search', 'a layout that types something else on the slash key')
  assert.equal(idOf(press('?', { code: 'Slash', shiftKey: true })), 'shortcuts')
  assert.equal(idOf(press('?', { code: 'Slash' })), 'shortcuts', 'some layouts type ? on that key without Shift: ? comes first')
  assert.equal(idOf(press('.', { code: 'Slash', shiftKey: true })), undefined)
})

test('Escape peels one layer per press, in escapeStep order', () => {
  const all = { shortcuts: true, navigatorOpen: true, navigatorUsed: true, flow: true, halfStep: true, recording: true, panel: true, inside: true }
  const esc = press('Escape')
  let r = reach(esc, all)
  assert.deepEqual([r.id, r.calls], ['escape', ['closeShortcuts']])
  r = reach(esc, { ...all, shortcuts: false })
  assert.deepEqual(r.calls, ['closeNavigator'])
  r = reach(esc, { ...all, shortcuts: false, navigatorUsed: false })
  assert.deepEqual(r.calls, ['stopFlow'], 'the last click was in the diagram: the navigator is left open')
  r = reach(esc, { ...all, shortcuts: false, navigatorUsed: false }, true)
  assert.deepEqual(r.calls, ['closeNavigator'], 'the key came from inside the navigator')
  r = reach(esc, { ...all, shortcuts: false, navigatorOpen: false, flow: false })
  assert.deepEqual(r.calls, ['clearStep'])
  r = reach(esc, { ...all, shortcuts: false, navigatorOpen: false, flow: false, halfStep: false })
  assert.deepEqual(r.calls, ['closePanel'])
  r = reach(esc, { ...nothing, compare: true, inside: true })
  assert.deepEqual(r.calls, ['closeCompare'], 'a comparison closes before the level is left')
  r = reach(esc, { ...nothing, compare: true, panel: true })
  assert.deepEqual(r.calls, ['closePanel'], 'the panel over a comparison goes first')
  r = reach(esc, { ...nothing, inside: true })
  assert.deepEqual(r.calls, ['up'])
  assert.deepEqual(reach(esc, { navigatorUsed: true }).calls, [], 'a navigator that is not open is not closed')
})

test('Escape with nothing to close is handled by nobody: the browser keeps it', () => {
  const r = reach(press('Escape'))
  assert.equal(r.id, 'escape', 'it still stops the chain')
  assert.equal(r.handled, false)
  assert.deepEqual(r.calls, [])
})

test('a half-recorded step is cleared only when a flow is being recorded', () => {
  assert.deepEqual(reach(press('Escape'), { halfStep: true }).calls, [], 'no recording: nothing to clear')
  assert.deepEqual(reach(press('Escape'), { halfStep: true, recording: true }).calls, ['clearStep'])
})

test('right after a drag, Esc and Backspace take it back, ahead of everything else', () => {
  const dragged = { editing: true, justMoved: true, panel: true, inside: true, flow: true }
  assert.equal(idOf(press('Escape'), dragged), 'undo-move')
  assert.equal(idOf(press('Backspace'), dragged), 'undo-move')
  assert.equal(idOf(press('Backspace', { ctrlKey: true }), dragged), 'up', 'Ctrl+Backspace is not it')
  assert.equal(idOf(press('Escape'), { ...dragged, shortcuts: true }), 'escape', 'the list closes first')
  assert.equal(idOf(press('Escape'), { ...dragged, justMoved: false }), 'escape')
  assert.equal(idOf(press('Escape'), { ...dragged, editing: false }), 'escape')
  assert.equal(idOf(press('z'), dragged), 'up', 'Z is for zooming out')
  assert.deepEqual(reach(press('Escape'), dragged).calls, ['takeBack'])
})

test('a load-test run takes the arrows, Home, End and P before a flow or the failures', () => {
  const perf = { perfOpen: true, flow: true, failuresOpen: true, analysis: true }
  assert.equal(idOf(press('ArrowRight'), perf), 'perf-step')
  assert.equal(idOf(press('ArrowLeft'), perf), 'perf-step')
  assert.equal(idOf(press('Home'), perf), 'perf-ends')
  assert.equal(idOf(press('End'), perf), 'perf-ends')
  assert.equal(idOf(press('p'), perf), 'perf-ramp')
  assert.equal(idOf(press('p', { repeat: true }), perf), undefined, 'P does not repeat')
  assert.equal(idOf(press('p', { ctrlKey: true }), perf), undefined)
  assert.deepEqual(reach(press('ArrowRight'), perf).calls, ['stepRun(1)'])
  assert.deepEqual(reach(press('ArrowLeft'), perf).calls, ['stepRun(-1)'])
  assert.deepEqual(reach(press('Home'), perf).calls, ['runEnd(first)'])
  assert.deepEqual(reach(press('End'), perf).calls, ['runEnd(last)'])
  assert.deepEqual(reach(press('p'), perf).calls, ['ramp'])
})

test('the arrows step the failures list, but not while editing (they nudge a picked shape there)', () => {
  const failing = { failuresOpen: true, analysis: true }
  assert.equal(idOf(press('ArrowRight'), failing), 'failure-step')
  assert.equal(idOf(press('ArrowLeft'), failing), 'failure-step')
  assert.equal(idOf(press('Home'), failing), undefined, 'Home is not for the list')
  assert.equal(idOf(press('ArrowRight'), { ...failing, editing: true }), undefined)
  assert.equal(idOf(press('ArrowRight'), { ...failing, analysis: false }), undefined, 'no analysis to step through')
  assert.equal(idOf(press('ArrowRight'), { ...failing, flow: true }), 'failure-step', 'the list comes before a flow')
  assert.deepEqual(reach(press('ArrowRight'), failing).calls, ['stepFailure(1)'])
  assert.deepEqual(reach(press('ArrowLeft'), failing).calls, ['stepFailure(-1)'])
})

test('a flow playing takes the arrows, Home, End, P and R', () => {
  const flow = { flow: true }
  assert.equal(idOf(press('ArrowRight'), flow), 'flow-step')
  assert.equal(idOf(press('ArrowLeft'), flow), 'flow-step')
  assert.equal(idOf(press('Home'), flow), 'flow-ends')
  assert.equal(idOf(press('End'), flow), 'flow-ends')
  assert.equal(idOf(press('p'), flow), 'flow-play')
  assert.equal(idOf(press('r'), flow), 'flow-replay')
  assert.equal(idOf(press('r', { repeat: true }), flow), undefined)
  assert.equal(idOf(press('r')), undefined, 'no flow, no R')
  assert.equal(idOf(press('ArrowRight')), undefined)
  assert.deepEqual(reach(press('ArrowRight'), flow).calls, ['stepFlow(1)'])
  assert.deepEqual(reach(press('ArrowLeft'), flow).calls, ['stepFlow(-1)'])
  assert.deepEqual(reach(press('Home'), flow).calls, ['flowEnd(first)'])
  assert.deepEqual(reach(press('End'), flow).calls, ['flowEnd(last)'])
  assert.deepEqual(reach(press('p'), flow).calls, ['play'])
  assert.deepEqual(reach(press('r'), flow).calls, ['replay'])
})

test('C compares the flow playing, or closes the comparison, and is taken in edit mode to say why it does nothing', () => {
  assert.equal(idOf(press('c')), undefined, 'no flow, no comparison')
  assert.equal(idOf(press('c'), { flow: true }), 'compare')
  assert.equal(idOf(press('c'), { compare: true }), 'compare')
  assert.equal(idOf(press('c'), { editing: true }), 'compare')
  assert.equal(idOf(press('c', { repeat: true }), { flow: true }), undefined)
  assert.equal(idOf(press('c', { ctrlKey: true }), { flow: true }), undefined, "Ctrl+C is the browser's copy")
  assert.equal(idOf(press('с', { code: 'KeyC' }), { flow: true }), 'compare', 'a Cyrillic layout')
  assert.deepEqual(reach(press('c'), { flow: true }).calls, ['compare'])
  assert.deepEqual(reach(press('c')).calls, [])
})

test('with two flows side by side, the keys of a flow reach the actions that act on the pane last clicked', () => {
  const side = { compare: true }
  assert.equal(idOf(press('ArrowRight'), side), 'flow-step')
  assert.equal(idOf(press('Home'), side), 'flow-ends')
  assert.equal(idOf(press('p'), side), 'flow-play')
  assert.equal(idOf(press('r'), side), 'flow-replay')
  assert.deepEqual(reach(press('ArrowLeft'), side).calls, ['stepFlow(-1)'])
  assert.deepEqual(reach(press('End'), side).calls, ['flowEnd(last)'])
  assert.deepEqual(reach(press('p'), side).calls, ['play'])
  assert.deepEqual(reach(press('r'), side).calls, ['replay'])
  assert.deepEqual(reach(press('f'), side).calls, ['fit'], 'F fits the pane too')
  assert.equal(idOf(press('ArrowRight')), undefined, 'no flow and no comparison: nothing to step')
  assert.equal(idOf(press('ArrowRight'), { ...side, perfOpen: true }), 'perf-step', 'a load-test run still comes first')
})

test('with two runs compared, the keys of the Performance tab reach the actions that act on the pane last clicked, and a flow has none', () => {
  const runs = { compare: true, runCompare: true }
  assert.equal(idOf(press('ArrowRight'), runs), 'perf-step')
  assert.equal(idOf(press('Home'), runs), 'perf-ends')
  assert.equal(idOf(press('p'), runs), 'perf-ramp')
  assert.deepEqual(reach(press('ArrowLeft'), runs).calls, ['stepRun(-1)'])
  assert.deepEqual(reach(press('End'), runs).calls, ['runEnd(last)'])
  assert.deepEqual(reach(press('p'), runs).calls, ['ramp'])
  assert.deepEqual(reach(press('f'), runs).calls, ['fit'], 'F fits the pane')
  assert.equal(idOf(press('r'), runs), undefined, 'two runs have no step to replay')
  assert.equal(idOf(press('c'), runs), 'compare', 'C closes the comparison')
  assert.equal(idOf(press('x'), { ...runs, swap: true }), 'swap', 'X swaps in Swap')
  assert.equal(idOf(press('ArrowRight'), { ...runs, swap: true }), 'perf-step', 'the keys of a run still work in Swap')
})

test('C on the Performance tab compares the run it shows', () => {
  assert.equal(idOf(press('c'), { perfOpen: true }), 'compare')
  assert.deepEqual(reach(press('c'), { perfOpen: true }).calls, ['compare'])
  assert.equal(idOf(press('c')), undefined, 'nothing to compare when no run or flow is on show')
})

test('X swaps the flow on show, only in a comparison set to Swap', () => {
  const swap = { compare: true, swap: true }
  assert.equal(idOf(press('x'), swap), 'swap')
  assert.deepEqual(reach(press('x'), swap).calls, ['swap'])
  assert.equal(idOf(press('x', { code: 'KeyX', key: 'ч' }), swap), 'swap', 'a Cyrillic layout')
  assert.equal(idOf(press('x'), { compare: true }), undefined, 'side by side leaves X to the browser')
  assert.equal(reach(press('x'), { compare: true }).handled, false)
  assert.equal(idOf(press('x'), { flow: true }), undefined, 'a single flow has nothing to swap')
  assert.equal(idOf(press('x')), undefined)
  assert.equal(idOf(press('x', { repeat: true }), swap), undefined, 'a held key does not flip back and forth')
  assert.equal(idOf(press('x', { ctrlKey: true }), swap), undefined, "Ctrl+X is the browser's cut")
  assert.equal(idOf(press('x', { altKey: true }), swap), undefined)
  assert.equal(idOf(press('ArrowRight'), swap), 'flow-step', 'the keys of a flow still work in Swap')
})

test('Enter opens the box in focus, unless a button, link or summary has it, or a flow is being recorded', () => {
  const button = { closest: (selector: string) => (selector.includes('button') ? {} : null) }
  const box = { closest: () => null }
  assert.equal(idOf(press('Enter', { target: box as unknown as EventTarget })), 'enter')
  assert.equal(idOf(press('Enter', { target: button as unknown as EventTarget })), undefined)
  assert.equal(idOf(press('Enter'), { recording: true }), undefined)
  assert.equal(idOf(press('Enter', { target: box as unknown as EventTarget }), { recording: true }), undefined)
})

test('Enter with no box to open is handled by nobody', () => {
  const { act } = recorder()
  const refuses = { ...act, enter: () => false } as KeyActions
  const ctx = contextOf(press('Enter'), false, nothing, refuses)
  assert.equal(match(ctx)?.id, 'enter')
  assert.equal(dispatch(ctx), false)
})

test('Z and Backspace go up a level, from inside one and not while recording', () => {
  assert.equal(idOf(press('z'), { inside: true }), 'up')
  assert.equal(idOf(press('Backspace'), { inside: true }), 'up')
  assert.equal(idOf(press('Backspace', { ctrlKey: true }), { inside: true }), 'up', 'Backspace does not mind modifiers')
  assert.equal(idOf(press('z', { ctrlKey: true }), { inside: true }), undefined)
  assert.equal(idOf(press('z')), undefined, 'at the top there is nowhere to go')
  assert.equal(idOf(press('z'), { inside: true, recording: true }), undefined)
  assert.equal(idOf(press('Backspace'), { inside: true, recording: true }), undefined)
})

test('edit keys work only while editing', () => {
  const edit = { editing: true }
  assert.equal(idOf(press('n')), undefined)
  assert.equal(idOf(press('n'), edit), 'add')
  assert.equal(idOf(press('n'), { ...edit, recording: true }), undefined)
  assert.equal(idOf(press('Delete')), undefined)
  assert.equal(idOf(press('Delete'), edit), 'delete')
  assert.equal(idOf(press('a', { ctrlKey: true }), edit), 'select-all')
  assert.equal(idOf(press('a', { metaKey: true }), edit), 'select-all')
  assert.equal(idOf(press('a', { ctrlKey: true }), { ...edit, recording: true }), undefined)
  assert.equal(idOf(press('a', { ctrlKey: true })), undefined)
})

test('undo and redo: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, not held down, not outside edit mode', () => {
  const edit = { editing: true }
  assert.equal(idOf(press('z', { ctrlKey: true }), edit), 'undo')
  assert.equal(idOf(press('z', { metaKey: true }), edit), 'undo')
  assert.equal(idOf(press('z', { ctrlKey: true, shiftKey: true }), edit), 'redo')
  assert.equal(idOf(press('y', { ctrlKey: true }), edit), 'redo')
  assert.equal(idOf(press('z', { ctrlKey: true, repeat: true }), edit), undefined, 'held down it would run through the whole stack')
  assert.equal(idOf(press('z', { ctrlKey: true })), undefined)
  assert.equal(idOf(press('z'), { ...edit, inside: true }), 'up', 'plain Z zooms out even in edit mode')
})

test('the keys reach the actions they name', () => {
  assert.deepEqual(reach(press('?')).calls, ['toggleShortcuts'])
  assert.deepEqual(reach(press('k', { ctrlKey: true })).calls, ['search'])
  assert.deepEqual(reach(press('f')).calls, ['fit'])
  assert.deepEqual(reach(press('l'), { showFlows: true }).calls, ['toggleTab(flows)'])
  assert.deepEqual(reach(press('o')).calls, ['toggleTab(explorer)'])
  assert.deepEqual(reach(press('y'), { showYaml: true }).calls, ['toggleTab(yaml)'])
  assert.deepEqual(reach(press('t'), { canPerf: true }).calls, ['togglePerf'])
  assert.deepEqual(reach(press('m')).calls, ['toggleFailures'])
  assert.deepEqual(reach(press('e')).calls, ['toggleEdit'])
  const edit = { editing: true }
  assert.deepEqual(reach(press('n'), edit).calls, ['add'])
  assert.deepEqual(reach(press('Delete'), edit).calls, ['remove'])
  assert.deepEqual(reach(press('a', { ctrlKey: true }), edit).calls, ['selectAll'])
  assert.deepEqual(reach(press('z', { ctrlKey: true }), edit).calls, ['takeBack'])
  assert.deepEqual(reach(press('y', { ctrlKey: true }), edit).calls, ['bringBack'])
  assert.deepEqual(reach(press('z'), { inside: true }).calls, ['up'])
})

test('a key nothing wants is left to the browser', () => {
  assert.equal(reach(press('q')).handled, false)
  assert.equal(reach(press('e')).handled, true)
})

// The list ? opens, pinned word for word.
test('the shortcut list says what it said before the table was built from the key map', () => {
  assert.deepEqual(HELP_GROUPS.map(g => g.title), ['Getting around', 'Flows', 'Performance', 'Failures', 'Edit mode'])
  const rows = Object.fromEntries(HELP_GROUPS.map(g => [g.id, helpRows(g.id)]))
  assert.deepEqual(rows.reading, [
    ['Enter', 'Open the selected shape'],
    ['Esc', "Close what's open, then go up a level. The navigator closes only if your last click was in it"],
    ['Backspace  Z', 'Zoom out: go up a level'],
    ['Ctrl+K  /', 'Find a shape'],
    ['F', 'Fit the view'],
    ['L', 'Show every flow, and play one'],
    ['O', 'Show everything as a tree'],
    ['Y', 'The files as YAML, and what changed'],
    ['T', 'Show a load-test run on the diagram, where there is one'],
    ['M', 'Show how things fail, worst first'],
    ['?', 'Show these shortcuts'],
  ])
  assert.deepEqual(rows.flows, [
    ['→  ←', 'Next and previous step'],
    ['Home  End', 'First and last step'],
    ['P', 'Step through the flow on its own, or pause'],
    ['R', 'Replay the step'],
    ['C', 'Compare with another flow, or close the comparison'],
    ['X', 'Swap to the other flow of a comparison'],
    ['Esc', 'Stop the flow'],
  ])
  assert.deepEqual(rows.performance, [
    ['→  ←', 'Next and previous tested level'],
    ['Home  End', 'First and last tested level'],
    ['P', 'Ramp the load or play the time, or pause'],
    ['Esc', 'Close the panel'],
  ])
  assert.deepEqual(rows.failures, [['→  ←', 'Next and previous failure']])
  assert.deepEqual(rows.editing, [
    ['E', 'Edit mode on and off'],
    ['N', 'Add a shape'],
    ['Ctrl+click  Shift+click', 'Add a shape to the selection, or take it out'],
    ['Shift+drag', 'Draw a box round shapes to select them'],
    ['Ctrl+A', 'Select every shape in this view'],
    ['Delete', 'Delete the selected shapes or line'],
    ['Ctrl+Z', 'Undo'],
    ['Esc  Backspace', 'Straight after dragging a shape: take the drag back'],
    ['Ctrl+Y  Ctrl+Shift+Z', 'Redo'],
  ])
})

test('the rail buttons show the keys of the entries they stand for', () => {
  assert.equal(keyOf('explorer'), 'O')
  assert.equal(keyOf('flows'), 'L')
  assert.equal(keyOf('failures'), 'M')
  assert.equal(keyOf('yaml'), 'Y')
  assert.equal(keyOf('perf'), 'T')
})
