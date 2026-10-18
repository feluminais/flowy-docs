import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flowToMermaid, mermaidText, viewToMermaid } from '../../src/core/mermaid.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { isView } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

const TEXTS = ['Plain', 'a "quoted" <b>word</b>', 'one\nline  \n\n  next', 'x; y # z', '`code` and ``', '#35; already', ' padded ', '', 'é — ünïcode ✓']

/** The Mermaid text of every view and every flow, and of some hostile strings, as the TypeScript side writes them. */
export async function dumpMermaid(): Promise<unknown> {
  const folders = []
  for (const folder of ['docs/demo/flowy', 'example', 'desktop/fixtures/cases/problems/flowy']) {
    const state = await loadState(join(root, folder))
    if ('parseError' in state) throw new Error(`${folder} can't be read`)
    const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
    const views = [ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id))
    folders.push({
      folder,
      views: views.map(view => ({ view, text: viewToMermaid(model, view) })),
      flows: Object.keys(model.flows).map(flow => ({ flow, text: flowToMermaid(model, flow) })),
    })
  }
  return { texts: TEXTS.map(text => ({ text, escaped: mermaidText(text) })), folders }
}
