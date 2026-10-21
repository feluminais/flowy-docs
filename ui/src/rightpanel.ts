/**
 * The panel on the right of the canvas: Details, Performance, or none. One value, so the two can never both be open.
 * The Failures tab is not here: it is a tab of the navigator on the left.
 */
export type Right = 'details' | 'perf' | undefined

export const openDetailsPanel = (): Right => 'details'
export const openPerfPanel = (): Right => 'perf'

/** Closing Details leaves Performance alone: a click that closes one panel never closes the other. */
export const closeDetailsPanel = (right: Right): Right => (right === 'details' ? undefined : right)
export const closePerfPanel = (right: Right): Right => (right === 'perf' ? undefined : right)

/** Whether Performance shows: it was asked for, and there is a run to show on a model that is not being edited. */
export const perfShows = (right: Right, perfAvailable: boolean): boolean => right === 'perf' && perfAvailable

/**
 * What shows. Performance needs a run and a model that is not being edited (`perfAvailable`); a picked shape or line (`sidePicked`, not several shapes)
 * opens Details by itself. Performance takes Details' place while it is open.
 */
export function rightPanel(right: Right, avail: { perfAvailable: boolean; sidePicked: boolean }): { perf: boolean; details: boolean; open: boolean } {
  const perf = perfShows(right, avail.perfAvailable)
  const details = (right === 'details' || avail.sidePicked) && !perf
  return { perf, details, open: perf || details }
}
