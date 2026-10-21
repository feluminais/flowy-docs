import type { Problem } from './problem.ts'
import type { Analysis, Flow, Layout, Model } from './model.ts'
import type { Run } from './perf.ts'

/** What GET /api/state returns: everything the canvas shows, or the file that stops it from loading. */
export type State =
  | {
    model: Pick<Model, 'objects' | 'connections' | 'meta'>
    layout: Layout
    flows: Record<string, Flow>
    /** The failure analyses in failures/, by file name. Left out when the folder has none. */
    failures?: Record<string, Analysis>
    problems: Problem[]
    /** Content hash per file, null for a missing file. Writes send it back as `version`. */
    versions: Record<string, string | null>
    /** Where `code` paths link to, e.g. https://github.com/acme/shop/tree/main/. Missing when the repo isn't on GitHub or GitLab. */
    codeBase?: string
    /** The load-test runs in perf/, by file name. Left out when the folder has none. */
    runs?: Record<string, Run>
    /** What is wrong with those files: one that can't be read, an object it names that isn't there. Kept apart from `problems`, which is the model's. Left out when there are none. */
    runProblems?: Problem[]
    /** What is wrong with the files in failures/ that were skipped (one that can't be read, a .yml file) and with run links. The analyses' other problems are in `problems`. Left out when there are none. */
    failureProblems?: Problem[]
  }
  | { parseError: { file: string; line?: number; message: string } }

/** The model a State holds: its objects and connections with the flows, failure analyses and layout put back. */
export const modelOf = (state: Extract<State, { model: unknown }>): Model =>
  ({ ...state.model, flows: state.flows, failures: state.failures ?? {}, layout: state.layout })

/** The id of the script element an exported page carries its State in, as JSON. */
export const STATE_ELEMENT = 'flowy-state'
