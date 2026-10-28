import type { DraftInfo } from './drafts.ts'
import type { YamlNow } from './history.ts'
import type { Problem } from './problem.ts'
import type { Analysis, Flow, Layout, Model } from './model.ts'
import type { Run } from './perf/types.ts'

/** What GET /api/state returns: everything the canvas shows, or the file that stops it from loading. */
export type State =
  | {
    model: Pick<Model, 'objects' | 'connections' | 'meta'>
    layout: Layout
    flows: Record<string, Flow>
    /** The folder of each flow that is in one (see Model.folders). Left out when no flow is. */
    folders?: Record<string, string>
    /** The failure analyses in failures/, by file name. Left out when the folder has none. */
    failures?: Record<string, Analysis>
    problems: Problem[]
    /** Content hash per file, null for a missing file. Writes send it back as `version`. A run's file (`perf/<id>.yaml`) has one too: the write of its `compare` needs it. */
    versions: Record<string, string | null>
    /** Where `code` paths link to, e.g. https://github.com/acme/shop/tree/main/. Missing when the repo isn't on GitHub or GitLab. */
    codeBase?: string
    /** The load-test runs in perf/, by file name. Left out when the folder has none. */
    runs?: Record<string, Run>
    /** What is wrong with those files: one that can't be read, an object it names that isn't there. Kept apart from `problems`, which is the model's. Left out when there are none. */
    runProblems?: Problem[]
    /** What is wrong with the files in failures/ that were skipped (one that can't be read, a .yml file) and with run links. The analyses' other problems are in `problems`. Left out when there are none. */
    failureProblems?: Problem[]
    /** The files as text, for the YAML tab of an exported page. Only an export carries it: a server answers for them in /api/yaml. */
    yaml?: YamlNow
    /** The drafts in this model folder's drafts/, by id. Left out when it has none, and in a draft. */
    drafts?: DraftInfo[]
    /** Set when this folder is a draft: `of` is the name of the model it belongs to ("" when the model has none). */
    draft?: { of: string }
  }
  | { parseError: { file: string; line?: number; message: string } }

/** The model a State holds: its objects and connections with the flows, failure analyses and layout put back. */
export const modelOf = (state: Extract<State, { model: unknown }>): Model =>
  ({ ...state.model, flows: state.flows, ...(state.folders === undefined ? {} : { folders: state.folders }), failures: state.failures ?? {}, layout: state.layout })

/** The id of the script element an exported page carries its State in, as JSON. */
export const STATE_ELEMENT = 'flowy-state'
