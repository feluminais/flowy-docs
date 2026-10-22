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
