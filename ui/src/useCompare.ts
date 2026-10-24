import { useEffect, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { draftKey, fromAddress, keepsDrafts, noteOf, openable, playable, unsaved, withDraft } from './compare.ts'
import type { Compare, Drafts } from './compare.ts'
import type { CompareHandle } from './CompareView.tsx'
import { readHash } from './hash.ts'

/**
 * The comparison of two flows or two runs side by side (see CompareView), named by the address: whether one is open, the stop the flow that was playing was at when it opened, and the
 * note on the pair. While one is open the single canvas and its flow player wait behind it, as they do behind the Performance and Failures tabs (`comparing` is undefined then).
 * The popovers that open it, and the buttons that do, are in useCompareActions.
 */
export function useCompare({ model, runs, editing, perfOpen, failuresOpen, setNotice }: {
  model: Model; runs: Record<string, Run>; editing: boolean; perfOpen: boolean; failuresOpen: boolean; setNotice: (notice: string | undefined) => void
}) {
  /** Whether both sides of a comparison are there to open: flows that play, or runs. */
  const comparable = (c: Compare) => (c.kind === 'run' ? openable(runs, c.a) && openable(runs, c.b) : playable(model, c.a) && playable(model, c.b))
  const [compare, setCompare] = useState<Compare | undefined>(() => fromAddress(model, runs, readHash(location.hash).compare).compare)
  // The stop the flow that was playing was at when the comparison opened: its pane starts there.
  const [compareStart, setCompareStart] = useState<{ flow: string; step: number }>()
  const compareRef = useRef<CompareHandle>(null)
  // The note on the pair: what is typed in its editor is kept here, not in the strip, so it survives the strip going away (the Performance tab opening over the panes) and so leaving can ask
  // first. Each pair keeps its own (a Map by pair); another pair starts with none, and typing on one never replaces another's. A pair with no tag has no file to hold it, so there it is a draft.
  // A pair's is only dropped by Discard or Cancel on that pair, by saving it, or by reloading the page: closing the comparison any other way (an address, a live reload that takes a flow
  // away) keeps it, and it is back when the pair is compared again. `saved` in a draft is the note the pair held when it was last typed in, to tell a draft that differs from it.
  const [drafts, setDrafts] = useState<Drafts>(new Map())
  const pair = compare && draftKey(compare.kind, compare.a, compare.b)
  const draft = pair === undefined ? undefined : drafts.get(pair)?.text
  const savedNote = compare ? noteOf(compare.kind === 'flow' ? model.flows : runs, compare.a, compare.b).text : ''
  const dirty = compare !== undefined && unsaved(draft, savedNote) // the pair on show is the one a close would lose a note on
  const keeping = keepsDrafts(drafts) // a note typed and not saved, on any pair: closing the page loses it
  const dirtyRef = useRef(false) // read by handlers an earlier render made, which are the ones a prompt holds on to
  dirtyRef.current = dirty
  const [asking, setAsking] = useState<{ leave: () => void }>() // what to do once the reader says to discard the note
  const comparing = compare && !editing && !perfOpen && !failuresOpen && comparable(compare) ? compare : undefined
  const flowsCompared = comparing?.kind === 'flow' // two flows stay on their own views; two runs share the level the address names, and going to another one moves both panes

  useEffect(() => {
    if (!compare) setCompareStart(undefined)
  }, [compare])
  useEffect(() => {
    if (!dirty) setAsking(undefined)
  }, [dirty])
  // Closing the tab or reloading with a note that isn't saved: the browser asks (it words the question itself).
  useEffect(() => {
    if (!keeping) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [keeping])
  useEffect(() => {
    const notice = fromAddress(model, runs, readHash(location.hash).compare).notice
    if (notice !== undefined) setNotice(notice) // a link to a comparison that can't open
  }, [])
  useEffect(() => {
    if (compare && !comparable(compare)) setCompare(undefined) // a live reload took one of the flows or runs away
  }, [model, runs, compare])

  /** Runs `leave`, but a note that isn't saved asks first. True when it asked instead: `leave` then waits for Discard, and a caller must stop. */
  const unlessDraft = (leave: () => void): boolean => {
    if (!dirtyRef.current) return false
    setAsking({ leave })
    return true
  }
  const discardNote = () => {
    const leave = asking?.leave
    dirtyRef.current = false
    if (pair !== undefined) setDrafts(d => withDraft(d, pair, undefined, '')) // the pair being left; the others keep theirs
    setAsking(undefined)
    leave?.()
  }
  const onDraft = (text: string | undefined) => {
    if (pair !== undefined) setDrafts(d => withDraft(d, pair, text, savedNote))
  }
  return { compare, setCompare, compareStart, setCompareStart, compareRef, draft, onDraft, dirtyRef, asking, setAsking, comparing, flowsCompared, unlessDraft, discardNote }
}
