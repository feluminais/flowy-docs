#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from './node/mcp.ts'

const args = (() => {
  try {
    return parseArgs({ allowPositionals: true, options: { dir: { type: 'string', default: 'flowy' } } })
  } catch {
    return undefined // an unknown flag: show the usage line, not a stack trace
  }
})()

if (args?.positionals[0] === 'mcp') {
  await createMcpServer(resolve(args.values.dir)).connect(new StdioServerTransport())
} else {
  console.error('Usage: flowy mcp [--dir flowy]')
  process.exitCode = 1
}
