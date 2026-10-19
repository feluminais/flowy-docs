import type { CSSProperties, ReactNode } from 'react'
import { colorPair, fillOpacity, iconData, onFill } from '../../src/core/look.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { iconOf, PathIcon } from './icons.tsx'
import type { IconProps } from './icons.tsx'

/** The class that gives an element its type's colour (`--c`): the tile, the header and the chips of a panel are tinted with it. */
export const kindClass = (type: string, external = false) => (external ? 't-external' : ['actor', 'system', 'app', 'store', 'component'].includes(type) ? `t-${type}` : 't-system')

/**
 * What an object's own `color` and `opacity` set on its element: `--c`, the colour (a named one in both themes, through
 * light-dark(), which follows the page's colour scheme), `--o`, how much of it the fill holds, and `--on`, the text colour that reads on a
 * fill that dark or strong. Without a colour the type's `--c` stays.
 */
export function lookVars(o: Pick<FlowyObject, 'color' | 'opacity'> & Partial<Pick<FlowyObject, 'type' | 'external'>>): CSSProperties {
  const pair = colorPair(o.color)
  const opacity = fillOpacity(o)
  const on = o.type === undefined ? undefined : onFill({ ...o, type: o.type })
  return {
    ...(pair && { '--c': pair[0] === pair[1] ? pair[0] : `light-dark(${pair[0]}, ${pair[1]})` }),
    ...(opacity > 0 && { '--o': `${opacity}%` }),
    ...(on && { '--on': `light-dark(${on[0]}, ${on[1]})` }),
  } as CSSProperties
}

/** An icon, in a colour, on a tint of it. `d` is the icon's path data; without one, the type's icon (a cloud for an outside service). */
export function TypeTile({ type, external, size = 34, d, style }: { type: string; external?: boolean; size?: number; d?: string; style?: CSSProperties }) {
  const iconSize = Math.round(size * 0.56)
  return (
    <span className={`tile ${kindClass(type, external)}`} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), ...style }}>
      {d ? <PathIcon d={d} size={iconSize} /> : (() => { const Icon = iconOf(type, external); return <Icon size={iconSize} /> })()}
    </span>
  )
}

/** The tile of one object as it is drawn on the canvas: the icon and colour it names, else its type's. */
export function ObjectTile({ model, object, size }: { model: Model; object: FlowyObject | undefined; size?: number }) {
  if (!object) return <TypeTile type="" size={size} />
  return <TypeTile type={object.type} external={object.external === 'true'} size={size} d={iconData(model, object)} style={lookVars(object)} />
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
