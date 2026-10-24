import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The Flows tab over Plum, whose flows are filed in folders under flows/ and tagged: the tree, the tag filter, the search, and that both themes read.

async function openFlows(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('/#ordering')
  await page.locator('.react-flow__node').first().waitFor()
  const tab = page.getByRole('button', { name: /^Flows/ })
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click()
  await page.locator('.flow-item').first().waitFor()
}

const folders = (page: Page) => page.locator('.navscroll .group-head.folder .name').allTextContents()
const rows = (page: Page) => page.locator('.navscroll .flow-item')

test('the Flows tab lists the flows as the folders they are filed in, folders first and flows by file name', async ({ page }) => {
  await openFlows(page)
  expect(await folders(page)).toEqual(['delivery', 'ordering', 'payments', 'stripe'])
  expect(await rows(page).count()).toBe(20)
  const names = await page.locator('.navscroll .flow-row .name').allTextContents()
  // delivery's flows come in file-name order (courier-pings-lost, deliver-order, events-arrive-late ...), not in the order of their titles
  expect(names.slice(0, 3)).toEqual(['Courier pings are lost', 'A courier delivers it', 'Dispatch hears about an order late'])
})

test('a folder folds away with its flows, and keeps its count', async ({ page }) => {
  await openFlows(page)
  const ordering = page.locator('.group-head.folder', { hasText: 'ordering' })
  await expect(ordering.locator('.muted')).toHaveText('7')
  await ordering.click()
  await expect(ordering).toHaveAttribute('aria-expanded', 'false')
  expect(await rows(page).count()).toBe(13)
  await expect(ordering.locator('.muted')).toHaveText('7')
  await ordering.click()
  expect(await rows(page).count()).toBe(20)
})

test('the tags in use filter the list, and pressing one again lets the flows back', async ({ page }) => {
  await openFlows(page)
  const bar = page.getByRole('group', { name: 'Tags' })
  expect(await bar.getByRole('button').allTextContents()).toEqual(['error path9', 'happy path7', 'edge case3', 'background2', 'recovery2'])
  await bar.getByRole('button', { name: /^error path/ }).click()
  expect(await rows(page).count()).toBe(9)
  await expect(page.locator('.navscroll .navnote').first()).toHaveText('9 of 20 flows')
  expect(await folders(page)).toEqual(['delivery', 'ordering', 'payments', 'stripe'])
  await bar.getByRole('button', { name: /^recovery/ }).click() // any of the tags, so recovery adds nothing here: every recovery flow is an error path too
  expect(await rows(page).count()).toBe(9)
  await bar.getByRole('button', { name: /^error path/ }).click()
  expect(await rows(page).count()).toBe(2)
  await bar.getByRole('button', { name: /^recovery/ }).click()
  expect(await rows(page).count()).toBe(20)
})

test('the search matches a folder or a tag, opens the folders that have a match, and says when nothing does', async ({ page }) => {
  await openFlows(page)
  await page.locator('.group-head.folder', { hasText: 'payments' }).click() // folded
  await page.getByRole('textbox', { name: 'Find a flow' }).fill('stripe')
  expect(await folders(page)).toEqual(['payments', 'stripe'])
  expect(await rows(page).count()).toBe(2)
  await page.getByRole('textbox', { name: 'Find a flow' }).fill('background')
  expect(await rows(page).count()).toBe(2)
  await page.getByRole('textbox', { name: 'Find a flow' }).fill('zzzz')
  expect(await rows(page).count()).toBe(0)
  await expect(page.locator('.navscroll .navnote')).toContainText('No flow matches')
})

for (const theme of ['light', 'dark'] as const) {
  test(`the Flows tab has no serious accessibility problem, ${theme}`, async ({ page }) => {
    await openFlows(page, theme)
    const result = await new AxeBuilder({ page }).include('.navpanel').analyze()
    const found = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id} (${v.impact}) on ${v.nodes.length} element(s): ${v.nodes[0]?.target.join(' ')}`)
    expect(found).toEqual([])
  })

  test(`the Flows tab is no wider than its panel, ${theme}`, async ({ page }) => {
    await openFlows(page, theme)
    const over = await page.evaluate(() => {
      const list = document.querySelector('.navscroll')!
      return list.scrollWidth - list.clientWidth
    })
    expect(over).toBeLessThanOrEqual(0)
  })
}
