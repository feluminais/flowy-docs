import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analysisText, coverageText, table } from '../src/core/failures.ts'
import type { Mode } from '../src/core/model.ts'
import { shopWithFailures } from './fixtures.ts'

const HEADER = 'Risk band,Part,Mode,Effect,Cause,Severity,Likelihood,Hard to spot,Risk,Controls,Next action,Owner,Status'

function withEffects(...effects: string[]) {
  const m = shopWithFailures()
  m.failures.ordering.modes = Object.fromEntries(effects.map((effect, i): [string, Mode] => [`m${i}`, { mode: 'x', on: 'db', effect }]))
  return m
}

test('the markdown table has the header, the separator and one row per mode in rank order', () => {
  const m = shopWithFailures()
  const lines = table(m, m.failures.ordering, 'markdown').split('\n')
  assert.equal(lines[0], `| ${HEADER.split(',').join(' | ')} |`)
  assert.equal(lines[1], `| ${HEADER.split(',').map(() => '---').join(' | ')} |`)
  assert.equal(lines[2], '| High | Shop > API > Auth | The login lock is never released | Nobody can sign in. |  | 6 | 5 | 5 | 150 |  |  |  | open |')
  assert.equal(lines[3], "| High | Shop > Orders DB | The database is unreachable | Orders can't be saved. |  | 10 | 2 | 2 | 40 |  |  |  | open |")
  assert.deepEqual(lines.slice(2).map(l => l.split(' | ')[0].slice(2)), ['High', 'High', 'Medium', 'Medium', 'Low', 'Not rated'])
  assert.equal(lines.length, 8)
  assert.match(lines[7], /^\| Not rated \| Shop > API > Orders \| An order is counted twice \| A customer is billed twice\. \|  \| 5 \|  \|  \|  \|/)
  assert.match(lines[4], /^\| Medium \| Orders to Mail service \|/)
})

test('the csv table is the same rows with commas', () => {
  const m = shopWithFailures()
  const lines = table(m, m.failures.ordering, 'csv').split('\n')
  assert.equal(lines[0], HEADER)
  assert.equal(lines[1], 'High,Shop > API > Auth,The login lock is never released,Nobody can sign in.,,6,5,5,150,,,,open')
  assert.equal(lines.length, 7)
})

test('the After columns appear only when some mode has an after, and fill only for the modes that have one', () => {
  const m = shopWithFailures()
  assert.doesNotMatch(table(m, m.failures.ordering, 'csv'), /after/)
  m.failures.ordering.modes['api-slow'].after = { severity: '4', occurrence: '2' }
  const lines = table(m, m.failures.ordering, 'csv').split('\n')
  assert.equal(lines[0], `${HEADER},Severity after,Likelihood after,Hard to spot after`)
  assert.equal(lines.find(l => l.includes('The API answers slowly')), 'Medium,Shop > API,The API answers slowly,Pages hang.,,4,5,3,60,,,,open,4,2,')
  assert.equal(lines[1], 'High,Shop > API > Auth,The login lock is never released,Nobody can sign in.,,6,5,5,150,,,,open,,,')
})

test('a done mode shows the band and risk of its after ratings, and a missing status reads open', () => {
  const m = shopWithFailures()
  Object.assign(m.failures.ordering.modes['auth-lock'], { status: 'done', after: { occurrence: '1' } })
  const row = table(m, m.failures.ordering, 'csv').split('\n').find(l => l.includes('login lock'))
  assert.equal(row, 'Low,Shop > API > Auth,The login lock is never released,Nobody can sign in.,,6,5,5,30,,,,done,,1,')
})

test('a pipe and a newline in a cell are escaped in markdown, and a leading = is left alone there', () => {
  const lines = table(withEffects('a|b\nc\r\nd', '=1+1'), withEffects('a|b\nc\r\nd', '=1+1').failures.ordering, 'markdown').split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[2], /\| a\\\|b<br>c<br>d \|/)
  assert.match(lines[3], /\| =1\+1 \|/)
})

test('csv quotes commas, quotes and newlines', () => {
  const m = withEffects('one, two', 'He said "no"', 'line\nbreak')
  const text = table(m, m.failures.ordering, 'csv')
  assert.match(text, /,"one, two",/)
  assert.match(text, /,"He said ""no""",/)
  assert.match(text, /,"line\nbreak",/)
})

test('a csv cell that starts with =, +, - or @ is prefixed so a spreadsheet does not run it; one that merely contains them is not', () => {
  const m = withEffects('=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx', 'a=b', 'x -y')
  const text = table(m, m.failures.ordering, 'csv')
  for (const guarded of ["'=1+1", "'+SUM(A1)", "'-2+3", "'@cmd", "'\tx"]) assert.ok(text.includes(`,${guarded},`), guarded)
  assert.ok(text.includes(`,"'\rx",`))
  assert.ok(text.includes(',a=b,') && text.includes(',x -y,'))
  assert.doesNotMatch(text, /,=1\+1,|,\+SUM|,-2\+3|,@cmd/)
})

test('a mode id of __proto__ is a row', () => {
  const m = shopWithFailures()
  m.failures.ordering.modes = JSON.parse('{"__proto__":{"mode":"proto row","on":"db"}}')
  const lines = table(m, m.failures.ordering, 'csv').split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[1], /proto row/)
})

test('an analysis with no modes gives the header only', () => {
  const m = shopWithFailures()
  m.failures.ordering.modes = {}
  assert.equal(table(m, m.failures.ordering, 'csv'), HEADER)
  assert.equal(table(m, m.failures.ordering, 'markdown').split('\n').length, 2)
})

test('coverageText says how many are analysed and names the ones left by their path', () => {
  const m = shopWithFailures()
  assert.equal(coverageText(m, m.failures.ordering), 'Analysed 4 of 4 shapes')
  delete m.failures.ordering.modes['web-glitch']
  assert.equal(coverageText(m, m.failures.ordering), 'Analysed 3 of 4 shapes\nNot analysed: Shop > Web app')
  delete m.failures.ordering.modes['db-down']
  assert.equal(coverageText(m, m.failures.ordering), 'Analysed 2 of 4 shapes\nNot analysed: Shop > Web app, Shop > Orders DB')
})

test('analysisText is a heading, the coverage and the table in markdown, and the table alone in csv', () => {
  const m = shopWithFailures()
  const md = analysisText(m, 'ordering', m.failures.ordering, 'markdown')
  assert.ok(md.startsWith(`## Ordering (ordering)\n\nAnalysed 4 of 4 shapes\n\n| Risk band | Part |`), md.slice(0, 80))
  assert.ok(md.endsWith(table(m, m.failures.ordering, 'markdown')))
  assert.equal(analysisText(m, 'ordering', m.failures.ordering, 'csv'), table(m, m.failures.ordering, 'csv'))
})
