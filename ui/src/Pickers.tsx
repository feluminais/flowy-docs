import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ICON_GROUPS, ICONS } from '../../src/core/icons.ts'
import { COLORS, COLOR_NAMES, colorPair, customIcons, fillOpacity, iconData, isColorName, isOpacity, SHAPE_DEFS, SHAPES, shapeOf, typeColor } from '../../src/core/look.ts'
import type { Shape } from '../../src/core/look.ts'
import type { FlowyObject, Model, ObjectType } from '../../src/core/model.ts'
import { isExternal } from '../../src/core/model.ts'
import { STATE_LABELS, STATE_NAMES } from '../../src/core/states.ts'
import type { StateName } from '../../src/core/states.ts'
import { lookVars, TypeTile } from './Chrome.tsx'
import { ChevronRight, PathIcon } from './icons.tsx'
import type { IconProps } from './icons.tsx'
import { PlainSwatch, Swatch } from './states.tsx'

/**
 * The pickers of an object's form. Each one draws what it offers, the type's tile, the shape's outline, the colour, the icon, so
 * a choice is made by eye. The chosen one is ringed, and the name of what is chosen sits beside the label.
 */

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
/** A colour as a CSS value that follows the page's colour scheme (a hex colour is the same in both). */
const cssColor = (pair: readonly [string, string]) => (pair[0] === pair[1] ? pair[0] : `light-dark(${pair[0]}, ${pair[1]})`)
/** The colour an object is drawn in as `--c`: the one it names, else its type's. */
const colorOf = (o: Pick<FlowyObject, 'type' | 'external' | 'color'>): CSSProperties =>
  ({ '--c': cssColor(colorPair(o.color) ?? colorPair(typeColor(o))!) }) as CSSProperties

function Head({ label, value }: { label: string; value?: ReactNode }) {
  return <div className="pick-head"><span>{label}</span>{value !== undefined && <span className="pick-value">{value}</span>}</div>
}

/** Object types as their tiles, in the colours the canvas gives them. */
export function TypePicker({ types, value, onPick }: { types: string[]; value: string; onPick: (type: ObjectType) => void }) {
  return (
    <div className="pick-field">
      <Head label="Type" value={value} />
      <div className="pick-grid types" role="radiogroup" aria-label="Type">
        {types.map(t => (
          <button key={t} type="button" role="radio" aria-checked={t === value} className="pick" onClick={() => t !== value && onPick(t as ObjectType)}>
            <TypeTile type={t} size={32} />
            <span>{t}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** A switch for an outside service, with the grey cloud tile it is drawn with. */
export function ExternalToggle({ on, onToggle }: { on: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button type="button" className="pick outside" aria-pressed={on} onClick={() => onToggle(!on)}>
      <TypeTile type="" external size={28} />
      <span>Outside service</span>
      <span className="switch" aria-hidden="true" />
    </button>
  )
}

/** The shapes as outlines, in the object's colour, the first one being what its type draws on its own. */
export function ShapePicker({ object, onPick }: { object: FlowyObject; onPick: (shape: Shape | '') => void }) {
  const fallback = shapeOf({ type: object.type })
  const chosen = SHAPES.find(s => s === object.shape) ?? ''
  const cell = (id: Shape | '') => {
    const shape = id || fallback
    const name = id ? cap(id) : 'Default'
    return (
      <button key={id} type="button" role="radio" aria-checked={id === chosen} aria-label={id ? name : `Default (${fallback})`} title={id ? name : `Default (${fallback})`} className="pick outline" onClick={() => id !== chosen && onPick(id)}>
        <svg viewBox="-3 -3 206 78" aria-hidden="true"><path d={SHAPE_DEFS[shape].path} /></svg>
        <span>{name}</span>
      </button>
    )
  }
  return (
    <div className="pick-field" style={colorOf(object)}>
      <Head label="Shape" value={chosen ? cap(chosen) : `Default (${fallback})`} />
      <div className="pick-grid shapes" role="radiogroup" aria-label="Shape">{['', ...SHAPES].map(id => cell(id as Shape | ''))}</div>
    </div>
  )
}

/**
 * A colour from the names as a row of swatches, the type's own first and any colour the browser's picker makes last. The picker
 * reports every move of the cursor as an input event and only its closing as a change, so it is saved on the change.
 */
export function ColorPicker({ object, onSave }: { object: FlowyObject; onSave: (color: string) => Promise<boolean> }) {
  const color = object.color
  const named = isColorName(color)
  const custom = !!color && !named
  const pair = colorPair(color)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = picker.current
    const save = () => void onSave(el!.value)
    el?.addEventListener('change', save)
    return () => el?.removeEventListener('change', save)
  })
  const own = cssColor(colorPair(typeColor({ type: object.type, external: undefined }))!)
  return (
    <div className="pick-field">
      <Head label="Color" value={named ? cap(color) : color ? color : "Default (the type's)"} />
      <div className="pick-colors" role="radiogroup" aria-label="Color">
        <button type="button" role="radio" aria-checked={!color} aria-label="Default (the type's)" title="Default (the type's)" className="dot auto" style={{ '--sw': own } as CSSProperties} onClick={() => color && void onSave('')} />
        {COLOR_NAMES.map(c => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={cap(c)} title={cap(c)} className="dot" style={{ '--sw': cssColor(COLORS[c]) } as CSSProperties} onClick={() => color !== c && void onSave(c)} />
        ))}
        <label className={`dot custom${custom ? ' on' : ''}`} title="Any color" aria-checked={custom} role="radio" style={pair && custom ? { '--sw': cssColor(pair) } as CSSProperties : undefined}>
          <input key={color} ref={picker} type="color" defaultValue={pair?.[0] ?? '#888888'} aria-label="Pick any color" />
        </label>
      </div>
    </div>
  )
}

/** How much of the colour fills the shape, as a slider over a fade of that colour. Saved when the slider is let go. */
export function OpacityPicker({ object, onSave }: { object: FlowyObject; onSave: (opacity: number | '') => Promise<boolean> }) {
  const set = isOpacity(object.opacity)
  const saved = fillOpacity(object)
  const [live, setLive] = useState<number>()
  const slider = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = slider.current
    const save = () => void onSave(Number(el!.value)).then(() => setLive(undefined))
    el?.addEventListener('change', save)
    return () => el?.removeEventListener('change', save)
  })
  const shown = live ?? saved
  return (
    <div className="pick-field" style={colorOf(object)}>
      <Head label="Opacity" value={set || live !== undefined ? `${shown}%` : `Default (${saved}%)`} />
      <span className="select-row">
        <input ref={slider} type="range" className="fade" min={0} max={100} step={1} value={shown} onChange={e => setLive(Number(e.target.value))} aria-label="Opacity (0 to 100)" />
        {set && <button type="button" className="reset" onClick={() => void onSave('')}>Default</button>}
      </span>
    </div>
  )
}

/** The icon of an object: its tile and name, and, opened, every icon drawn in groups with a filter. The type's own icon is the first choice. */
export function IconPicker({ model, object, onPick }: { model: Model; object: FlowyObject; onPick: (icon: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [hot, setHot] = useState<string>()
  const own = customIcons(model.meta)
  const groups = [...ICON_GROUPS, ...(Object.keys(own).length > 0 ? [{ group: 'This model', names: Object.keys(own) }] : [])]
  const needle = filter.trim().toLowerCase()
  const shown = groups.map(g => ({ ...g, names: g.names.filter(n => n.includes(needle) || g.group.toLowerCase().includes(needle)) })).filter(g => g.names.length > 0)
  const name = object.icon ?? ''
  const pick = (icon: string) => { setOpen(false); setHot(undefined); if (icon !== name) onPick(icon) }
  const look = lookVars(object)
  const defaults = { type: object.type, external: isExternal(object) }
  return (
    <div className="pick-field" style={colorOf(object)} onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}>
      <Head label="Icon" />
      <button type="button" className="pick icon-open" aria-expanded={open} onClick={() => setOpen(!open)}>
        <TypeTile type={object.type} external={defaults.external} size={28} d={iconData(model, object)} style={look} />
        <span>{name || "Default (the type's)"}</span>
        <ChevronRight size={14} />
      </button>
      {open && (
        <div className="icon-pop">
          <input type="search" autoFocus value={filter} placeholder="Find an icon" aria-label="Find an icon" onChange={e => setFilter(e.target.value)} />
          <p className="icon-name" aria-live="polite">{hot ?? (name || "Default (the type's)")}</p>
          <div className="icon-scroll">
            {needle === '' && (
              <button type="button" className="pick icon-default" aria-pressed={name === ''} onClick={() => pick('')} onMouseEnter={() => setHot("Default (the type's)")} onMouseLeave={() => setHot(undefined)}>
                <TypeTile type={object.type} external={defaults.external} size={28} />
                <span>Default (the type's)</span>
              </button>
            )}
            {shown.map(g => (
              <section key={g.group}>
                <h4>{g.group}</h4>
                <div className="icon-grid">
                  {g.names.map(n => (
                    <button key={n} type="button" className="icon-cell" aria-pressed={n === name} aria-label={n} title={n}
                      onClick={() => pick(n)} onMouseEnter={() => setHot(n)} onMouseLeave={() => setHot(undefined)} onFocus={() => setHot(n)} onBlur={() => setHot(undefined)}>
                      <PathIcon d={own[n] ?? ICONS[n]} size={20} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {shown.length === 0 && <p className="muted">No icon called "{filter.trim()}".</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** The six states as tiles drawn the way the canvas draws them, with None first for a step that leaves the shape as it is. `label` is the shape's name. */
export function StatePicker({ label, value, onPick }: { label: string; value?: StateName; onPick: (state: StateName | '') => void }) {
  const cell = (id: StateName | '') => (
    <button key={id} type="button" role="radio" aria-checked={id === (value ?? '')} className="pick" onClick={() => id !== (value ?? '') && onPick(id)}>
      {id === '' ? <PlainSwatch none /> : id === 'running' ? <PlainSwatch /> : <Swatch mark={{ state: id, inside: false }} />}
      <span>{id === '' ? 'None' : STATE_LABELS[id]}</span>
    </button>
  )
  return (
    <div className="pick-field">
      <Head label={label} value={value === undefined ? 'None' : STATE_LABELS[value]} />
      <div className="pick-grid states" role="radiogroup" aria-label={`State of ${label}`}>{['', ...STATE_NAMES].map(id => cell(id as StateName | ''))}</div>
    </div>
  )
}

/** The kinds of a group as cells, each with its icon, so which one a group is can be seen without reading. */
export function KindPicker({ kinds, value, onPick }: { kinds: { id: string; name: string; Icon: (props?: IconProps) => ReactNode }[]; value: string; onPick: (kind: string) => void }) {
  return (
    <div className="pick-field">
      <Head label="Kind" />
      <div className="pick-grid kinds" role="radiogroup" aria-label="Kind">
        {kinds.map(({ id, name, Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={id === value} className="pick" onClick={() => id !== value && onPick(id)}>
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
