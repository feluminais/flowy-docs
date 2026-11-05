import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { serveModel, systems } from './serve.ts'

// A flow that plays on a pair of lines side by side: the lines open around the one in use, which keeps its place, the others fade, and the pose follows the player's clock.

const MODEL = () => {
  const model = systems(['a', 'b', 'c'], [
    { from: 'a', to: 'b', label: 'One', kind: 'request' }, { from: 'a', to: 'b', label: 'Two' }, { from: 'a', to: 'b', label: 'Three', kind: 'publish' },
    { from: 'b', to: 'c', label: 'Next' },
  ], { pairs: 'separate' })
  model.flows = {
    ask: {
      name: 'Ask', view: 'root', steps: [
        { from: 'a', to: 'b', text: 'Asks on line two', via: 'Two', animation: 'call' },
        { from: 'a', to: 'b', text: 'Then on line three', via: 'Three', animation: 'send' },
        { from: 'b', to: 'c', text: 'Then on to c', animation: 'send' },
      ],
    },
  }
  return serveModel(model, 'flowy-pairs-flow-')
}

const player = (page: Page) => page.locator('.player')
const line = (page: Page, place: number) => page.getByRole('group', { name: new RegExp(`^${place} of 3, `) })

/**
 * How far apart the middles of the three lines are, neighbour from neighbour, in the canvas's own units (screen pixels over the zoom), so it does not depend on how far the page
 * fitted the canvas: [line 1 to line 2, line 2 to line 3].
 */
const gaps = (page: Page) => page.getByRole('group', { name: /^\d of 3, / }).locator('.react-flow__edge-path').evaluateAll(paths => {
  const transform = (document.querySelector('.react-flow__viewport') as HTMLElement).style.transform
  const zoom = Number(/scale\(([\d.]+)\)/.exec(transform)?.[1] ?? 1)
  const middles = paths.map(p => {
    const path = p as unknown as SVGGeometryElement
    const at = path.getPointAtLength(path.getTotalLength() / 2)
    return new DOMPoint(at.x, at.y).matrixTransform(path.getScreenCTM()!)
  })
  const apart = (a: DOMPoint, b: DOMPoint) => Math.round((Math.hypot(a.x - b.x, a.y - b.y) / zoom) * 10) / 10
  return [apart(middles[0], middles[1]), apart(middles[1], middles[2])]
})

/** The gaps are these, to half a unit (the middle of a line is found on a path of short curves). */
async function expectGaps(page: Page, expected: number[]) {
  const seen = await gaps(page)
  expected.forEach((gap, i) => expect(seen[i]).toBeCloseTo(gap, 0))
}

/** Waits for the pair to stop moving. */
async function settled(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await gaps(page))
    const same = now === last
    last = now
    return same
  }, { intervals: [150] }).toBe(true)
}

async function open(page: Page, url: string) {
  await page.goto(`${url}#root/ask`)
  await player(page).waitFor()
  await page.locator('.react-flow__edge-path').first().waitFor()
}

test('a step on the second line lights it, fades its kin to 35 percent and parts the pair around it; the lit line keeps its slot', async ({ page }) => {
  const s = await MODEL()
  try {
    await open(page, s.url)
    await expect(line(page, 2)).toHaveClass(/active/)
    await expect(line(page, 1)).toHaveClass(/kin/)
    await expect(line(page, 3)).toHaveClass(/kin/)
    expect(await line(page, 1).evaluate(el => getComputedStyle(el).opacity)).toBe('0.35')
    // The pair parts: 30 units (the 12 pitch and an 18 gap) clear on each side of the lit line in the middle. The lit line is the middle of the three and stays there.
    await settled(page)
    await expectGaps(page, [30, 30])
    // Moving on to line three: the pair stays open (it never closes between two steps on it) and the gap moves to the new lit line. Line one keeps its pitch from line two.
    await player(page).getByRole('button', { name: 'Next' }).click()
    await expect(line(page, 3)).toHaveClass(/active/)
    await expect(line(page, 2)).toHaveClass(/kin/)
    await settled(page)
    await expectGaps(page, [12, 30])
    // A step on another pair closes it again, and the lines of this pair are dim, as the lines of any other pair are.
    await player(page).getByRole('button', { name: 'Next' }).click()
    await expect(line(page, 1)).toHaveClass(/dim/)
    await settled(page)
    await expectGaps(page, [12, 12])
  } finally {
    await s.close()
  }
})

/**
 * How far each label (the pill that starts with a sample of its line) is from its line, in the canvas's own units, for lines one to three: 0 where the line runs under it. The label of a line is
 * placed from the line as it is drawn, so it stays by the line wherever the pair has parted it.
 */
const offLine = (page: Page) => page.getByRole('group', { name: /^\d of 3, / }).locator('.react-flow__edge-path').evaluateAll(async paths => {
  const zoom = Number(/scale\(([\d.]+)\)/.exec((document.querySelector('.react-flow__viewport') as HTMLElement).style.transform)?.[1] ?? 1)
  const pills = [...document.querySelectorAll('.lane-pill')]
  return ['One', 'Two', 'Three'].map((text, i) => {
    const pill = pills.find(p => p.querySelector('span')?.textContent === text)!.getBoundingClientRect()
    const path = paths[i] as unknown as SVGGeometryElement
    let best = Infinity
    for (let at = 0; at <= path.getTotalLength(); at += 1) {
      const p = path.getPointAtLength(at)
      const q = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
      best = Math.min(best, Math.hypot(Math.max(pill.left - q.x, 0, q.x - pill.right), Math.max(pill.top - q.y, 0, q.y - pill.bottom)))
    }
    return Math.round((best / zoom) * 10) / 10
  })
})

test('the labels of the lines beside the lit one move with their lines as the pair parts', async ({ page }) => {
  const s = await MODEL()
  try {
    await open(page, s.url)
    // A shape picked shows the labels of all its lines, the lit one's and the ones that part around it.
    await page.locator('.react-flow__node').filter({ hasText: 'A' }).first().click()
    await expect(page.locator('.lane-pill')).toHaveCount(3)
    await settled(page)
    await expectGaps(page, [30, 30])
    const off = await offLine(page)
    // The label of the lit line sits beside it, clear of the dot and the pipe that play along it; the labels of the lines that part around it are by their own lines.
    expect(off[1]).toBeGreaterThan(1)
    expect(off[1]).toBeLessThanOrEqual(24)
    for (const i of [0, 2]) expect(off[i]).toBeLessThanOrEqual(8)
    // Moving on to line three: the pair re-forms around it, and the labels go with their lines.
    await player(page).getByRole('button', { name: 'Next' }).click()
    await expect(line(page, 3)).toHaveClass(/active/)
    await settled(page)
    await expectGaps(page, [12, 30])
    const later = await offLine(page)
    for (const i of [0, 1]) expect(later[i]).toBeLessThanOrEqual(8)
  } finally {
    await s.close()
  }
})

test('a pause holds the lines where the clock is, and play carries them on to open', async ({ page }) => {
  const s = await MODEL()
  try {
    await open(page, s.url)
    await player(page).getByRole('button', { name: 'Pause' }).click()
    const frozen = await gaps(page)
    await page.waitForTimeout(500)
    expect(await gaps(page)).toEqual(frozen)
    await player(page).getByRole('button', { name: 'Play', exact: true }).click()
    await settled(page)
    await expectGaps(page, [30, 30])
  } finally {
    await s.close()
  }
})

test('with reduced motion the lines are open as soon as the step shows', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const s = await MODEL()
  try {
    await open(page, s.url)
    await expect(line(page, 2)).toHaveClass(/active/)
    await expectGaps(page, [30, 30])
  } finally {
    await s.close()
  }
})

test("the camera fits the diagram above the player's card, as tall as the card is", async ({ page }) => {
  // A step with a long text makes a card taller than the room a fit used to leave for it.
  const model = systems(['a', 'b', 'c'], [{ from: 'a', to: 'b', label: 'One' }, { from: 'a', to: 'b', label: 'Two' }, { from: 'b', to: 'c', label: 'Next' }], { pairs: 'separate' })
  const long = 'This step says a good deal about what happens on the line, so that the card of the player has to be taller than its usual room. '.repeat(3)
  model.flows = { ask: { name: 'Ask', view: 'root', steps: [{ from: 'a', to: 'b', text: long, via: 'Two', animation: 'call' }, { from: 'b', to: 'c', text: 'Then on to c', animation: 'send' }] } }
  const s = await serveModel(model, 'flowy-pairs-card-')
  try {
    await page.setViewportSize({ width: 1100, height: 900 })
    await open(page, s.url)
    // The diagram is fitted once the card is drawn, so wait for the view to stop moving.
    await expect.poll(async () => {
      const [card, boxes] = await page.evaluate(() => [
        document.querySelector('.player')!.getBoundingClientRect().top,
        [...document.querySelectorAll('.react-flow__node')].map(n => n.getBoundingClientRect().bottom),
      ] as [number, number[]])
      return Math.max(...boxes) <= card
    }, { intervals: [200], timeout: 5000 }).toBe(true)
  } finally {
    await s.close()
  }
})
