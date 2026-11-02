import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The C# core in desktop/Flowy.Core is a port of some modules of src/core, src/node and ui/src, held equal by the dumps in desktop/fixtures. A
 * function that is added to a ported module and is in no dump may be missing from the port, or untested there, and nothing else would say so.
 * So every value a ported module exports is either read by a fixture dump or listed in desktop/fixtures/twin-gaps.json, which says on purpose
 * "no C# twin, or not pinned". Adding to the list is a choice; the test names what to add. `UPDATE_TWIN_GAPS=1 npm test` rewrites the list.
 * A src/core module is listed by its name ("animation"); one elsewhere by its path ("ui/src/perfview").
 */
const root = join(import.meta.dirname, '..')
const gapsFile = join(root, 'desktop', 'fixtures', 'twin-gaps.json')

const read = (path: string) => readFileSync(path, 'utf8')

/** A module's path from the repo root, without .ts, from its name in the list: a bare name is in src/core. */
const pathOfModule = (module: string) => (/^(src|ui)\//.test(module) ? module : `src/core/${module}`)

/** The modules that a C# file calls its source ("port of src/core/x.ts", "twin of ui/src/y.ts"), src/core ones by name and the others by path. */
function portedModules(): string[] {
  const dir = join(root, 'desktop', 'Flowy.Core')
  const found = new Set<string>()
  for (const file of readdirSync(dir).filter(f => f.endsWith('.cs'))) {
    for (const m of read(join(dir, file)).matchAll(/\b(src\/core|src\/node|ui\/src)\/([\w-]+(?:\/[\w-]+)?)\.ts\b/g)) {
      found.add(m[1] === 'src/core' ? m[2] : `${m[1]}/${m[2]}`)
    }
  }
  return [...found].filter(module => existsSync(join(root, `${pathOfModule(module)}.ts`))).sort()
}

/** The values (functions, constants, classes) a module exports, each once: an overloaded function is declared several times. */
function exportsOf(module: string): string[] {
  const text = read(join(root, `${pathOfModule(module)}.ts`))
  return [...new Set([...text.matchAll(/^export (?:async )?(?:function\*?|const|let|class) (\w+)/gm)].map(m => m[1]))].sort()
}

/** The names the fixture dumps read from a module. */
function dumpedFrom(module: string): Set<string> {
  const dir = join(root, 'desktop', 'fixtures')
  const names = new Set<string>()
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const text = read(join(dir, file))
    for (const m of text.matchAll(new RegExp(`import (?:type )?\{([^}]*)\} from '[./]*${pathOfModule(module)}\.ts'`, 'g'))) {
      for (const n of m[1].split(',')) names.add(n.trim().split(' as ')[0].replace(/^type /, ''))
    }
  }
  return names
}

test('every value a ported module exports is dumped by a fixture or listed as a gap', () => {
  const gaps: Record<string, string[]> = {}
  for (const module of portedModules()) {
    const dumped = dumpedFrom(module)
    const missing = exportsOf(module).filter(name => !dumped.has(name))
    if (missing.length) gaps[module] = missing
  }
  if (process.env.UPDATE_TWIN_GAPS) {
    writeFileSync(gapsFile, JSON.stringify(gaps, null, 2) + '\n')
    return
  }
  const known = JSON.parse(read(gapsFile)) as Record<string, string[]>
  const fresh = Object.entries(gaps).flatMap(([m, names]) => names.filter(n => !(known[m] ?? []).includes(n)).map(n => `${m}.${n}`))
  assert.deepEqual(fresh, [], `exported from a ported module, in no fixture dump and not in desktop/fixtures/twin-gaps.json. Dump it in desktop/fixtures and port it, or add it to the list if it has no C# twin on purpose: ${fresh.join(', ')}`)
  const stale = Object.entries(known).flatMap(([m, names]) => names.filter(n => !(gaps[m] ?? []).includes(n)).map(n => `${m}.${n}`))
  assert.deepEqual(stale, [], `in desktop/fixtures/twin-gaps.json but now dumped or gone: remove ${stale.join(', ')}`)
})
