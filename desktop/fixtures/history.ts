import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { changedPaths, collapseSteps, fallbackLabel, mcpLabel, outsideLabel, planRetention, stepInfos } from '../../src/core/history.ts'
import type { Step, StepApp, StepInfo, StepSource } from '../../src/core/history.ts'
import { diffLines } from '../../src/core/linediff.ts'
import { hashText } from '../../src/node/files.ts'
import { openHistory } from '../../src/node/history.ts'
import type { StepView } from '../../src/node/history.ts'
import { defaultStateDir, historyKey } from '../../src/node/history-store.ts'

// What the C# history (Flowy.Core) must say too: the line diff, the list rules, retention, labels, folder keys, and the step files of a sample
// trail written by the TypeScript store. The C# tests compare their output with desktop/fixtures/expected/history.json and read
// desktop/fixtures/expected/history-trail as a trail of their own.

/** Pairs of texts with their diffs. */
const DIFFS: [string, string, string][] = [
  ['identical', 'a\nb\n', 'a\nb\n'],
  ['a changed line', 'a\nb\nc\n', 'a\nB\nc\n'],
  ['a tie goes to the removal', 'a\nx\n', 'x\na\n'],
  ['empty base', '', 'a\nb\n'],
  ['empty next', 'a\nb\n', ''],
  ['both empty', '', ''],
  ['line endings and the final newline', 'a\r\nb', 'a\nb\n'],
  ['a blank line', 'a\n\nb\n', 'a\nb\n'],
  ['a moved block', 'a\nb\nc\nd\n', 'c\nd\na\nb\n'],
  ['no final newline on either side', 'a\nb', 'a\nc'],
  ['a line added at the start and one at the end', 'b\nc\n', 'a\nb\nc\nd\n'],
  ['a change in the middle of thirty lines', numbered(30, 15, 'changed'), numbered(30, -1, '')],
  ['repeated lines', 'x\nx\nx\n', 'x\nx\n'],
  ['yaml with a renamed key', 'objects:\n  shop:\n    type: system\n    name: Shop\n', 'objects:\n  shop:\n    type: system\n    name: Web shop\n'],
]

function numbered(count: number, changeAt: number, text: string): string {
  return Array.from({ length: count }, (_, i) => (i === changeAt ? `line ${i} ${text}` : `line ${i}`)).join('\n') + '\n'
}

const step = (id: string, source: StepSource, files: Record<string, string>): Step =>
  ({ id, time: `2026-10-20T10:00:0${id}.000Z`, label: `${source} ${id}`, source, app: 'browser', files })

/** Lists of steps with what the list rules make of them. */
const COLLAPSES: [string, Step[]][] = [
  ['an outside step equal to the labelled one before it', [step('1', 'you', { 'model.yaml': 'aaaaaaaaaaaaaaaa' }), step('2', 'outside', { 'model.yaml': 'aaaaaaaaaaaaaaaa' })]],
  ['a labelled step over the identical outside one', [step('1', 'you', { 'model.yaml': 'aaaaaaaaaaaaaaaa' }), step('2', 'outside', { 'model.yaml': 'bbbbbbbbbbbbbbbb' }), step('3', 'you', { 'model.yaml': 'bbbbbbbbbbbbbbbb' })]],
  ['a labelled step over the first-seen step', [step('1', 'first', { 'model.yaml': 'aaaaaaaaaaaaaaaa' }), step('2', 'ai', { 'model.yaml': 'aaaaaaaaaaaaaaaa' })]],
  ['two labelled steps with equal files', [step('1', 'you', { 'model.yaml': 'aaaaaaaaaaaaaaaa' }), step('2', 'ai', { 'model.yaml': 'aaaaaaaaaaaaaaaa' })]],
  ['files that come and go', [step('1', 'you', { 'model.yaml': 'aaaaaaaaaaaaaaaa' }), step('2', 'you', { 'model.yaml': 'aaaaaaaaaaaaaaaa', 'flows/a.yaml': 'bbbbbbbbbbbbbbbb' }), step('3', 'restore', { 'model.yaml': 'aaaaaaaaaaaaaaaa' })]],
  ['nothing', []],
]

const CHANGES: [Record<string, string>, Record<string, string>][] = [[{ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }], [{}, { a: '1' }], [{ a: '1' }, { a: '1' }]]

const FILE_LISTS =[[], ['model.yaml'], ['model.yaml', 'layout.yaml'], ['model.yaml', 'layout.yaml', 'flows/a.yaml'], ['a', 'b', 'c', 'd']]

const MCP: [string, Record<string, unknown>][] = [
  ['put_object', { id: 'cart' }], ['connect', { from: 'a', to: 'b' }], ['disconnect', { from: 'a', to: 'b', label: 'x' }], ['put_icon', { name: 'stripe' }],
  ['put_flow', { id: 'checkout' }], ['get_model', {}], ['put_object', { id: 5 }], ['connect', { from: 'a' }],
]

const KEYS: [string, NodeJS.Platform][] = [
  ['M:\\Projects\\Flowy Docs\\flowy', 'win32'], ['m:\\projects\\flowy docs\\flowy\\', 'win32'], ['/home/a/Shop/flowy', 'linux'], ['/home/a/shop/flowy', 'linux'],
  ['/Users/a/Shop/flowy/', 'darwin'], ['/USERS/A/SHOP/FLOWY', 'darwin'], ['C:\\p\\é a\\flowy', 'win32'], ['C:\\p\\É a\\flowy', 'win32'],
]

const STATE_DIRS: [Record<string, string>, NodeJS.Platform, string][] = [
  [{ FLOWY_STATE_DIR: '/state' }, 'linux', '/h'], [{ FLOWY_STATE_DIR: '' }, 'linux', '/h'], [{ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'],
  [{}, 'win32', 'C:\\Users\\a'], [{ XDG_CONFIG_HOME: '/x' }, 'linux', '/h'], [{}, 'linux', '/h'], [{}, 'darwin', '/Users/a'],
]

/** A trail of six steps by the three programs, with a file that is not UTF-8, a restore, and an outside step that a labelled one then covers. */
export type Trail = { files: Record<string, Uint8Array>; list: StepInfo[]; reads: StepView[] }

const BASE = Date.UTC(2026, 9, 20, 10, 0, 0)

export async function buildTrail(): Promise<Trail> {
  const work = await mkdtemp(join(tmpdir(), 'flowy-trail-'))
  try {
    const dir = join(work, 'flowy')
    await mkdir(dir)
    const stateDir = join(work, 'state')
    let tick = 0
    let count = 0
    const as = (app: StepApp) => openHistory(dir, { app, stateDir, now: () => new Date(BASE + tick++ * 1000), random: () => (count++).toString(16).padStart(6, '0') })
    const browser = as('browser')
    const desktop = as('desktop')
    const mcp = as('mcp')
    const put = async (rel: string, content: string | Uint8Array) => {
      await mkdir(dirname(join(dir, rel)), { recursive: true })
      await writeFile(join(dir, rel), content)
    }
    const shop = 'objects:\n  shop: { type: system, name: Shop }\nconnections: []\n'

    await put('model.yaml', 'objects: {}\nconnections: []\n')
    await browser.ensureCurrent('open') // 1: First seen
    await put('model.yaml', shop)
    await put('layout.yaml', 'root:\n  shop: [10, 20]\n')
    const added = await browser.record('Added the Shop system', 'you') // 2
    await put('model.yaml', new Uint8Array([0xff, 0xfe, 0x00]))
    await desktop.ensureCurrent('watch') // 3: outside, and not text
    if (!added) throw new Error('the sample trail needs its second step')
    await browser.restore(added.id, (await browser.now()).versions, 'Restored the version from 10:00') // 4
    await put('model.yaml', `${shop.replace('connections: []\n', '')}  cart: { type: system, name: Cart }\nconnections: []\n`)
    await desktop.ensureCurrent('watch') // 5: outside, the same files as 6
    await mcp.record('AI: put_object cart', 'ai') // 6

    const files: Record<string, Uint8Array> = {}
    for (const sub of ['steps', 'blobs']) {
      for (const name of await readdir(join(mcp.root, sub))) files[`${sub}/${name}`] = new Uint8Array(await readFile(join(mcp.root, sub, name)))
    }
    const list = await mcp.list()
    const reads: StepView[] = []
    for (const info of list) {
      const view = await mcp.read(info.id)
      if (view) reads.push(view)
    }
    return { files, list, reads }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function dumpHistory(): Promise<unknown> {
  const trail = await buildTrail()
  const fallback = diffLines(Array.from({ length: 2100 }, (_, i) => `a${i}`).join('\n'), Array.from({ length: 2100 }, (_, i) => `b${i}`).join('\n'))
  return {
    diffs: DIFFS.map(([name, base, next]) => ({ name, base, next, marks: diffLines(base, next) })),
    // 2100 lines against 2100 other lines is over the cell limit: every old line goes, every new one comes.
    fallback: { lines: 2100, removes: fallback.filter(m => m.kind === 'remove').length, adds: fallback.filter(m => m.kind === 'add').length, firstAdd: fallback[2100] },
    collapse: COLLAPSES.map(([name, steps]) => {
      const visible = collapseSteps(steps)
      return { name, steps, visible: visible.map(s => s.id), infos: stepInfos(visible) }
    }),
    retention: [3, 9].map(keep => {
      const steps = ['1', '2', '3', '4', '5'].map(id => step(id, 'you', { 'model.yaml': hashText(`model ${id}`), 'layout.yaml': hashText('layout') }))
      const plan = planRetention(steps, keep)
      return { keep, steps, dropSteps: plan.dropSteps, keepBlobs: [...plan.keepBlobs].sort() }
    }),
    changed: CHANGES.map(([before, after]) => ({ before, after, changed: changedPaths(before, after) })),
    labels: {
      files: FILE_LISTS.map(files => ({ files, outside: outsideLabel(files), fallback: fallbackLabel(files) })),
      mcp: MCP.map(([tool, input]) => ({ tool, input, label: mcpLabel(tool, input) })),
    },
    keys: KEYS.map(([path, platform]) => ({ path, platform, key: historyKey(path, platform) })),
    stateDirs: STATE_DIRS.map(([env, platform, home]) => ({ env, platform, home, dir: defaultStateDir(env, platform, home) })),
    trail: { folder: 'history-trail', files: Object.keys(trail.files).sort(), list: trail.list, reads: trail.reads },
  }
}
