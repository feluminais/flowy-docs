// Quiet controls: Lucide 1.17.0, ISC. Model icons: Tabler, MIT.
// The notices ship as LUCIDE-LICENSE.txt and TABLER-ICONS-LICENSE.txt next to the bundle.
import type { JSX, ReactNode } from 'react'
import { ICONS } from '../../src/core/icons.ts'
import type { ObjectType } from '../../src/core/model.ts'

/** An icon at `size` pixels (18 unless it says), in the colour of the text around it. */
export type IconProps = { size?: number }

const icon = (paths: ReactNode, strokeWidth = 2) => function Icon({ size = 18 }: IconProps = {}): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths}
    </svg>
  )
}
const one = (d: string, strokeWidth = 1.4) => icon(<path d={d} />, strokeWidth)

/** An icon drawn from SVG path data on the 24×24 grid: a built-in one (src/core/icons.ts) or one the model defines. */
export function PathIcon({ d, size = 18 }: IconProps & { d: string }): JSX.Element {
  return one(d, 2)({ size })
}

export const User = one(ICONS['user'], 2)
export const Cube = one(ICONS['cube'], 2)
export const AppWindow = one(ICONS['app-window'], 2)
export const Database = one(ICONS['database'], 2)
export const Table = one('M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12')
export const Clock = one(ICONS['clock'])
export const Puzzle = one(ICONS['puzzle'], 2)
export const Cloud = one(ICONS['cloud'], 2)
export const ZoomIn = icon(<><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M7 10l6 0" /><path d="M10 7l0 6" /><path d="M21 21l-6 -6" /></>)

// The controls and the panel's headings. The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs).
export const Workflow = one('M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM7 11v4a2 2 0 0 0 2 2h4M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z')
export const StepForward = one('M10.029 4.285A2 2 0 0 0 7 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432zM3 4v16')
export const StepBack = one('M13.971 4.285A2 2 0 0 1 17 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM21 20V4')
export const Home = one('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')
export const ChevronRight = one('M0 0m9 18 6-6-6-6')
export const ChevronDown = one('M0 0m6 9 6 6 6-6')
export const ArrowRight = one('M5 12h14M0 0m12 5 7 7-7 7')
export const ArrowLeft = one('M0 0m12 19-7-7 7-7M19 12H5')
export const ArrowUp = one('M0 0m5 12 7-7 7 7M12 19V5')
export const ArrowDown = one('M12 5v14M0 0m19 12-7 7-7-7')
export const File = one('M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5')
export const Folder = one('M0 0m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2')
export const Tag = one('M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0')
export const Code = one('M0 0m18 16 4-4-4-4M0 0m6 8-4 4 4 4M0 0m14.5 4-5 16')
export const Text = one('M21 5H3M15 12H3M17 19H3')
export const Pencil = one('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM0 0m15 5 4 4')
export const Plus = one('M5 12h14M12 5v14')
export const Minus = one('M5 12h14')
export const Fit = one('M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3')
export const Undo = one('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11')
export const Redo = one('M0 0m15 14 5-5-5-5M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13')
export const Search = one('M0 0m21 21-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0')
export const Route = one('M3 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0')
export const Grid = one('M4 4h6v6h-6zM14 4h6v6h-6zM4 14h6v6h-6zM14 14h6v6h-6z')
export const Alert = one('M0 0m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01')
export const Trash = one('M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')
export const Play = one('M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z')
export const Pause = one('M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1zM6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z')
export const Reload = one('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5')
export const Keyboard = one('M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z')
export const Close = one('M18 6 6 18M0 0m6 6 12 12')
export const Check = one('M20 6 9 17l-5-5')
export const Copy = one('M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')
export const Info = one('M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 16v-4M12 8h.01')
export const Activity = one('M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2')
export const Bolt = one('M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11')
export const Explorer = one('M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3')
export const FileCode = one('M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35M14 2v5a1 1 0 0 0 1 1h5M0 0m5 16-3 3 3 3M0 0m9 22 3-3-3-3')
export const Lock = one('M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM7 11V7a5 5 0 0 1 10 0v4')
export const Repeat = one('M0 0m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M0 0m7 22-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3')
export const GitFork = one('M9 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9M12 12v3')
export const ArrowsSplit = one('M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3M0 0m15 9 6-6')
export const Help = one('M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01')
export const Link = one('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')
// Compare: two panes side by side, and the arrows that put them on each other's side.
export const Columns = one('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM12 3v18')
export const ArrowsLeftRight = one('M0 0m8 3-4 4 4 4M4 7h16M0 0m16 21 4-4-4-4M20 17H4')

export const Sparkles = one(ICONS.sparkles)

export const TYPE_ICONS: Record<ObjectType, (props?: IconProps) => JSX.Element> = { actor: User, system: Cube, app: AppWindow, store: Database, component: Puzzle }

/** The icon of an object type. A type the checker doesn't know gets the system's. */
export const iconOf = (type: string, external = false) => (external ? Cloud : Object.hasOwn(TYPE_ICONS, type) ? TYPE_ICONS[type as ObjectType] : TYPE_ICONS.system)
