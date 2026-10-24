import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Flow, FlowyObject, Model } from '../src/core/model.ts'
import type { Run } from '../src/core/perf/types.ts'
import { nameOf } from '../src/core/views.ts'
import { diffFlows } from '../src/core/flowdiff.ts'
import type { FlowDiff } from '../src/core/flowdiff.ts'
import { CHANGE_NAMES, changeOfStop, choicesFor, compareOff, draftKey, firstLinked, firstLinkedRun, flipped, fromAddress, keepsDrafts, keyItems, linkedRuns, marksFor, noteOf, noteOff, orderPair, paneInside, paneLevel, paneUp, pairKey, pairOf, pairOff, partnerChoices, playable, removeNeedsConfirm, runCompareOff, runPairOf, samePick, saveTarget, taggedBy, tagWith, unsaved, withDraft } from '../ui/src/compare.ts'
import type { Compare, Drafts } from '../ui/src/compare.ts'

const flow = (name: string, compare?: unknown): Flow => ({ name, view: 'root', steps: [], ...(compare === undefined ? {} : { compare }) })
const run = (name: string, compare?: Run['compare']): Run => ({ name, unit: 'req/s', levels: [], ...(compare === undefined ? {} : { compare }) })
const modelOf = (flows: Record<string, Flow>) => ({ ...emptyModel(), flows })

test('choices for a flow list what it tags first, then what tags it, then the rest by name', () => {
  const model = modelOf({
    old: flow('Refund, old'),
    now: flow('Refund, now', 'old'),
    later: flow('Refund, later', { with: 'now', note: 'x' }),
    beta: flow('beta'),
    Alpha: flow('Alpha'),
    zed: flow('Zed'),
  })
  const { linked, others } = choicesFor(model, {}, 'flow', 'now')
  assert.deepEqual(linked, [{ id: 'old', name: 'Refund, old', side: 'before' }, { id: 'later', name: 'Refund, later', side: 'after' }])
  assert.deepEqual(others.map(c => c.id), ['Alpha', 'beta', 'zed'], 'by name, ignoring case')
  assert.ok(others.every(c => c.side === undefined && c.missing === undefined))
})

test('the id itself is never listed, even when it tags itself', () => {
  const model = modelOf({ a: flow('A', 'a'), b: flow('B') })
  const { linked, others } = choicesFor(model, {}, 'flow', 'a')
  assert.deepEqual(linked, [])
  assert.deepEqual(others, [{ id: 'b', name: 'B' }])
})

test('a tag to a flow that is not there stays, marked missing, with the id as its name', () => {
  const model = modelOf({ a: flow('A', 'gone'), b: flow('B') })
  const { linked, others } = choicesFor(model, {}, 'flow', 'a')
  assert.deepEqual(linked, [{ id: 'gone', name: 'gone', side: 'before', missing: true }])
  assert.deepEqual(others.map(c => c.id), ['b'])
})

test('a pair that tag each other lists once, and a flow tagged by many lists them all', () => {
  const mutual = modelOf({ a: flow('A', 'b'), b: flow('B', 'a') })
  assert.deepEqual(choicesFor(mutual, {}, 'flow', 'a').linked, [{ id: 'b', name: 'B', side: 'before' }])
  const many = modelOf({ base: flow('Base'), x: flow('X', 'base'), y: flow('Y', 'base'), z: flow('Z', 'base') })
  assert.deepEqual(choicesFor(many, {}, 'flow', 'base').linked.map(c => c.id), ['x', 'y', 'z'])
  assert.deepEqual(choicesFor(many, {}, 'flow', 'base').others, [])
})

test('choices for a run read the runs, not the flows, and fall back to the id for a name', () => {
  const model = modelOf({ f: flow('F') })
  const runs = { slow: run('Slow gateway'), fast: run('Fast gateway', { with: 'slow' }), plain: run('Plain'), nameless: { ...run(''), name: undefined as unknown as string } }
  const { linked, others } = choicesFor(model, runs, 'run', 'slow')
  assert.deepEqual(linked, [{ id: 'fast', name: 'Fast gateway', side: 'after' }])
  assert.deepEqual(others, [{ id: 'nameless', name: 'nameless' }, { id: 'plain', name: 'Plain' }])
  assert.deepEqual(choicesFor(model, runs, 'flow', 'f'), { linked: [], others: [] })
})

test('the pair is ordered so the holder of the tag is second', () => {
  const flows = { old: flow('Old'), now: flow('Now', 'old'), other: flow('Other') }
  assert.deepEqual(orderPair('flow', flows, 'now', 'old'), ['old', 'now'])
  assert.deepEqual(orderPair('flow', flows, 'old', 'now'), ['old', 'now'])
  assert.deepEqual(orderPair('flow', flows, 'other', 'old'), ['other', 'old'], 'no tag between them: as given')
  assert.deepEqual(orderPair('flow', flows, 'old', 'other'), ['old', 'other'])
  const mutual = { a: flow('A', 'b'), b: flow('B', 'a') }
  assert.deepEqual(orderPair('flow', mutual, 'a', 'b'), ['b', 'a'], 'a tags b: a is second')
  assert.deepEqual(orderPair('run', { r1: run('R1'), r2: run('R2', { with: 'r1' }) }, 'r2', 'r1'), ['r1', 'r2'])
  assert.deepEqual(orderPair('flow', flows, 'now', 'now'), ['now', 'now'])
})

const plays = (name: string, compare?: unknown): Flow => ({ ...flow(name, compare), steps: [{ from: 'a', to: 'b', text: 'Go' }] })

test('a flow plays when it has steps and its view opens', () => {
  const model = modelOf({ ok: plays('Ok'), empty: flow('Empty'), lost: { ...plays('Lost'), view: 'nowhere' } })
  assert.equal(playable(model, 'ok'), true)
  assert.equal(playable(model, 'empty'), false)
  assert.equal(playable(model, 'lost'), false)
  assert.equal(playable(model, 'missing'), false)
  assert.equal(playable(model, '__proto__'), false, 'a key the object inherits is no flow')
})

test('Compare is blocked while editing and with no other flow, and the reason is the tooltip', () => {
  const two = modelOf({ a: plays('A'), b: plays('B') })
  assert.equal(compareOff(two, false), undefined)
  assert.equal(compareOff(two, true), 'Not while editing')
  assert.equal(compareOff(modelOf({ a: plays('A') }), false), 'No other flow')
  assert.equal(compareOff(modelOf({ a: plays('A') }), true), 'Not while editing', 'editing is the first reason')
})

test('C offers the first linked flow that is there, else nothing', () => {
  const model = modelOf({ old: plays('Old'), now: plays('Now', 'old'), later: plays('Later', 'now'), alone: plays('Alone') })
  assert.equal(firstLinked(model, 'now'), 'old')
  assert.equal(firstLinked(model, 'old'), 'now')
  assert.equal(firstLinked(model, 'alone'), undefined, 'not linked: the picker opens instead')
  assert.equal(firstLinked(modelOf({ a: plays('A', 'gone'), b: plays('B', 'a') }), 'a'), 'b', 'a missing tag is skipped')
  assert.equal(firstLinked(modelOf({ a: plays('A', 'gone') }), 'a'), undefined)
})

test('the pick is ordered so the holder of the tag is second', () => {
  const model = modelOf({ old: plays('Old'), now: plays('Now', 'old'), other: plays('Other') })
  assert.deepEqual(pairOf(model, 'now', 'old'), { kind: 'flow', a: 'old', b: 'now', mode: 'side' })
  assert.deepEqual(pairOf(model, 'other', 'old'), { kind: 'flow', a: 'other', b: 'old', mode: 'side' })
  assert.deepEqual(pairOf(model, 'now', 'now'), { kind: 'flow', a: 'now', b: 'now', mode: 'side' }, 'a flow with itself still draws both panes')
})

test('an address opens a comparison of two flows that play, in the mode it names', () => {
  const model = modelOf({ a: plays('A'), b: plays('B'), empty: flow('Empty') })
  const named = (a: string, b: string, mode: Compare['mode'] = 'side', kind: Compare['kind'] = 'flow'): Compare => ({ kind, a, b, mode })
  const flows = (c: Compare | undefined) => fromAddress(model, {}, c)
  assert.deepEqual(flows(named('a', 'b')), { compare: named('a', 'b') })
  assert.deepEqual(flows(named('a', 'b', 'swap')), { compare: named('a', 'b', 'swap') }, 'the address keeps its mode')
  assert.deepEqual(flows(named('a', 'a')), { compare: named('a', 'a') })
  assert.deepEqual(flows(named('a', 'empty')), { notice: "That flow can't play yet." })
  assert.deepEqual(flows(named('a', 'gone')), { notice: "That flow can't play yet." })
  assert.deepEqual(flows(named('a', 'b', 'side', 'run')), { notice: "That run can't open." }, 'a run is not a flow: with no runs it is missing')
  assert.deepEqual(flows(undefined), {})
})

test('an address opens a comparison of two runs that are there, and says so when one is not', () => {
  const model = modelOf({})
  const runs = { slow: run('Slow'), fast: run('Fast', { with: 'slow' }) }
  const named = (a: string, b: string, mode: Compare['mode'] = 'side'): Compare => ({ kind: 'run', a, b, mode })
  assert.deepEqual(fromAddress(model, runs, named('slow', 'fast')), { compare: named('slow', 'fast') })
  assert.deepEqual(fromAddress(model, runs, named('slow', 'fast', 'swap')), { compare: named('slow', 'fast', 'swap') })
  assert.deepEqual(fromAddress(model, runs, named('slow', 'slow')), { compare: named('slow', 'slow') })
  assert.deepEqual(fromAddress(model, runs, named('slow', 'gone')), { notice: "That run can't open." })
  assert.deepEqual(fromAddress(model, runs, named('__proto__', 'fast')), { notice: "That run can't open." }, 'a key the object inherits is no run')
})

test('Compare on the Performance tab is blocked while editing and with no other run', () => {
  assert.equal(runCompareOff({ a: run('A'), b: run('B') }, false), undefined)
  assert.equal(runCompareOff({ a: run('A'), b: run('B') }, true), 'Not while editing')
  assert.equal(runCompareOff({ a: run('A') }, false), 'No other run')
})

test('C on a run offers the first run it is linked to that is there', () => {
  const model = modelOf({})
  const runs = { old: run('Old'), now: run('Now', { with: 'old' }), gone: run('Gone', { with: 'missing' }), alone: run('Alone') }
  assert.equal(firstLinkedRun(model, runs, 'now'), 'old')
  assert.equal(firstLinkedRun(model, runs, 'old'), 'now', 'the one that tags it')
  assert.equal(firstLinkedRun(model, runs, 'alone'), undefined, 'not linked: the picker opens instead')
  assert.equal(firstLinkedRun(model, runs, 'gone'), undefined, 'a tag to a run that is not there is skipped')
})

test('a run is marked linked when it tags a run that is there or one tags it', () => {
  const runs = { old: run('Old'), now: run('Now', { with: 'old' }), gone: run('Gone', { with: 'missing' }), alone: run('Alone'), self: run('Self', { with: 'self' }) }
  assert.deepEqual([...linkedRuns(runs)].sort(), ['now', 'old'])
  assert.deepEqual([...linkedRuns({})], [])
})

test('the pick of a run is ordered so the holder of the tag is second', () => {
  const runs = { old: run('Old'), now: run('Now', { with: 'old' }), other: run('Other') }
  assert.deepEqual(runPairOf(runs, 'now', 'old'), { kind: 'run', a: 'old', b: 'now', mode: 'side' })
  assert.deepEqual(runPairOf(runs, 'other', 'old'), { kind: 'run', a: 'other', b: 'old', mode: 'side' })
})

test('the two sides swap places and nothing else changes', () => {
  assert.deepEqual(flipped({ kind: 'flow', a: 'x', b: 'y', mode: 'side' }), { kind: 'flow', a: 'y', b: 'x', mode: 'side' })
})

test('a click on what the panel already shows is the same pick', () => {
  assert.equal(samePick({ kind: 'object', id: 'db' }, { kind: 'object', id: 'db' }), true)
  assert.equal(samePick({ kind: 'object', id: 'db' }, { kind: 'object', id: 'api' }), false)
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b', view: 'root' }, { kind: 'line', from: 'a', to: 'b', view: 'root' }), true)
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b', view: 'root' }, { kind: 'line', from: 'a', to: 'b', view: 'shop' }), false, 'the same ends in another view are another line')
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b' }, { kind: 'line', from: 'a', to: 'b', view: 'root' }), false)
  assert.equal(samePick({ kind: 'add' }, { kind: 'object', id: 'db' }), false)
  assert.equal(samePick(undefined, { kind: 'object', id: 'db' }), false)
})

const side = (marks: Partial<FlowDiff['older']> = {}): FlowDiff['older'] => ({ steps: {}, shapes: {}, lines: {}, ...marks })
const diffOf = (older: Partial<FlowDiff['older']>, newer: Partial<FlowDiff['older']>, related = true): FlowDiff => ({ related, older: side(older), newer: side(newer) })

test('the key lists the kinds on screen, New then Removed then Changed', () => {
  assert.deepEqual(keyItems(diffOf({}, { steps: { 2: 'new' }, shapes: { fee: 'changed' } })), { items: ['new', 'changed'], related: true })
  assert.deepEqual(keyItems(diffOf({ lines: { 'a b': 'removed' } }, { shapes: { b: 'changed' }, steps: { 0: 'new' } })).items, ['new', 'removed', 'changed'], 'either side counts, whatever the order they were found in')
  assert.deepEqual(keyItems(diffOf({ steps: { 1: 'removed' } }, {})).items, ['removed'], 'a kind on the older side alone still shows')
})

test('the key lists only the sides on screen', () => {
  const diff = diffOf({ shapes: { gone: 'removed' } }, { steps: { 0: 'new' } })
  assert.deepEqual(keyItems(diff, ['newer']).items, ['new'], 'Swap with the newer flow on show: no Removed')
  assert.deepEqual(keyItems(diff, ['older']).items, ['removed'])
  assert.deepEqual(keyItems(diff, ['older', 'newer']).items, ['new', 'removed'])
  assert.deepEqual(keyItems(diffOf({ shapes: { gone: 'removed' } }, {}), ['newer']), { items: [], related: true }, 'a mark on the older side alone gives nothing while only the newer shows')
  assert.deepEqual(keyItems(diffOf({}, {}, false), ['newer']), { items: [], related: false }, 'related comes straight from the diff')
})

test('a stop takes the mark of its steps, by file step number', () => {
  const changes = { 0: 'new', 2: 'removed', 3: 'changed' } as const
  assert.equal(changeOfStop([2], changes), 'removed', 'one marked step gives its kind')
  assert.equal(changeOfStop([0, 2], changes), 'changed', 'mixed kinds read as changed')
  assert.equal(changeOfStop([3, 3], changes), 'changed')
  assert.equal(changeOfStop([0, 1], changes), 'new', 'an unmarked step beside a marked one does not mix')
  assert.equal(changeOfStop([1], changes), undefined, 'no marks gives none')
  assert.equal(changeOfStop([], changes), undefined)
  assert.equal(changeOfStop([1], {}), undefined)
  assert.equal(changeOfStop([0], { 1: 'new' }), undefined, 'the numbers are file step numbers, not stops')
})

test('an empty diff has nothing in its key', () => {
  assert.deepEqual(keyItems(diffOf({}, {})), { items: [], related: true })
})

test('flows with nothing in common say so and list no kinds', () => {
  assert.deepEqual(keyItems(diffOf({}, {}, false)), { items: [], related: false })
  const a: Flow = { name: 'A', view: 'root', steps: [{ from: 'x', to: 'y', text: 'one' }] }
  const b: Flow = { name: 'B', view: 'root', steps: [{ from: 'p', to: 'q', text: 'two' }] }
  assert.deepEqual(keyItems(diffFlows(a, b)), { items: [], related: false }, 'never everything changed')
})

test('each side takes its own marks', () => {
  const diff = diffOf({ shapes: { gone: 'removed' } }, { shapes: { fresh: 'new' } })
  assert.equal(marksFor(diff, 'older'), diff.older)
  assert.equal(marksFor(diff, 'newer'), diff.newer)
  assert.deepEqual(marksFor(diff, 'newer').shapes, { fresh: 'new' })
})

test('the kinds have one name each', () => {
  assert.deepEqual(CHANGE_NAMES, { new: 'New', removed: 'Removed', changed: 'Changed' })
})

test('the note of a pair is the one its tag holds, whichever way round the pair is asked', () => {
  const flows = { old: flow('Old'), now: flow('Now', { with: 'old', note: 'After the fix' }), other: flow('Other') }
  assert.deepEqual(noteOf(flows, 'old', 'now'), { text: 'After the fix', holder: 'now' })
  assert.deepEqual(noteOf(flows, 'now', 'old'), { text: 'After the fix', holder: 'now' })
})

test('a tag without a note has a holder and no text; a pair without a tag has neither', () => {
  const flows = { old: flow('Old'), now: flow('Now', 'old'), other: flow('Other') }
  assert.deepEqual(noteOf(flows, 'old', 'now'), { text: '', holder: 'now' })
  assert.deepEqual(noteOf(flows, 'old', 'other'), { text: '' })
  assert.deepEqual(noteOf(flows, 'now', 'now'), { text: '' }, 'a flow with itself is no pair')
  assert.deepEqual(noteOf({ ...flows, now: flow('Now', 'gone') }, 'old', 'now'), { text: '' }, 'a tag to another flow is not this pair')
})

test('a pair that tag each other shows the note of the newer one, else the other', () => {
  const both = { a: flow('A', { with: 'b', note: 'from a' }), b: flow('B', { with: 'a', note: 'from b' }) }
  assert.deepEqual(noteOf(both, 'a', 'b'), { text: 'from a', holder: 'a' }, 'orderPair puts a second: it tags b')
  assert.deepEqual(noteOf({ a: flow('A', 'b'), b: flow('B', { with: 'a', note: 'from b' }) }, 'a', 'b'), { text: 'from b', holder: 'b' }, 'the line with the note is the one shown')
  assert.deepEqual(noteOf({ a: flow('A', 'b'), b: flow('B', 'a') }, 'a', 'b'), { text: '', holder: 'a' })
})

test('a run pair reads the runs the same way', () => {
  const runs = { r1: run('R1'), r2: run('R2', { with: 'r1', note: 'Cache on' }) }
  assert.deepEqual(noteOf(runs, 'r1', 'r2'), { text: 'Cache on', holder: 'r2' })
})

test('a tagged pair is saved on the line it has; an untagged one on the second of the pair, with the first as the older', () => {
  const flows = { old: flow('Old'), now: flow('Now', { with: 'old', note: 'x' }), other: flow('Other') }
  assert.deepEqual(saveTarget('flow', flows, 'old', 'now', 'New text'), { id: 'now', tag: { with: 'old', note: 'New text' } })
  assert.deepEqual(saveTarget('flow', flows, 'now', 'old', ''), { id: 'now', tag: { with: 'old' } }, 'no text: the short form')
  assert.deepEqual(saveTarget('flow', flows, 'other', 'old', 'Both'), { id: 'old', tag: { with: 'other', note: 'Both' } }, 'untagged: the one on the right gets the line')
  assert.deepEqual(saveTarget('flow', flows, 'old', 'other'), { id: 'other', tag: { with: 'old' } })
  assert.deepEqual(saveTarget('flow', flows, 'old', 'other', '  \n'), { id: 'other', tag: { with: 'old' } }, 'blank text is no note')
  assert.deepEqual(saveTarget('flow', flows, 'old', 'other', '  Padded  '), { id: 'other', tag: { with: 'old', note: 'Padded' } })
})

test('Save as pair never replaces a link silently: the target is named with what it replaces', () => {
  const flows = { x: flow('X'), y: flow('Y', 'z'), z: flow('Z'), w: flow('W', 'v'), v: flow('V') }
  // The newer (second) already links to another flow, the older does not: the line goes to the older, which replaces nothing.
  assert.deepEqual(saveTarget('flow', flows, 'x', 'y', 'n'), { id: 'x', tag: { with: 'y', note: 'n' } })
  // Swap sides flips who is newer: Y is first, X second, and X is free.
  assert.deepEqual(saveTarget('flow', flows, 'y', 'x', 'n'), { id: 'x', tag: { with: 'y', note: 'n' } })
  // Both link elsewhere: the newer is the target by the usual rule, and the confirm says what it replaces.
  assert.deepEqual(saveTarget('flow', flows, 'w', 'y'), { id: 'y', tag: { with: 'w' }, replaces: 'z' })
  assert.deepEqual(saveTarget('flow', flows, 'y', 'w'), { id: 'w', tag: { with: 'y' }, replaces: 'v' }, 'swapped: the other one is the target')
  // The older links elsewhere and the newer is free: the newer.
  assert.deepEqual(saveTarget('flow', flows, 'y', 'x'), { id: 'x', tag: { with: 'y' } })
  // A tag to a flow that is not there is still a link.
  assert.deepEqual(saveTarget('flow', { a: flow('A'), b: flow('B', 'gone') }, 'a', 'b'), { id: 'a', tag: { with: 'b' } })
  assert.deepEqual(saveTarget('flow', { a: flow('A', 'gone2'), b: flow('B', 'gone') }, 'a', 'b'), { id: 'b', tag: { with: 'a' }, replaces: 'gone' })
})

test('a pair that is tagged replaces nothing, and a free target replaces nothing', () => {
  const flows = { old: flow('Old'), now: flow('Now', 'old') }
  assert.equal(saveTarget('flow', flows, 'old', 'now', 'x').replaces, undefined)
  assert.equal(saveTarget('flow', { a: flow('A'), b: flow('B') }, 'a', 'b').replaces, undefined)
})

test('the pair has one key whichever way round it is given', () => {
  assert.equal(pairKey('a', 'b'), pairKey('b', 'a'))
  assert.notEqual(pairKey('a', 'b'), pairKey('a', 'c'))
})

test('a tagged pair keeps the line that holds it when the tag is the other way round', () => {
  const flows = { a: flow('A', 'b'), b: flow('B') }
  assert.deepEqual(saveTarget('flow', flows, 'a', 'b', 'n'), { id: 'a', tag: { with: 'b', note: 'n' } })
})

test('the note can be written when the page can save, and the reason is the tooltip when it can not', () => {
  assert.equal(noteOff(true, false), undefined)
  assert.equal(noteOff(false, false), "This page can't save")
  assert.equal(noteOff(true, true), "This page can't save")
})

test('Save as pair needs two different flows', () => {
  assert.equal(pairOff('flow', 'old', 'old'), 'Needs two different flows')
  assert.equal(pairOff('flow', 'old', 'other'), undefined)
  assert.equal(pairOff('run', 'r1', 'r1'), 'Needs two different runs')
})

test('a note counts as unsaved when it has text and is not what the pair holds', () => {
  assert.equal(unsaved(undefined, 'x'), false, 'no editor open')
  assert.equal(unsaved('', ''), false)
  assert.equal(unsaved('  \n', ''), false, 'blank text is nothing to lose')
  assert.equal(unsaved('x', ''), true)
  assert.equal(unsaved('x', 'x'), false, 'what is saved can not be lost')
  assert.equal(unsaved('', 'x'), true, 'a saved note emptied out is a change')
  assert.equal(unsaved('x', 'x\n'), false, 'a hand-written block note ends in a newline: opening it is not a change')
  assert.equal(unsaved('x\n', 'x\n'), false)
  assert.equal(unsaved('y', 'x\n'), true)
})

test('partner choices are every other flow by name, each with its view, and never the flow itself', () => {
  const model = modelOf({ me: flow('Me'), zed: flow('Zed'), Alpha: { ...flow('Alpha'), view: 'shop' }, beta: flow('beta'), nameless: flow('') })
  model.objects.shop = { type: 'system', name: 'Shop' }
  const choices = partnerChoices(model, 'me')
  assert.deepEqual(choices.map(c => c.id), ['Alpha', 'beta', 'nameless', 'zed'], 'by name, ignoring case, a flow with no name by its id')
  assert.deepEqual(choices[0], { id: 'Alpha', name: 'Alpha', view: 'Shop' })
  assert.equal(choices[1].view, nameOf(model, 'root'))
})

test('the tag a pick writes keeps the note, and no partner takes the tag out', () => {
  const model = modelOf({ a: flow('A', { with: 'old', note: 'why' }), b: flow('B'), c: flow('C', 'b'), old: flow('Old') })
  assert.deepEqual(tagWith(model, 'a', 'b'), { with: 'b', note: 'why' })
  assert.deepEqual(tagWith(model, 'c', 'old'), { with: 'old' }, 'no note to keep')
  assert.equal(tagWith(model, 'a', undefined), undefined)
  assert.deepEqual(tagWith(model, 'old', 'a'), { with: 'a' })
})

test('removing a link asks only when it holds a note', () => {
  assert.equal(removeNeedsConfirm({ with: 'a', note: 'why' }), true)
  assert.equal(removeNeedsConfirm({ with: 'a' }), false)
  assert.equal(removeNeedsConfirm(undefined), false)
})

test('the flows that tag a flow are listed by name with their view, a mutual pair once, a tag to nothing not at all', () => {
  const model = modelOf({ base: flow('Base'), y: flow('Y', 'base'), x: flow('X', { with: 'base', note: 'n' }), self: flow('S', 'self'), other: flow('O', 'gone') })
  assert.deepEqual(taggedBy(model, 'base').map(c => c.id), ['x', 'y'], 'by name')
  assert.deepEqual(taggedBy(model, 'self'), [])
  const mutual = modelOf({ a: flow('A', 'b'), b: flow('B', 'a') })
  assert.deepEqual(taggedBy(mutual, 'a'), [], 'b is already its own partner: a mutual pair lists once')
})

test('names order by lower-cased UTF-16 code unit, then id, so the desktop twin gives the same order', () => {
  // Locale order would put "Éclair" before "Zebra" and "Їжа" before "Яблуко"; code unit order is the other way round.
  const model = modelOf({ zebra: flow('Zebra'), eclair: flow('Éclair'), eat: flow('Їжа'), apple: flow('Яблуко'), upper: flow('ZEBRA'), twin: flow('zebra'), me: flow('Me') })
  assert.deepEqual(partnerChoices(model, 'me').map(t => t.id), ['twin', 'upper', 'zebra', 'eclair', 'apple', 'eat'])
  assert.deepEqual(choicesFor(model, {}, 'flow', 'me').others.map(c => c.id), ['twin', 'upper', 'zebra', 'eclair', 'apple', 'eat'])
})

test('drafts are kept per pair: typing on one never replaces another, and a pair is the same whichever way round', () => {
  let drafts: Drafts = new Map()
  drafts = withDraft(drafts, draftKey('flow', 'a', 'b'), 'about a and b', '')
  drafts = withDraft(drafts, draftKey('flow', 'c', 'd'), 'about c and d', '')
  assert.equal(drafts.get(draftKey('flow', 'b', 'a'))?.text, 'about a and b')
  assert.equal(drafts.get(draftKey('flow', 'c', 'd'))?.text, 'about c and d')
  assert.equal(drafts.get(draftKey('run', 'a', 'b')), undefined, 'a run pair is another pair')
  const typed = withDraft(drafts, draftKey('flow', 'a', 'b'), 'more', '')
  assert.equal(drafts.get(draftKey('flow', 'a', 'b'))?.text, 'about a and b', 'the map it was given is not changed')
  assert.equal(typed.get(draftKey('flow', 'c', 'd'))?.text, 'about c and d')
})

test("taking a pair's draft out leaves the others, and the page keeps a note while any pair has one that differs from what it held", () => {
  const k1 = draftKey('flow', 'a', 'b')
  const k2 = draftKey('flow', 'c', 'd')
  assert.equal(keepsDrafts(new Map()), false)
  let drafts = withDraft(withDraft(new Map(), k1, 'x', ''), k2, 'same as saved', 'same as saved')
  assert.equal(keepsDrafts(drafts), true)
  drafts = withDraft(drafts, k1, undefined, '')
  assert.deepEqual([...drafts.keys()], [k2])
  assert.equal(keepsDrafts(drafts), false, 'a draft equal to what the pair holds loses nothing')
})

const withObjects = (objects: Record<string, [FlowyObject['type'], string]>): Model => ({ ...emptyModel(), objects: Object.fromEntries(Object.entries(objects).map(([id, [type, parent]]) => [id, { type, name: id, in: parent }])) })

test('a pane draws the view of its flow until it is zoomed, and goes back to it when the level it was zoomed to is gone', () => {
  const model = withObjects({ shop: ['system', 'root'], api: ['app', 'shop'], leaf: ['app', 'api'], lone: ['app', 'root'] })
  assert.equal(paneLevel(model, 'shop', undefined), 'shop')
  assert.equal(paneLevel(model, 'shop', 'api'), 'api', 'zoomed into a shape that opens')
  assert.equal(paneLevel(model, 'shop', 'root'), 'root', 'zoomed out to the top')
  assert.equal(paneLevel(model, 'shop', 'lone'), 'shop', 'a shape with nothing inside is no level')
  assert.equal(paneLevel(model, 'shop', 'gone'), 'shop', 'a level an edit took away')
})

test('Esc takes a pane up only when it is zoomed away from its flow and not at the top', () => {
  assert.equal(paneInside('shop', 'shop'), false, 'at the view of its flow Esc closes the comparison')
  assert.equal(paneInside('api', 'shop'), true)
  assert.equal(paneInside('root', 'shop'), false, 'at the top there is nowhere to go up')
  assert.equal(paneInside('root', 'root'), false)
})

test('up from a level is the level above, and the top stays the top', () => {
  const model = withObjects({ shop: ['system', 'root'], api: ['app', 'shop'] })
  assert.equal(paneUp(model, 'api'), 'shop')
  assert.equal(paneUp(model, 'shop'), 'root')
  assert.equal(paneUp(model, 'root'), 'root')
})
