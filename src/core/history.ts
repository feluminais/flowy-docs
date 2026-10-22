/** Where a change came from: an edit in Flowy (you), through the MCP tools (ai), anything else (outside), a restore, or the first look at a folder. */
export type StepSource = 'you' | 'ai' | 'outside' | 'restore' | 'first'

/** Which program recorded the step. */
export type StepApp = 'browser' | 'desktop' | 'mcp'

/**
 * One recorded step of a model folder's history. `id` is the file name it is kept under and sorts in time order. `files` maps each path to
 * the hash of that file's bytes; a file that did not exist then is not in it.
 */
export type Step = { id: string; time: string; label: string; source: StepSource; app: StepApp; files: Record<string, string> }

/** A step as the list shows it: `changed` is the files it changed against the step before it. */
export type StepInfo = Omit<Step, 'files'> & { changed: string[] }

/** A file as the panel shows it: its text, or the fact that it is not text. */
export type StepFile = { text: string } | { notText: true }

/** A step with its files, and the step before it in the list (what the marks are against). */
export type StepView = { step: StepInfo; files: Record<string, StepFile>; previous?: { id: string; files: Record<string, StepFile> } }

/** The files as they are on disk now, as text, with each one's version. */
export type YamlNow = { files: Record<string, StepFile>; versions: Record<string, string> }

/** The newest this many steps of a folder are kept. */
export const HISTORY_LIMIT = 300

/** Trimming reads every step, so it waits until there are this many more than the limit and then goes back to the limit in one go. */
export const HISTORY_SLACK = 30

export const FIRST_LABEL = 'First seen'
export const CLOSED_LABEL = 'Changed while Flowy was closed'

/** Edits made in Flowy, through its tools or by a restore are labelled; a step that only notices a change is not. */
export const isLabelled = (source: StepSource): boolean => source === 'you' || source === 'ai' || source === 'restore'

/** A step's id: the time to the millisecond, then a random part so two programs recording at once do not collide. Plain sorting is time order. */
export function stepId(time: Date, random: string): string {
  return `${time.toISOString().replace(/[-:.]/g, '')}-${random}`
}

export function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => b[key] === a[key])
}

/** The paths that differ between two sets of files, including ones in only one of them, sorted. */
export function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).sort()
}

/**
 * The steps as the list shows them, oldest first. A step with the same files as the one before it adds nothing and is dropped, except that
 * a labelled step takes the place of an unlabelled one it equals: the labelled one says what happened.
 */
export function collapseSteps(oldestFirst: Step[]): Step[] {
  const kept: Step[] = []
  for (const step of oldestFirst) {
    const last = kept[kept.length - 1]
    if (last && sameFiles(last.files, step.files)) {
      if (isLabelled(step.source) && !isLabelled(last.source)) kept[kept.length - 1] = step
      continue
    }
    kept.push(step)
  }
  return kept
}

/** The list rows for collapsed steps, newest first. */
export function stepInfos(collapsedOldestFirst: Step[]): StepInfo[] {
  return collapsedOldestFirst
    .map(({ files, ...info }, i) => ({ ...info, changed: changedPaths(i === 0 ? {} : collapsedOldestFirst[i - 1].files, files) }))
    .reverse()
}

/** Which steps to delete to keep the newest `keep`, and the blob names the kept steps still need. */
export function planRetention(oldestFirst: Step[], keep: number): { dropSteps: string[]; keepBlobs: Set<string> } {
  const cut = Math.max(0, oldestFirst.length - keep)
  return {
    dropSteps: oldestFirst.slice(0, cut).map(step => step.id),
    keepBlobs: new Set(oldestFirst.slice(cut).flatMap(step => Object.values(step.files))),
  }
}

/** Up to three paths by name, else how many. */
const fileList = (files: string[]): string => (files.length <= 3 ? files.join(', ') : `${files.length} files`)

export const outsideLabel = (files: string[]): string => (files.length === 0 ? 'Changed outside Flowy' : `Changed outside Flowy: ${fileList(files)}`)

/** The label of a change nobody described. */
export const fallbackLabel = (files: string[]): string => (files.length === 0 ? 'Changed files' : `Changed ${fileList(files)}`)

/** What an MCP tool call is called in the list: the tool and what it was given (an id, a name, or the two ends of a connection). */
export function mcpLabel(tool: string, input: Record<string, unknown>): string {
  const { from, to, id, name } = input
  if (typeof from === 'string' && typeof to === 'string') return `AI: ${tool} ${from} → ${to}`
  const target = typeof id === 'string' ? id : typeof name === 'string' ? name : undefined
  return target === undefined ? `AI: ${tool}` : `AI: ${tool} ${target}`
}
