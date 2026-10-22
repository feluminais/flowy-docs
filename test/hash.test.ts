import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROOT } from '../src/core/model.ts'
import { addressChange, alongFailures, isSavedHash, readHash, runAddress, toHash } from '../ui/src/hash.ts'

test('an address and what it names go both ways', () => {
  const cases: [string, string?][] = [[ROOT], ['shop'], ['shop', 'checkout'], [ROOT, 'tour']]
  for (const [view, flow] of cases) assert.deepEqual(readHash(toHash(view, flow)), flow ? { view, flow } : { view })
  assert.equal(toHash(ROOT), '')
  assert.equal(toHash('shop'), '#shop')
  assert.equal(toHash('shop', 'checkout'), '#shop/checkout')
  assert.equal(toHash(ROOT, 'tour'), '#root/tour')
})

test('an address that is not ids opens the overview, and a flow that is not an id is dropped', () => {
  for (const hash of ['', '#', '#Shop', '#a/b/c', '#../x', '#shop%20x']) assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/Bad'), { view: 'shop' })
  assert.deepEqual(readHash('#shop/'), { view: 'shop' })
})

test('an address can name a failure analysis and a mode, and goes both ways', () => {
  assert.equal(toHash('shop', undefined, undefined, { analysis: 'ordering' }), '#shop/failures/ordering')
  assert.equal(toHash('shop', undefined, undefined, { analysis: 'ordering', mode: 'db-down' }), '#shop/failures/ordering/db-down')
  assert.equal(toHash(ROOT, undefined, undefined, { analysis: 'ordering' }), '#root/failures/ordering')
  assert.deepEqual(readHash('#shop/failures/ordering'), { view: 'shop', failures: { analysis: 'ordering' } })
  assert.deepEqual(readHash('#shop/failures/ordering/db-down'), { view: 'shop', failures: { analysis: 'ordering', mode: 'db-down' } })
  for (const f of [{ analysis: 'a' }, { analysis: 'a', mode: 'b' }]) assert.deepEqual(readHash(toHash('shop', undefined, undefined, f)), { view: 'shop', failures: f })
  assert.deepEqual(readHash('#shop/failures/constructor'), { view: 'shop', failures: { analysis: 'constructor' } }) // an id, so a valid name
  assert.equal(toHash('shop', undefined, { run: 'ramp', level: 1 }, { analysis: 'ordering' }), '#shop/perf/ramp/1') // a run on show wins
})

test('only picking another mode replaces the address, so Back still undoes opening the tab and each zoom', () => {
  assert.equal(alongFailures({ analysis: 'a', mode: 'x' }, { analysis: 'a', mode: 'y' }), true)
  assert.equal(alongFailures({ analysis: 'a' }, { analysis: 'a', mode: 'x' }), true)
  assert.equal(alongFailures({ analysis: 'a', mode: 'x' }, { analysis: 'a' }), true)
  assert.equal(alongFailures({ analysis: 'a', mode: 'x' }, { analysis: 'a', mode: 'x' }), false) // the view changed: a zoom is a step
  assert.equal(alongFailures({ analysis: 'a', mode: 'x' }, { analysis: 'b', mode: 'y' }), false)
  assert.equal(alongFailures(undefined, { analysis: 'a', mode: 'x' }), false) // opening the tab
  assert.equal(alongFailures({ analysis: 'a', mode: 'x' }, undefined), false) // closing it
})

test('an address that is not a failure address reads as the overview, or as a flow called failures', () => {
  for (const hash of ['#shop/failures/Ordering', '#shop/failures/ordering/Bad', '#shop/failures/ordering/x/y', '#shop/failure/ordering', '#Bad/failures/ordering', '#shop/failures/', '#shop/failures//x'])
    assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/failures'), { view: 'shop', flow: 'failures' })
})

test('an address can name a run and a tested level, and no other address reads as one', () => {
  assert.equal(toHash('shop', undefined, { run: 'ramp', level: 4 }), '#shop/perf/ramp/4')
  assert.equal(toHash(ROOT, undefined, { run: 'ramp', level: 0 }), '#root/perf/ramp/0')
  assert.deepEqual(readHash('#shop/perf/ramp/4'), { view: 'shop', perf: { run: 'ramp', level: 4 } })
  assert.deepEqual(readHash('#root/perf/slow-gateway/12'), { view: ROOT, perf: { run: 'slow-gateway', level: 12 } })
  assert.deepEqual(readHash(toHash('shop', undefined, { run: 'ramp', level: 4 })), { view: 'shop', perf: { run: 'ramp', level: 4 } })
  // the wrong word, a run or level that is not valid, a missing or extra part, and a view that is not an id
  for (const hash of ['#shop/runs/ramp/1', '#shop/perf/Ramp/1', '#shop/perf/ramp/x', '#shop/perf/ramp/-1', '#shop/perf/ramp', '#shop/perf/ramp/1/2', '#Bad/perf/ramp/1'])
    assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/perf'), { view: 'shop', flow: 'perf' }) // a flow can be called perf
})

test('a run with several sources has a place for each in its address, in dial order, and it goes both ways', () => {
  assert.equal(toHash('shop', undefined, { run: 'together', level: 2, levels: [2, 1.5] }), '#shop/perf/together/2,1.5')
  assert.equal(toHash(ROOT, undefined, { run: 'together', level: 0, levels: [0, 0, 3] }), '#root/perf/together/0,0,3')
  assert.deepEqual(readHash('#shop/perf/together/2,1.5'), { view: 'shop', perf: { run: 'together', level: 2, levels: [2, 1.5] } })
  assert.deepEqual(readHash('#root/perf/together/0,0,3,1'), { view: ROOT, perf: { run: 'together', level: 0, levels: [0, 0, 3, 1] } })
  for (const levels of [[0, 0], [3, 1], [2, 1.5], [10, 0.25, 4]]) {
    const perf = { run: 'together', level: levels[0], levels }
    assert.deepEqual(readHash(toHash('shop', undefined, perf)), { view: 'shop', perf })
  }
  // a single run's address is what it was
  assert.deepEqual(readHash('#shop/perf/together/2'), { view: 'shop', perf: { run: 'together', level: 2 } })
})

test('a list of places that is not one reads as no places, so the page opens at the opening place, and nothing throws', () => {
  // a number that is not one, an empty place, a sign, an exponent, too many places, a place with too many digits
  for (const list of ['x,1', '1,', ',1', '1,,2', '-1,2', '1e3,2', '1,2,3,4,5', '1234567,1', '1.,2', '.5,2', '1,2x', ',']) {
    const read = readHash(`#shop/perf/together/${list}`)
    assert.deepEqual(read, { view: 'shop', perf: { run: 'together', level: 0, levels: [] } }, list)
  }
  // a list is only a list for a run: the run and the view must still be ids, and the address has no more parts
  for (const hash of ['#shop/perf/Together/1,2', '#Bad/perf/together/1,2', '#shop/perf/together/1,2/3', '#shop/runs/together/1,2'])
    assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.doesNotThrow(() => readHash('#shop/perf/together/' + '9,'.repeat(5000)))
})

test('the address of a run: a level, or for several sources a place for each', () => {
  assert.deepEqual(runAddress('burst', [2.4], false, false), { run: 'burst', level: 2 })
  assert.deepEqual(runAddress('burst', [1.234, 0.5], true, false), { run: 'burst', level: 1, levels: [1.23, 0.5] }, 'two decimals while the screen stands still')
  assert.deepEqual(runAddress('burst', [1.234, 0.5], true, true), { run: 'burst', level: 1, levels: [1, 1] }, 'whole loads during a ramp, or every step would rewrite it')
  assert.equal(toHash('shop', undefined, runAddress('burst', [1.234, 0.5], true, false)), '#shop/perf/burst/1.23,0.5')
})

test('a step the reader takes pushes an entry; the page opening, Back and moving along a run replace it', () => {
  const same = { quiet: false, address: '#shop', current: '#shop', view: 'shop', viewId: 'shop', perfOpen: false, runKey: '', failuresAt: undefined }
  assert.equal(addressChange(same), undefined, 'nothing changed: the address is left alone')
  assert.equal(addressChange({ ...same, address: '#shop/checkout' }), 'push', 'playing a flow is a step')
  assert.equal(addressChange({ ...same, address: '#other', view: 'other', viewId: 'other' }), 'push', 'a zoom is a step')
  assert.equal(addressChange({ ...same, quiet: true }), 'replace', 'the page opening, or E, writes the address without a step')
  assert.equal(addressChange({ ...same, address: '#other', view: 'other', viewId: 'shop' }), 'replace', 'a live reload fell back to another view than the one asked for')
})

test('moving along a run is not a step to go back to, nor is picking another mode', () => {
  const along = { quiet: false, address: '#shop/perf/burst/2', current: '#shop/perf/burst/1', view: 'shop', viewId: 'shop', perfOpen: true, runKey: 'burst', failuresAt: undefined }
  assert.equal(addressChange(along), 'replace')
  assert.equal(addressChange({ ...along, perfOpen: false }), 'push', 'opening the panel is a step')
  assert.equal(addressChange({ ...along, runKey: 'other' }), 'push', 'another run is a step')
  assert.equal(addressChange({ ...along, current: '#root/perf/burst/1' }), 'push', 'the same run on another view is a step')
  const failing = { quiet: false, address: '#shop/failures/a/two', current: '#shop/failures/a/one', view: 'shop', viewId: 'shop', perfOpen: false, runKey: '', failuresAt: { analysis: 'a', mode: 'two' } }
  assert.equal(addressChange(failing), 'replace')
  assert.equal(addressChange({ ...failing, current: '#shop', address: '#shop/failures/a/two' }), 'push', 'opening the tab is a step')
})

test('every address toHash writes is one a restored panel takes back, and anything else is not', () => {
  const written = [
    toHash('shop'),
    toHash('shop', 'checkout'),
    toHash('shop', undefined, { run: 'dinner-rush', level: 3 }),
    toHash('shop', undefined, { run: 'dinner-rush', level: 3, levels: [2, 1.5] }),
    toHash('shop', undefined, undefined, { analysis: 'checkout', mode: 'timeout' }),
  ]
  for (const address of written) assert.equal(isSavedHash(address), true, address)
  for (const bad of ['', '#', 'shop', '#shop checkout', '#shop"x', '#a<b', '#javascript:alert(1)', '#//evil', '#shop/..']) assert.equal(isSavedHash(bad), false, bad)
})
