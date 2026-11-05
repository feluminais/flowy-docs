import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// The flow player over Plum's "Customer places an order": Play and Pause freeze a step where it is and carry on from there, and Autoplay takes away the stops between steps.

async function openFlow(page: Page) {
  await page.goto('/#ordering/place-order')
  await page.locator('.player').waitFor()
}

const player = (page: Page) => page.locator('.player')
const button = (page: Page, name: 'Play' | 'Pause') => player(page).getByRole('button', { name, exact: true })
const autoplay = (page: Page) => player(page).getByRole('button', { name: 'Autoplay' })
const repeat = (page: Page) => player(page).getByRole('button', { name: 'Repeat' })
/** The dot running along the step's line, while it is drawn. */
const dot = (page: Page) => page.locator('.motion g[data-beat]:has(> .blob):visible').first()

test('Pause freezes the dot and Play carries on from there', async ({ page }) => {
  await openFlow(page)
  await dot(page).waitFor() // a flow opens with its first step moving
  await page.waitForTimeout(200)
  await button(page, 'Pause').click()
  await page.waitForTimeout(100) // the frame of the paused moment
  const frozen = await dot(page).getAttribute('transform')
  await page.waitForTimeout(600)
  expect(await dot(page).getAttribute('transform')).toBe(frozen)
  await button(page, 'Play').click()
  await expect.poll(() => dot(page).getAttribute('transform')).not.toBe(frozen)
})

test('Pausing in the rest between steps does not move on, and Play goes on', async ({ page }) => {
  await openFlow(page)
  await autoplay(page).click()
  await expect(player(page)).toContainText('Step 2 of')
  await expect(page.locator('.motion g[data-beat]:has(> .blob):visible')).toHaveCount(0, { timeout: 5000 }) // its motion is over: the rest before step 3
  await button(page, 'Pause').click()
  await page.waitForTimeout(2000)
  await expect(player(page)).toContainText('Step 2 of')
  await expect(autoplay(page)).toHaveAttribute('aria-pressed', 'true')
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 3 of', { timeout: 8000 })
})

test('Next while paused stays paused on the first frame of the next step', async ({ page }) => {
  await openFlow(page)
  await page.waitForTimeout(300)
  await button(page, 'Pause').click()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
  await expect(button(page, 'Play')).toBeVisible()
  const first = await page.locator('.motion g[data-beat]').first().getAttribute('style')
  await page.waitForTimeout(600)
  expect(await page.locator('.motion g[data-beat]').first().getAttribute('style')).toBe(first)
})

// "The customer follows the courier": its second step opens the live map, a stream drawn as dots running along the line.
async function openLiveMap(page: Page) {
  await page.goto('/#delivery/follow-the-courier')
  await page.locator('.player').waitFor()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
}
const channel = (page: Page) => page.locator('svg.channels').first()
const opacity = (page: Page) => channel(page).evaluate(el => getComputedStyle(el).opacity)

test('Pause holds a channel that is opening', async ({ page }) => {
  await openLiveMap(page)
  await button(page, 'Pause').click() // the step's call has not landed yet, so the live map has not appeared
  await expect(button(page, 'Play')).toBeVisible()
  const held = await opacity(page)
  await page.waitForTimeout(4000) // longer than the call and the fade
  expect(await opacity(page)).toBe(held)
  await button(page, 'Play').click()
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
})

test('Pause stops the dots of an open stream', async ({ page }) => {
  await openLiveMap(page)
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
  await page.keyboard.press('p')
  const dots = page.locator('svg.channels .stream-dots').first()
  const offset = () => dots.evaluate(el => getComputedStyle(el).strokeDashoffset)
  await expect(button(page, 'Play')).toBeVisible()
  await page.waitForTimeout(150) // the frame of the paused moment, under load too
  const held = await offset()
  await page.waitForTimeout(500)
  expect(await offset()).toBe(held)
})

test('Play does not bring an open channel in again', async ({ page }) => {
  await openLiveMap(page)
  await expect.poll(() => opacity(page), { timeout: 8000 }).toBe('1')
  await page.keyboard.press('p')
  await page.keyboard.press('p')
  await page.waitForTimeout(100)
  expect(await opacity(page)).toBe('1')
})

test('Dragging the bar while paused goes to the step and the moment under the pointer, and holds there', async ({ page }) => {
  await openFlow(page)
  await button(page, 'Pause').click()
  const cells = page.locator('.player .progress .cell')
  const first = (await cells.nth(0).boundingBox())!
  const third = (await cells.nth(2).boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(third.x + third.width / 5, third.y + third.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(player(page)).toContainText('Step 3 of')
  await expect(button(page, 'Play')).toBeVisible()
  const fill = await page.locator('.player .progress .cell.now').evaluate(el => Number(getComputedStyle(el).getPropertyValue('--fill')))
  expect(fill).toBeGreaterThan(0.1)
  expect(fill).toBeLessThan(0.3)
  await expect(dot(page)).toBeVisible() // a fifth of the way through the call: its dot is on the way there
  const held = await dot(page).getAttribute('transform')
  await page.waitForTimeout(500)
  expect(await dot(page).getAttribute('transform')).toBe(held)
  await expect(player(page).getByRole('slider', { name: 'Step' })).toHaveAttribute('aria-valuetext', /^Step 3 of \d+$/)
})

test('Letting go of the bar carries on if it was playing', async ({ page }) => {
  await openFlow(page)
  const cell = (await player(page).locator('.progress .cell[data-stop="1"]').boundingBox())!
  await page.mouse.click(cell.x + cell.width / 5, cell.y + cell.height / 2)
  await expect(player(page)).toContainText('Step 2 of')
  await expect(button(page, 'Pause')).toBeVisible()
  await expect(dot(page)).toBeVisible()
})

/** How long the motion of step 2 takes, from Next until its dot has gone. */
async function stepTwoTakes(page: Page): Promise<number> {
  await page.goto('/#ordering/place-order')
  await page.locator('.player').waitFor()
  await expect(page.locator('.motion g[data-beat]:has(> .blob):visible')).toHaveCount(0, { timeout: 8000 })
  const started = Date.now()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await dot(page).waitFor()
  // Every 20 ms: toHaveCount backs off to one look a second, so on a slow machine both speeds land on the same look.
  await expect.poll(() => page.locator('.motion g[data-beat]:has(> .blob):visible').count(), { intervals: [20], timeout: 8000 }).toBe(0)
  return Date.now() - started
}

test('2× plays a step in about half the time, and the speed is kept', async ({ page }) => {
  const normal = await stepTwoTakes(page)
  await player(page).getByRole('button', { name: '2×' }).click()
  await expect(player(page).getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true')
  const fast = await stepTwoTakes(page) // a new page load: the speed comes back
  await expect(player(page).getByRole('button', { name: '2×' })).toHaveAttribute('aria-pressed', 'true')
  expect(fast).toBeLessThan(normal * 0.75)
})

test('A flow stopped and opened again plays its first step from the start', async ({ page }) => {
  await openFlow(page)
  await player(page).getByRole('button', { name: 'Repeat' }).click() // off: a step that has played holds its end
  await expect(page.locator('.motion g[data-beat]:has(> .blob):visible')).toHaveCount(0, { timeout: 8000 }) // step 1 has played
  await player(page).getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(player(page)).toHaveCount(0)
  await page.evaluate(() => (location.hash = '#ordering/place-order'))
  await page.locator('.player').waitFor()
  await expect(dot(page)).toBeVisible({ timeout: 1500 }) // its dot runs again
})

test('Turning Repeat off and on while paused keeps the frozen moment', async ({ page }) => {
  await openFlow(page)
  await dot(page).waitFor()
  await page.waitForTimeout(200)
  await button(page, 'Pause').click()
  await page.waitForTimeout(100)
  const frozen = await dot(page).getAttribute('transform')
  await repeat(page).click()
  await repeat(page).click()
  await page.waitForTimeout(200)
  expect(await dot(page).getAttribute('transform', { timeout: 1000 })).toBe(frozen)
})

test('A click a few pixels off the bar still goes to the step and the moment under the pointer', async ({ page }) => {
  await openFlow(page)
  const cell = (await player(page).locator('.progress .cell[data-stop="1"]').boundingBox())!
  await page.mouse.click(cell.x + cell.width / 2, cell.y - 6) // above the four-pixel cell
  await expect(player(page)).toContainText('Step 2 of')
  await button(page, 'Pause').or(button(page, 'Play')).waitFor()
  const fill = Number(await player(page).locator('.progress .cell.now').evaluate(e => (e as HTMLElement).style.getPropertyValue('--fill')))
  expect(fill).toBeGreaterThan(0.3) // from the middle of the step, not its start
})

test('The card keeps one size and one top edge through a flow', async ({ page }) => {
  for (const path of ['/#ordering/place-order', '/#root/refund', '/#ordering/nobody-accepts']) {
    await page.goto(path)
    await player(page).waitFor()
    const count = Number((await player(page).locator('.chips').textContent())!.match(/of (\d+)/)![1])
    const seen = new Set<string>()
    for (let k = 0; k < count; k++) {
      await expect(player(page)).toContainText(`Step ${k + 1} of`)
      const box = (await player(page).boundingBox())!
      seen.add(`${Math.round(box.y)} ${Math.round(box.height)}`)
      if (k < count - 1) await player(page).getByRole('button', { name: 'Next' }).click()
    }
    expect([...seen], path).toHaveLength(1)
  }
})

test('Repeat stays on a step that does not move, greyed out, and Back goes straight to the step before', async ({ page }) => {
  await page.goto('/#root/sms-dropped')
  await player(page).waitFor()
  for (let k = 0; k < 4; k++) await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 5 of 5')
  const repeat = player(page).getByRole('button', { name: 'Repeat' })
  await expect(repeat).toBeDisabled()
  await expect(repeat).toHaveAttribute('title', 'Nothing moves on this step')
  await player(page).getByRole('button', { name: 'Back', exact: true }).click()
  await expect(player(page)).toContainText('Step 4 of 5')
})

const back = (page: Page) => player(page).getByRole('button', { name: 'Back', exact: true })
/** The dots of the step on show have gone: its motion is over. */
const settled = (page: Page) => expect(page.locator('.motion g[data-beat]:has(> .blob):visible')).toHaveCount(0, { timeout: 8000 })

test('Back plays a step that moves again, and a second click goes to the step before', async ({ page }) => {
  await openFlow(page)
  await player(page).getByRole('button', { name: 'Repeat' }).click() // off: a step that has played holds its end
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
  await settled(page)
  await expect(back(page)).toHaveAttribute('title', 'Replay the step, twice for the one before')
  await back(page).click()
  await expect(dot(page)).toBeVisible() // its dot runs again
  await expect(player(page)).toContainText('Step 2 of')
  await back(page).click()
  await expect(player(page)).toContainText('Step 1 of')
})

test('Back on the first step plays it again', async ({ page }) => {
  await openFlow(page)
  await player(page).getByRole('button', { name: 'Repeat' }).click()
  await settled(page)
  await expect(back(page)).toBeEnabled()
  await back(page).click()
  await back(page).click()
  await expect(dot(page)).toBeVisible()
  await expect(player(page)).toContainText('Step 1 of')
})

test('Back and Next leave Autoplay on', async ({ page }) => {
  await openFlow(page)
  await autoplay(page).click()
  await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 2 of')
  await expect(autoplay(page)).toHaveAttribute('aria-pressed', 'true')
  await back(page).click()
  await expect(autoplay(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(player(page)).toContainText('Step 3 of', { timeout: 8000 })
})

test('Without Autoplay a step rests on its end, and Play runs it again', async ({ page }) => {
  await openFlow(page)
  await repeat(page).click() // off: a step that has played holds its end
  await settled(page)
  await expect(button(page, 'Play')).toBeVisible()
  await page.waitForTimeout(2500) // longer than the rest between steps
  await expect(player(page)).toContainText('Step 1 of')
  await button(page, 'Play').click()
  await expect(dot(page)).toBeVisible()
  await expect(button(page, 'Pause')).toBeVisible()
  await expect(player(page)).toContainText('Step 1 of')
})

test('Autoplay does not start a paused step, and turned on after a step is over it goes on', async ({ page }) => {
  await openFlow(page)
  await button(page, 'Pause').click()
  await autoplay(page).click()
  await expect(button(page, 'Play')).toBeVisible()
  await page.waitForTimeout(2500)
  await expect(player(page)).toContainText('Step 1 of')
  await autoplay(page).click()
  await button(page, 'Play').click()
  await repeat(page).click() // off: a step that has played holds its end
  await settled(page)
  await autoplay(page).click()
  await expect(player(page)).toContainText('Step 2 of', { timeout: 8000 })
})

test('Autoplay waits on the last step, and Play starts the flow from its first', async ({ page }) => {
  await page.goto('/#root/sms-dropped')
  await player(page).waitFor()
  for (let k = 0; k < 4; k++) await player(page).getByRole('button', { name: 'Next' }).click()
  await expect(player(page)).toContainText('Step 5 of 5')
  await autoplay(page).click()
  await expect(button(page, 'Play')).toBeVisible({ timeout: 8000 })
  await expect(autoplay(page)).toHaveAttribute('aria-pressed', 'true')
  await button(page, 'Play').click()
  await expect(player(page)).toContainText('Step 1 of 5')
})

test('Repeat is greyed out while Autoplay is on', async ({ page }) => {
  await openFlow(page)
  await autoplay(page).click()
  await expect(repeat(page)).toBeDisabled()
  await expect(repeat(page)).toHaveAttribute('title', 'Autoplay is on')
})

test('Autoplay is kept across visits', async ({ page }) => {
  await openFlow(page)
  await autoplay(page).click()
  await page.reload()
  await player(page).waitFor()
  await expect(autoplay(page)).toHaveAttribute('aria-pressed', 'true')
})

test('Play sits between Back and Next', async ({ page }) => {
  await openFlow(page)
  const names = await player(page).locator('.player-buttons > button').evaluateAll(bs => bs.slice(0, 3).map(b => b.textContent?.trim()))
  expect(names).toEqual(['Back', 'PausePlay', 'Next'])
})
