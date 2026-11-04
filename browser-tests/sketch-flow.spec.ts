import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// A flow of a sketch, in the browser, over the Embedded device sketch of the Plum demo (docs/demo/flowy/sketches/embedded-device): three layers whose pairs draw a line for each
// connection (`pairs: separate`), and flows whose steps name the line they ride with `via`. The sketch opens as its own model, `?model=sketches/<id>`, and its flows play as any flow does.

const SKETCH = '/?model=sketches%2Fembedded-device'

const player = (page: Page) => page.locator('.player')
const next = (page: Page) => player(page).getByRole('button', { name: 'Next' }).click()

/** The line whose accessible name ("1 of 6, from Touch app to Controller, starts a scan, Request then stream") holds `from`, `to` and `label`. */
const line = (page: Page, from: string, to: string, label: string) => page.getByRole('group', { name: new RegExp(`^\\d of \\d, from ${from} to ${to}, ${label}(,|$)`) })

/** All the lines of one pair, whichever way they run. */
const pair = (page: Page, a: string, b: string) => page.getByRole('group', { name: new RegExp(`^\\d of \\d, from (${a} to ${b}|${b} to ${a}), `) })

async function play(page: Page, flow: string) {
  await page.goto(`${SKETCH}#root/${flow}`)
  await player(page).waitFor()
  await page.locator('.react-flow__edge-path').first().waitFor({ state: 'attached' })
}

async function stepTo(page: Page, n: number) {
  for (let i = 1; i < n; i++) await next(page)
  await expect(player(page)).toContainText(`Step ${n} of`)
}

const classesOf = (lines: Locator) => lines.evaluateAll(els => els.map(e => (e.getAttribute('class') ?? '').split(/\s+/)))

/** The line `lit` is the one in use on its pair: the other lines of the pair are its kin, and the lines of the pair beside it are dim. */
async function expectRides(lit: Locator, pairLines: Locator, others: Locator) {
  await expect(lit).toHaveClass(/active/)
  await expect.poll(async () => (await classesOf(pairLines)).map(c => (c.includes('active') ? 'active' : c.includes('kin') ? 'kin' : 'other')).sort()).toEqual(
    [...Array(await pairLines.count() - 1).fill('kin'), 'active'].sort())
  await expect.poll(async () => (await classesOf(others)).every(c => c.includes('dim') || c.includes('kin'))).toBe(true)
}

test('each step of a sketch flow plays on the line it names: the one line is lit and its kin in the pair fade', async ({ page }) => {
  await play(page, 'join-a-network')
  const settings = line(page, 'Touch app', 'Controller', 'reads and saves settings')
  const touch = pair(page, 'Touch app', 'Controller')
  const radio = pair(page, 'Controller', 'Network daemon')

  await stepTo(page, 2)
  await expectRides(settings, touch, radio)
  await expect(touch).toHaveCount(6)

  await next(page) // a hook plugged into the daemon: an extension point
  await expectRides(line(page, 'Controller', 'Network daemon', 'calls vendor hooks'), radio, touch)
  await expect(radio).toHaveCount(7)

  await next(page)
  await expectRides(line(page, 'Controller', 'Network daemon', 'applies the config'), radio, touch)
})

test('a publish with two subscribers lights two lines at once, one on each pair; the same label names both', async ({ page }) => {
  await play(page, 'join-a-network')
  await stepTo(page, 5)
  const toScreen = line(page, 'Controller', 'Touch app', 'announces config changes')
  const toDaemon = line(page, 'Controller', 'Network daemon', 'announces config changes')
  await expect(toScreen).toHaveClass(/active/)
  await expect(toDaemon).toHaveClass(/active/)
  await expect(page.locator('.react-flow__edge.active')).toHaveCount(2)
  await expect(page.locator('.react-flow__edge.kin')).toHaveCount(5 + 6) // the other five lines of the screen's pair and the other six of the daemon's
})

test('a reply rides the line of its request, and a stream stays open on that line', async ({ page }) => {
  await play(page, 'scan-for-networks')
  await stepTo(page, 2)
  const scan = line(page, 'Touch app', 'Controller', 'starts a scan')
  await expect(scan).toHaveClass(/active/)
  await next(page)
  await expect(line(page, 'Controller', 'Network daemon', 'starts a radio scan')).toHaveClass(/active/)
  // The results come back from the Controller to the screen, on the line that asked for them, not on one of the Controller's own lines to the screen.
  await next(page)
  await expect(player(page)).toContainText('Adds each network it hears to the list')
  await expect(scan).toHaveClass(/active/)
  await expect(line(page, 'Controller', 'Touch app', 'publishes radio state')).toHaveClass(/kin/)
})

test('a request that times out lights its own line, and the card names the failure', async ({ page }) => {
  await play(page, 'the-radio-does-not-answer')
  await stepTo(page, 3)
  await expect(line(page, 'Controller', 'Network daemon', 'applies the config')).toHaveClass(/active/)
  await expect(player(page)).toContainText('Times out: No answer in 5 s')
  // The answer to the screen is on the line of the request that came in, which is a request, so it rides it against its way.
  await next(page)
  await expect(player(page)).toContainText('Step 4 of')
  await expect(line(page, 'Touch app', 'Controller', 'reads and saves settings')).toHaveClass(/active/)
})

/** The shape of every line on the canvas, as the paths draw them, in the order of the page. */
const shapes = (page: Page) => page.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(p => p.getAttribute('d')))

/** Waits for the canvas to stop moving after it opens (it fits the view), so a click lands where the line is. */
async function still(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await page.locator('.react-flow__edge-path').evaluateAll(paths => paths.map(p => { const r = p.getBoundingClientRect(); return [r.x, r.y] })))
    const same = now === last
    last = now
    return same
  }, { intervals: [200] }).toBe(true)
}

test('a click on a line opens its connection in the panel, and hovering a line moves none', async ({ page }) => {
  await page.goto(SKETCH)
  const touch = pair(page, 'Touch app', 'Controller')
  await expect(touch).toHaveCount(6)
  await still(page)
  const labels = [
    ['Touch app', 'Controller', 'reads and saves settings', 'Request and reply'],
    ['Touch app', 'Controller', 'starts a scan', 'Request then stream'],
    ['Touch app', 'Controller', 'subscribes to radio state', 'Plain line'],
    ['Controller', 'Touch app', 'publishes radio state', 'Cached publish'],
    ['Controller', 'Touch app', 'announces config changes', 'Publish and subscribe'],
    ['Controller', 'Touch app', 'publishes the current network', 'Object updates'],
  ]
  const rest = await shapes(page)
  // Each click opens the panel on the connection it hit, whatever the pair does to spread its lines, and a click on the pane puts them back.
  for (const [from, to, label, kind] of labels) {
    await line(page, from, to, label).locator('path.react-flow__edge-path').first().click({ force: true })
    const card = page.locator('.line.card.current')
    await expect(card, label).toHaveCount(1)
    await expect(card).toContainText(label)
    await expect(card).toContainText(kind)
    await page.locator('.react-flow__pane').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.line.card.current')).toHaveCount(0)
    await still(page) // the pair closes again, over a moment
  }
  // Hover moves nothing: the lines are where they were, whichever one the pointer is on.
  for (const [from, to, label] of labels) {
    await line(page, from, to, label).locator('path.react-flow__edge-path').first().hover({ force: true })
    await page.waitForTimeout(250)
    expect(await shapes(page)).toEqual(rest)
    await page.mouse.move(5, 300)
  }
})
