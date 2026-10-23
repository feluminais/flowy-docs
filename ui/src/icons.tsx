// Icons from Tabler Icons, https://tabler.io/icons. MIT License, Copyright (c) 2020-2024 Paweł Kuna.
// The minifier drops comments, so the notice ships as ui/public/TABLER-ICONS-LICENSE.txt next to the bundle.
import type { JSX, ReactNode } from 'react'
import { ICONS } from '../../src/core/icons.ts'
import type { ObjectType } from '../../src/core/model.ts'

/** An icon at `size` pixels (18 unless it says), in the colour of the text around it. */
export type IconProps = { size?: number }

const icon = (paths: ReactNode) => function Icon({ size = 18 }: IconProps = {}): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  )
}
const one = (d: string) => icon(<path d={d} />)

/** An icon drawn from SVG path data on the 24×24 grid: a built-in one (src/core/icons.ts) or one the model defines. */
export function PathIcon({ d, size = 18 }: IconProps & { d: string }): JSX.Element {
  return one(d)({ size })
}

export const User = one(ICONS['user'])
export const Cube = one(ICONS['cube'])
export const AppWindow = one(ICONS['app-window'])
export const Database = one(ICONS['database'])
export const Table = one(ICONS['table'])
export const Clock = one(ICONS['clock'])
export const Puzzle = one(ICONS['puzzle'])
export const Cloud = one(ICONS['cloud'])
export const ZoomIn = icon(<><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M7 10l6 0" /><path d="M10 7l0 6" /><path d="M21 21l-6 -6" /></>)

// The controls and the panel's headings. The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs).
export const Home = one('M5 12l-2 0l9 -9l9 9l-2 0M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6')
export const ChevronRight = one('M9 6l6 6l-6 6')
export const ChevronDown = one('M6 9l6 6l6 -6')
export const ArrowRight = one('M5 12l14 0M15 16l4 -4M15 8l4 4')
export const ArrowLeft = one('M5 12l14 0M5 12l4 4M5 12l4 -4')
export const ArrowUp = one('M12 5l0 14M18 11l-6 -6M6 11l6 -6')
export const ArrowDown = one('M12 5l0 14M18 13l-6 6M6 13l6 6')
export const File = one('M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z')
export const Folder = one('M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2')
export const Tag = one('M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3z')
export const Code = one('M7 8l-4 4l4 4M17 8l4 4l-4 4M14 4l-4 16')
export const Text = one('M4 6l16 0M4 12l10 0M4 18l14 0')
export const Pencil = one('M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4')
export const Plus = one('M12 5l0 14M5 12l14 0')
export const Minus = one('M5 12l14 0')
export const Fit = one('M4 9v-3a2 2 0 0 1 2 -2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1 -2 2h-3M9 20h-3a2 2 0 0 1 -2 -2v-3')
export const Undo = one('M9 14l-4 -4l4 -4M5 10h11a4 4 0 1 1 0 8h-1')
export const Redo = one('M15 14l4 -4l-4 -4M19 10h-11a4 4 0 1 0 0 8h1')
export const Search = one('M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6')
export const Route = one('M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M18 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5')
export const Grid = one('M4 4h6v6h-6zM14 4h6v6h-6zM4 14h6v6h-6zM14 14h6v6h-6z')
export const Alert = one('M12 9v4M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0zM12 16h.01')
export const Trash = one('M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3')
export const Play = one('M7 4v16l13 -8z')
export const Pause = icon(<><path d="M6 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /><path d="M14 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /></>)
export const Reload = icon(<><path d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1.002 7.935 1.007 9.425 4.747" /><path d="M20 4v5h-5" /></>)
export const Keyboard = one('M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2zM6 10l0 .01M10 10l0 .01M14 10l0 .01M18 10l0 .01M6 14l0 .01M18 14l0 .01M10 14l4 .01')
export const Close = one('M18 6l-12 12M6 6l12 12')
export const Check = one('M5 12l5 5l10 -10')
export const Copy = one('M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667zM4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1')
// Our own, drawn for the rail: an i with no serifs in a rounded square, whose straight edges stay sharp at 18 pixels (a circle blurs)
export const Info = one('M5.5 3h13a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1 -2.5 2.5h-13a2.5 2.5 0 0 1 -2.5 -2.5v-13a2.5 2.5 0 0 1 2.5 -2.5zM12 7.5h.01M12 11.5v5')
export const Activity = one('M3 12h4l3 8l4 -16l3 8h4')
export const Bolt = one('M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11')
// Our own: a folder with what is in it hanging below
export const Explorer = one('M4 3h4l2 2h9a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-15a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM7 11v9.5h3M7 15.5h3M13 15.5h8M13 20.5h8')
// Tabler's file-code: the file icon of icons.ts with a pair of angle brackets on it
export const FileCode = one(`${ICONS.file}M10 13l-1 2l1 2M14 13l1 2l-1 2`)
export const Repeat = one('M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3')
export const GitFork = one('M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2M12 12l0 4')
export const ArrowsSplit = one('M21 17h-8l-3.5 -5h-6.5M21 7h-8l-3.495 5')
export const Help = one('M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 17l0 .01M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4')
export const Link = one('M9 15l6 -6M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463')
export const Columns = one('M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2zM12 4l0 16')
export const ArrowsLeftRight = one('M21 17l-18 0M6 10l-3 -3l3 -3M3 7l18 0M18 20l3 -3l-3 -3')

export const Sparkles = one(ICONS.sparkles)

export const TYPE_ICONS: Record<ObjectType, (props?: IconProps) => JSX.Element> = { actor: User, system: Cube, app: AppWindow, store: Database, component: Puzzle }

/** The icon of an object type. A type the checker doesn't know gets the system's. */
export const iconOf = (type: string, external = false) => (external ? Cloud : Object.hasOwn(TYPE_ICONS, type) ? TYPE_ICONS[type as ObjectType] : TYPE_ICONS.system)
