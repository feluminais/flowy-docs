// node bench/canvas.ts : how the built page copes with a big view, in a real (headless) browser. Needs `npm run build:ui` first.
// FLOWY_UI=<folder> times another build of the page (for example one kept from before a change); the server and the model are the same.
import { chromium } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gen, fmt, rng } from './gen.ts'
import { modelFiles, serializeLayout } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'

const BOXES = Number(process.env.BOXES ?? 300)
// One system holding BOXES apps, in a grid, and lines between random pairs of them: no outsiders, so nothing but the view is on the canvas.
const model = gen({ systems: 1, apps: 1, components: 0 }, 3)
const rand = rng(11)
model.objects = { 'sys-0': { type: 'system', name: 'Big system' } }
const ids = Array.from({ length: BOXES }, (_, i) => `app-${i}`)
for (const id of ids) model.objects[id] = { type: 'app', name: `App ${id}`, tech: 'Node', description: `The ${id} service, which does one thing.`, in: 'sys-0' }
const seen = new Set<string>()
model.connections = []
while (model.connections.length < BOXES * 1.5) {
  const [from, to] = [ids[Math.floor(rand() * BOXES)], ids[Math.floor(rand() * BOXES)]]
  if (from === to || seen.has(`${from}>${to}`)) continue
  seen.add(`${from}>${to}`)
  model.connections.push(rand() < 0.3 ? { from, to, label: 'calls' } : { from, to })
}
model.flows = {}
model.failures = {}
model.layout = { 'sys-0': Object.fromEntries(ids.map((id, i) => [id, [(i % 15) * 260, Math.floor(i / 15) * 140] as [number, number]])) }

const root = await mkdtemp(join(tmpdir(), 'flowy-canvas-'))
const dir = join(root, 'flowy')
await mkdir(join(dir, 'flows'), { recursive: true })
for (const [rel, text] of Object.entries(modelFiles(model))) await writeFile(join(dir, rel), text)
await writeFile(join(dir, 'layout.yaml'), serializeLayout(model.layout))
const ui = resolve(process.env.FLOWY_UI ?? join(import.meta.dirname, '..', 'dist', 'ui'))
const server = await startServer({ dir, ui, port: 0 })
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const t0 = Date.now()
  await page.goto(`http://127.0.0.1:${server.port}/#sys-0`)
  await page.locator('.react-flow__node').first().waitFor()
  await page.waitForFunction(count => document.querySelectorAll('.react-flow__node').length >= count, ids.length)
  console.log(`${ids.length} boxes, ${model.connections.length} lines; first picture after ${Date.now() - t0} ms`)
  await page.waitForTimeout(1500)
  if (process.env.FIT) { await page.mouse.click(77, 867); await page.waitForTimeout(800) }
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  const frames = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  /** Runs `steps` actions, each followed by two frames, and says what the page spent per step. */
  async function measure(what: string, steps: number, act: (i: number) => Promise<void>) {
    await frames()
    const before = await metrics()
    const start = performance.now()
    for (let i = 0; i < steps; i++) {
      await act(i)
      await frames()
    }
    const wall = performance.now() - start
    const after = await metrics()
    const per = (k: string) => ((after[k] - before[k]) * 1000) / steps
    console.log(`${what.padEnd(44)}${fmt(wall / steps).padStart(8)} ms/step   script ${fmt(per('ScriptDuration')).padStart(7)}   style ${fmt(per('RecalcStyleDuration')).padStart(7)}   layout ${fmt(per('LayoutDuration')).padStart(7)}`)
  }

  // Points on the lines, in screen pixels.
  const onLines: [number, number][] = await page.evaluate(() => Array.from(document.querySelectorAll<SVGPathElement>('.react-flow__edge-interaction')).flatMap(p => {
    const at = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()
    if (!m) return []
    const [x, y] = [at.x * m.a + at.y * m.c + m.e, at.x * m.b + at.y * m.d + m.f]
    return x > 400 && y > 60 && x < innerWidth - 20 && y < innerHeight - 100 ? [[x, y] as [number, number]] : []
  }).slice(0, 40))
  console.log(`lines to point at: ${onLines.length} of ${await page.locator('.react-flow__edge-interaction').count()} (edges ${await page.locator('.react-flow__edge').count()}); viewport ${await page.locator('.react-flow__viewport').getAttribute('style')}`)
  const empty: [number, number] = [700, 880]
  await measure('point at a line, then away', Math.min(20, onLines.length), async i => {
    await page.mouse.move(...onLines[i % onLines.length])
    await page.mouse.move(...empty)
  })
  console.log('viewport', await page.locator('.react-flow__viewport').getAttribute('style'), 'sample node', JSON.stringify(await page.locator('.react-flow__node').first().boundingBox()))
  const boxes = await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] as [number, number] }).filter(([x, y]) => x > 400 && y > 60 && x < innerWidth - 20 && y < innerHeight - 100).slice(0, 30))
  await measure('point at a box, then away', Math.min(20, boxes.length), async i => {
    const at = boxes[i % boxes.length]
    await page.mouse.move(...at)
    await page.mouse.move(...empty)
  })
  await page.mouse.move(...empty)
  await page.mouse.down()
  let x = 700
  await measure('drag the canvas', 30, async i => { await page.mouse.move((x += i % 2 ? 6 : -4), 880 - (i % 3)) })
  await page.mouse.up()
  await page.getByRole('button', { name: /explorer/i }).first().click().catch(() => page.mouse.click(22, 66))
  await page.waitForTimeout(500)
  const sash = page.locator('.sash').first()
  if ((await sash.count()) > 0) {
    const box = (await sash.boundingBox())!
    const sx = box.x + box.width / 2
    await page.mouse.move(sx, 450)
    await page.mouse.down()
    let w = sx
    await measure('drag the navigator edge', 30, async i => { await page.mouse.move((w += i % 2 ? 7 : -5), 450) })
    await page.mouse.up()
    const moved = (await sash.boundingBox())!.x - box.x
    console.log(`  (the edge moved ${Math.round(moved)} px)`)
  }
  await measure('click a box, then the empty canvas', 10, async i => {
    const at = boxes[i % boxes.length]
    await page.mouse.click(...at)
    await page.mouse.click(...empty)
  })
} finally {
  await browser.close()
  await server.close()
  await rm(root, { recursive: true, force: true })
}
