import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { themeOf } from '../ui/src/theme.ts'

test("a webview's theme is the class VS Code puts on its body", () => {
  assert.equal(themeOf('vscode-dark'), 'dark')
  assert.equal(themeOf('vscode-light'), 'light')
  assert.equal(themeOf('vscode-high-contrast'), 'dark')
  assert.equal(themeOf('vscode-high-contrast vscode-high-contrast-light'), 'light')
  assert.equal(themeOf('vscode-dark  other'), 'dark')
})

test('a page with no such class follows the system', () => {
  assert.equal(themeOf(''), undefined)
  assert.equal(themeOf('dark'), undefined)
})

/** The declarations of the first rule in `css` whose selector contains `selector`. */
function rule(css: string, selector: string): string[] {
  const at = css.indexOf(selector)
  assert.ok(at >= 0, `no rule for ${selector}`)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open)).split(';').map(d => d.trim()).filter(Boolean)
}

test("the dark colours are the same whether the system or a host asks for them", async () => {
  const css = await readFile(new URL('../ui/src/style.css', import.meta.url), 'utf8')
  const system = rule(css, ":root:not([data-theme='light'])")
  const host = rule(css, ":root[data-theme='dark']").filter(d => !d.startsWith('color-scheme'))
  assert.ok(system.length > 10, 'the dark tokens are missing')
  assert.deepEqual(host, system)
})
