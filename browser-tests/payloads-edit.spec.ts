import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Model } from '../src/core/model.ts'
import { modelFiles } from '../src/core/modelfiles.ts'
import { loadDir } from '../src/node/files.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'

// The edit forms for payloads, on a copy of the small shop: web → api carries nothing yet; the checkout flow's step 2 (web → api) is a call, step 3 a send.

async function serve(t: { model?: (m: Model) => void } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-payloads-edit-'))
  const model = shop()
  model.meta.payloads = { order: { name: 'Order', about: 'What the web app sends.' }, receipt: { name: 'Receipt', about: 'What comes back.' } }
  model.flows.checkout.steps[1] = { ...model.flows.checkout.steps[1], animation: 'call' }
  model.flows.checkout.steps[2] = { ...model.flows.checkout.steps[2], animation: 'send' }
  t.model?.(model)
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  const saved = async () => (await loadDir(dir)).model
  return { dir, server, saved, close: async () => { await server.close(); await rm(dir, { recursive: true, force: true }) } }
}

async function editLine(page: Page, port: number) {
  await page.goto(`http://127.0.0.1:${port}/#shop`)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('.react-flow__edge[data-id="api web"]').click({ force: true })
}

const picker = (page: Page) => page.locator('.panel').getByRole('group', { name: 'Payloads' })

test('a line takes a payload from the picker and lets it go', async ({ page }) => {
  const s = await serve()
  try {
    await editLine(page, s.server.port)
    await picker(page).getByRole('button', { name: 'Order' }).click()
    await expect.poll(async () => (await s.saved()).connections.find(c => c.from === 'web' && c.to === 'api')?.payloads).toEqual(['order'])
    await expect(picker(page).getByRole('button', { name: 'Order' })).toHaveAttribute('aria-pressed', 'true')
    await picker(page).getByRole('button', { name: 'Order' }).click()
    await expect.poll(async () => (await s.saved()).connections.find(c => c.from === 'web' && c.to === 'api')?.payloads).toBeUndefined()
  } finally {
    await s.close()
  }
})

test('a new payload made from the picker is saved and carried once it says something', async ({ page }) => {
  const s = await serve()
  try {
    await editLine(page, s.server.port)
    await page.locator('.panel').getByRole('textbox', { name: 'New payload' }).fill('Shipping label')
    await page.locator('.panel').getByRole('textbox', { name: 'New payload' }).press('Enter')
    const about = page.locator('.panel').getByLabel('About (Markdown)').last()
    await about.fill('What the courier prints.')
    await about.press('Tab')
    await expect.poll(async () => (await s.saved()).meta.payloads).toMatchObject({ 'shipping-label': { name: 'Shipping label', about: 'What the courier prints.' } })
    await expect.poll(async () => (await s.saved()).connections.find(c => c.from === 'web' && c.to === 'api')?.payloads).toEqual(['shipping-label'])
  } finally {
    await s.close()
  }
})

test('the form edits a payload\'s name, about, shape and example', async ({ page }) => {
  const s = await serve({ model: m => { m.connections[1] = { ...m.connections[1], payloads: ['order'] } } })
  try {
    await editLine(page, s.server.port)
    const form = page.locator('.panel .payload-form').first()
    await form.locator('summary').click()
    await form.getByLabel('Name', { exact: true }).fill('Order request')
    await form.getByLabel('Name', { exact: true }).press('Tab')
    await form.getByRole('button', { name: 'Add a shape' }).click()
    await form.getByRole('textbox', { name: 'Shape', exact: true }).fill('type Order = { id: string }')
    await form.getByRole('textbox', { name: 'Shape', exact: true }).press('Tab')
    await form.getByRole('button', { name: 'Add an example' }).click()
    await form.getByRole('textbox', { name: 'Example', exact: true }).fill('{ "id": "o-1" }')
    await form.getByRole('textbox', { name: 'Example', exact: true }).press('Tab')
    await expect.poll(async () => (await s.saved()).meta.payloads).toMatchObject({
      order: { name: 'Order request', about: 'What the web app sends.', shape: { text: 'type Order = { id: string }' }, example: { text: '{ "id": "o-1" }' } },
    })
  } finally {
    await s.close()
  }
})

test('deleting a payload in use is refused and says who uses it', async ({ page }) => {
  const s = await serve({ model: m => { m.connections[1] = { ...m.connections[1], payloads: ['order'] } } })
  try {
    await editLine(page, s.server.port)
    const form = page.locator('.panel .payload-form').first()
    await form.locator('summary').click()
    await form.getByRole('button', { name: 'Delete payload' }).click()
    await expect(form.getByRole('alert')).toHaveText('payload "order" is used by connection web → api. Change those first.')
    expect(Object.keys((await s.saved()).meta.payloads as object)).toEqual(['order', 'receipt'])
  } finally {
    await s.close()
  }
})

test('a step takes a payload and, on a call, a reply; on a send the reply is greyed out with the reason', async ({ page }) => {
  const s = await serve()
  try {
    await page.goto(`http://127.0.0.1:${s.server.port}/#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const flows = page.getByRole('button', { name: /^Flows/ })
    if ((await flows.getAttribute('aria-pressed')) !== 'true') await flows.click()
    await page.locator('.flow-item', { hasText: 'Customer checks out' }).click()
    const call = page.locator('.panel ol.steps > li').nth(1)
    await call.getByRole('group', { name: 'Payload' }).getByRole('button', { name: 'Order' }).click()
    await call.getByRole('group', { name: 'Reply' }).getByRole('button', { name: 'Receipt' }).click()
    await expect.poll(async () => { const st = (await s.saved()).flows.checkout.steps[1]; return [st.payload, st.reply] }).toEqual(['order', 'receipt'])
    const send = page.locator('.panel ol.steps > li').nth(2)
    const reply = send.getByRole('group', { name: 'Reply' }).getByRole('button', { name: 'Receipt' })
    await expect(reply).toBeDisabled()
    await expect(reply).toHaveAttribute('title', 'A reply needs a call, a callback or a recurse')
  } finally {
    await s.close()
  }
})
