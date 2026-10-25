import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// What a reader gets from the canvas and the navigator without the picture: names for connections, regions and the current level, the nesting of folders, which flow a pair
// mark compares with, a state key whose marks are drawn small, and a view fitted to the room beside the open navigator. Over Plum.

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`)
  await page.locator('.react-flow__node').first().waitFor()
}

test('a connection is named by its shapes and its label, never by ids', async ({ page }) => {
  await open(page, '#ordering')
  await expect(page.getByRole('group', { name: /^Edge from / })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Customer app to Order API, REST' })).toHaveCount(1)
})

test('the level you are on is the current page, not an unavailable button', async ({ page }) => {
  await open(page, '#ordering')
  const here = page.getByRole('navigation', { name: 'Zoom level' }).getByRole('button', { name: 'Ordering' })
  await expect(here).toHaveAttribute('aria-current', 'page')
  await expect(here).toBeEnabled()
  await expect(page.getByRole('navigation', { name: 'Zoom level' }).getByRole('button', { name: /Overview/ })).not.toHaveAttribute('aria-current', 'page')
})

test('the two side panels have names, and so do their close buttons', async ({ page }) => {
  await open(page, '#ordering')
  await page.getByRole('button', { name: /^Explorer/ }).click()
  await expect(page.getByRole('complementary', { name: 'Navigator' })).toBeVisible()
  await page.getByRole('button', { name: 'Close navigator' }).click()
  await expect(page.getByRole('complementary', { name: 'Navigator' })).toHaveCount(0)
  await page.locator('.react-flow__node[data-id="order-api"]').click()
  await expect(page.getByRole('complementary', { name: 'Details' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page.getByRole('complementary', { name: 'Details' })).toHaveCount(0)
})

test('the Flows tab nests a folder inside the folder that holds it, and a pair mark names its partner', async ({ page }) => {
  await open(page, '#ordering')
  await page.getByRole('button', { name: /^Flows/ }).click()
  await expect(page.getByRole('group', { name: 'payments folder' }).getByRole('group', { name: 'stripe folder' })).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Compared with The refund is not recorded' })).toHaveCount(1)
  await expect(page.getByRole('img', { name: 'Compared with Support refunds an order' })).toHaveCount(1)
  // a row's own Compare button does not say the flow's name again: its row (a group named for the flow) does
  await expect(page.getByRole('group', { name: 'Support refunds an order' }).getByRole('button', { name: 'Compare', exact: true })).toHaveCount(1)
  // a tag button says whether it is pressed
  const tag = page.locator('.tagchip').first()
  await expect(tag).toHaveAttribute('aria-pressed', 'false')
  await tag.click()
  await expect(tag).toHaveAttribute('aria-pressed', 'true')
})

test('an Explorer row counts the shapes right inside it, as the canvas does, and says the rest in full', async ({ page }) => {
  await open(page, '')
  await page.getByRole('button', { name: /^Explorer/ }).click()
  const ordering = page.getByRole('treeitem', { name: /^Ordering/ })
  await expect(ordering.locator('.count > [aria-hidden]')).toHaveText('7 inside · 12 flows')
  await expect(ordering.locator('.count')).toHaveAttribute('title', '7 inside, 13 in all, 12 flows')
  await expect(page.locator('.react-flow__node[data-id="ordering"] .inside')).toHaveText('7 inside')
})

test('the key of states draws each mark small and names the shape inside that is in a state', async ({ page }) => {
  await open(page, '#ordering/stripe-outage')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  const key = page.locator('.player .keyrow')
  await expect(key).toContainText('Restarting')
  await expect(key).toContainText('Degraded inside: Checkout')
  for (const glyph of await key.locator('.state-glyph svg').all()) {
    const box = (await glyph.boundingBox())!
    expect(box.width).toBeLessThan(14) // the ring is 14 wide: the drawing in it must not take the outline's 26 by 16
    expect(box.height).toBeLessThan(14)
  }
  await expect(page.locator('.react-flow__node[data-id="order-api"] .state-glyph')).toHaveAttribute('title', 'Degraded inside: Checkout')
})

test('opening the navigator fits the view beside it, and closing it fits the whole window again', async ({ page }) => {
  await open(page, '')
  const nodes = page.locator('.react-flow__node')
  const leftOf = async () => Math.min(...(await nodes.evaluateAll(els => els.map(e => e.getBoundingClientRect().left))))
  const before = await leftOf()
  await page.getByRole('button', { name: /^Explorer/ }).click()
  const panel = (await page.locator('.navpanel').boundingBox())!
  await expect.poll(leftOf).toBeGreaterThanOrEqual(panel.x + panel.width)
  await page.getByRole('button', { name: 'Close navigator' }).click()
  await expect.poll(leftOf).toBeLessThan(panel.x + panel.width)
  expect(Math.abs((await leftOf()) - before)).toBeLessThan(2)
})

test('a view you have zoomed stays where you put it when the navigator opens', async ({ page }) => {
  await open(page, '')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.waitForTimeout(400)
  const viewport = () => page.locator('.react-flow__viewport').getAttribute('style')
  const before = await viewport()
  await page.getByRole('button', { name: /^Explorer/ }).click()
  await page.waitForTimeout(400)
  expect(await viewport()).toBe(before)
})

test('opening Details fits the view beside it, and closing it fits the window again, unless you moved the view', async ({ page }) => {
  await open(page, '')
  const nodes = page.locator('.react-flow__node')
  const rightOf = async () => Math.max(...(await nodes.evaluateAll(els => els.map(e => e.getBoundingClientRect().right))))
  await page.getByRole('navigation', { name: 'Side panel' }).getByRole('button', { name: 'Details' }).click()
  const details = page.getByRole('complementary', { name: 'Details' })
  await expect(details).toBeVisible()
  const left = (await details.boundingBox())!.x
  await expect.poll(rightOf).toBeLessThanOrEqual(left)
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect.poll(rightOf).toBeGreaterThan(left)
  // a click on a shape opens Details too, and every shape is beside it
  await page.locator('.react-flow__node[data-id="support"]').click()
  await expect(details).toBeVisible()
  await expect.poll(rightOf).toBeLessThanOrEqual(left)
})
