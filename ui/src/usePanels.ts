import { useEffect, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import { expandTo } from '../../src/core/outline.ts'
import { NAV, PANEL } from './graph.ts'
import { readHash } from './hash.ts'
import { openTab } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { keepNav, loadNav } from './navstore.ts'

/**
 * The two panels beside the canvas: the navigator on the left (its tab, its tree's open rows, its width) and the Details panel on the right (opened from its rail, or by a
 * `side`, which the caller adds in). What the reader left open is kept for the next visit (see navstore.ts).
 */
export function usePanels({ model, view, selectedBox }: { model: Model; view: string; selectedBox: string | undefined }) {
  // The left-hand panel's tab (the navigator: Explorer, Flows, Performance, Failures or YAML), and whether the right-hand Details panel was opened from its rail. Details shows
  // `side`, or the level you are in, so a `side` opens it too. The Performance and Failures panels are tabs of the navigator too, and an address that names one opens on it.
  const [remembered] = useState(loadNav)
  const [tab, setNavTab] = useState<NavTab | undefined>(() => {
    const named = readHash(location.hash)
    // A comparison waits behind the Performance and Failures tabs, so an address that names one opens without the tab that was left open.
    const left = named.compare !== undefined && (remembered.tab === 'performance' || remembered.tab === 'failures')
    return named.perf !== undefined ? 'performance' : named.failures !== undefined ? 'failures' : left ? undefined : remembered.tab
  })
  // Whether the navigator is where the reader last clicked or opened something: Escape closes it then, and leaves it alone once they work in
  // the diagram. A navigator that came back with the page has not been used.
  const navUsed = useRef(false)
  const setTab = (t: NavTab | undefined) => {
    navUsed.current = t !== undefined
    setNavTab(t)
  }
  const [details, setDetails] = useState(false)
  const [navWidth, setNavWidth] = useState(remembered.navWidth ?? NAV) // dragged by the sashes on the panels' edges
  const [detailsWidth, setDetailsWidth] = useState(remembered.detailsWidth ?? PANEL)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT, ...remembered.expanded])) // the project's own row starts open
  const nav = openTab(tab, {})

  // The tree follows the canvas: going into a level opens it, and a selected shape is brought into view. It only ever opens rows.
  const reveal = (id: string, self: boolean) =>
    setExpanded(e => {
      const next = expandTo(model, id, e, self)
      return next.size === e.size ? e : next
    })
  useEffect(() => reveal(view, true), [view])
  useEffect(() => {
    if (selectedBox !== undefined) reveal(selectedBox, false)
  }, [selectedBox])
  // Written a moment after the last change, not on every pixel of a dragged edge (it is the whole tree's open rows each time), and at once when the page is left.
  useEffect(() => {
    const write = () => keepNav({ tab, expanded: [...expanded], navWidth, detailsWidth })
    const timer = setTimeout(write, 200)
    window.addEventListener('pagehide', write)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', write)
    }
  }, [tab, expanded, navWidth, detailsWidth])

  // Where the last click landed: in the navigator, Escape closes it; anywhere else (the diagram, Details, the bar), it leaves the navigator be.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      navUsed.current = e.target instanceof Element && e.target.closest('.navpanel') !== null
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  /** Closes a tab of the navigator, if it is the one showing. */
  const leave = (t: NavTab) => setNavTab(now => (now === t ? undefined : now))
  // The Performance and Failures panels are tabs of the same panel on the left, so the traffic and the risk marks never draw over each other.
  const openPerf = () => setTab('performance')
  const openFailures = () => setTab('failures')
  const toggleTab = (t: NavTab) => {
    if (nav === t) setTab(undefined)
    else if (t === 'performance') openPerf()
    else if (t === 'failures') openFailures()
    else setTab(t)
  }
  const closeFailures = () => leave('failures')
  const closePerf = () => leave('performance')
  const toggleOpen = (id: string, expand: boolean) =>
    setExpanded(e => {
      const next = new Set(e)
      if (expand) next.add(id)
      else next.delete(id)
      return next
    })

  return { nav, setTab, navUsed, leave, openPerf, openFailures, toggleTab, closeFailures, closePerf, details, setDetails, navWidth, setNavWidth, detailsWidth, setDetailsWidth, expanded, toggleOpen }
}
