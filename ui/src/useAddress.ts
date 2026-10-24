import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Flow, Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { drawnIn, homeView } from '../../src/core/failures.ts'
import { fromAddress, pairKey } from './compare.ts'
import type { Compare } from './compare.ts'
import { modeIn } from './failuresview.ts'
import { addressChange, readHash, runAddress, toHash } from './hash.ts'
import { saveState } from './host.ts'
import type { NavTab } from './navstate.ts'
import type { Side } from './side.ts'
import { followBack } from './trail.ts'
import type { Play } from './usePlayer.ts'
import type { usePerfRun } from './usePerfRun.ts'

/**
 * The address names the view, the flow playing, the tab of the Performance or Failures panel and the comparison, so a link opens there and Back goes back (see hash.ts).
 * It's checked on every render. A step the reader takes pushes an entry. Anything else replaces the address: the page opening (which also drops a part that named nothing), Back or a
 * typed address, E, or a live reload that falls back to another view. `quiet` makes the next write a replace (E isn't a step to go back to).
 */
export function useAddress({ model, runs, view, viewId, flow, playing, setPlaying, perfRun, perfOpen, failuresOpen, analysisKey, mode, modeId, setAnalysisId, setModeId, compare, setCompare, comparing, dirtyRef, setNotice, setSide, goNow, go, openPerf, openFailures, leave }: {
  model: Model; runs: Record<string, Run>; view: string; viewId: string; flow: Flow | undefined; playing: Play | undefined; setPlaying: Dispatch<SetStateAction<Play | undefined>>
  perfRun: ReturnType<typeof usePerfRun>; perfOpen: boolean; failuresOpen: boolean; analysisKey: string | undefined; mode: unknown; modeId: string | undefined
  setAnalysisId: (id: string) => void; setModeId: (id: string | undefined) => void; compare: Compare | undefined; setCompare: (compare: Compare | undefined) => void; comparing: Compare | undefined
  dirtyRef: { readonly current: boolean }; setNotice: (notice: string | undefined) => void; setSide: (side: Side | undefined) => void
  goNow: (id: string) => void; go: (id: string) => void; openPerf: () => void; openFailures: () => void; leave: (t: NavTab) => void
}) {
  const { runKey, here, multi, ramping, startPositions } = perfRun
  const quiet = useRef(true) // the next address write replaces instead of pushing (see the address effect)
  const failuresAt = failuresOpen && analysisKey !== undefined ? { analysis: analysisKey, ...(mode ? { mode: modeId } : {}) } : undefined
  const perfAt = perfOpen ? runAddress(runKey, here, multi, ramping) : undefined
  const address = toHash(view, flow ? playing?.flow : undefined, perfAt, failuresAt, comparing)
  useEffect(() => {
    const change = addressChange({ quiet: quiet.current, address, current: location.hash, view, viewId, perfOpen, runKey, failuresAt, compareAt: comparing })
    if (change) history[change === 'replace' ? 'replaceState' : 'pushState'](null, '', address || location.pathname + location.search)
    quiet.current = false
    saveState({ hash: address }) // a VS Code panel that is restored opens where the reader was
  })

  // Back, Forward, or an address typed in: show what it names. Added again on every render, like the keys.
  useEffect(() => {
    const follow = () => {
      quiet.current = true
      const named = readHash(location.hash)
      // The browser has already moved on, and a Back or a typed address can't be held back, so unlike every other way out this one can't ask. The note stays where it is, keyed by its
      // pair, and the reader is told it is there. (Taking the address back and asking would need to know which way the reader went, which the History API doesn't say.)
      const keeps = fromAddress(model, runs, named.compare).compare
      if (dirtyRef.current && !(keeps && compare && keeps.kind === compare.kind && pairKey(keeps.a, keeps.b) === pairKey(compare.a, compare.b)))
        setNotice('The note is kept until you close this page. Compare the pair again to see it')
      goNow(named.view)
      if (named.flow !== undefined) {
        // Back arrives twice (popstate, then hashchange), and the second must not undo the first: a flow already playing stays where it is.
        if (playing?.flow === named.flow) setPlaying(playing)
        else {
          const back = followBack(playing?.trail ?? [], named.flow) // Back lands on the stop the reader left, when it is the flow they came from
          setPlaying({ flow: named.flow, step: back.step, ...(back.trail.length > 0 ? { trail: back.trail } : {}) })
        }
      }
      perfRun.stopRamp()
      if (named.perf !== undefined && Object.hasOwn(runs, named.perf.run)) {
        perfRun.pick(named.perf.run, startPositions(named.perf.run, named.perf.level, named.perf.levels))
        openPerf()
      } else leave('performance')
      if (named.failures !== undefined && Object.hasOwn(model.failures, named.failures.analysis)) {
        const m = modeIn(model, named.failures.analysis, named.failures.mode)
        setAnalysisId(named.failures.analysis)
        setModeId(m ? named.failures.mode : undefined)
        if (m) setSide(undefined) // a picked shape would narrow the list to what it carries, and the mode named here may not be in it
        openFailures()
        if (m && !drawnIn(model, named.view, m)) go(homeView(model, m)) // the mode's part is outside the view the address names
      } else leave('failures')
      const opened = fromAddress(model, runs, named.compare)
      setCompare(opened.compare)
      if (opened.notice !== undefined) setNotice(opened.notice)
    }
    window.addEventListener('popstate', follow)
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      window.removeEventListener('hashchange', follow)
    }
  })
  return { quiet }
}
