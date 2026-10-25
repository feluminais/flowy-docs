import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

// What no unit test sees: the built page in a real browser. The checks are about things that cost fixes in this project's history
// (shapes and labels printed over each other, a page wider than its window, text nobody can read in the dark theme, a script error on
// a tab), and none compares pixels, so they hold on any machine. Screenshots are kept as files to look at, not compared.

const ROUTES = [
  ['the overview', '/'],
  ['a system', '/#ordering'],
  ['a flow playing', '/#ordering/place-order'],
  ['another system', '/#delivery'],
  ['the performance tab', '/#delivery/perf/dinner-rush/3'],
  ['the failures tab', '/#ordering/failures/ordering'],
  ['two flows side by side', '/#root/compare/refund/refund-not-recorded'],
  ['two flows swapped', '/#root/compare/refund/refund-not-recorded/swap'],
  ['two runs side by side', '/#root/compare-runs/together/together-measured'],
] as const

const THEMES = ['light', 'dark'] as const

/** Opens an address with the theme set and collects what the page reports as wrong. */
async function open(page: Page, route: string, theme: (typeof THEMES)[number]) {
  const reported: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') reported.push(message.text())
  })
  page.on('pageerror', error => reported.push(`uncaught: ${error.message}`))
  await page.emulateMedia({ colorScheme: theme })
  await page.goto(route)
  await page.locator('.react-flow__node').first().waitFor()
  await page.waitForTimeout(800) // the view fits itself and the first motion settles
  return reported
}

for (const [name, route] of ROUTES) {
  for (const theme of THEMES) {
    test.describe(`${name}, ${theme}`, () => {
      test('draws its shapes and reports no error', async ({ page }, info) => {
        const reported = await open(page, route, theme)
        expect(await page.locator('.react-flow__node').count()).toBeGreaterThan(0)
        expect(reported).toEqual([])
        await keep(page, info, `${name}-${theme}`)
      })

      test('is no wider or taller than its window', async ({ page }) => {
        await open(page, route, theme)
        const size = await page.evaluate(() => ({
          wide: document.documentElement.scrollWidth - window.innerWidth,
          tall: document.documentElement.scrollHeight - window.innerHeight,
        }))
        expect(size.wide).toBeLessThanOrEqual(0)
        expect(size.tall).toBeLessThanOrEqual(0)
      })

      test('prints no shape or line label over another', async ({ page }) => {
        await open(page, route, theme)
        const overlaps = await page.evaluate(() => {
          type Box = { name: string; x: number; y: number; w: number; h: number }
          const boxes = (selector: string): Box[] =>
            Array.from(document.querySelectorAll<HTMLElement>(selector))
              .map(element => ({ element, rect: element.getBoundingClientRect() }))
              .filter(({ rect }) => rect.width > 0 && rect.height > 0)
              .map(({ element, rect }) => ({ name: (element.textContent ?? '').trim().slice(0, 30), x: rect.x, y: rect.y, w: rect.width, h: rect.height }))
          const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
          const area = (a: Box) => a.w * a.h
          const inside = (a: Box, b: Box) => area(a) !== area(b) && overlap(a, b) >= Math.min(area(a), area(b)) - 1 // a smaller one wholly inside a larger: a shape in its parent
          const found: string[] = []
          for (const [kind, selector] of [
            ['shapes', '.react-flow__node'],
            ['line labels', '.react-flow__edgelabel-renderer > *'],
          ] as const) {
            const all = boxes(selector)
            for (let i = 0; i < all.length; i++)
              for (let j = i + 1; j < all.length; j++)
                if (!inside(all[i], all[j]) && overlap(all[i], all[j]) > 12) found.push(`${kind}: "${all[i].name}" and "${all[j].name}" overlap by ${Math.round(overlap(all[i], all[j]))} px`)
          }
          return found
        })
        expect(overlaps).toEqual([])
      })

      test('has no serious accessibility problem beyond the known ones', async ({ page }) => {
        await open(page, route, theme)
        const result = await new AxeBuilder({ page }).exclude('.react-flow__attribution').analyze() // the library's own credit link, grey on purpose
        const found = result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id} (${v.impact}) on ${v.nodes.length} element(s): ${v.nodes[0]?.target.join(' ')}`)
        expect(found).toEqual([])
      })
    })
  }
}

/** A picture of the page, attached to the report for a person to look at. */
async function keep(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.describe('Esc goes back', () => {
  test('to the level the reader came from, then to the one before, not up a level', async ({ page }) => {
    await open(page, '/', 'light')
    const level = () => page.evaluate(() => location.hash)
    await page.locator('.react-flow__node[data-id="ordering"]').dblclick()
    await expect.poll(level).toBe('#ordering')
    await page.locator('.react-flow__node[data-id="backoffice"]').dblclick() // a shape that sits beside it: the view slides across
    await expect.poll(level).toBe('#backoffice')
    await page.mouse.click(5, 5) // keep the keys off any panel the double-click opened
    await page.keyboard.press('Escape')
    await expect.poll(level).toBe('#ordering') // not #root, the level above
    await page.keyboard.press('Escape')
    await expect.poll(level).toMatch(/^(#root)?$/)
  })

  test('Z goes up a level, and Esc then has nothing to go back to', async ({ page }) => {
    await open(page, '/', 'light')
    const level = () => page.evaluate(() => location.hash)
    await page.locator('.react-flow__node[data-id="ordering"]').dblclick()
    await expect.poll(level).toBe('#ordering')
    await page.locator('.react-flow__node[data-id="backoffice"]').dblclick()
    await expect.poll(level).toBe('#backoffice')
    await page.mouse.click(5, 5)
    await page.keyboard.press('z')
    await expect.poll(level).toMatch(/^(#root)?$/)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    expect(await level()).toMatch(/^(#root)?$/)
  })
})

test.describe('pointing at a line', () => {
  test('marks that line, and only that one; moving off takes the mark away', async ({ page }) => {
    await open(page, '/#ordering', 'light')
    // A point on each line, in pixels.
    const lines = await page.evaluate(() => Array.from(document.querySelectorAll<SVGPathElement>('.react-flow__edge')).flatMap(edge => {
      const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')
      const m = path?.getScreenCTM()
      if (!path || !m) return []
      const at = path.getPointAtLength(path.getTotalLength() / 2)
      return [{ id: edge.getAttribute('data-id') ?? '', x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f }]
    }))
    expect(lines.length).toBeGreaterThan(1)
    const target = lines[0]
    await page.mouse.move(target.x, target.y)
    await expect(page.locator('.react-flow__edge-path.hot')).toHaveCount(1)
    await expect(page.locator(`.react-flow__edge[data-id="${target.id}"] .react-flow__edge-path.hot`)).toHaveCount(1)
    await page.mouse.move(5, 500)
    await expect(page.locator('.react-flow__edge-path.hot')).toHaveCount(0)
  })

  test('a line that has a label shows it while it is pointed at, and not after', async ({ page }) => {
    await open(page, '/#ordering', 'light')
    const points = await page.evaluate(() => Array.from(document.querySelectorAll<SVGPathElement>('.react-flow__edge-path')).flatMap(path => {
      const m = path.getScreenCTM()
      if (!m) return []
      const at = path.getPointAtLength(path.getTotalLength() / 2)
      return [{ x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f }]
    }))
    const labels = () => page.locator('.react-flow__edge-text').count()
    const quiet = await labels()
    let showed = 0
    for (const p of points) {
      await page.mouse.move(p.x, p.y)
      if ((await labels()) > quiet) showed++
      await page.mouse.move(5, 500)
      expect(await labels()).toBe(quiet)
    }
    expect(showed).toBeGreaterThan(0)
  })
})

test.describe('the performance tab on an 880 px window', () => {
  test('keeps its whole key in view, says what each stripe stands for and reads the load aloud', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 880 })
    await open(page, '/#delivery/perf/dinner-rush/3', 'light')
    const key = page.locator('.perf .keyrow').first()
    const box = await key.boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(880)
    await expect(page.getByRole('group', { name: 'Each stripe' })).toBeVisible()
    await expect(page.locator('.perf .keyrow').first().getByText('Struggling')).toBeVisible() // Dispatch is past the struggle mark: its number is on the canvas and in the key
    await expect(page.locator('.strain-pct').first()).toHaveText(/^\d+%$/)
    expect(await page.locator('.perf input[type=range]').first().getAttribute('aria-valuetext')).toBe('900 orders/min, tested')
    await expect(page.getByText('Calls into Customer app')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Go there to 900 orders\/min$/ })).toBeVisible()
    const rows = await page.locator('.stripfig .visually-hidden li').allTextContents()
    expect(rows[0]).toBe('100 orders/min: expected call 42 ms, slowest 5% 118 ms')
  })
})
