import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'

// The setting that makes a pair of shapes one line or a line for each connection, in the browser, over the small shop: the two drawn tiles of the Overview in edit mode, and the
// label field a drag opens where each connection has a line of its own.

async function serve(pairs?: 'separate') {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-pairs-browser-'))
  const model = shop()
  if (pairs) model.meta = { name: 'Shop', pairs }
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  return { dir, url: `http://127.0.0.1:${server.port}/`, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

const file = (dir: string) => readFile(join(dir, 'model.yaml'), 'utf8')
const tiles = (page: Page) => page.getByRole('radiogroup', { name: 'Lines between two shapes' })

test('the Overview offers Merged and Separate as drawn tiles in edit mode, and a pick writes pairs to model.yaml', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(s.url)
    await expect(tiles(page)).toHaveCount(0) // reading, not editing
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByRole('button', { name: 'Details', exact: true }).click()
    await expect(tiles(page)).toBeVisible()
    await expect(tiles(page).getByRole('radio')).toHaveText(['Merged', 'Separate'])
    await expect(tiles(page).getByRole('radio', { name: 'Merged' })).toHaveAttribute('aria-checked', 'true')
    await expect(tiles(page).locator('svg').first()).toHaveAttribute('aria-hidden', 'true')
    expect(await tiles(page).getByRole('radio', { name: 'Merged' }).locator('svg path').count()).toBe(1) // one line between two boxes
    expect(await tiles(page).getByRole('radio', { name: 'Separate' }).locator('svg path').count()).toBe(3) // a line for each connection
    await tiles(page).getByRole('radio', { name: 'Separate' }).click()
    await expect.poll(() => file(s.dir)).toMatch(/^pairs: separate\r?$/m)
    await expect(tiles(page).getByRole('radio', { name: 'Separate' })).toHaveAttribute('aria-checked', 'true')
    await tiles(page).getByRole('radio', { name: 'Merged' }).click()
    await expect.poll(() => file(s.dir)).not.toMatch(/pairs/)
  } finally {
    await s.close()
  }
})

/** Drags from the bottom handle of one box onto another, as a person making a connection does. */
async function drag(page: Page, from: string, to: string) {
  const handle = await page.locator(`.react-flow__node[data-id="${from}"] .react-flow__handle.source`).boundingBox()
  const target = await page.locator(`.react-flow__node[data-id="${to}"]`).boundingBox()
  if (!handle || !target) throw new Error('the boxes are not on the canvas')
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('a drag in a project with a line for each connection opens the label of the new connection for typing', async ({ page }) => {
  const s = await serve('separate')
  try {
    await page.goto(`${s.url}#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await drag(page, 'web', 'db')
    await expect.poll(() => file(s.dir)).toMatch(/from: web\r?\n\s+to: db/)
    await expect(page.getByLabel('Label', { exact: true })).toBeFocused()
  } finally {
    await s.close()
  }
})

test('a drag where each pair has one line opens the panel of the new line and leaves the cursor alone', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await drag(page, 'web', 'db')
    await expect.poll(() => file(s.dir)).toMatch(/from: web\r?\n\s+to: db/)
    await expect(page.getByLabel('Label', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Label', { exact: true })).not.toBeFocused()
  } finally {
    await s.close()
  }
})
