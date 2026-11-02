import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// What Plum's lines carry and its steps send: the Basket on customer app → order API, its Receipt back, the Card hold to Stripe.

async function ordering(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('/#ordering')
  await page.locator('.react-flow__node[data-id="customer-app"]').waitFor()
}

const panel = (page: Page) => page.locator('.panel')
const rows = (page: Page) => panel(page).locator('details.payload')

test('a connection\'s payloads fold out under it, closed, with the shape and the example', async ({ page }) => {
  await ordering(page)
  await page.locator('.react-flow__node[data-id="customer-app"]').click()
  const basket = panel(page).locator('.lines-of details.payload', { hasText: 'Basket' })
  await expect(basket).toBeVisible()
  await expect(basket).not.toHaveAttribute('open', '')
  await basket.locator('summary').click()
  await expect(basket.locator('figcaption', { hasText: 'Shape' })).toBeVisible()
  await expect(basket.locator('figcaption', { hasText: 'Example' })).toBeVisible()
  await expect(basket).toContainText('idempotency key')
})

test('the line panel lists what the line carries, the first open', async ({ page }) => {
  await ordering(page)
  await page.locator('.react-flow__edge[data-id="customer-app order-api"]').click({ force: true })
  await expect(panel(page).getByRole('heading', { name: /^Payloads/ })).toBeVisible()
  const first = rows(page).first()
  await expect(first).toHaveAttribute('open', '')
  await expect(first).toContainText('Basket')
  await expect(rows(page).nth(1)).toContainText('Receipt') // sent back by the place-order flow
  await expect(rows(page).nth(1)).toHaveAttribute('title', /Customer places an order, step 2 reply/)
})

test('the player card shows what a step sends and what comes back', async ({ page }) => {
  await page.goto('/#ordering/place-order')
  await page.locator('.player').waitFor()
  await page.locator('.player').getByRole('button', { name: 'Next' }).click()
  const sent = page.locator('.player details.payload')
  await expect(sent).toHaveCount(2)
  await expect(sent.nth(0)).toContainText('Basket')
  await expect(sent.nth(1)).toContainText('Receipt')
  await expect(sent.nth(0)).not.toHaveAttribute('open', '')
})

test('a long shape scrolls inside 240 px and keeps the panel its width', async ({ page }) => {
  await ordering(page)
  await page.locator('.react-flow__edge[data-id="customer-app order-api"]').click({ force: true })
  const before = await panel(page).evaluate(el => el.getBoundingClientRect().width)
  const block = rows(page).first().locator('.code-block').first()
  const box = await block.evaluate(el => ({ height: el.getBoundingClientRect().height, max: getComputedStyle(el).maxHeight, overflow: getComputedStyle(el).overflowY }))
  expect(box.max).toBe('240px')
  expect(['auto', 'scroll']).toContain(box.overflow)
  expect(await panel(page).evaluate(el => el.getBoundingClientRect().width)).toBe(before)
  expect(await panel(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

for (const theme of ['light', 'dark'] as const) {
  test(`opened payload rows have no serious accessibility problem, ${theme}`, async ({ page }) => {
    await ordering(page, theme)
    await page.locator('.react-flow__edge[data-id="customer-app order-api"]').click({ force: true })
    await rows(page).nth(1).locator('summary').click()
    const result = await new AxeBuilder({ page }).include('.panel').analyze()
    const found = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)
    expect(found).toEqual([])
  })
}

test('Details drags wider than 640 while a line of code runs past it, and stops once the line shows whole', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 })
  await page.goto('/#root')
  await page.locator('.react-flow__edge[data-id="ordering stripe"]').click({ force: true })
  const charge = rows(page).filter({ hasText: 'Charge event' })
  await charge.locator('summary').click()
  const example = charge.locator('pre.code-block').last() // the event on one line
  await expect(example).toBeVisible()
  const runsPast = () => example.evaluate(e => e.scrollWidth - e.clientWidth)
  expect(await runsPast()).toBeGreaterThan(0)
  const widthNow = () => panel(page).evaluate(e => e.getBoundingClientRect().width)
  const before = await widthNow()
  const sash = (await page.getByRole('separator', { name: 'Resize the details panel' }).boundingBox())!
  await page.mouse.move(sash.x + sash.width / 2, 300)
  await page.mouse.down()
  await page.mouse.move(sash.x - 1600, 300, { steps: 4 }) // its edge going left makes it wider
  await page.mouse.up()
  const width = await widthNow()
  expect(width).toBeGreaterThan(640)
  expect(width).toBeLessThan(before + 1600) // no wider than the line needs
  expect(await runsPast()).toBeLessThanOrEqual(1)
})
