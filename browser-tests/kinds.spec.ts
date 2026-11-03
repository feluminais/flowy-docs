import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'

// What a connection's kind looks like in the browser, over the small shop: the key at the foot of the canvas, the swatch at the head of a line's panel, the kind named on each
// connection's card, and the tiles that set it. The web app and the API publish to each other; the API asks the database; the web app streams from the database;
// the API calls the mail service as an extension point; the customer's line has no kind.

async function serve() {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-kinds-browser-'))
  const model = shop()
  const kind = (from: string, to: string, kind: string, extra: Record<string, unknown> = {}) => ({ from, to, ...extra, kind })
  model.connections = [
    { from: 'customer', to: 'web', label: 'browses' },
    kind('web', 'api', 'publish', { label: 'Start scan' }),
    kind('api', 'web', 'publish', { label: 'Progress' }),
    kind('api', 'db', 'request', { label: 'reads/writes' }),
    kind('web', 'db', 'stream', { label: 'reports' }),
    kind('api', 'mail', 'extension', { label: 'sends receipts' }),
  ] as typeof model.connections
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  return { url: `http://127.0.0.1:${server.port}/`, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

const key = (page: Page) => page.locator('.kind-key')
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`)
const header = (page: Page) => page.locator('.panel .hero.ends .look-swatch')

test('the key lists the kinds on the canvas in the order of the list, with the plain line last, each beside a drawing of it', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await expect(key(page)).toBeVisible()
    await expect(key(page).locator('li')).toHaveText(['Request and reply', 'Request then stream', 'Publish and subscribe', 'Extension point', 'Plain line'])
    await expect(key(page).locator('svg.look-swatch')).toHaveCount(5)
    await expect(key(page).locator('svg.look-swatch').first()).toHaveAttribute('aria-hidden', 'true')
    await expect(key(page)).not.toContainText('Cached publish') // a kind nothing on the canvas has is not in it
  } finally {
    await s.close()
  }
})

test("a line's panel draws a head at each end and no tail when its connections run both ways, and a head and a tail when they run one way", async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await edge(page, 'api web').click({ force: true })
    await expect(header(page)).toHaveCount(1)
    expect(await header(page).locator('path.kmark').count()).toBe(2)
    expect(await header(page).locator('path.kmark.stroke').count()).toBe(2) // an open head at each end, no tail
    await edge(page, 'api db').click({ force: true })
    await expect(header(page)).toHaveCount(1)
    expect(await header(page).locator('path.kmark.fill').count()).toBe(1) // the head
    expect(await header(page).locator('path.kmark.stroke, path.kmark.hollow').count()).toBe(1) // the tail
  } finally {
    await s.close()
  }
})

test('each connection on a line\'s card names its kind beside its drawing, and a plain one says so', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await edge(page, 'api web').click({ force: true })
    const rows = page.locator('.panel .kind-row')
    await expect(rows).toHaveText(['Publish and subscribe', 'Publish and subscribe'])
    await expect(rows.first().locator('svg.look-swatch')).toBeVisible()
    await edge(page, 'customer web').click({ force: true })
    await expect(page.locator('.panel .kind-row')).toHaveCount(0) // nothing on this line has a kind: no row says so
  } finally {
    await s.close()
  }
})

test('editing, the tiles are the plain line and the six kinds, the connection\'s own is picked, and choosing another saves it', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`${s.url}#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await edge(page, 'api db').click({ force: true })
    const tiles = page.locator('.panel').getByRole('radiogroup', { name: 'Kind' }).first().getByRole('radio')
    await expect(tiles).toHaveText(['Plain line', 'Request and reply', 'Request then stream', 'Publish and subscribe', 'Cached publish', 'Object updates', 'Extension point'])
    await expect(tiles.locator('svg.look-swatch')).toHaveCount(7)
    await expect(page.locator('.panel').getByRole('radio', { name: 'Request and reply', checked: true })).toHaveCount(1)
    await page.locator('.panel').getByRole('radio', { name: 'Cached publish' }).click()
    await expect(page.locator('.panel').getByRole('radio', { name: 'Cached publish', checked: true })).toHaveCount(1)
    await expect(key(page)).toContainText('Cached publish')
  } finally {
    await s.close()
  }
})

test("beside a flow's card the key stops short of it, with the navigator open too", async ({ page }) => {
  const s = await serve()
  try {
    await page.setViewportSize({ width: 2000, height: 800 }) // wide enough that the room left of the card is more than the least the key is given
    await page.goto(`${s.url}#shop/checkout`)
    await expect(page.locator('.player')).toBeVisible()
    await expect(key(page)).toBeVisible()
    const clear = async () => {
      const [k, p] = [(await key(page).boundingBox())!, (await page.locator('.player').boundingBox())!]
      return p.x - (k.x + k.width)
    }
    await expect.poll(clear).toBeGreaterThanOrEqual(0)
    await page.getByRole('button', { name: /^Explorer/ }).click()
    await expect(page.getByRole('complementary', { name: 'Navigator' })).toBeVisible()
    const nav = (await page.locator('.navpanel').boundingBox())!
    expect((await key(page).boundingBox())!.x).toBeGreaterThanOrEqual(nav.x + nav.width) // beside the navigator, not under it
    await expect.poll(clear).toBeGreaterThanOrEqual(0)
  } finally {
    await s.close()
  }
})
