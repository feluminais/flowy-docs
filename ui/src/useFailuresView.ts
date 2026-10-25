import { useMemo, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import { bandOf, drawnIn, homeView, lightFor, rollUp } from '../../src/core/failures.ts'
import type { Band, Mark, Part, Reach } from '../../src/core/failures.ts'
import { readHash } from './hash.ts'
import { activeAnalysis, modeIn, rowsFor } from './failuresview.ts'
import type { Filter } from './failuresview.ts'

/**
 * The Failures panel, a tab on the left: which analysis, which mode is picked in it, what the list is narrowed to, and what the canvas draws for them (the badges, and for a
 * picked mode its part, what it affects, and the rest faded). `open` is whether the tab is showing; `part` is the shape or line picked, which narrows the list; `drawing` is a
 * panel (Add, a flow being recorded) that is drawn on the canvas, where a faded shape would hide what it makes.
 */
export function useFailuresView({ model, view, open, part, drawing, go }: { model: Model; view: string; open: boolean; part: Part | undefined; drawing: boolean; go: (id: string) => void }) {
  const [analysisId, setAnalysisId] = useState(() => readHash(location.hash).failures?.analysis ?? '')
  const [modeId, setModeId] = useState<string | undefined>(() => readHash(location.hash).failures?.mode)
  const [filter, setFilter] = useState<Filter>({})
  const analysisKey = activeAnalysis(model.failures, analysisId)
  const analysis = analysisKey === undefined ? undefined : model.failures[analysisKey]
  const mode = modeIn(model, analysisKey, modeId)
  // What the Failures tab draws: the badges (rolled up to what this view draws), and for a picked mode its part, what it affects, and the rest faded.
  const failMarks = useMemo(() => (open && analysis ? rollUp(model, analysis, view) : undefined), [open, model, analysis, view])
  const lineMarks = useMemo(() => new Map<string, Mark>(Object.entries(failMarks?.lines ?? {})), [failMarks])
  // What a picked mode lights, with its band: the part that fails and what it hurts are outlined in the colour of that band.
  const lit = useMemo((): (Reach & { band: Band }) | undefined => {
    const reach = open && mode && !drawing ? lightFor(model, view, mode) : undefined
    return reach && mode ? { ...reach, band: bandOf(mode) } : undefined
  }, [open, model, mode, view, drawing])
  const partKey = part === undefined ? '' : JSON.stringify(part)
  const rows = useMemo(
    () => (open && analysis ? rowsFor(model, analysis, view, { band: filter.band, part }) : { here: [], elsewhere: [] }),
    [open, model, analysis, view, filter.band, partKey], // `part` is `partKey` in words
  )
  const litClass = (id: string) => (lit === undefined ? undefined : lit.fails.includes(id) ? `fails band-${lit.band}` : lit.affects.includes(id) ? `affected band-${lit.band}` : 'dim')
  /** Pick a mode in the Failures list; when its part is outside this view, the canvas goes to the view that draws it. */
  const selectMode = (id: string | undefined) => {
    setModeId(id)
    const m = modeIn(model, analysisKey, id)
    if (m && !drawnIn(model, view, m)) go(homeView(model, m))
  }
  return { setAnalysisId, modeId, setModeId, filter, setFilter, analysisKey, analysis, mode, failMarks, lineMarks, lit, rows, litClass, selectMode }
}
