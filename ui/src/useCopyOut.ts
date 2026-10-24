import type { Analysis, Flow, Model } from '../../src/core/model.ts'
import { table } from '../../src/core/failures.ts'
import { copyMessage } from '../../src/core/host.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { vscode } from './host.ts'
import { starterRun } from './perfview.ts'
import type { Play } from './usePlayer.ts'

/** What the reader copies out of the page to paste elsewhere: the view or the flow as Mermaid, a starter run, an analysis as a table. */
export function useCopyOut({ model, view, flow, playing, analysis, setNotice }: {
  model: Model; view: string; flow: Flow | undefined; playing: Play | undefined; analysis: Analysis | undefined; setNotice: (notice: string) => void
}) {
  // Fenced, so it pastes straight into a README or a PR, where GitHub draws it.
  const copyText = async (text: string, notice: string) => {
    try {
      // In VS Code the editor writes it: a webview can't count on the clipboard API, which wants the page focused.
      if (vscode) vscode.postMessage(copyMessage(text))
      else await navigator.clipboard.writeText(text)
      setNotice(notice)
    } catch {
      setNotice("Couldn't copy: the browser didn't allow it.")
    }
  }
  const copyMermaid = () => {
    const diagram = flow && playing ? flowToMermaid(model, playing.flow) : viewToMermaid(model, view)
    return copyText('```mermaid\n' + diagram + '```\n', `Copied ${flow ? 'this flow' : 'this view'} as Mermaid. Paste it into a README or a PR: GitHub draws it.`)
  }
  // Flowy reads runs and writes only their `compare` field, so making one is a file: a starter for this view to fill with what a load test measured.
  const createRun = () => copyText(starterRun(model, view), 'Copied a starter run for this view. Fill in your numbers and save it as flowy/perf/<name>.yaml.')
  const copyFailures = (format: 'markdown' | 'csv') => {
    if (analysis) void copyText(table(model, analysis, format), format === 'csv' ? 'Copied this analysis as CSV.' : 'Copied this analysis as a table.')
  }
  return { copyMermaid, createRun, copyFailures }
}
