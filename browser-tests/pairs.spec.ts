import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'
import { serveModel, systems } from './serve.ts'

// The setting that makes a pair of shapes one line or a line for each connection, in the browser, over the small shop: the two drawn tiles of the Overview in edit mode, and the
// label field a drag opens where each connection has a line of its own.

async function serve(pairs?: 'separate') {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-pairs-browser-'))
  const model = shop()
  if (pairs) model.meta = { name: 'Shop', pairs }
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  return { dir, url: `http://127.0.0.1:${server.port}/`, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

const file = (dir: string) => readFile(join(dir, 'model.yaml'), 'utf8')
const tiles = (page: Page) => page.getByRole('radiogroup', { name: 'Lines between two shapes' })

test('the Overview offers Merged and Separate as drawn tiles in edit mode, and a pick writes pairs to model.yaml', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(s.url)
    await expect(tiles(page)).toHaveCount(0) // reading, not editing
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('button', { name: 'Details', exact: true }).click()
    await expect(tiles(page)).toBeVisible()
    await expect(tiles(page).getByRole('radio')).toHaveText(['Merged', 'Separate'])
    await expect(tiles(page).getByRole('radio', { name: 'Merged' })).toHaveAttribute('aria-checked', 'true')
    await expect(tiles(page).locator('svg').first()).toHaveAttribute('aria-hidden', 'true')
    expect(await tiles(page).getByRole('radio', { name: 'Merged' }).locator('svg path').count()).toBe(1) // one line between two boxes
    expect(await tiles(page).getByRole('radio', { name: 'Separate' }).locator('svg path').count()).toBe(3) // a line for each connection
    await tiles(page).getByRole('radio', { name: 'Separate' }).click()
    await expect.poll(() => file(s.dir)).toMatch(/^pairs: separate\r?$/m)
    await expect(tiles(page).getByRole('radio', { name: 'Separate' })).toHaveAttribute('aria-checked', 'true')
    await tiles(page).getByRole('radio', { name: 'Merged' }).click()
    await expect.poll(() => file(s.dir)).not.toMatch(/pairs/)
  } finally {
    await s.close()
  }
})

/** Drags from the bottom handle of one box onto another, as a person making a connection does. */
async function drag(page: Page, from: string, to: string) {
  const handle = await page.locator(`.react-flow__node[data-id="${from}"] .react-flow__handle.source`).boundingBox()
  const target = await page.locator(`.react-flow__node[data-id="${to}"]`).boundingBox()
  if (!handle || !target) throw new Error('the boxes are not on the canvas')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('a drag in a project with a line for each connection opens the label of the new connection for typing', async ({ page }) => {
  const s = await serve('separate')
  try {
    await page.goto(`${s.url}#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await drag(page, 'web', 'db')
    await expect.poll(() => file(s.dir)).toMatch(/from: web\r?\n\s+to: db/)
    await expect(page.getByLabel('Label', { exact: true })).toBeFocused()
  } finally {
    await s.close()
  }
})

test('a drag where each pair has one line opens the panel of the new line and leaves the cursor alone', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await drag(page, 'web', 'db')
    await expect.poll(() => file(s.dir)).toMatch(/from: web\r?\n\s+to: db/)
    await expect(page.getByLabel('Label', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Label', { exact: true })).not.toBeFocused()
  } finally {
    await s.close()
  }
})

// Three lines between two systems, each a line of its own: which one a click or the pointer means, the card it opens, and the order the cards can be moved in.

const THREE = () => serveModel(systems(['a', 'b'], [
  { from: 'a', to: 'b', label: 'One', kind: 'request' }, { from: 'a', to: 'b', label: 'Two' }, { from: 'a', to: 'b', label: 'Three', kind: 'publish' },
], { pairs: 'separate' }))

/** The middle of a line on the screen. */
async function middleOf(page: Page, place: number) {
  return page.getByRole('group', { name: new RegExp(`^${place} of 3, `) }).locator('.react-flow__edge-path').evaluate(path => {
    const line = path as unknown as SVGGeometryElement
    const p = line.getPointAtLength(line.getTotalLength() / 2)
    const at = new DOMPoint(p.x, p.y).matrixTransform(line.getScreenCTM()!)
    return { x: at.x, y: at.y }
  })
}

/** Waits for the pair to finish spreading or closing (it takes 160 ms): the paths of the lines stop changing. */
async function settled(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = await page.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(p => p.getAttribute('d')).join('|'))
    const same = now === last
    last = now
    return same
  }, { intervals: [60] }).toBe(true)
}

test('a click on a line of a pair picks that line, its card is marked, the pointer lights only it, and a second click closes the panel', async ({ page }) => {
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    const [first, second, third] = [await middleOf(page, 1), await middleOf(page, 2), await middleOf(page, 3)]
    // Lanes are 12 apart, the lanes of the pair are not spread yet, and each strip is as wide as they are apart.
    expect(Math.round(Math.hypot(second.x - first.x, second.y - first.y))).toBe(12)
    await page.mouse.move(second.x, second.y)
    await expect(page.locator('.react-flow__edge-path.hot')).toHaveCount(1)
    await expect(page.getByRole('group', { name: /^2 of 3, / }).locator('.react-flow__edge-path.hot')).toHaveCount(1)
    await page.mouse.move(third.x, third.y)
    await expect(page.getByRole('group', { name: /^3 of 3, / }).locator('.react-flow__edge-path.hot')).toHaveCount(1)
    await page.mouse.click(second.x, second.y)
    const card = page.locator('section.line.card[aria-current="true"]')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Two')
    await expect(page.locator('section.line.card')).toHaveCount(3)
    await expect(page.getByRole('group', { name: /^2 of 3, / })).toHaveClass(/selected/)
    // The pair is spread now (every line shows its label), and the line is where it was clicked or near it: the next click picks another.
    await expect(page.locator('.lane-pill')).toHaveCount(3)
    expect((await page.locator('.lane-pill').allTextContents()).sort()).toEqual(['One', 'Three', 'Two'])
    await settled(page)
    // Picking a line does not reorder the lines in the page, so Tab keeps visiting them in lane order.
    expect(await page.locator('.react-flow__edge').evaluateAll(els => els.map(e => e.getAttribute('aria-label')?.slice(0, 6)))).toEqual(['1 of 3', '2 of 3', '3 of 3'])
    const spreadFirst = await middleOf(page, 1)
    await page.mouse.click(spreadFirst.x, spreadFirst.y)
    await expect(page.locator('section.line.card[aria-current="true"]')).toContainText('One')
    await page.mouse.click(spreadFirst.x, spreadFirst.y) // the same line again: closes
    await expect(page.locator('section.line.card')).toHaveCount(0)
    await page.mouse.move(5, 5)
    await expect(page.locator('.lane-pill')).toHaveCount(0)
  } finally {
    await s.close()
  }
})

/** Starts writing down, on every frame, how far apart the middles of the first and the second line of the pair are on the screen, in pixels: `window.lanesSeen`. */
async function watchOuterLine(page: Page) {
  await page.evaluate(() => {
    const [outer, middle] = [...document.querySelectorAll<SVGGeometryElement>('.react-flow__edge-path')]
    const seen: number[] = []
    ;(window as unknown as { lanesSeen: number[] }).lanesSeen = seen
    const middleOf = (path: SVGGeometryElement) => {
      const p = path.getPointAtLength(path.getTotalLength() / 2)
      return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    }
    const tick = () => {
      const [a, b] = [middleOf(outer), middleOf(middle)]
      seen.push(Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 100) / 100)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const seenSoFar = (page: Page) => page.evaluate(() => (window as unknown as { lanesSeen: number[] }).lanesSeen)

test('a pair eases out to spread over about 160 ms when a line of it is picked, and eases back when the pick goes', async ({ page }) => {
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    const second = await middleOf(page, 2)
    await watchOuterLine(page)
    await page.waitForTimeout(100)
    await page.mouse.click(second.x, second.y)
    await expect(page.locator('.lane-pill')).toHaveCount(3)
    await settled(page)
    const out = await seenSoFar(page)
    const rest = out[0]
    const spread = out.at(-1)!
    expect(spread / rest).toBeCloseTo(22 / 12, 1) // the outer line goes from 12 to 22 px off the middle one
    // Between the two it was seen on several frames, each further than the one before, and never beyond the end.
    const between = out.filter(y => Math.abs(y - rest) > 0.2 && Math.abs(y - spread) > 0.2)
    expect(between.length).toBeGreaterThanOrEqual(3)
    expect(between.length).toBeLessThan(16) // 160 ms is about ten frames, not a slow crawl
    const sign = Math.sign(spread - rest)
    for (let i = 1; i < out.length; i++) expect((out[i] - out[i - 1]) * sign).toBeGreaterThanOrEqual(-0.011)
    // Closing it takes the same way back.
    const closeFrom = out.length
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.lane-pill')).toHaveCount(0)
    await settled(page)
    const back = (await seenSoFar(page)).slice(closeFrom)
    expect(back.at(-1)).toBeCloseTo(rest, 1)
    expect(back.filter(y => Math.abs(y - rest) > 0.2 && Math.abs(y - spread) > 0.2).length).toBeGreaterThanOrEqual(3)
  } finally {
    await s.close()
  }
})

test('with reduced motion a pair snaps to spread and back in one frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    const second = await middleOf(page, 2)
    await watchOuterLine(page)
    await page.waitForTimeout(100)
    await page.mouse.click(second.x, second.y)
    await expect(page.locator('.lane-pill')).toHaveCount(3)
    await page.waitForTimeout(400)
    const seen = await seenSoFar(page)
    expect(new Set(seen).size).toBe(2) // where it was, and where it went: never anywhere between
  } finally {
    await s.close()
  }
})

test('the line pointed at among its pair is on top of the others, which fade to 85 percent', async ({ page }) => {
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    const [first, second] = [await middleOf(page, 1), await middleOf(page, 2)]
    const z = (place: string) => page.getByRole('group', { name: new RegExp(`^${place} of 3, `) }).evaluate(g => getComputedStyle(g.closest('svg')!).zIndex)
    const faded = () => page.getByRole('group', { name: /of 3, / }).evaluateAll(gs => gs.map(g => g.querySelector('.lane-mate') === null ? 1 : Number(getComputedStyle(g.querySelector('.lane-mate')!).opacity)))
    expect(await faded()).toEqual([1, 1, 1])
    await page.mouse.move(second.x, second.y)
    await expect(page.locator('.react-flow__edge-path.raised')).toHaveCount(1)
    expect(await faded()).toEqual([0.85, 1, 0.85])
    expect(await z('2')).toBe('2') // over the other two, which have React Flow's own 0
    expect(await z('1')).toBe('0')
    expect(await z('3')).toBe('0')
    await page.mouse.move(first.x, first.y)
    await expect(page.getByRole('group', { name: /^1 of 3, / }).locator('.react-flow__edge-path.raised')).toHaveCount(1)
    expect(await faded()).toEqual([1, 0.85, 0.85])
    await page.mouse.move(5, 5)
    await expect(page.locator('.react-flow__edge-path.raised')).toHaveCount(0)
    expect(await faded()).toEqual([1, 1, 1])
  } finally {
    await s.close()
  }
})

test('pointing at a card of the panel lights its line; in edit mode Move down and Move up change the order of the connections in the file', async ({ page }) => {
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    const middle = await middleOf(page, 2)
    await page.mouse.click(middle.x, middle.y)
    await page.locator('section.line.card').nth(2).hover()
    await expect(page.getByRole('group', { name: /^3 of 3, / }).locator('.react-flow__edge-path.hot')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Move up' })).toHaveCount(0) // reading, not editing
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const cards = page.locator('section.line.card')
    await expect(cards).toHaveCount(3)
    await expect(cards.nth(0).getByRole('button', { name: 'Move up' })).toBeDisabled()
    await expect(cards.nth(0).getByRole('button', { name: 'Move up' })).toHaveAttribute('title', 'Already first')
    await expect(cards.nth(2).getByRole('button', { name: 'Move down' })).toBeDisabled()
    await cards.nth(0).getByRole('button', { name: 'Move down' }).click()
    await expect.poll(() => file(s.dir).then(text => text.match(/label: (\w+)/g))).toEqual(['label: Two', 'label: One', 'label: Three'])
    await expect(cards.nth(0).getByLabel('Label', { exact: true })).toHaveValue('Two')
    await cards.nth(2).getByRole('button', { name: 'Move up' }).click()
    await expect.poll(() => file(s.dir).then(text => text.match(/label: (\w+)/g))).toEqual(['label: Two', 'label: Three', 'label: One'])
  } finally {
    await s.close()
  }
})

test('a connection with no other going its way keeps Move up and Move down, greyed out with the reason', async ({ page }) => {
  const s = await serveModel(systems(['a', 'b'], [{ from: 'a', to: 'b', label: 'Out' }, { from: 'b', to: 'a', label: 'Back' }], { pairs: 'separate' }))
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('group', { name: /^1 of 2, / }).locator('.react-flow__edge-path').click({ force: true })
    const cards = page.locator('section.line.card')
    await expect(cards).toHaveCount(2)
    for (const card of await cards.all()) {
      for (const name of ['Move up', 'Move down']) {
        const button = card.getByRole('button', { name })
        await expect(button).toBeVisible()
        await expect(button).toBeDisabled()
        await expect(button).toHaveAttribute('title', 'Only line this way')
      }
    }
  } finally {
    await s.close()
  }
})

test('recording a flow, a click on a line picks the step\'s ends and the line it rides, and the step is saved with its via', async ({ page }) => {
  const s = await THREE()
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').first().waitFor()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('button', { name: 'New flow', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Scan')
    await page.getByRole('button', { name: 'Start recording' }).click()
    const middle = await middleOf(page, 3)
    await page.mouse.click(middle.x, middle.y)
    await expect(page.getByRole('group', { name: /^3 of 3, / })).toHaveClass(/active/) // the line the step will ride is lit
    await page.getByPlaceholder('What happens? Press Enter').fill('Three is published')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readFile(join(s.dir, 'flows', 'scan.yaml'), 'utf8').catch(() => ''))).toMatch(/via: Three/)
    const saved = await readFile(join(s.dir, 'flows', 'scan.yaml'), 'utf8')
    expect(saved).toMatch(/from: a\r?\n\s+to: b/)
  } finally {
    await s.close()
  }
})

test('the labels of a pair with many lines sit in rows beside their lines, none over another, between the shapes', async ({ page }) => {
  const labels = ['reads settings', 'saves settings', 'starts a scan', 'announces changes', 'publishes the network', 'calls vendor hooks']
  const model = systems(['a', 'b'], labels.map((label, i) => (i < 3 ? { from: 'a', to: 'b', label } : { from: 'b', to: 'a', label })), { pairs: 'separate' })
  const s = await serveModel(model, 'flowy-pairs-many-')
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node').filter({ hasText: 'A' }).first().click()
    await expect(page.locator('.lane-pill').first()).toBeVisible()
    await page.waitForTimeout(500) // the pair spreads over 160 ms
    const { pills, a, b } = await page.evaluate(() => {
      const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      const nodes = [...document.querySelectorAll('.react-flow__node')]
      return { pills: [...document.querySelectorAll('.lane-pill')].map(box), a: box(nodes[0]), b: box(nodes[1]) }
    })
    expect(pills.length).toBeGreaterThanOrEqual(4) // those that find no room are left out; the panel lists every line
    for (const p of pills) {
      expect(p.top).toBeGreaterThanOrEqual(Math.min(a.bottom, b.bottom) - 1)
      expect(p.bottom).toBeLessThanOrEqual(Math.max(a.top, b.top) + 1)
    }
    pills.forEach((p, i) => pills.forEach((q, j) => {
      if (i < j) expect(p.left >= q.right || q.left >= p.right || p.top >= q.bottom || q.top >= p.bottom, `labels ${i} and ${j} do not overlap`).toBe(true)
    }))
  } finally {
    await s.close()
  }
})
