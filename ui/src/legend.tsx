import type { CSSProperties, ReactNode } from 'react'

/** A row of marks, each drawn as it looks on the chart or the canvas with its name beside it: the way to say what a colour or a shape means. */
export function KeyRow({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return <ul className={className ? `keyrow ${className}` : 'keyrow'} style={style}>{children}</ul>
}

export function KeyItem({ swatch, children, style, title }: { swatch: ReactNode; children: ReactNode; style?: CSSProperties; title?: string }) {
  return <li style={style} title={title}><span className="swatch" aria-hidden="true">{swatch}</span>{children}</li>
}
