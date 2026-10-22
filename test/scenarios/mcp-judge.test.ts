import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { deleteObject, putObject } from '../../src/core/ops.ts'
import { shop } from '../fixtures.ts'
import type { McpMaker, McpMove } from './mcp-moves.ts'
import { playMcp } from './mcp-play.ts'
import type { Fixture } from './play.ts'

/** The MCP judge, tested the way judge.test.ts tests the ops judge: a tool that is wrong on purpose, and the rule that must name it. */
const fixture: Fixture = { name: 'Shop', model: shop(), runs: {} }

const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], ...(isError ? { isError } : {}) })

/** Tools that are wrong on purpose, each added to the server of a scenario. */
function plant(server: McpServer, dir: string) {
  const tool = (name: string, run: () => Promise<ReturnType<typeof text>>) => server.registerTool(name, { description: name, inputSchema: {} }, run)
  tool('boom', async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')") })
  tool('sneaky', async () => { await writeFile(join(dir, 'note.txt'), 'x'); return text('Nothing saved.', true) })
  tool('peek', async () => { await writeFile(join(dir, 'note.txt'), 'x'); return text('Looked.') })
  tool('breaker', async () => {
    const file = join(dir, 'model.yaml')
    await writeFile(file, (await readFile(file, 'utf8')).replace('connections:', 'connections:\n  - { from: web, to: nowhere }'))
    return text('Connected.')
  })
  tool('lax', async () => text('Deleted customer.'))
  tool('refuser', async () => text('No.', true))
}

const call = (op: string, tool: string, extra: Partial<McpMove> = {}): McpMaker => () => ({ op, label: op, kind: 'write', calls: [{ tool, args: {} }], ...extra })
const run = async (maker: McpMaker) => new Set((await playMcp(fixture, 1, 4, { planted: maker }, plant)).findings.map(f => `${f.rule}:${f.op}`))

test('a tool that answers with a bug in the server is a crash', async () => {
  assert.ok((await run(call('boom', 'boom'))).has('tool-crash:boom'))
})

test('a refusal that still changed a file is named', async () => {
  assert.ok((await run(call('sneaky', 'sneaky'))).has('wrote-on-error:sneaky'))
})

test('a read that changed a file is named', async () => {
  assert.ok((await run(call('peek', 'peek', { kind: 'read' }))).has('read-wrote:peek'))
})

test('a write that leaves the folder with a problem it did not have is named', async () => {
  assert.ok((await run(call('breaker', 'breaker'))).has('new-problem:breaker'))
})

test('a tool that takes an edit the op refuses is named', async () => {
  const twin = { op: 'deleteObject', label: 'deleteObject customer', run: (m: Fixture['model']) => deleteObject(m, 'customer') }
  assert.ok((await run(call('lax', 'lax', { twin }))).has('accepts-refused:lax'))
})

test('a tool that says it did what the op does and left the folder alone is named', async () => {
  const twin = { op: 'putObject', label: 'putObject extra', run: (m: Fixture['model']) => putObject(m, { id: 'extra', type: 'system', name: 'Extra' }) }
  assert.ok((await run(call('lax', 'lax', { twin }))).has('differs-from-op:lax'))
})

test('what a tool showed, sent back and refused, is named', async () => {
  const echo: McpMaker = () => ({
    op: 'echo', label: 'echo', kind: 'echo', calls: [{ tool: 'get_model', args: { object: 'web' } }], sendBack: () => ({ tool: 'refuser', args: {} }),
  })
  assert.ok((await run(echo)).has('echo-refused:echo'))
})
