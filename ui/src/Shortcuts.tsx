import type { ReactNode } from 'react'
import { Section } from './Chrome.tsx'
import { Activity, Bolt, Close, Pencil, Play, Search } from './icons.tsx'
import type { IconProps } from './icons.tsx'
import { helpRows, HELP_GROUPS } from './keymap.ts'
import type { HelpGroupId } from './keymap.ts'

/** Two spaces between keys that do the same thing: each is its own cap. */
const caps = (key: string) => key.split('  ').map(k => <kbd key={k}>{k}</kbd>)

function Group({ icon, group }: { icon: (props?: IconProps) => ReactNode; group: HelpGroupId }) {
  return (
    <>
      <Section icon={icon} title={HELP_GROUPS.find(g => g.id === group)!.title} />
      <dl>
        {helpRows(group).map(([key, what]) => [<dt key={`${key} key`}>{caps(key)}</dt>, <dd key={`${key} what`}>{what}</dd>])}
      </dl>
    </>
  )
}

/** What ? opens, read from the key map (keymap.ts). The editing keys only show where the page can edit. */
export function Shortcuts({ editable, performance, failures, onClose }: { editable: boolean; performance: boolean; failures: boolean; onClose: () => void }) {
  return (
    <section className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
      <button className="close" aria-label="Close" onClick={onClose}><Close size={16} /></button>
      <h2>Keyboard shortcuts</h2>
      <Group icon={Search} group="reading" />
      <Group icon={Play} group="flows" />
      {performance && <Group icon={Activity} group="performance" />}
      {failures && <Group icon={Bolt} group="failures" />}
      {editable && <Group icon={Pencil} group="editing" />}
    </section>
  )
}
