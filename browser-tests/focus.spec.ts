import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// A control that was used keeps the keyboard focus, and while it has it the keys go to it instead of the page. A native select did this after its list closed,
// and an arrow key then changed the run instead of stepping the load. These check that a dropdown used with the mouse lets go, and one used with the keys does not
// take the page's keys.

const RUN = '/#delivery/perf/dinner-rush/3'

const level = (page: Page) => Number(new URL(page.url()).hash.split('/').at(-1))
const dropdown = (page: Page) => page.getByRole('combobox', { name: 'Run' })
const onPage = (page: Page) => page.evaluate(() => document.activeElement === document.body)

async function openRun(page: Page) {
  await page.goto(RUN)
  await dropdown(page).waitFor()
}

test('Esc on a list opened with the mouse closes it and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(4) // stepped the load, and the run is the one it was
  await expect(dropdown(page)).toHaveText('Dinner rush')
})

test('picking the row that is already chosen closes the list and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.getByRole('option', { name: 'Dinner rush', exact: true }).click()
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
})

test('picking another row changes the run and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.getByRole('option', { name: 'Courier pings' }).click()
  await expect(dropdown(page)).toHaveText('Courier pings')
  expect(await onPage(page)).toBe(true)
})

test('a click elsewhere closes the list', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 400 } }) // clear of the panel
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
})

test('with the keys, the arrows pick a row and Enter takes it; the focus stays, and left and right still belong to the page', async ({ page }) => {
  await openRun(page)
  await dropdown(page).focus()
  await page.keyboard.press('ArrowDown') // opens
  await expect(page.getByRole('listbox')).toBeVisible()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dropdown(page)).toHaveText('Stripe outage')
  await expect(dropdown(page)).toBeFocused()
  const before = level(page)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(before + 1)
  await expect(dropdown(page)).toHaveText('Stripe outage')
})

test('the arrows move the highlight and do not step the load while the list is open', async ({ page }) => {
  await openRun(page)
  await dropdown(page).focus()
  await page.keyboard.press('Enter')
  const before = level(page)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('p')
  expect(level(page)).toBe(before)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(dropdown(page)).toBeFocused() // the keys opened it, so the keys close it with the focus kept
})
