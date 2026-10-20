// What the desktop app's copy of highlight.js runs (desktop/Flowy.App/Assets/hljs.js, built by make-hljs-bundle.ts): the same grammars the
// canvas has (ui/src/hljs.ts), and the one function the app calls, which answers in text so no object has to cross into the engine.
import { highlightHtml } from '../../ui/src/hljs.ts'

const flowy = globalThis as unknown as Record<string, unknown>

/** The code as highlight.js's HTML, or null for a language it has no grammar for. */
flowy.flowyHighlight = (text: string, language: string): string | null => highlightHtml(text, language) ?? null
