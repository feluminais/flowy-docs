import type { ReactNode } from 'react'
import { Section } from './Chrome.tsx'
import { Activity, Close, Pencil, Play, Search } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/** The keyboard shortcuts, as App's key handler has them. Keep the two in step. */
const READING: [string, string][] = [
  ['Enter', 'Open the selected shape'],
  ['Esc', "Close what's open, then go up a level. The navigator closes only if your last click was in it"],
  ['Backspace  Z', 'Zoom out: go up a level'],
  ['Ctrl+K  /', 'Find a shape'],
  ['F', 'Fit the view'],
  ['L', 'Show every flow, and play one'],
  ['O', 'Show everything as a tree'],
  ['Y', 'The files as YAML, and what changed'],
  ['T', 'Show a load-test run on the diagram, where there is one'],
  ['?', 'Show these shortcuts'],
]
const FLOWS: [string, string][] = [
  ['→  ←', 'Next and previous step'],
  ['Home  End', 'First and last step'],
  ['P', 'Step through the flow on its own, or pause'],
  ['R', 'Replay the step'],
  ['Esc', 'Stop the flow'],
]
const PERFORMANCE: [string, string][] = [
  ['→  ←', 'Next and previous tested load'],
  ['Home  End', 'Lowest and highest tested load'],
  ['P', 'Ramp the load up on its own, or pause'],
  ['Esc', 'Close the panel'],
]
const EDITING: [string, string][] = [
  ['E', 'Edit mode on and off'],
  ['N', 'Add a shape'],
  ['Ctrl+click  Shift+click', 'Add a shape to the selection, or take it out'],
  ['Shift+drag', 'Draw a box round shapes to select them'],
  ['Ctrl+A', 'Select every shape in this view'],
  ['Delete', 'Delete the selected shapes or line'],
  ['Ctrl+Z', 'Undo'],
  ['Esc  Backspace', 'Straight after dragging a shape: take the drag back'],
  ['Ctrl+Y  Ctrl+Shift+Z', 'Redo'],
]

/** Two spaces between keys that do the same thing: each is its own cap. */
const caps = (key: string) => key.split('  ').map(k => <kbd key={k}>{k}</kbd>)

function Group({ icon, title, keys }: { icon: (props?: IconProps) => ReactNode; title: string; keys: [string, string][] }) {
  return (
    <>
      <Section icon={icon} title={title} />
      <dl>
        {keys.map(([key, what]) => [<dt key={`${key} key`}>{caps(key)}</dt>, <dd key={`${key} what`}>{what}</dd>])}
      </dl>
    </>
  )
}

/** What ? opens. The editing keys only show where the page can edit. */
export function Shortcuts({ editable, performance, onClose }: { editable: boolean; performance: boolean; onClose: () => void }) {
  return (
    <section className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
      <button className="close" aria-label="Close" onClick={onClose}><Close size={16} /></button>
      <h2>Keyboard shortcuts</h2>
      <Group icon={Search} title="Getting around" keys={READING} />
      <Group icon={Play} title="Flows" keys={FLOWS} />
      {performance && <Group icon={Activity} title="Performance" keys={PERFORMANCE} />}
      {editable && <Group icon={Pencil} title="Edit mode" keys={EDITING} />}
    </section>
  )
}
