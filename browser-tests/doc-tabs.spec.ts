import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The row of tabs on the Plum demo: it shows from two open models on, a sketch sits beside its model inside one outline, and a tab goes back to the place it was left.

const SKETCH = (id: string) => `/?model=sketches%2F${id}`

const groups = (page: Page) => page.locator('.docgroup').evaluateAll(els => els.map(g => [...g.querySelectorAll('.name')].map(n => n.textContent)))

test('one model shows no row, and a sketch opened from the Explorer joins its model', async ({ page }) => {
  await page.goto('/')
  await page.locator('.react-flow__node').first().waitFor()
  await expect(page.locator('.doctabs')).toHaveCount(0)

  await page.keyboard.press('o')
  await page.getByRole('link', { name: 'Group orders' }).click()
  await page.getByRole('navigation', { name: 'Open tabs' }).waitFor()
  expect(await groups(page)).toEqual([['Plum', 'Group orders']])
  await expect(page.locator('.doctab.active .name')).toHaveText('Group orders')
})

test('a second sketch lands in the same outline, and closing the one on show goes back along it', async ({ page }) => {
  await page.goto('/')
  await page.locator('.react-flow__node').first().waitFor()
  await page.goto(SKETCH('group-orders'))
  await page.locator('.doctabs').waitFor()
  await page.goto(SKETCH('embedded-device'))
  await page.locator('.doctabs').waitFor()
  await expect.poll(() => groups(page)).toEqual([['Plum', 'Group orders', 'Embedded device']])

  await page.getByRole('button', { name: 'Close Embedded device' }).click()
  await expect(page).toHaveURL(/group-orders/)
  await expect.poll(() => groups(page)).toEqual([['Plum', 'Group orders']])

  await page.getByRole('button', { name: 'Close Plum' }).click()
  await expect(page.locator('.doctabs')).toHaveCount(0) // one tab left: nothing to go between
})

test('a sketch opened on its own shows no row, and a tab goes back to where it was left', async ({ page }) => {
  await page.goto(SKETCH('group-orders'))
  await page.locator('.react-flow__node').first().waitFor()
  await expect(page.locator('.doctabs')).toHaveCount(0)
  await page.goto('/#delivery')
  await page.locator('.doctabs').waitFor()
  await page.locator('.doctab a').nth(1).click()
  await expect(page).toHaveURL(/group-orders/)
  await page.locator('.doctab a').first().click()
  await expect(page).toHaveURL(/#delivery/)
})
