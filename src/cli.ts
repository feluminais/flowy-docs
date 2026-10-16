#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './node/mcp.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { dir: { type: 'string', default: 'flowy' } },
})
const dir = resolve(values.dir)

if (positionals[0] === 'mcp') {
  await createMcpServer(dir).connect(new StdioServerTransport())
} else {
  console.error('Usage: flowy mcp [--dir flowy]')
  process.exitCode = 1
}
