import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import type { HistoryStore } from './historystore.ts'
import { scrollToRow, visibleRows } from './window.ts'
import { blockOf, canRestore, defaultFile, fileOrder, firstMark, neighbour, restoreLabel, rowsFor, SOURCE_NAMES, timeLabel } from './yamlview.ts'

const ROW = 20 // px: every line is this tall, which is what lets the text be windowed

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined

/** What a file is called on its tab: the flows without their folder, unless that would read like the model or the layout. */
const tabName = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return path.startsWith('flows/') && name !== 'model.yaml' && name !== 'layout.yaml' ? name : path
}

export type YamlProps = {
  store: HistoryStore
  /** Edit mode is on. */
  editing: boolean
  /** A file can't be read: the page is read-only, and edit mode can't be turned on. */
  broken: boolean
  /** The id of the flow that is open, and of the shape that is selected, if any: they say which file to show first. */
  flow?: string
  selected?: string
  /** Puts a version back. Resolves to what went wrong, or undefined once it is done. */
  onRestore: (id: string, seen: Record<string, string | null>, label: string) => Promise<string | undefined>
  onClear: () => Promise<void>
}

/**
 * The YAML tab of the left-hand panel: the model's files as text with what the shown step changed marked in them, and below them the steps of
 * the history. Picking an older step shows its files and offers to put them back. The marks and the steps come from the store (historystore.ts).
 */
export function Yaml({ store, editing, broken, flow, selected, onRestore, onClear }: YamlProps) {
  const view = useSyncExternalStore(store.subscribe, store.get)
  const [chosen, setChosen] = useState<string>()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(300)
  const text = useRef<HTMLDivElement>(null)
  const steps = useRef<HTMLUListElement>(null)

  // The version shown, or the files as they are while there is no history to show. Marks are against the step before it, or against the files now.
  const shownFiles = view.shown?.files ?? view.now?.files
  const base = view.shown ? (view.compare ? view.now?.files : view.shown.previous?.files) : undefined
  const paths = useMemo(() => fileOrder([...new Set([...Object.keys(shownFiles ?? {}), ...Object.keys(base ?? {})])]), [shownFiles, base])
  const fallback = selected !== undefined && paths.includes('model.yaml') ? 'model.yaml' : defaultFile(paths, { flow })
  const file = chosen !== undefined && paths.includes(chosen) ? chosen : fallback
  useEffect(() => setChosen(undefined), [flow, selected]) // a new context shows its own file
  const rows = useMemo(() => rowsFor(file, shownFiles ?? {}, base), [file, shownFiles, base])
  const marked = rows.some(r => r.kind === 'add' || r.kind === 'remove')
  const changed = useMemo(
    () => (view.compare
      ? new Set(paths.filter(p => JSON.stringify(shownFiles?.[p]) !== JSON.stringify(base?.[p])))
      : new Set(view.shown?.step.changed ?? [])),
    [paths, shownFiles, base, view.compare, view.shown],
  )

  const model = shownFiles?.['model.yaml']
  const block = file === 'model.yaml' && selected !== undefined && model && 'text' in model ? blockOf(model.text, selected) : undefined
  const inBlock = (line: number | undefined) => block !== undefined && line !== undefined && line >= block.start && line <= block.end

  useEffect(() => {
    const el = text.current
    if (!el) return
    const watch = new ResizeObserver(() => setHeight(el.clientHeight))
    setHeight(el.clientHeight)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  // A new version, file or shape brings its first mark into view, else the shape's block, else the top.
  useEffect(() => {
    const el = text.current
    if (!el) return
    const mark = firstMark(rows)
    const target = mark ?? (block ? rows.findIndex(r => r.line === block.start) : -1)
    el.scrollTop = target < 0 ? 0 : Math.max(0, target * ROW - el.clientHeight / 3)
  }, [file, view.shownId, view.compare, selected])
  useEffect(() => {
    const el = steps.current
    const at = view.steps.findIndex(s => s.id === view.shownId)
    const to = el && at >= 0 ? scrollToRow(at, el.scrollTop, el.clientHeight, 30) : undefined
    if (el && to !== undefined) el.scrollTop = to
  }, [view.shownId])

  const today = new Date()
  const newest = view.steps[0]?.id
  const pickStep = (id: string | undefined) => void store.pick(id === newest ? undefined : id) // the newest is not a choice: the tab follows it
  const onStepKeys = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const next = neighbour(view.steps, view.shownId, e.key === 'ArrowUp' ? -1 : 1)
    if (next !== undefined) pickStep(next)
    e.preventDefault()
    e.stopPropagation() // the arrows of a flow playing are not meant for the list
  }

  const restore = async () => {
    const shown = view.shown
    if (!shown || !view.now || busy) return
    setBusy(true)
    const message = await onRestore(shown.step.id, view.now.versions, restoreLabel(shown.step.time, new Date()))
    setBusy(false)
    if (message === undefined) await store.pick(undefined)
  }
  const allowed = canRestore({ editing, broken })

  const { start, end } = visibleRows(scrollTop, height, rows.length, ROW)
  const widest = rows.reduce((n, r) => Math.max(n, r.text.length), 0)

  return (
    <>
      <div className="yfiles" role="tablist" aria-label="Files">
        {paths.map(p => (
          <button key={p} role="tab" aria-selected={p === file} aria-label={changed.has(p) ? `${p}, changed` : p} title={p} onClick={() => setChosen(p)}>
            {tabName(p)}{changed.has(p) && <i className="ydot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {view.picked !== undefined && view.shown && (
        <div className="ybanner" role="status">
          <span className="ywhen"><b>{timeLabel(view.shown.step.time, today)}</b> · {view.shown.step.label}</span>
          <label className="ycompare"><input type="checkbox" checked={view.compare} onChange={e => store.setCompare(e.target.checked)} />Compare with now</label>
          <span className="yactions">
            <button className="primary" disabled={!allowed || busy} onClick={() => void restore()}>Restore</button>
            {!allowed && <span className="hint"><kbd>E</kbd> Edit to restore</span>}
            <button onClick={() => pickStep(undefined)}>Back to now</button>
          </span>
        </div>
      )}
      <div ref={text} className="ytext" role="region" aria-label={file} tabIndex={0} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="yrows" style={{ height: rows.length * ROW, minWidth: `calc(${widest}ch + 68px)` }}>
          {rows.slice(start, end).map((r, k) => (
            <div key={start + k} className={classes('yrow', r.kind, inBlock(r.line) && 'block')} style={{ top: (start + k) * ROW }}
              title={r.kind === 'add' ? 'Added' : r.kind === 'remove' ? 'Removed' : undefined}>
              <span className="ynum" aria-hidden="true">{r.line ?? ''}</span>
              <span className="ymark" aria-hidden="true">{r.kind === 'add' ? '+' : r.kind === 'remove' ? '−' : ''}</span>
              <span className="ycode">{r.text}</span>
            </div>
          ))}
        </div>
      </div>
      {marked && (
        <ul className="keyrow ykey" aria-label="Key">
          <li><i className="sw yadd" aria-hidden="true" />Added</li>
          <li><i className="sw yremove" aria-hidden="true" />Removed</li>
        </ul>
      )}
      {!view.saving && (
        <p className="ynote ywarn">History isn't being saved{view.reason && <><br /><span className="muted">{view.reason}</span></>}</p>
      )}
      {view.error && <p className="muted ynote">{view.error}</p>}
      {view.ready && view.steps.length === 0 && view.saving && <p className="muted ynote">No changes yet</p>}
      <ul ref={steps} className="ysteps" role="listbox" aria-label="History" tabIndex={0} onKeyDown={onStepKeys}>
        {view.steps.map(s => (
          <li key={s.id} role="option" aria-selected={s.id === view.shownId} className={classes('ystep', s.id === view.shownId && 'sel')} onClick={() => pickStep(s.id)}>
            {SOURCE_NAMES[s.source] && <span className={`ychip ${s.source}`}>{SOURCE_NAMES[s.source]}</span>}
            <span className="ylabel" title={s.label}>{s.label}</span>
            <span className="ytime">{timeLabel(s.time, today)}</span>
          </li>
        ))}
      </ul>
      {view.steps.length > 0 && (
        <div className="yclear">
          {asking
            ? <><span>Clear history?</span><button className="danger" onClick={() => void onClear().then(() => setAsking(false))}>Clear</button><button onClick={() => setAsking(false)}>Keep</button></>
            : <button onClick={() => setAsking(true)}>Clear history</button>}
        </div>
      )}
    </>
  )
}
