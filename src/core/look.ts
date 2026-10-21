import { ICONS } from './icons.ts'
import type { FlowyObject, Model } from './model.ts'

/** How a shape is drawn, how its colour is chosen and which icon it carries. The desktop app (Look.cs) holds the same tables, and a fixture test keeps the two equal. */

/** The shapes an object may take with `shape:`. Documented, with what each is for, in docs/guide.md. */
export const SHAPES = ['rectangle', 'pill', 'ellipse', 'diamond', 'hexagon', 'parallelogram', 'cylinder', 'queue', 'document', 'folder', 'note', 'cloud', 'arrow'] as const
export type Shape = (typeof SHAPES)[number]

export const isShape = (v: unknown): v is Shape => typeof v === 'string' && SHAPES.some(s => s === v)

/**
 * One shape. Every shape is drawn in the same 200×72 area as a box always was, so layout never depends on it.
 * `path` is the outline (the lines inside it, like a cylinder's rim, are part of it). `pad` is where content may
 * sit inside it, as [top, right, bottom, left] px; `badge` is where "3 inside" goes, as [right, bottom] px;
 * `tile` is whether the icon tile shows unless the object names an icon itself. `edge` is the outline as a convex polygon, which is
 * where a straight line meets the shape; empty means the rectangle, and so does a shape that nearly fills it.
 */
export type ShapeDef = { path: string; pad: [number, number, number, number]; badge: [number, number]; tile: boolean; edge: [number, number][] }

const round2 = (v: number) => Math.round(v * 100) / 100
/** n points around an ellipse, as a polygon: close enough that a line meeting it is never a pixel off. */
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 32): [number, number][] =>
  Array.from({ length: n }, (_, i) => [round2(cx + rx * Math.cos((2 * Math.PI * i) / n)), round2(cy + ry * Math.sin((2 * Math.PI * i) / n))])
/** A pill: two half circles of radius 35 joined by straight sides. */
const stadium = (): [number, number][] => [
  ...Array.from({ length: 13 }, (_, i): [number, number] => [round2(164 + 35 * Math.cos((Math.PI * (i - 6)) / 12)), round2(36 + 35 * Math.sin((Math.PI * (i - 6)) / 12))]),
  ...Array.from({ length: 13 }, (_, i): [number, number] => [round2(36 - 35 * Math.cos((Math.PI * (i - 6)) / 12)), round2(36 - 35 * Math.sin((Math.PI * (i - 6)) / 12))]),
]

export const SHAPE_DEFS: Record<Shape, ShapeDef> = {
  rectangle: { path: 'M9 1H191A8 8 0 0 1 199 9V63A8 8 0 0 1 191 71H9A8 8 0 0 1 1 63V9A8 8 0 0 1 9 1Z', pad: [0, 14, 0, 12], badge: [9, 5], tile: true, edge: [] },
  pill: { path: 'M36 1H164A35 35 0 0 1 164 71H36A35 35 0 0 1 36 1Z', pad: [0, 30, 0, 28], badge: [24, 5], tile: true, edge: stadium() },
  ellipse: { path: 'M1 36A99 35 0 0 1 199 36A99 35 0 0 1 1 36Z', pad: [0, 26, 0, 24], badge: [34, 7], tile: true, edge: ellipse(100, 36, 99, 35) },
  diamond: { path: 'M100 1L199 36L100 71L1 36Z', pad: [0, 50, 0, 50], badge: [66, 9], tile: false, edge: [[100, 1], [199, 36], [100, 71], [1, 36]] },
  hexagon: { path: 'M26 1H174L199 36L174 71H26L1 36Z', pad: [0, 28, 0, 28], badge: [28, 6], tile: true, edge: [[26, 1], [174, 1], [199, 36], [174, 71], [26, 71], [1, 36]] },
  parallelogram: { path: 'M26 1H199L174 71H1Z', pad: [0, 30, 0, 28], badge: [30, 5], tile: true, edge: [[26, 1], [199, 1], [174, 71], [1, 71]] },
  cylinder: { path: 'M1 9A99 8 0 0 1 199 9V63A99 8 0 0 1 1 63ZM1 9A99 8 0 0 0 199 9', pad: [10, 14, 0, 12], badge: [9, 7], tile: true, edge: [] },
  queue: { path: 'M10 1H190A9 35 0 0 1 190 71H10A9 35 0 0 1 10 1ZM10 1A9 35 0 0 1 10 71', pad: [0, 20, 0, 24], badge: [20, 5], tile: true, edge: [] },
  document: { path: 'M1 1H199V63C166 72 133 54 100 63C67 72 34 54 1 63Z', pad: [0, 14, 8, 12], badge: [9, 12], tile: true, edge: [] },
  folder: { path: 'M1 9A8 8 0 0 1 9 1H66L80 15H191A8 8 0 0 1 199 23V63A8 8 0 0 1 191 71H9A8 8 0 0 1 1 63Z', pad: [14, 14, 0, 12], badge: [9, 5], tile: true, edge: [] },
  note: { path: 'M1 9A8 8 0 0 1 9 1H171L199 29V63A8 8 0 0 1 191 71H9A8 8 0 0 1 1 63ZM171 1V21A8 8 0 0 0 179 29H199', pad: [8, 14, 0, 12], badge: [9, 5], tile: true, edge: [] },
  cloud: { path: 'M30 70H172A21 21 0 1 0 164.67 29.32A21 21 0 0 0 130.1 17.25A26 26 0 0 0 81.41 18.55A22 22 0 0 0 42 31.77A21 21 0 1 0 30 70Z', pad: [30, 26, 2, 34], badge: [30, 6], tile: true, edge: ellipse(100, 38, 92, 33, 24) },
  arrow: { path: 'M1 1H165L199 36L165 71H1Z', pad: [0, 36, 0, 12], badge: [34, 5], tile: true, edge: [[1, 1], [165, 1], [199, 36], [165, 71], [1, 71]] },
}

/** What `type` draws when an object names no shape: actors as pills, stores as cylinders, the rest as rectangles. */
export const shapeOf = (o: Pick<FlowyObject, 'type' | 'shape'>): Shape =>
  isShape(o.shape) ? o.shape : o.type === 'actor' ? 'pill' : o.type === 'store' ? 'cylinder' : 'rectangle'

/** Named colours, each as [light theme, dark theme], to read on the canvas of either. Any #rgb or #rrggbb works too. */
export const COLORS = {
  gray: ['#888780', '#b4b2a9'],
  red: ['#e24b4a', '#f09595'],
  orange: ['#d85a30', '#f0997b'],
  amber: ['#ba7517', '#efb04a'],
  green: ['#639922', '#97c459'],
  teal: ['#1d9e75', '#5dcaa5'],
  blue: ['#378add', '#85b7eb'],
  indigo: ['#5b5fd6', '#9a9df0'],
  purple: ['#7f77dd', '#afa9ec'],
  pink: ['#d4537e', '#ed93b1'],
} as const satisfies Record<string, readonly [string, string]>
export type ColorName = keyof typeof COLORS
export const COLOR_NAMES = Object.keys(COLORS) as ColorName[]

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
export const isColorName = (v: unknown): v is ColorName => typeof v === 'string' && Object.hasOwn(COLORS, v)
export const isColor = (v: unknown): boolean => isColorName(v) || (typeof v === 'string' && HEX.test(v))
/** Whole percent, 0 to 100, no sign, no leading zero. */
export const isOpacity = (v: unknown): boolean => typeof v === 'string' && /^(?:100|[1-9]?\d)$/.test(v)

/** A colour as [light, dark] #rrggbb, or undefined when it isn't one. A hex colour is the same in both themes. */
export function colorPair(color: unknown): [string, string] | undefined {
  if (isColorName(color)) return [...COLORS[color]]
  if (typeof color !== 'string' || !HEX.test(color)) return undefined
  const hex = color.length === 4 ? `#${[...color.slice(1)].map(c => c + c).join('')}` : color
  return [hex.toLowerCase(), hex.toLowerCase()]
}

/** How much of the colour the fill holds, in percent: what `opacity:` says, else 15 once a colour is set, else 0 (the plain surface). */
export const fillOpacity = (o: Pick<FlowyObject, 'color' | 'opacity'>): number =>
  isOpacity(o.opacity) ? Number(o.opacity) : isColor(o.color) ? 15 : 0

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (rgb: number[]) => 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])

/** The canvas surface a fill is blended over, in [light theme, dark theme]. Keep in sync with --box in style.css. */
const SURFACE = ['#ffffff', '#292524'] as const
const DARK_INK = '#1c1917'
const LIGHT_INK = '#fafaf9'

/**
 * The text colour that reads on an object's fill, as [light theme, dark theme], or undefined while the usual text already does
 * (a light tint, or no fill at all: dark text on the light theme, light text on the dark one). The fill is the colour at its
 * opacity over the plain surface; the text is whichever of near-black and near-white has the better WCAG contrast against it.
 */
export function onFill(o: Pick<FlowyObject, 'type' | 'external' | 'color' | 'opacity'>): [string, string] | undefined {
  const opacity = fillOpacity(o) / 100
  if (opacity === 0) return undefined
  const pair = colorPair(isColor(o.color) ? o.color : typeColor(o))!
  const pick = (theme: 0 | 1): string => {
    const fill = luminance([1, 3, 5].map(at => opacity * channel(pair[theme], at) + (1 - opacity) * channel(SURFACE[theme], at)))
    const contrast = (ink: string) => {
      const t = luminance([1, 3, 5].map(at => channel(ink, at)))
      return (Math.max(fill, t) + 0.05) / (Math.min(fill, t) + 0.05)
    }
    return contrast(DARK_INK) >= contrast(LIGHT_INK) ? DARK_INK : LIGHT_INK
  }
  const on: [string, string] = [pick(0), pick(1)]
  return on[0] === DARK_INK && on[1] === LIGHT_INK ? undefined : on
}

/** What an icon name may look like, worded to follow "icon names". */
export const ICON_NAME_RULE = 'use lowercase letters, digits and dashes, not starting with a dash'
export const isIconName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(name)

/** SVG path data a custom icon may hold: path commands and numbers only, on the 24×24 grid, kept short. */
export const isPathData = (d: unknown): d is string =>
  typeof d === 'string' && d.length <= 4000 && /^[ \t\n\r\f\v]*[Mm]/.test(d) && /^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r\f\v,.+\-eE]+$/.test(d)

/** Why `icons: { name: d }` can't be used, or undefined when it can. Worded to follow "icon <name>:". */
export function iconProblem(name: string, d: unknown): string | undefined {
  if (!isIconName(name)) return `names ${ICON_NAME_RULE}`
  if (Object.hasOwn(ICONS, name)) return 'is a built-in icon, so pick another name'
  if (!isPathData(d)) return 'must be SVG path data (commands like M, L, C, A and Z, on a 24×24 grid, at most 4000 characters)'
  return undefined
}

/** The model's own icons: the well-formed entries of `icons:` in model.yaml. check() reports the rest. */
export function customIcons(meta: Model['meta']): Record<string, string> {
  const icons = meta.icons
  if (typeof icons !== 'object' || icons === null || Array.isArray(icons)) return {}
  return Object.fromEntries(Object.entries(icons).filter(([name, d]) => iconProblem(name, d) === undefined)) as Record<string, string>
}

/** Whether an icon name is a built-in or one the model defines. */
export const isKnownIcon = (meta: Model['meta'], name: unknown): boolean =>
  typeof name === 'string' && (Object.hasOwn(ICONS, name) || Object.hasOwn(customIcons(meta), name))

/** The colour an object has when it names none: its type's, or grey for an outside service. */
export const typeColor = (o: Pick<FlowyObject, 'type' | 'external'>): ColorName =>
  o.external === 'true' ? 'gray' : o.type === 'actor' ? 'purple' : o.type === 'app' ? 'teal' : o.type === 'store' ? 'pink' : o.type === 'component' ? 'orange' : 'blue'

const TYPE_ICONS: Record<string, string> = { actor: 'user', system: 'cube', app: 'app-window', store: 'database', component: 'puzzle' }

/**
 * The path data of the icon an object shows: the one it names, else a cloud when it is an outside service,
 * else its type's (a type nobody knows gets the system's).
 */
export function iconData(model: Pick<Model, 'meta'>, o: Pick<FlowyObject, 'type' | 'icon' | 'external'>): string {
  if (typeof o.icon === 'string' && o.icon !== '') {
    const own = customIcons(model.meta)
    if (Object.hasOwn(own, o.icon)) return own[o.icon]
    if (Object.hasOwn(ICONS, o.icon)) return ICONS[o.icon]
  }
  if (o.external === 'true') return ICONS.cloud
  return ICONS[Object.hasOwn(TYPE_ICONS, o.type) ? TYPE_ICONS[o.type] : 'cube']
}

/** Whether the icon tile shows: always, unless the shape has no room for it and the object names no icon. */
export const showsTile = (o: Pick<FlowyObject, 'type' | 'shape' | 'icon'>): boolean =>
  SHAPE_DEFS[shapeOf(o)].tile || (typeof o.icon === 'string' && o.icon !== '')
