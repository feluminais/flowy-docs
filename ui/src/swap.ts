export type XY = { x: number; y: number }
export type GraphNode = { id: string; position: XY }

/** How long the boxes take to glide to the other flow's places, and the camera to fit it. */
export const SWAP_MS = 450

/** How long the lines take to fade out before the boxes move, and to fade in once they have settled (a line is drawn from where its boxes are, so it cannot follow a gliding box). */
export const FADE_MS = 150

/** The time a swap takes: none under reduced motion, where it cuts. */
export const swapDuration = (reduced: boolean): number => (reduced ? 0 : SWAP_MS)

/**
 * The time a swap of two runs takes. Both runs draw the same view, so the boxes stay where they are and only what the runs measured changes: the traffic fades from one run's to
 * the other's over this long, and the boxes' colours and the lines' thickness follow on their own transitions. None under reduced motion, where it cuts.
 */
export const crossfadeDuration = (reduced: boolean): number => (reduced ? 0 : FADE_MS * 2)

/**
 * What changes on the canvas when it swaps from one flow's diagram to the other's. Shapes are told apart by their object id, so a shape both diagrams draw `stay`s and glides
 * from where it was to where it goes; one only the new diagram draws is `entering`, one only the old one drew is `leaving`. `stay` and `entering` follow the order of `to`,
 * `leaving` that of `from`.
 */
export function planSwap(from: GraphNode[], to: GraphNode[]): { stay: { id: string; from: XY; to: XY }[]; entering: string[]; leaving: string[] } {
  const was = new Map(from.map(n => [n.id, n.position]))
  const now = new Set(to.map(n => n.id))
  const stay: { id: string; from: XY; to: XY }[] = []
  const entering: string[] = []
  for (const n of to) {
    const old = was.get(n.id)
    if (old) stay.push({ id: n.id, from: old, to: n.position })
    else entering.push(n.id)
  }
  return { stay, entering, leaving: from.filter(n => !now.has(n.id)).map(n => n.id) }
}
