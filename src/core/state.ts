import type { Problem } from './check.ts'
import type { Flow, Layout, Model } from './model.ts'
import type { Run } from './perf.ts'

/** What GET /api/state returns: everything the canvas shows, or the file that stops it from loading. */
export type State =
  | {
    model: Pick<Model, 'objects' | 'connections' | 'meta'>
    layout: Layout
    flows: Record<string, Flow>
    problems: Problem[]
    /** Content hash per file, null for a missing file. Writes send it back as `version`. */
    versions: Record<string, string | null>
    /** Where `code` paths link to, e.g. https://github.com/acme/shop/tree/main/. Missing when the repo isn't on GitHub or GitLab. */
    codeBase?: string
    /** The load-test runs in perf/, by file name. Left out when the folder has none. */
    runs?: Record<string, Run>
    /** What is wrong with those files: one that can't be read, an object it names that isn't there. Kept apart from `problems`, which is the model's. Left out when there are none. */
    runProblems?: Problem[]
  }
  | { parseError: { file: string; line?: number; message: string } }

/** The id of the script element an exported page carries its State in, as JSON. */
export const STATE_ELEMENT = 'flowy-state'
