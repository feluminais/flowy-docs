import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Connection } from '../src/core/model.ts'
import { serveModel, systems } from './serve.ts'

// A pair with more lines than fit across its shapes, in a project that draws a line for each connection: a trunk with a chip, its key item, and the lines it opens into.

const lines = (n: number): Connection[] => Array.from({ length: n }, (_, i) => ({ from: 'ui', to: 'management', label: `Line ${i + 1}` }))
const edges = (page: Page) => page.locator('.react-flow__edge')

test('nine lines of a pair are one trunk with a chip, two hairlines and a key item; a click opens the lines, a click on the pane shuts them', async ({ page }) => {
  const s = await serveModel(systems(['ui', 'management', 'linux'], [...lines(9), { from: 'management', to: 'linux', label: 'Apply' }], { pairs: 'separate' }))
  try {
    await page.goto(s.url)
    await expect(edges(page)).toHaveCount(2) // the trunk and the line to Linux
    const trunk = edges(page).first()
    await expect(trunk.locator('.trunk-chip text')).toHaveText('9')
    await expect(trunk.locator('path.trunk-hair')).toHaveCount(2)
    await expect(trunk).toHaveAttribute('aria-label', 'from UI to MANAGEMENT, 9 connections')
    await expect(page.locator('.kind-key').getByText('Stacked lines')).toBeVisible()
    await expect(page.locator('.kind-key').getByText('In use')).toHaveCount(0)
    // The chip is part of the line: it takes no clicks, and a click on the line opens the trunk into its nine lines.
    await trunk.locator('path.react-flow__edge-path').first().click({ force: true })
    await expect(edges(page)).toHaveCount(9 + 1)
    await expect(page.locator('.react-flow__edge .trunk-chip')).toHaveCount(0)
    await expect(page.locator('.kind-key').getByText('Stacked lines')).toHaveCount(0)
    // The panel names the first of them, and lists every connection of the pair.
    await expect(page.locator('.line.card')).toHaveCount(9)
    await expect(page.locator('.line.card.current')).toHaveCount(1)
    // The pane shuts the trunk again.
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await expect(edges(page)).toHaveCount(2)
    await expect(edges(page).first().locator('.trunk-chip text')).toHaveText('9')
  } finally {
    await s.close()
  }
})

test('pointing at a connection in the list of a box lights the trunk it is in', async ({ page }) => {
  const s = await serveModel(systems(['ui', 'management'], lines(9), { pairs: 'separate' }))
  try {
    await page.goto(s.url)
    await page.locator('.react-flow__node[data-id="ui"]').click()
    // The row of the pair in the list lights the trunk; so does a connection inside it, by its own id.
    const row = page.locator('.panel li.row').first()
    await row.hover()
    await expect(edges(page).first().locator('path.react-flow__edge-path.hot')).toHaveCount(1)
    await expect(edges(page).first().locator('path.trunk-hair.hot')).toHaveCount(2)
    await page.locator('.panel').hover({ position: { x: 5, y: 5 } })
    await expect(edges(page).first().locator('path.react-flow__edge-path.hot')).toHaveCount(0)
    await row.locator('summary').click()
    await row.locator('details li').nth(3).hover()
    await expect(edges(page).first().locator('path.react-flow__edge-path.hot')).toHaveCount(1)
  } finally {
    await s.close()
  }
})

test('eight lines of a pair fit and are eight lines, with no key item for stacks', async ({ page }) => {
  const s = await serveModel(systems(['ui', 'management'], lines(8), { pairs: 'separate' }))
  try {
    await page.goto(s.url)
    await expect(edges(page)).toHaveCount(8)
    await expect(page.locator('.react-flow__edge .trunk-chip')).toHaveCount(0)
    await expect(page.locator('.kind-key')).toHaveCount(0)
  } finally {
    await s.close()
  }
})

test('a step plays on a lane beside a trunk and on a line in the trunk: the key says "In use" and "Stacked lines", and the trunk is lit as one', async ({ page }) => {
  const model = systems(['ui', 'management'], [...lines(9), { from: 'management', to: 'ui', label: 'Back' }], { pairs: 'separate' })
  model.flows = {
    f: {
      name: 'F', view: 'root', steps: [
        { from: 'management', to: 'ui', text: 'Answers on the back line', via: 'Back', animation: 'send' },
        { from: 'ui', to: 'management', text: 'Asks on one of the nine', via: 'Line 4', animation: 'send' },
      ],
    },
  }
  const s = await serveModel(model, 'flowy-trunks-flow-')
  try {
    await page.goto(`${s.url}#root/f`)
    await page.locator('.player').waitFor()
    const trunk = page.getByRole('group', { name: /^1 of 2, from UI to MANAGEMENT, 9 connections/ })
    const back = page.getByRole('group', { name: /^2 of 2, from MANAGEMENT to UI, Back/ })
    await expect(back).toHaveClass(/active/)
    await expect(trunk).toHaveClass(/kin/)
    await expect(page.locator('.kind-key').getByText('In use')).toBeVisible()
    await expect(page.locator('.kind-key').getByText('Stacked lines')).toBeVisible()
    // The step on a line the trunk stands for lights the trunk, and the back line is its kin.
    await page.locator('.player').getByRole('button', { name: 'Next' }).click()
    await expect(trunk).toHaveClass(/active/)
    await expect(back).toHaveClass(/kin/)
  } finally {
    await s.close()
  }
})
