import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Code is coloured by kind of stretch (the tok colours in ui/src/style.css, the Tok brushes in desktop/Flowy.App/Styles.axaml).
 * Each colour reads at 4.5 to 1 on what code sits on: the page, a card, and a row under the pointer. The desktop's brushes are the browser's.
 */
const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const axaml = readFileSync(join(import.meta.dirname, '../desktop/Flowy.App/Styles.axaml'), 'utf8')

/** The custom properties set in the first rule whose selector ends with `selector` and that sets `has`. */
function vars(selector: string, has: string): Record<string, string> {
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (!m[1].trim().endsWith(selector) || !m[2].includes(has)) continue
    return Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(d => [d[1], d[2].trim()]))
  }
  assert.fail(`no rule ${selector} setting ${has}`)
}

const light = { ...vars(':root', '--bg:'), ...vars(':root', '--tok-comment') }
const dark = { ...vars(":root[data-theme='dark']", '--bg:'), ...vars(":root[data-theme='dark']", '--tok-comment') }
const toks = (theme: Record<string, string>) => Object.fromEntries(Object.entries(theme).filter(([k]) => k.startsWith('tok-')).map(([k, v]) => [k.slice(4), v.toLowerCase()]))

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const over = (fg: string, bg: string, alpha: number) => '#' + rgb(fg).map((v, i) => Math.round(v * alpha + rgb(bg)[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
  test(`code in the ${name} theme reads at 4.5 to 1 on the page, a card and a row under the pointer`, () => {
    const grounds = { 'the page': theme.bg, 'a card': theme.box, 'a hovered row': over(theme.fg, theme.bg, 0.1) }
    const colours = toks(theme)
    assert.equal(Object.keys(colours).length, 9)
    const faint = Object.entries(colours).flatMap(([kind, colour]) =>
      Object.entries(grounds).filter(([, ground]) => ratio(colour, ground) < 4.5).map(([where, ground]) => `${kind} ${colour} on ${where}: ${ratio(colour, ground).toFixed(2)}`))
    assert.deepEqual(faint, [])
  })
}

test('the desktop colours code with the browser colours, in both themes', () => {
  const brushes = (key: string) => {
    const dict = axaml.slice(axaml.indexOf(`<ResourceDictionary x:Key="${key}">`))
    const body = dict.slice(0, dict.indexOf('</ResourceDictionary>'))
    return Object.fromEntries([...body.matchAll(/x:Key="Tok(\w+)Brush" Color="(#[0-9a-fA-F]{6})"/g)].map(m => [m[1].toLowerCase(), m[2].toLowerCase()]))
  }
  assert.deepEqual(brushes('Light'), toks(light))
  assert.deepEqual(brushes('Dark'), toks(dark))
})
