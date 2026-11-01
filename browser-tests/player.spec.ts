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
