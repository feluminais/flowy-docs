import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { snippetsOf } from '../src/core/snippets.ts'
import { loadDir } from '../src/node/files.ts'
import { startServer } from '../src/node/server.ts'
import { shop } from '../test/fixtures.ts'

test('editing a snippet title while its code is saving keeps both edits', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-edit-browser-'))
  const model = shop()
  model.objects.web.snippets = [{ title: 'Delivery fee', text: 'const fee = 1' }]
  for (const [file, text] of Object.entries(modelFiles(model))) {
    const path = join(dir, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }
  const server = await startServer({ dir, ui: resolve('dist/ui'), port: 0 })
  let release!: () => void
  const pending = new Promise<void>(done => { release = done })
  let writes = 0
  try {
    await page.route(url => url.pathname === '/api/file/model.yaml', async route => {
      if (++writes === 1) {
        await pending
      }
      await route.continue()
    })
    await page.goto(`http://127.0.0.1:${server.port}/#shop`)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('.react-flow__node[data-id="web"]').click()
    const card = page.locator('.code-card')
    await card.getByRole('textbox', { name: 'Code', exact: true }).fill('const fee = 2')
    await card.getByRole('textbox', { name: 'Code', exact: true }).press('Tab')
    await expect.poll(() => writes).toBe(1)
    await card.getByLabel('Title', { exact: true }).fill('Updated fee')
    await card.getByLabel('Title', { exact: true }).press('Tab')
    release()
    await expect.poll(async () => snippetsOf((await loadDir(dir)).model.objects.web)).toEqual([
      { title: 'Updated fee', text: 'const fee = 2' },
    ])
  } finally {
    release()
    await page.close()
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
