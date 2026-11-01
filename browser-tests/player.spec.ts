import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The flow player over Plum's "Customer places an order": Play and Pause freeze a step where it is and carry on from there.

async function openFlow(page: Page) {
  await page.goto('/#ordering/place-order')
  await page.locator('.player').waitFor()
}

const player = (page: Page) => page.locator('.player')
const button = (page: Page, name: 'Play' | 'Pause') => player(page).getByRole('button', { name, exact: true })
/** The dot running along the step's line, while it is drawn. */
const dot = (page: Page) => page.locator('.motion g[data-beat]:has(> .blob):visible').first()

test('Pause freezes the dot and Play carries on from there', async ({ page }) => {
  await openFlow(page)
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 2 of')
  await dot(page).waitFor() // the step's motion has begun
  await page.waitForTimeout(200)
  await button(page, 'Pause').click()
  const frozen = await dot(page).getAttribute('transform')
  await page.waitForTimeout(600)
  expect(await dot(page).getAttribute('transform')).toBe(frozen)
  await button(page, 'Play').click()
  await expect.poll(() => dot(page).getAttribute('transform')).not.toBe(frozen)
})

test('Pausing in the rest between steps does not move on', async ({ page }) => {
  await openFlow(page)
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 2 of')
  await expect(page.locator('.motion g[data-beat]:has(> .blob):visible')).toHaveCount(0, { timeout: 5000 }) // its motion is over: the rest before step 3
  await button(page, 'Pause').click()
  await page.waitForTimeout(2000)
  await expect(player(page)).toContainText('Step 2 of')
})

test('Next while paused stays paused on the first frame of the next step', async ({ page }) => {
  await openFlow(page)
  await button(page, 'Play').click()
  await page.waitForTimeout(300)
  await button(page, 'Pause').click()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
  await expect(button(page, 'Play')).toBeVisible()
  const first = await page.locator('.motion g[data-beat]').first().getAttribute('style')
  await page.waitForTimeout(600)
  expect(await page.locator('.motion g[data-beat]').first().getAttribute('style')).toBe(first)
})

// "The customer follows the courier": its second step opens the live map, a stream drawn as dots running along the line.
async function openLiveMap(page: Page) {
  await page.goto('/#delivery/follow-the-courier')
  await page.locator('.player').waitFor()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
}
const channel = (page: Page) => page.locator('svg.channels').first()
const opacity = (page: Page) => channel(page).evaluate(el => getComputedStyle(el).opacity)

test('Pause holds a channel that is opening', async ({ page }) => {
  await openLiveMap(page)
  await button(page, 'Pause').click() // the step's call has not landed yet, so the live map has not appeared
  await expect(button(page, 'Play')).toBeVisible()
  const held = await opacity(page)
  await page.waitForTimeout(4000) // longer than the call and the fade
  expect(await opacity(page)).toBe(held)
  await button(page, 'Play').click()
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
})

test('Pause stops the dots of an open stream', async ({ page }) => {
  await openLiveMap(page)
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
  await page.keyboard.press('p')
  await page.keyboard.press('p')
  const dots = page.locator('svg.channels .stream-dots').first()
  const offset = () => dots.evaluate(el => getComputedStyle(el).strokeDashoffset)
  const held = await offset()
  await page.waitForTimeout(500)
  expect(await offset()).toBe(held)
})

test('Play does not bring an open channel in again', async ({ page }) => {
  await openLiveMap(page)
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
  await page.keyboard.press('p')
  await page.keyboard.press('p')
  await page.keyboard.press('p')
  await page.waitForTimeout(100)
  expect(await opacity(page)).toBe('1')
})
