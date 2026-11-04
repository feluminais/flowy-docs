import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { KIND_IDS, KINDS, PLAIN_NAME } from '../src/core/kinds.ts'
import { FOLD_FROM, LANE_KEY, laneCapacity, MOST, MOVE_WORDS, OPEN_MOST } from '../src/core/lanes.ts'
import { PAIRS_FIELD, PAIR_NAMES } from '../src/core/model.ts'

const read = (file: string) => readFileSync(file, 'utf8')
const kinds = read('docs/guide/kinds.md')

test('the kinds guide names every kind as the app does, with its word and a line of YAML that uses it', () => {
  for (const id of KIND_IDS) {
    assert.ok(kinds.includes(`## ${KINDS[id].name}`) || kinds.includes(`### ${KINDS[id].name}`), `${id}: a section named ${KINDS[id].name}`)
    assert.ok(kinds.includes(`(\`${id}\`)`), `${id}: the word in the questions table`)
    assert.ok(new RegExp(`kind: ${id} \}`).test(kinds), `${id}: a YAML line`)
  }
  assert.ok(kinds.includes(PLAIN_NAME))
})

test('the kinds guide draws the kinds and the marks with the generated pictures, and they exist', () => {
  for (const file of ['connection-kinds.svg', 'connection-marks.svg']) {
    assert.ok(kinds.includes(`](../images/${file})`), `${file} is not in the guide`)
    assert.ok(existsSync(`docs/images/${file}`), `${file} is missing`)
  }
})

test('the kinds guide has no dashes in its prose and the guides link to it', () => {
  for (const file of ['docs/guide/kinds.md', 'docs/guide/sketches.md']) assert.ok(!/[–—]/.test(read(file)), `${file} has an en or em dash`)
  assert.ok(read('docs/guide.md').includes('(guide/kinds.md)'))
  assert.ok(read('docs/guide/canvas.md').includes('(kinds.md)'))
  assert.ok(read('docs/format.md').includes('(guide/kinds.md)'))
})

test('the sketches guide says the words the app says for lines side by side', () => {
  const sketches = read('docs/guide/sketches.md')
  for (const word of [PAIRS_FIELD, PAIR_NAMES.merged, PAIR_NAMES.separate, MOVE_WORDS.up, MOVE_WORDS.down, LANE_KEY.inUse, LANE_KEY.stacked, 'pairs: separate', 'via:']) assert.ok(sketches.includes(word), word)
})

test('the Many lines paragraph says when the readers fold, not just the upper limit', () => {
  const para = read('docs/guide/sketches.md').split(/[\x0a\x0d]+/).find(line => line.startsWith('**Many lines.**')) ?? ''
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  const short = 36 // half of the 72 px height of a shape: the room across two shapes side by side in a row
  assert.ok(para.includes(`at most ${words[MOST]}`), 'the most lanes')
  assert.ok(para.includes(`room for ${words[laneCapacity(short, false)]} lines one way, or ${words[laneCapacity(short, true)]} when lines run both ways`), 'the room across short sides')
  assert.ok(para.includes(`A pair of ${words[FOLD_FROM - 1]} lines or fewer never folds`), 'the least that folds')
  assert.ok(para.includes(`up to ${words[OPEN_MOST]}`), 'what a click opens')
  assert.ok(para.includes('each direction folds into one stacked line, whatever the kinds'), 'the fallback')
  assert.ok(!para.includes('draws up to eight lines'), 'eight is not where folding starts')
})

test('the sketches guide says a reply rides its request only when no line runs its way or via names it, as strandCandidates tries them', () => {
  const sketches = read('docs/guide/sketches.md')
  assert.ok(sketches.includes("only when no line of the pair runs the reply's way, or when its `via` or `payload` names that line"))
  assert.ok(!sketches.includes('A reply step rides the line of its request when'), 'the old sentence put the request line first')
  assert.ok(sketches.includes('text: Results reach the screen, via: Start scan'), 'the example names the request line, since Scan results runs that way')
  assert.ok(read('docs/guide/flows.md').includes("the lines of the pair that run the step's way, then the Request and reply and Request then stream lines that run against it"))
})

test('the Mermaid paragraph of the sharing guide keeps "The same" next to what it repeats', () => {
  const share = read('docs/guide/share.md')
  const same = share.search(/The same\s+from the command line/)
  assert.ok(same > 0)
  assert.ok(share.indexOf("A connection's kind is only partly kept") > share.indexOf('(`get_mermaid`):'), 'the kinds sentence comes after the command line sentence')
  assert.ok(!share.slice(share.lastIndexOf('Mermaid 11.3 or later)'), same).includes('kind'), 'nothing between Mermaid 11.3 and "The same"')
})

test('the flows guide, the AI guide and the writing rules say how a step names its line', () => {
  assert.match(read('docs/guide/flows.md'), /## Which line a step rides/)
  assert.match(read('docs/guide/ai.md'), /`set_kind`/)
  assert.match(read('docs/guide/ai.md'), /`via`/)
  assert.match(read('docs/writing.md'), /One line per relationship in the model/)
})
