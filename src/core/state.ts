import type { Problem } from './check.ts'
import type { Flow, Layout, Model } from './model.ts'

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
  }
  | { parseError: { file: string; line?: number; message: string } }

/** The id of the script element an exported page carries its State in, as JSON. */
export const STATE_ELEMENT = 'flowy-state'
