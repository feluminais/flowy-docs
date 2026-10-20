import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import type { Problem } from '../../src/core/check.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { flowGroups, outline, outlineKey } from '../../src/core/outline.ts'
import type { FlowRef, OutlineKey, OutlineRow } from '../../src/core/outline.ts'
import { nameOf } from '../../src/core/views.ts'
import { ObjectTile } from './Chrome.tsx'
import { Activity, Bolt, ChevronRight, Close, FileCode, Home, Info, Pencil, Play, Route, Search as SearchIcon, Explorer as ExplorerIcon } from './icons.tsx'
import { MAX_WIDTH, MIN_WIDTH } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { scrollToRow, visibleRows } from './window.ts'

const ROW = 30 // px: every row of the tree is this tall, which is what lets it be windowed

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function NavTabs({ tab, showFlows, showYaml, onPick }: { tab: NavTab; showFlows: boolean; showYaml: boolean; onPick: (tab: NavTab) => void }) {
  const tabs: [NavTab, string][] = [['explorer', 'Explorer'], ...(showFlows ? [['flows', 'Flows'] as [NavTab, string]] : []), ...(showYaml ? [['yaml', 'YAML'] as [NavTab, string]] : [])]
  return (
    <div className="navtabs" role="tablist" aria-label="Panel">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => onPick(id)}>{label}</button>)}
    </div>
  )
}

function RailButton({ label, hint, Icon, pressed, count, onClick }: { label: string; hint?: string; Icon: typeof Info; pressed: boolean; count?: number; onClick: () => void }) {
  return (
    <button aria-pressed={pressed} aria-label={count === undefined ? label : `${label}, ${count}`} title={hint ? `${label} (${hint})` : label} onClick={onClick}>
      <Icon size={18} />
      {count !== undefined && <span className="count" aria-hidden="true">{count > 999 ? '999+' : count}</span>}
    </button>
  )
}

/** The slim column of icons on the left edge for the Flows list, the Explorer tree and the YAML. It is always there, and the counts on it say how much the documentation holds. */
export function NavRail({ tab, flows, shapes, showFlows, showYaml, onPick }: { tab: NavTab | undefined; flows: number; shapes: number; showFlows: boolean; showYaml: boolean; onPick: (tab: NavTab) => void }) {
  return (
    <nav className="rail left" aria-label="Navigator">
      <RailButton label="Explorer" hint="O" Icon={ExplorerIcon} count={shapes} pressed={tab === 'explorer'} onClick={() => onPick('explorer')} />
      {showFlows && <RailButton label="Flows" hint="L" Icon={Route} count={flows} pressed={tab === 'flows'} onClick={() => onPick('flows')} />}
      {showYaml && <RailButton label="YAML" hint="Y" Icon={FileCode} pressed={tab === 'yaml'} onClick={() => onPick('yaml')} />}
    </nav>
  )
}

/** The slim column on the right edge: a button for the Details panel, and below it one for Performance where there is a load-test run to show (it takes Details' place). */
export function DetailsRail({ open, onToggle, perf, failures }: {
  open: boolean; onToggle: () => void; perf?: { open: boolean; runs: number; onToggle: () => void }; failures?: { open: boolean; count: number; onToggle: () => void }
}) {
  const label = ['Details', perf && 'performance', failures && 'failures'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1')
  return (
    <nav className="rail" aria-label={label}>
      <RailButton label="Details" Icon={Info} pressed={open} onClick={onToggle} />
      {perf && <RailButton label="Performance" hint="T" Icon={Activity} count={perf.runs} pressed={perf.open} onClick={perf.onToggle} />}
      {failures && <RailButton label="Failures" hint="M" Icon={Bolt} count={failures.count} pressed={failures.open} onClick={failures.onToggle} />}
    </nav>
  )
}

/**
 * The edge of a side panel you drag to resize it, as in VS Code: it lights up under the pointer, a double-click puts the width back, and the
 * arrow keys nudge it. `side` is the panel it belongs to: the navigator grows as its edge goes right, Details as its edge goes left.
 */
export function Sash({ side, width, onResize, onReset }: { side: 'nav' | 'details'; width: number; onResize: (width: number) => void; onReset: () => void }) {
  const drag = useRef<{ x: number; width: number }>(undefined)
  const sign = side === 'nav' ? 1 : -1
  const label = side === 'nav' ? 'Resize the navigator' : 'Resize the details panel'
  return (
    <div className={`sash ${side}`} role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} tabIndex={0}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId) // the drag goes on over the canvas, and nothing there sees it
        drag.current = { x: e.clientX, width }
        e.preventDefault()
      }}
      onPointerMove={e => drag.current && onResize(drag.current.width + sign * (e.clientX - drag.current.x))}
      onPointerUp={() => { drag.current = undefined }}
      onPointerCancel={() => { drag.current = undefined }}
      onDoubleClick={onReset}
      onKeyDown={e => {
        const step = e.key === 'ArrowRight' ? 16 : e.key === 'ArrowLeft' ? -16 : 0
        if (step === 0) return
        onResize(width + sign * step)
        e.preventDefault()
        e.stopPropagation() // the arrows of a flow playing are not meant for the sash
      }} />
  )
}

/** The panel of the Flows and Explorer tabs, on the left. It has no scrolling of its own: each tab scrolls what it holds. */
export function NavPanel({ tabs, onClose, children }: { tabs: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="panel navpanel">
      {tabs}
      <button className="close" aria-label="Close" onClick={onClose}><Close size={16} /></button>
      <div className="navbody">{children}</div>
    </aside>
  )
}

function SearchField({ value, label, onChange, inputRef, onKeyDown }: {
  value: string; label: string; onChange: (value: string) => void; inputRef?: Ref<HTMLInputElement>; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="navfind">
      <SearchIcon size={15} />
      <input ref={inputRef} value={value} placeholder={label} aria-label={label} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} />
    </label>
  )
}

/**
 * Every flow in the documentation: first those that play in the level you are in, then all the others under the level they play in.
 * Picking one goes to its level and plays it (or, while editing, opens it for editing).
 */
export function FlowsTab({ model, view, editing, current, onOpen }: { model: Model; view: string; editing: boolean; current?: string; onOpen: (flow: FlowRef) => void }) {
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const groups = useMemo(() => flowGroups(model, view, { editing }), [model, view, editing])
  const needle = query.trim().toLowerCase()
  const keep = (f: FlowRef) => needle === '' || f.name.toLowerCase().includes(needle) || f.id.includes(needle)
  const here = groups.here.filter(keep)
  const elsewhere = groups.elsewhere.map(g => ({ ...g, flows: g.flows.filter(keep) })).filter(g => g.flows.length > 0)
  const row = (f: FlowRef) => (
    <button key={f.id} className="flow-row" aria-current={f.id === current} onClick={() => onOpen(f)}>
      {editing ? <Pencil size={15} /> : <Play size={15} />}
      <span className="name">{f.name}</span>
      <span className="muted">{f.steps === 0 ? 'no steps yet' : plural(f.steps, 'step')}</span>
    </button>
  )
  const otherCount = groups.total - groups.here.length
  return (
    <>
      <SearchField value={query} label="Find a flow" onChange={setQuery}
        onKeyDown={e => {
          if (e.key === 'Escape' && query !== '') {
            setQuery('')
            e.stopPropagation()
          }
        }} />
      <div className="navscroll">
        <h3 className="navhead"><span>This view</span><span className="muted">{groups.here.length}</span></h3>
        {here.length > 0 && here.map(row)}
        {groups.here.length === 0 && groups.total > 0 && <p className="muted navnote">No flows on this view.</p>}
        {groups.here.length > 0 && here.length === 0 && <p className="muted navnote">No matches.</p>}
        {groups.elsewhere.length > 0 && <h3 className="navhead"><span>Other views</span><span className="muted">{otherCount}</span></h3>}
        {elsewhere.map(g => {
          const open = needle !== '' || !closed.has(g.view)
          return (
            <div key={g.view} className="flow-group">
              <button className="group-head" aria-expanded={open} onClick={() => setClosed(c => { const next = new Set(c); if (next.has(g.view)) next.delete(g.view); else next.add(g.view); return next })}>
                <ChevronRight size={14} />
                <span className="name">{g.path.length > 0 ? g.path.join(' › ') : g.name}</span>
                <span className="muted">{g.flows.length}</span>
              </button>
              {open && g.flows.map(row)}
            </div>
          )
        })}
        {needle !== '' && here.length === 0 && elsewhere.length === 0 && <p className="muted navnote">No flow matches “{query.trim()}”.</p>}
        {groups.total === 0 && <p className="muted navnote">No flows yet. New flow in the bar starts one.</p>}
      </div>
    </>
  )
}

const KEYS: Partial<Record<string, OutlineKey>> = {
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Home: 'Home', End: 'End', Enter: 'Enter',
}

type ExplorerProps = {
  model: Model
  problems: readonly Problem[]
  editing: boolean
  expanded: ReadonlySet<string>
  onToggle: (id: string, expand: boolean) => void
  /** The level the canvas shows, the shape selected on it, and the flow playing: what the tree marks. */
  here: string
  selected?: string
  playing?: string
  /** A click on a row, and Enter or a double-click on one. */
  onPick: (row: OutlineRow) => void
  onOpen: (row: OutlineRow) => void
}

/**
 * The whole documentation as a tree: a summary line, a filter, and the rows (see core/outline.ts), drawn a window at a time so a model of
 * thousands of shapes stays smooth. It keeps the row you are on in view as you zoom on the canvas, but not while you are using the tree.
 */
export function Explorer({ model, problems, editing, expanded, onToggle, here, selected, playing, onPick, onOpen }: ExplorerProps) {
  const [filter, setFilter] = useState('')
  const [focus, setFocus] = useState<string>()
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const list = useRef<HTMLDivElement>(null)
  const find = useRef<HTMLInputElement>(null)
  const using = useRef(false) // the pointer is over the tree, or a key was just pressed in it
  const { rows, totals } = useMemo(() => outline(model, { expanded, filter, editing, problems }), [model, expanded, filter, editing, problems])
  const current = playing ? `flow:${playing}` : `shape:${selected ?? here}`

  useEffect(() => {
    const el = list.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const reveal = (key: string | undefined) => {
    const at = rows.findIndex(r => r.key === key)
    const el = list.current
    const to = el && at !== -1 ? scrollToRow(at, el.scrollTop, el.clientHeight, ROW) : undefined
    if (el && to !== undefined) el.scrollTop = to
  }
  useEffect(() => {
    if (!using.current && filter === '') reveal(current)
  }, [current, rows])
  useEffect(() => reveal(focus), [focus])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const key = KEYS[e.key]
    if (key) {
      using.current = true
      const result = outlineKey(rows, focus, key)
      if (result.focus !== undefined) setFocus(result.focus)
      if (result.toggle) onToggle(result.toggle.id, result.toggle.expand)
      if (result.open) onOpen(result.open)
      e.preventDefault()
      e.stopPropagation() // the canvas's own keys (E, Enter, the arrows of a flow) are not meant for the tree
    } else if (e.key.length === 1 && e.key !== ' ') {
      find.current?.focus() // the letter then lands in the filter
      e.stopPropagation()
    }
  }

  const { start, end } = visibleRows(scrollTop, height, rows.length, ROW)
  const counts = (r: OutlineRow) => (r.kind === 'flow' ? plural(r.steps ?? 0, 'step') : [r.shapes > 0 && String(r.shapes), r.flows > 0 && plural(r.flows, 'flow')].filter(Boolean).join(' · '))
  const icon = (r: OutlineRow) => (r.id === ROOT && r.kind === 'shape' ? <Home size={16} /> : r.kind === 'flow' ? <Route size={16} /> : <ObjectTile model={model} object={model.objects[r.id]} size={18} />)

  return (
    <>
      <p className="navsum">
        {plural(totals.shapes, 'shape')} · {plural(totals.flows, 'flow')}
        {totals.problems > 0 && <span className="bad"> · {plural(totals.problems, 'problem')}</span>}
      </p>
      <SearchField value={filter} label="Filter the tree" onChange={setFilter} inputRef={find}
        onKeyDown={e => {
          if (e.key === 'Escape' && filter !== '') {
            setFilter('')
            e.stopPropagation()
          } else if (e.key === 'ArrowDown' && rows.length > 0) {
            setFocus(rows[0].key)
            list.current?.focus()
            e.preventDefault()
          }
        }} />
      <div ref={list} className="tree" role="tree" aria-label="Documentation" tabIndex={0} onKeyDown={onKeyDown}
        aria-activedescendant={focus ? `nav-${focus}` : undefined}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
        onPointerEnter={() => { using.current = true }} onPointerLeave={() => { using.current = false }}
        onBlur={() => { using.current = false }}>
        {rows.length === 0 && <p className="muted navnote">{filter.trim() === '' ? 'Nothing here yet.' : `Nothing matches “${filter.trim()}”.`}</p>}
        <div className="tree-rows" style={{ height: rows.length * ROW }}>
          {rows.slice(start, end).map((r, k) => (
            <div key={r.key} id={`nav-${r.key}`} role="treeitem" aria-level={r.depth + 1} aria-expanded={r.expandable ? r.expanded : undefined} aria-selected={r.key === current}
              className={classes('tree-row', r.key === current && 'sel', r.key === focus && 'focus', !r.match && 'dim')}
              style={{ top: (start + k) * ROW, paddingLeft: 6 + r.depth * 16 }}
              onClick={() => { setFocus(r.key); onPick(r) }} onDoubleClick={() => onOpen(r)}>
              {r.expandable
                ? <span className="twist" aria-hidden="true" onClick={e => { e.stopPropagation(); onToggle(r.id, !r.expanded) }}><ChevronRight size={14} /></span>
                : <span className="twist" aria-hidden="true" />}
              {icon(r)}
              <span className="name">{r.name}</span>
              {r.problem && <span className="dot" title="A problem in here" />}
              <span className="count">{counts(r)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
