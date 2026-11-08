import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// A control that was used keeps the keyboard focus, and while it has it the keys go to it instead of the page. A native select did this after its list closed,
// and an arrow key then changed the setting instead of stepping the load. These check that a dropdown used with the mouse lets go, and one used with the keys does not
// take the page's keys, and that the run list leaves the page its keys too.

const RUN = '/#delivery/perf/dinner-rush/3'

const level = (page: Page) => Number(new URL(page.url()).hash.split('/').at(-1))
const dropdown = (page: Page) => page.getByRole('combobox', { name: 'Line style' })
const runList = (page: Page) => page.getByRole('list', { name: 'Run' })
const runRow = (page: Page, name: string) => runList(page).getByRole('button', { name, exact: true })
// Let go: the focus is on the page, or on the canvas a click landed on (it takes the focus so a field gives it up, and is no tab stop).
const onPage = (page: Page) => page.evaluate(() => document.activeElement === document.body || document.activeElement?.matches('main.canvas') === true)

async function openRun(page: Page) {
  await page.goto(RUN)
  await runList(page).waitFor()
}

test('Esc on a list opened with the mouse closes it and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(4) // stepped the load, and the setting is the one it was
  await expect(dropdown(page)).toHaveText('Lines: straight')
})

test('picking the row that is already chosen closes the list and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.getByRole('option', { name: 'Lines: straight' }).click()
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
})

test('picking another row changes the setting and lets go of the focus', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.getByRole('option', { name: 'Lines: curved' }).click()
  await expect(dropdown(page)).toHaveText('Lines: curved')
  expect(await onPage(page)).toBe(true)
})

test('a click elsewhere closes the list', async ({ page }) => {
  await openRun(page)
  await dropdown(page).click()
  await page.locator('.react-flow__pane').click({ position: { x: 1000, y: 30 } }) // clear of the panel and of the shapes, which are fitted beside it
  await expect(page.getByRole('listbox')).toBeHidden()
  expect(await onPage(page)).toBe(true)
})

test('with the keys, the arrows pick a row and Enter takes it; the focus stays, and left and right still belong to the page', async ({ page }) => {
  await openRun(page)
  await dropdown(page).focus()
  await page.keyboard.press('ArrowDown') // opens
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(dropdown(page)).toHaveText('Lines: curved')
  await expect(dropdown(page)).toBeFocused()
  const before = level(page)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(before + 1)
  await expect(dropdown(page)).toHaveText('Lines: curved')
})

test('the arrows move the highlight and do not step the load while the list is open', async ({ page }) => {
  await openRun(page)
  await dropdown(page).focus()
  await page.keyboard.press('Enter')
  const before = level(page)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(before)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(dropdown(page)).toBeFocused() // the keys opened it, so the keys close it with the focus kept
})

test('a row of the run list picks the run, and the page keeps its keys', async ({ page }) => {
  await openRun(page)
  await runRow(page, 'Courier pings').click()
  await expect(runRow(page, 'Courier pings')).toHaveAttribute('aria-current', 'true')
  await expect(runRow(page, 'Dinner rush')).toHaveAttribute('aria-current', 'false')
  const before = level(page)
  await page.keyboard.press('ArrowLeft')
  expect(level(page)).toBe(before - 1)
  await expect(runRow(page, 'Courier pings')).toHaveAttribute('aria-current', 'true')
})

test('the run list is one Tab stop: up, down, Home and End go through the runs with the focus on the row, and left and right stay with the page', async ({ page }) => {
  await openRun(page)
  await expect(runList(page).locator('button[tabindex="0"]')).toHaveCount(1)
  await runRow(page, 'Dinner rush').focus()
  await page.keyboard.press('ArrowDown')
  await expect(runRow(page, 'Dinner rush, ETA calls batched')).toBeFocused()
  await expect(runRow(page, 'Dinner rush, ETA calls batched')).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('End')
  await expect(runRow(page, 'Orders and pings, added Compare pair')).toBeFocused()
  await page.keyboard.press('ArrowDown') // stays on the last
  await expect(runRow(page, 'Orders and pings, added Compare pair')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(runRow(page, 'Dinner rush')).toBeFocused()
  const before = level(page)
  await page.keyboard.press('ArrowRight')
  expect(level(page)).toBe(before + 1)
  await expect(runRow(page, 'Dinner rush')).toHaveAttribute('aria-current', 'true')
})

test('past four runs the list scrolls inside itself, and a run opened by its link is in view without moving the panel', async ({ page }) => {
  await page.goto('/#delivery/perf/together/3,3')
  await runList(page).waitFor()
  const fit = await runList(page).evaluate(list => {
    const box = list.getBoundingClientRect()
    const row = list.querySelector('[aria-current="true"]')!.getBoundingClientRect()
    return { height: box.height, scrolls: list.scrollHeight > list.clientHeight, inView: row.top >= box.top && row.bottom <= box.bottom, rowHeight: row.height, panel: list.closest('.perf')!.scrollTop }
  })
  expect(fit).toEqual({ height: 150, scrolls: true, inView: true, rowHeight: 32, panel: 0 })
})
