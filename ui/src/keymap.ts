import { escapeStep, letter, takesEnter, undoesMove } from './keys.ts'

/**
 * Every key the reader answers to, in one ordered list. The first entry whose `when` holds takes the key, so the order is part of what the keys mean:
 * taking back a drag comes before Escape closes anything, a load-test run takes the arrows before a flow does, and so on.
 * The list the ? key opens (Shortcuts.tsx) and the key hints on the navigator rail are read from these same entries, so a key is written down once.
 */

/** What a key press carries. A KeyboardEvent has all of it. */
export type KeyEvent = {
  key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; target: EventTarget | null
}

/** What the page looks like at the moment of the press. */
export type KeyState = {
  editing: boolean
  justMoved: boolean // the last thing done was dragging a box: Esc and Backspace take it back
  shortcuts: boolean // the list ? opens is showing
  navigatorOpen: boolean
  navigatorUsed: boolean // the last click or key was in the navigator
  flow: boolean // a flow is playing
  compare: boolean // two flows (or runs) are open: side by side the keys of a flow go to the pane last clicked, swapped to the flow on show
  swap: boolean // the two flows (or runs) are in Swap, one canvas flipping between them
  runCompare: boolean // the comparison is of two runs: the keys of the Performance tab go to the pane last clicked, and the keys of a flow stay out
  halfStep: boolean // a step being recorded has its first end
  panel: boolean // a panel on the right is open, or several shapes are picked
  inside: boolean // not at the top level
  recording: boolean // a flow is being recorded
  perfOpen: boolean
  failuresOpen: boolean
  analysis: boolean // the Failures tab has an analysis to step through
  readOnly: boolean
  showFlows: boolean
  showYaml: boolean
  canPerf: boolean
}

/** What a key can do. The reader supplies them; each one does what its name says, on the screen as it is now. */
export type KeyActions = {
  takeBack(): void
  bringBack(): void
  closeShortcuts(): void
  toggleShortcuts(): void
  closeNavigator(): void
  stopFlow(): void
  /** Compare on and off: close the comparison, or open it beside the flow playing or the run on show (the picker when it has no linked one). */
  compare(): void
  closeCompare(): void
  /** In Swap: flip the canvas to the other flow. */
  swap(): void
  clearStep(): void
  closePanel(): void
  up(): void
  stepRun(by: 1 | -1): void
  runEnd(end: 'first' | 'last'): void
  ramp(): void
  stepFailure(by: 1 | -1): void
  stepFlow(by: 1 | -1): void
  flowEnd(end: 'first' | 'last'): void
  play(): void
  replay(): void
  /** Opens the box in focus (or the one whose panel is open). False when there is none. */
  enter(): boolean
  search(): void
  fit(): void
  toggleTab(tab: 'flows' | 'explorer' | 'yaml'): void
  togglePerf(): void
  toggleFailures(): void
  toggleEdit(): void
  add(): void
  remove(): void
  selectAll(): void
}

export type KeyContext = {
  e: KeyEvent
  key: string // the Latin letter pressed, or the key's place on a US keyboard (see `letter`)
  plain: boolean // no Ctrl, Cmd or Alt
  control: boolean // Ctrl or Cmd, and not held down: undo and redo would run through the whole stack
  inNavigator: boolean // the press came from inside the navigator
  s: KeyState
  act: KeyActions
}

export function contextOf(e: KeyEvent, inNavigator: boolean, s: KeyState, act: KeyActions): KeyContext {
  return { e, key: letter(e), plain: !e.ctrlKey && !e.metaKey && !e.altKey, control: (e.ctrlKey || e.metaKey) && !e.repeat, inNavigator, s, act }
}

export type HelpGroupId = 'reading' | 'flows' | 'performance' | 'failures' | 'editing'
type Help = { keys?: string; text: string } // `keys` is the entry's own when left out

export type KeyId =
  | 'undo-move' | 'escape' | 'perf-step' | 'perf-ends' | 'perf-ramp' | 'failure-step' | 'flow-step' | 'flow-ends' | 'flow-play' | 'flow-replay' | 'compare' | 'swap'
  | 'enter' | 'shortcuts' | 'search' | 'fit' | 'flows' | 'explorer' | 'yaml' | 'perf' | 'failures' | 'edit' | 'add' | 'delete' | 'select-all' | 'redo' | 'undo' | 'up'

export type Entry = {
  id: KeyId
  /** What is pressed, as the shortcut list and the rail show it: caps are separated by two spaces. */
  keys: string
  /** Whether this entry takes the press. Entries are tried in order and the first to say yes wins. */
  when(c: KeyContext): boolean
  /** Does it. Returning false says nothing was done, so the browser keeps the key. */
  run(c: KeyContext): boolean | void
  /** The rows this entry has in the shortcut list, by group. An entry that shares a row with another has none. */
  help?: Partial<Record<HelpGroupId, Help>>
}

const arrow = (c: KeyContext) => c.e.key === 'ArrowRight' || c.e.key === 'ArrowLeft'
const by = (c: KeyContext): 1 | -1 => (c.e.key === 'ArrowRight' ? 1 : -1)
const home = (c: KeyContext) => c.e.key === 'Home' || c.e.key === 'End'
const end = (c: KeyContext): 'first' | 'last' => (c.e.key === 'Home' ? 'first' : 'last')
/** The keys of a flow apply: one is playing, or two are compared. Two runs have no steps: their comparison takes the keys of the Performance tab. */
const flowKeys = (c: KeyContext) => c.s.flow || (c.s.compare && !c.s.runCompare)
/** A plain press of the letter that is not a key held down. */
const tap = (c: KeyContext, l: string) => c.key === l && c.plain && !c.e.repeat

export const KEYMAP: readonly Entry[] = [
  {
    id: 'undo-move', keys: 'Esc  Backspace',
    when: ({ e, s, plain }) => undoesMove(e, { editing: s.editing, justMoved: s.justMoved, shortcuts: s.shortcuts, plain }),
    run: c => c.act.takeBack(),
    help: { editing: { text: 'Straight after dragging a shape: take the drag back' } },
  },
  {
    id: 'escape', keys: 'Esc',
    when: ({ e }) => e.key === 'Escape',
    run: ({ s, inNavigator, act }) => {
      const navigator = s.navigatorOpen && (s.navigatorUsed || inNavigator)
      const layer = escapeStep({ shortcuts: s.shortcuts, navigator, flow: s.flow, halfStep: s.halfStep, panel: s.panel, compare: s.compare, inside: s.inside })
      if (layer === 'shortcuts') act.closeShortcuts()
      else if (layer === 'navigator') act.closeNavigator()
      else if (layer === 'flow') act.stopFlow()
      else if (layer === 'step' && s.recording) act.clearStep()
      else if (layer === 'panel') act.closePanel()
      else if (layer === 'compare') act.closeCompare()
      else if (layer === 'up') act.up()
      else return false
    },
    help: {
      reading: { text: "Close what's open, then go up a level. The navigator closes only if your last click was in it" },
      flows: { text: 'Stop the flow' },
      performance: { text: 'Close the panel' },
    },
  },
  {
    id: 'perf-step', keys: '→  ←',
    when: c => (c.s.perfOpen || c.s.runCompare) && arrow(c),
    run: c => c.act.stepRun(by(c)),
    help: { performance: { text: 'Next and previous tested level' } },
  },
  {
    id: 'perf-ends', keys: 'Home  End',
    when: c => (c.s.perfOpen || c.s.runCompare) && home(c),
    run: c => c.act.runEnd(end(c)),
    help: { performance: { text: 'First and last tested level' } },
  },
  {
    id: 'perf-ramp', keys: 'P',
    when: c => (c.s.perfOpen || c.s.runCompare) && tap(c, 'p'),
    run: c => c.act.ramp(),
    help: { performance: { text: 'Ramp the load or play the time, or pause' } },
  },
  // In edit mode the arrow keys nudge a picked shape, so the list is stepped with them only outside it.
  {
    id: 'failure-step', keys: '→  ←',
    when: c => c.s.failuresOpen && !c.s.editing && c.s.analysis && arrow(c),
    run: c => c.act.stepFailure(by(c)),
    help: { failures: { text: 'Next and previous failure' } },
  },
  {
    id: 'flow-step', keys: '→  ←',
    when: c => flowKeys(c) && arrow(c),
    run: c => c.act.stepFlow(by(c)),
    help: { flows: { text: 'Next and previous step' } },
  },
  {
    id: 'flow-ends', keys: 'Home  End',
    when: c => flowKeys(c) && home(c),
    run: c => c.act.flowEnd(end(c)),
    help: { flows: { text: 'First and last step' } },
  },
  {
    id: 'flow-play', keys: 'P',
    when: c => flowKeys(c) && tap(c, 'p'),
    run: c => c.act.play(),
    help: { flows: { text: 'Step through the flow on its own, or pause' } },
  },
  {
    id: 'flow-replay', keys: 'R',
    when: c => flowKeys(c) && tap(c, 'r'),
    run: c => c.act.replay(),
    help: { flows: { text: 'Replay the step' } },
  },
  // In edit mode the key is still taken, to say why it does nothing there.
  {
    id: 'compare', keys: 'C',
    when: c => tap(c, 'c') && (c.s.flow || c.s.compare || c.s.editing || c.s.perfOpen),
    run: c => c.act.compare(),
    help: { flows: { text: 'Compare with another flow, or close the comparison' } },
  },
  // Only in Swap: side by side the key is left to the browser.
  {
    id: 'swap', keys: 'X',
    when: c => tap(c, 'x') && c.s.swap,
    run: c => c.act.swap(),
    help: { flows: { text: 'Swap to the other flow of a comparison' } },
  },
  {
    id: 'enter', keys: 'Enter',
    when: ({ e, s }) => e.key === 'Enter' && !s.recording && !takesEnter(e.target as { closest?: (selector: string) => unknown } | null),
    run: c => c.act.enter(), // the box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel
    help: { reading: { text: 'Open the selected shape' } },
  },
  // ? before the slash key's fallback: some layouts type ? on that key without Shift.
  {
    id: 'shortcuts', keys: '?',
    when: ({ e }) => e.key === '?',
    run: c => c.act.toggleShortcuts(),
    help: { reading: { text: 'Show these shortcuts' } },
  },
  {
    id: 'search', keys: 'Ctrl+K  /',
    when: ({ e, key }) => (key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/' || (e.code === 'Slash' && !e.shiftKey),
    run: c => c.act.search(),
    help: { reading: { text: 'Find a shape' } },
  },
  {
    id: 'fit', keys: 'F',
    when: c => c.key === 'f' && c.plain,
    run: c => c.act.fit(),
    help: { reading: { text: 'Fit the view' } },
  },
  {
    id: 'flows', keys: 'L',
    when: c => tap(c, 'l') && c.s.showFlows,
    run: c => c.act.toggleTab('flows'),
    help: { reading: { text: 'Show every flow, and play one' } },
  },
  {
    id: 'explorer', keys: 'O',
    when: c => tap(c, 'o'),
    run: c => c.act.toggleTab('explorer'),
    help: { reading: { text: 'Show everything as a tree' } },
  },
  {
    id: 'yaml', keys: 'Y',
    when: c => tap(c, 'y') && c.s.showYaml,
    run: c => c.act.toggleTab('yaml'),
    help: { reading: { text: 'The files as YAML, and what changed' } },
  },
  {
    id: 'perf', keys: 'T',
    when: c => tap(c, 't') && c.s.canPerf,
    run: c => c.act.togglePerf(),
    help: { reading: { text: 'Show a load-test run on the diagram, where there is one' } },
  },
  {
    id: 'failures', keys: 'M',
    when: c => tap(c, 'm'),
    run: c => c.act.toggleFailures(),
    help: { reading: { text: 'Show how things fail, worst first' } },
  },
  {
    id: 'edit', keys: 'E',
    when: c => tap(c, 'e') && !c.s.readOnly,
    run: c => c.act.toggleEdit(),
    help: { editing: { text: 'Edit mode on and off' } },
  },
  {
    id: 'add', keys: 'N',
    when: c => c.s.editing && c.key === 'n' && c.plain && !c.s.recording,
    run: c => c.act.add(),
    help: { editing: { text: 'Add a shape' } },
  },
  {
    id: 'delete', keys: 'Delete',
    when: c => c.s.editing && c.e.key === 'Delete',
    run: c => c.act.remove(),
    help: { editing: { text: 'Delete the selected shapes or line' } },
  },
  {
    id: 'select-all', keys: 'Ctrl+A',
    when: c => c.s.editing && c.control && c.key === 'a' && !c.s.recording,
    run: c => c.act.selectAll(),
    help: { editing: { text: 'Select every shape in this view' } },
  },
  {
    id: 'redo', keys: 'Ctrl+Y  Ctrl+Shift+Z',
    when: c => c.s.editing && c.control && ((c.key === 'z' && c.e.shiftKey) || c.key === 'y'),
    run: c => c.act.bringBack(),
    help: { editing: { text: 'Redo' } },
  },
  {
    id: 'undo', keys: 'Ctrl+Z',
    when: c => c.s.editing && c.control && c.key === 'z',
    run: c => c.act.takeBack(),
    help: { editing: { text: 'Undo' } },
  },
  // Z zooms out, always: Esc and Backspace may be busy taking a drag back, and going up should stay one key away.
  {
    id: 'up', keys: 'Backspace  Z',
    when: c => (c.e.key === 'Backspace' || (c.key === 'z' && c.plain)) && c.s.inside && !c.s.recording,
    run: c => c.act.up(),
    help: { reading: { text: 'Zoom out: go up a level' } },
  },
]

/** The entry that takes this press, if any. */
export const match = (c: KeyContext): Entry | undefined => KEYMAP.find(k => k.when(c))

/** Runs the entry that takes the press. True when something was done, so the browser should not also act on the key. */
export function dispatch(c: KeyContext): boolean {
  const hit = match(c)
  return hit !== undefined && hit.run(c) !== false
}

/** The keys of an entry, as the rail shows them (`O` for the Explorer). */
export const keyOf = (id: KeyId): string => KEYMAP.find(k => k.id === id)!.keys

export const HELP_GROUPS: { id: HelpGroupId; title: string }[] = [
  { id: 'reading', title: 'Getting around' },
  { id: 'flows', title: 'Flows' },
  { id: 'performance', title: 'Performance' },
  { id: 'failures', title: 'Failures' },
  { id: 'editing', title: 'Edit mode' },
]

/** The order of each group's rows. A row that is not a key (a click, a drag) is written out here. */
const HELP_ORDER: Record<HelpGroupId, (KeyId | [string, string])[]> = {
  reading: ['enter', 'escape', 'up', 'search', 'fit', 'flows', 'explorer', 'yaml', 'perf', 'failures', 'shortcuts'],
  flows: ['flow-step', 'flow-ends', 'flow-play', 'flow-replay', 'compare', 'swap', 'escape'],
  performance: ['perf-step', 'perf-ends', 'perf-ramp', 'escape'],
  failures: ['failure-step'],
  editing: [
    'edit', 'add', ['Ctrl+click  Shift+click', 'Add a shape to the selection, or take it out'], ['Shift+drag', 'Draw a box round shapes to select them'],
    'select-all', 'delete', 'undo', 'undo-move', 'redo',
  ],
}

/** The rows of one group of the shortcut list: the keys, and what they do. */
export function helpRows(group: HelpGroupId): [string, string][] {
  return HELP_ORDER[group].map(row => {
    if (Array.isArray(row)) return row
    const entry = KEYMAP.find(k => k.id === row)!
    const help = entry.help![group]!
    return [help.keys ?? entry.keys, help.text]
  })
}
