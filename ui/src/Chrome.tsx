import type { ReactNode } from 'react'
import { iconOf } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/** The class that gives an element its type's colour (`--c`): the tile, the header and the chips of a panel are tinted with it. */
export const kindClass = (type: string, external = false) => (external ? 't-external' : ['actor', 'system', 'app', 'store', 'component'].includes(type) ? `t-${type}` : 't-system')

/** An object's icon, in its colour, on a tint of it; a cloud on grey for an outside service. */
export function TypeTile({ type, external, size = 34 }: { type: string; external?: boolean; size?: number }) {
  const Icon = iconOf(type, external)
  return <span className={`tile ${kindClass(type, external)}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}><Icon size={Math.round(size * 0.56)} /></span>
}

/** A small rounded label with an optional icon. `kind` picks its colour: an object type's class, or "warn" or "accent". */
export function Chip({ icon: Icon, kind, children }: { icon?: (props?: IconProps) => ReactNode; kind?: string; children: ReactNode }) {
  return <span className={['chip', kind].filter(Boolean).join(' ')}>{Icon && <Icon size={12} />}{children}</span>
}

/** The heading of a section of the panel: an icon, the title in small capitals and how many there are. */
export function Section({ icon: Icon, title, count }: { icon: (props?: IconProps) => ReactNode; title: string; count?: number }) {
  return (
    <h3 className="section">
      <Icon size={14} />
      {title}
      {count !== undefined && <span className="count">{count}</span>}
    </h3>
  )
}
