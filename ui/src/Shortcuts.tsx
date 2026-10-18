/** The keyboard shortcuts, as App's key handler has them. Keep the two in step. */
const READING: [string, string][] = [
  ['Enter', 'Open the selected box'],
  ['Esc', "Close what's open, then go up a level"],
  ['Backspace', 'Go up a level'],
  ['Ctrl+K or /', 'Find a box'],
  ['F', 'Fit the view'],
  ['?', 'Show these shortcuts'],
]
const FLOWS: [string, string][] = [
  ['→  ←', 'Next and previous step'],
  ['Home  End', 'First and last step'],
  ['Esc', 'Stop the flow'],
]
const EDITING: [string, string][] = [
  ['E', 'Edit mode on and off'],
  ['N', 'Add a box'],
  ['Delete', 'Delete the selected box or line'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo (Ctrl+Shift+Z works too)'],
]

function Group({ title, keys }: { title: string; keys: [string, string][] }) {
  return (
    <>
      <h3>{title}</h3>
      <dl>
        {keys.map(([key, what]) => [<dt key={`${key} key`}><kbd>{key}</kbd></dt>, <dd key={`${key} what`}>{what}</dd>])}
      </dl>
    </>
  )
}

/** What ? opens. The editing keys only show where the page can edit. */
export function Shortcuts({ editable, onClose }: { editable: boolean; onClose: () => void }) {
  return (
    <section className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
      <button className="close" aria-label="Close" onClick={onClose}>×</button>
      <Group title="Getting around" keys={READING} />
      <Group title="Flows" keys={FLOWS} />
      {editable && <Group title="Edit mode" keys={EDITING} />}
    </section>
  )
}
