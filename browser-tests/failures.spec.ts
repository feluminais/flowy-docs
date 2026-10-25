import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The Failures tab as a reader meets it on a short window: the picked mode's card is in view, the rows say what they are, and what fails is
// outlined in the colour of the mode's band. The Plum demo's Stripe time-out is Medium (96), so it must not read as High.

const MEDIUM = '#ordering/failures/ordering/stripe-timeout'

async function open(page: Page, route: string) {
  await page.setViewportSize({ width: 1280, height: 880 })
  await page.goto(route)
  await page.locator('.react-flow__node').first().waitFor()
  await page.waitForTimeout(600)
}

test('a picked mode has its card above the list and in view', async ({ page }) => {
  await open(page, MEDIUM)
  const card = page.locator('.failcard')
  const firstRow = page.locator('.failrow').first()
  const [cardBox, rowBox] = [await card.boundingBox(), await firstRow.boundingBox()]
  expect(cardBox!.y).toBeLessThan(rowBox!.y)
  const severity = await page.locator('.failcard .rating .label', { hasText: 'Severity' }).boundingBox()
  expect(severity!.y + severity!.height).toBeLessThan(880)
  await expect(page.locator('.failcard .riskline')).toContainText('Risk after next action: 96 to 32')
})

test('the rows are named and the picked one is pressed', async ({ page }) => {
  await open(page, MEDIUM)
  const picked = page.locator('.failrow[aria-pressed="true"]')
  await expect(picked).toHaveCount(1)
  // Named by what each row shows, in its order, so the name holds the label a reader sees.
  await expect(picked).toHaveAccessibleName(/^Medium\. Checkout to Stripe ?: Stripe doesn't answer within 5 s ?\. Risk 96$/)
  await expect(page.locator('.failrow').first()).toHaveAccessibleName(/^High\. (.+ > )?Refunds ?: Stripe refunds the money but the database write fails ?\. Risk 126$/)
  await expect(page.locator('.failhead').first()).toHaveText('Risk')
  await expect(page.locator('.fail-badge.line').first()).toHaveAttribute('aria-label', /^\S.* to \S.*, \d failures?, (High|Medium|Low|Not rated)$/)
  await expect(page.getByRole('button', { name: /^Show it: play the flow/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Seen in a run: open Performance/ })).toBeVisible()
})

test('each band says what puts a mode in it, and the coverage says what it counts', async ({ page }) => {
  await open(page, '#ordering/failures/ordering')
  const bands = page.locator('.failsum')
  await expect(bands).toContainText('Risk 150+ or severity 9+')
  await expect(bands).toContainText('Risk 60 to 149')
  await expect(bands).toContainText('Risk under 60')
  await expect(bands).toContainText('A rating missing')
  await expect(page.locator('.coverage')).toContainText('Analysed 15 of 26 shapes')
})

test('a Medium mode is outlined orange and solid, a High one red, and the key follows', async ({ page }) => {
  await open(page, MEDIUM)
  const strokeOf = (page: Page, selector: string) => page.locator(selector).first().evaluate(el => {
    const path = el.querySelector('.shape path') ?? el.querySelector('.react-flow__edge-path')!
    const style = getComputedStyle(path)
    return { stroke: style.stroke, dash: style.strokeDasharray }
  })
  const colour = (variable: string) => page.evaluate(v => { const p = document.createElement('i'); p.style.color = `var(${v})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c }, variable)
  const stripe = await strokeOf(page, '.react-flow__node.fails.outsider')
  expect(stripe.stroke).toBe(await colour('--warn'))
  expect(stripe.dash).toBe('none') // the outsider's dashes are for "another level", and the outline says "fails"
  const swatch = await page.locator('.failcard .sw.fails').evaluate(el => getComputedStyle(el).borderTopColor)
  expect(swatch).toBe(await colour('--warn'))
  await open(page, '#ordering/failures/ordering/refund-not-recorded')
  expect((await strokeOf(page, '.react-flow__node.fails')).stroke).toBe(await colour('--danger'))
})
