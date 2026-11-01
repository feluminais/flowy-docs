import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'

// The payload card on a paused dot, over Plum's "Customer places an order": step 2 is the Basket call, answered with Receipt; step 1 sends nothing.

const player = (page: Page) => page.locator('.player')
const button = (page: Page, name: 'Play' | 'Pause') => player(page).getByRole('button', { name, exact: true })
const dots = (page: Page, which = '.blob') => page.locator(`.motion g[data-beat]:has(> ${which}):visible`)
const card = (page: Page) => page.locator('.dot-card')
const hit = (page: Page) => page.locator('.dot-hit')

/** Plays the flow to step 2 and pauses while its first dot (or the one `which` picks) is on its way. */
async function pauseMidSend(page: Page, which = '.blob', path = '/#ordering/place-order', step = 'Step 2 of') {
  await page.goto(path)
  await player(page).waitFor()
  await button(page, 'Play').click()
  await expect(player(page)).toContainText(step)
  await dots(page, which).first().waitFor()
  await page.waitForTimeout(150)
  await button(page, 'Pause').click()
  await page.waitForTimeout(100) // the frame of the paused moment
}

async function hover(page: Page, target: Locator) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

type Box = { x: number; y: number; width: number; height: number }
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('paused mid-send, the dot under the pointer shows its payload beside it', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  await expect(card(page).getByRole('heading')).toHaveText('Basket')
  await expect(card(page).locator('figure.code-snippet').first()).toContainText('Shape')
  await expect(page.locator('.panel')).toHaveCount(0)
})

test('while the dot moves, hovering it shows nothing', async ({ page }) => {
  await page.goto('/#ordering/place-order')
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 2 of')
  await dots(page).first().waitFor()
  await expect(hit(page)).toHaveCount(0)
  await hover(page, dots(page).first())
  await expect(card(page)).toHaveCount(0)
})

test('the card stays while the pointer is on it, at most 380 by 320', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  await hover(page, card(page))
  await page.waitForTimeout(400)
  await expect(card(page)).toBeVisible()
  const box = (await card(page).boundingBox())!
  expect(box.width).toBeLessThanOrEqual(380)
  expect(box.height).toBeLessThanOrEqual(320)
})

test('the answer\'s dot shows the reply, coming back', async ({ page }) => {
  await pauseMidSend(page, '.blob.reply')
  await hover(page, hit(page).first())
  await expect(card(page).getByRole('heading')).toContainText('Receipt')
  await expect(card(page).getByRole('heading')).toContainText('comes back')
})

test('the card stays inside the canvas and off the player card', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  const shown = (await card(page).boundingBox())!
  const canvas = (await page.locator('.main-flow').boundingBox())!
  const bar = (await player(page).boundingBox())!
  expect(shown.x).toBeGreaterThanOrEqual(canvas.x)
  expect(shown.y).toBeGreaterThanOrEqual(canvas.y)
  expect(shown.x + shown.width).toBeLessThanOrEqual(canvas.x + canvas.width)
  expect(shown.y + shown.height).toBeLessThanOrEqual(canvas.y + canvas.height)
  expect(meets(shown, bar)).toBe(false)
})

test('Play closes the card', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  await button(page, 'Play').click()
  await expect(card(page)).toHaveCount(0)
})

test('Esc closes the card with the pointer still on the dot', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(player(page)).toBeVisible() // Esc went to the card, not to the player
})

test('leaving the dot closes the card', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  const canvas = (await page.locator('.main-flow').boundingBox())!
  await page.mouse.move(canvas.x + 20, canvas.y + 20)
  await page.waitForTimeout(400)
  await expect(card(page)).toHaveCount(0)
})

test('zooming closes the card', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  await page.mouse.wheel(0, -200)
  await expect(card(page)).toHaveCount(0)
})

test('a dot whose step sends nothing has no card', async ({ page }) => {
  // Step 6, Order events calling Dispatch back, names no payload.
  await page.goto('/#ordering/place-order')
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 2 of')
  for (const n of [3, 4, 5, 6]) {
    await player(page).getByRole('button', { name: 'Next', exact: true }).click()
    await expect(player(page)).toContainText(`Step ${n} of`)
  }
  await dots(page).first().waitFor()
  await button(page, 'Pause').click()
  await page.waitForTimeout(100)
  await expect(dots(page).first()).toBeVisible()
  await expect(hit(page)).toHaveCount(0)
})

test('a long payload keeps the card at most 380 by 320, and its code scrolls inside', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-dot-card-'))
  const model = shop()
  const shape = Array.from({ length: 400 }, (_, i) => `  field${i}: string`).join('\n')
  model.meta.payloads = { order: { name: 'Order', about: 'What the web app sends.', shape: { language: 'typescript', text: `type Order = {\n${shape}\n}` } } }
  model.flows.checkout.steps[1] = { ...model.flows.checkout.steps[1], animation: 'send', payload: 'order' }
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  try {
    await pauseMidSend(page, '.blob', `http://127.0.0.1:${server.port}/#shop/checkout`)
    await hover(page, hit(page).first())
    await expect(card(page)).toBeVisible()
    const box = (await card(page).boundingBox())!
    expect(box.width).toBeLessThanOrEqual(380)
    expect(box.height).toBeLessThanOrEqual(320)
    const code = (await card(page).locator('.code-block').first().boundingBox())!
    expect(code.height).toBeLessThanOrEqual(241) // as in the rows: a code block shows at most 240 pixels of itself
    const scrolls = await card(page).evaluate(el => [...el.querySelectorAll<HTMLElement>('*'), el as HTMLElement].some(e => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible'))
    expect(scrolls).toBe(true)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

/** Serves the small shop with step 2 sent as a burst of ten (three lost), carrying a payload long enough to scroll. */
async function burst() {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-dot-burst-'))
  const model = shop()
  const shape = Array.from({ length: 120 }, (_, i) => `  field${i}: string`).join('\n')
  model.meta.payloads = { order: { name: 'Order', about: 'What the web app sends.', shape: { language: 'typescript', text: `type Order = {\n${shape}\n}` } } }
  model.flows.checkout.steps[1] = { ...model.flows.checkout.steps[1], animation: { kind: 'send', outcome: 'lost', share: '30' } as never, payload: 'order' }
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  return { url: `http://127.0.0.1:${server.port}/#shop/checkout`, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

test('moved to another dot of a burst, the card goes beside it and starts at its top', async ({ page }) => {
  const s = await burst()
  try {
    // A burst's dots leave one after another: pause once three are on their way.
    await page.goto(s.url)
    await button(page, 'Play').click()
    await expect(player(page)).toContainText('Step 2 of')
    await dots(page).nth(2).waitFor()
    await button(page, 'Pause').click()
    await page.waitForTimeout(100)
    expect(await hit(page).count()).toBeGreaterThan(1)
    await hover(page, hit(page).first())
    await expect(card(page)).toBeVisible()
    await card(page).evaluate(el => { el.scrollTop = 200 })
    const first = (await card(page).boundingBox())!
    await hover(page, hit(page).last())
    await expect.poll(async () => (await card(page).boundingBox())?.y).not.toBe(first.y) // the line runs down here, so the dots differ in height
    expect(await card(page).evaluate(el => el.scrollTop)).toBe(0)
  } finally {
    await s.close()
  }
})

test('dragging the canvas closes the card, and it stays closed while the drag goes on', async ({ page }) => {
  await pauseMidSend(page)
  await hover(page, hit(page).first())
  await expect(card(page)).toBeVisible()
  const box = (await hit(page).first().boundingBox())!
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 })
  await page.waitForTimeout(100)
  await expect(card(page)).toHaveCount(0)
  await page.mouse.up()
})
