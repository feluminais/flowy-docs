import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode, Ref } from 'react'
import type { Problem } from '../../src/core/problem.ts'
import { folderOf, ROOT, tagKey } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { comparedWith, flowList, outline, outlineKey, rowCount, rowCountWords } from '../../src/core/outline.ts'
import type { FlowRef, FlowRow, FlowTag, OutlineKey, OutlineRow } from '../../src/core/outline.ts'
import { nameOf } from '../../src/core/views.ts'
import { ObjectTile } from './Chrome.tsx'
import type { PickAt } from './ComparePicker.tsx'
import { Activity, Alert, ChevronRight, Close, Columns, FileCode, Folder, Home, Info, Link, Pencil, Play, Route, Workflow, Search as SearchIcon, Tag, Explorer as ExplorerIcon } from './icons.tsx'
import { keyOf } from './keymap.ts'
import { KeyItem, KeyRow } from './legend.tsx'
import { MAX_WIDTH, MIN_WIDTH } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { scrollToRow, visibleRows } from './window.ts'

const ROW = 30 // px: every row of the tree is this tall, which is what lets it be windowed

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function NavTabs({ tab, onPick }: { tab: NavTab; onPick: (tab: NavTab) => void }) {
  const tabs: [NavTab, string][] = [
    ['explorer', 'Explorer'],
    ['flows', 'Flows'],
    ['yaml', 'YAML'],
  ]
  return (
    <div className="navtabs" role="tablist" aria-label="Panel">
      {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => onPick(id)}>{label}</button>)}
    </div>
  )
}

/** The head of the Performance and Failures panels: one tab, set like the navigator's, with the rail on the left to move between panels. */
export function NavTitle({ title }: { title: string }) {
  return (
    <div className="navtabs" role="tablist" aria-label="Panel">
      <button role="tab" aria-selected="true">{title}</button>
    </div>
  )
}

function RailButton({ label, hint, Icon, pressed, count, off, onClick }: { label: string; hint?: string; Icon: typeof Info; pressed: boolean; count?: number; off?: string; onClick: () => void }) {
  return (
    <button aria-pressed={pressed} aria-label={count === undefined ? label : `${label}, ${count}`} title={off ? `${label} (${off})` : hint ? `${label} (${hint})` : label} disabled={off !== undefined} onClick={onClick}>
      <Icon size={18} />
      {count !== undefined && <span className="count" aria-hidden="true">{count > 999 ? '999+' : count}</span>}
    </button>
  )
}

/**
 * The slim column of icons on the left edge for the Explorer tree, the Flows list, the Performance panel, the Failures panel and the YAML. It is always there, and the counts
 * on it say how much the documentation holds. Flows, Performance, Failures and YAML are there whether or not there is a flow, a run, an analysis or a history: their panels offer to make one or say why there is none.
 * `perf.off` greys the Performance button out and says why in its tooltip: the tab stays where it is while the panel can't be used.
 */
export function NavRail({ tab, flows, shapes, perf, failures, onPick }: {
  tab: NavTab | undefined; flows: number; shapes: number
  perf: { runs: number; off?: string }; failures: { count: number }; onPick: (tab: NavTab) => void
}) {
  return (
    <nav className="rail left" aria-label="Panels">
      <RailButton label="Explorer" hint={keyOf('explorer')} Icon={ExplorerIcon} count={shapes} pressed={tab === 'explorer'} onClick={() => onPick('explorer')} />
      <RailButton label="Flows" hint={keyOf('flows')} Icon={Workflow} count={flows} pressed={tab === 'flows'} onClick={() => onPick('flows')} />
      <RailButton label="Performance" hint={keyOf('perf')} Icon={Activity} count={perf.runs > 0 ? perf.runs : undefined} pressed={tab === 'performance'} off={perf.off} onClick={() => onPick('performance')} />
      <RailButton label="Failures" hint={keyOf('failures')} Icon={Alert} count={failures.count > 0 ? failures.count : undefined} pressed={tab === 'failures'} onClick={() => onPick('failures')} />
      <RailButton label="YAML" hint={keyOf('yaml')} Icon={FileCode} pressed={tab === 'yaml'} onClick={() => onPick('yaml')} />
    </nav>
  )
}

/** The slim column on the right edge: a button for the Details panel, which is all the right-hand side holds. */
export function DetailsRail({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <nav className="rail" aria-label="Side panel">
      <RailButton label="Details" Icon={Info} pressed={open} onClick={onToggle} />
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

/** The panel of the tabs on the left (Explorer, Flows, Performance, Failures and YAML). It has no scrolling of its own: each tab scrolls what it holds. */
export function NavPanel({ tabs, onClose, children }: { tabs: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="panel navpanel" aria-label="Navigator">
      {tabs}
      <button className="close" aria-label="Close navigator" onClick={onClose}><Close size={16} /></button>
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

/** What the Compare button on a flow's row needs: why it is greyed out (if it is), the flow whose picker is open, and what a press does. The picker itself is drawn by the page. */
export type RowCompare = { off?: string; open?: string; onCompare: (flowId: string, at: PickAt) => void }

/** The attribute (with its value) that marks one flow's Compare button: the picker's `toggle`, so Esc gives the focus back to that button and a press on it is not "outside". */
export const compareRowAttr = (flowId: string) => `data-compare-row="${CSS.escape(flowId)}"`

/** Where the popover of the button goes: under the row, or above it when there is no room below, as wide as the navigator. */
function anchorOf(button: HTMLElement): PickAt {
  const panel = (button.closest('.navpanel') ?? button).getBoundingClientRect()
  const row = button.getBoundingClientRect()
  const place = { left: panel.left + 8, width: panel.width - 16 }
  return row.bottom + 340 > window.innerHeight ? { ...place, bottom: window.innerHeight - row.top + 6 } : { ...place, top: row.bottom + 6 }
}

/** The mark of a flow that is in a pair. Its name, in the tooltip and for a screen reader, says which flow it is compared with. */
function LinkedMark({ partners }: { partners: readonly string[] }) {
  const words = comparedWith(partners)
  return <span className="linked-mark" role="img" aria-label={words} title={words}><Link size={13} /></span>
}

/** The foot of a list that has a flow in a pair: the mark and its name. */
function LinkedKey() {
  return (
    <div className="navfoot">
      <KeyRow><KeyItem swatch={<span className="linked-mark"><Link size={13} /></span>}>Compare pair</KeyItem></KeyRow>
    </div>
  )
}

/**
 * The Compare button of a flow's row. It shows on hover and on focus within the row but is always there and can always be focused; when a mode blocks it
 * it is greyed out with the reason in its tooltip (aria-disabled, so the keyboard can still reach the reason). Its name is only "Compare": the row around it
 * (a group named for the flow in the Flows tab, the tree item in the Explorer) says which flow, so a screen reader does not read the flow's name twice.
 */
function RowCompareButton({ flow, compare }: { flow: string; compare: RowCompare }) {
  return (
    <button type="button" className="row-compare" data-compare-row={flow} aria-label="Compare"
      aria-disabled={compare.off !== undefined} aria-pressed={compare.open === flow} title={compare.off ?? 'Compare with another flow'}
      onClick={e => {
        e.stopPropagation() // a row of the tree also opens on a click
        if (compare.off === undefined) compare.onCompare(flow, anchorOf(e.currentTarget))
      }}>
      <Columns size={14} />
    </button>
  )
}

/**
 * The rows of the Flows list with each open folder's rows inside a group named for it, so a screen reader hears the nesting (a group in a group is a folder
 * in a folder) and not a flat run of buttons. The rows themselves are `list.rows`, in order, each with its depth; the groups only wrap them.
 */
function nested(rows: FlowRow[], flow: (f: FlowRef, depth: number) => ReactNode, head: (folder: Extract<FlowRow, { kind: 'folder' }>) => ReactNode): ReactNode[] {
  const build = (from: number, depth: number): [ReactNode[], number] => {
    const out: ReactNode[] = []
    let at = from
    while (at < rows.length && rows[at].depth >= depth) {
      const r = rows[at]
      if (r.kind === 'flow') {
        out.push(flow(r.flow, r.depth))
        at++
        continue
      }
      const [inside, next] = build(at + 1, r.depth + 1)
      out.push(head(r))
      if (r.open) out.push(<div key={`in-${r.key}`} role="group" aria-label={`${r.name} folder`}>{inside}</div>)
      at = next
    }
    return [out, at]
  }
  return build(0, 0)[0]
}

/** What a dragged flow's id is carried as. */
const FLOW_DRAG = 'application/x-flowy-flow'

/** How far each level of folders is moved in. */
const INDENT = 16
/** A row's own mark has this much room before it: the arrow of a folder, which a flow leaves empty so its mark lines up with its folder's. */
const TWIST = 22

/** A tag as a small word with the mark of a tag, beside a count when there is one. On a flow's row it only names; in the filter bar it is a button. */
function TagWord({ tag }: { tag: string }) {
  return <span className="tagword"><Tag size={11} />{tag}</span>
}

/**
 * The tags in use as buttons, each with how many flows have it. Pressing one keeps only the flows that have it, or any of those pressed; pressing it again lets them back.
 * It says nothing of tags that are not in use.
 */
function TagBar({ tags, picked, onToggle }: { tags: FlowTag[]; picked: readonly string[]; onToggle: (tag: string) => void }) {
  return (
    <div className="tagbar" role="group" aria-label="Tags">
      {tags.map(t => (
        <button key={tagKey(t.tag)} type="button" className="tagchip" aria-pressed={picked.includes(tagKey(t.tag))} onClick={() => onToggle(tagKey(t.tag))}>
          <Tag size={11} />{t.tag}<span className="muted">{t.count}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Every flow in the documentation as the folders it is filed in (the folders under flows/ in the repo), a folder first and then its flows by file name.
 * Picking a flow goes to the level it plays in and plays it (or, while editing, opens it for editing). The tags in use filter the list, and so does the search.
 * A flow in a pair has a link mark.
 */
export function FlowsTab({ model, editing, canEdit, current, compare, onOpen, onMove }: {
  model: Model; editing: boolean; canEdit: boolean; current?: string; compare: RowCompare; onOpen: (flow: FlowRef) => void
  /** Files a flow in a folder ("" is the top of flows/): what dropping a flow on a folder does. Left out when nothing can be edited, and then rows are not dragged. */
  onMove?: (flowId: string, folder: string) => void
}) {
  const [dragging, setDragging] = useState<string>()
  const [over, setOver] = useState<string>()
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<readonly string[]>([])
  const list = useMemo(() => flowList(model, { editing, query, tags: picked, closed }), [model, editing, query, picked, closed])
  // A tag that no flow has any more is no filter: its button is gone, so it could not be let go of.
  const alive = useMemo(() => picked.filter(p => list.tags.some(t => tagKey(t.tag) === p)), [picked, list.tags])
  useEffect(() => {
    if (alive.length !== picked.length) setPicked(alive)
  }, [alive, picked])
  const filtering = query.trim() !== '' || picked.length > 0
  const flows = list.rows.flatMap(r => (r.kind === 'flow' ? [r.flow] : []))
  const toggleFolder = (path: string) => setClosed(c => { const next = new Set(c); if (next.has(path)) next.delete(path); else next.add(path); return next })
  const toggleTag = (key: string) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]))
  // A flow dropped on a folder goes into it, and one dropped on another flow goes into that flow's folder; the top of flows/ is a row of its own while one is dragged.
  const drop = (folder: string) => dragging === undefined ? {} : {
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== folder) setOver(folder) },
    onDragLeave: () => setOver(o => (o === folder ? undefined : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const id = e.dataTransfer.getData(FLOW_DRAG) || dragging
      setDragging(undefined)
      setOver(undefined)
      if (folderOf(model, id) !== folder) onMove?.(id, folder)
    },
  }
  const marked = (folder: string) => classes(over === folder && dragging !== undefined && 'drop')
  const row = (f: FlowRef, depth: number) => (
    <div key={f.id} role="group" aria-label={f.name} className={classes('flow-item', marked(f.folder), dragging === f.id && 'dragged')} draggable={onMove !== undefined || undefined} {...drop(f.folder)}
      onDragStart={e => { e.dataTransfer.setData(FLOW_DRAG, f.id); e.dataTransfer.effectAllowed = 'move'; setDragging(f.id) }}
      onDragEnd={() => { setDragging(undefined); setOver(undefined) }}>
      <button className="flow-row" aria-current={f.id === current} style={{ paddingLeft: 6 + INDENT * depth + TWIST }} title={nameOf(model, f.view)} onClick={() => onOpen(f)}>
        {editing ? <Pencil size={15} /> : <Play size={15} />}
        <span className="name">{f.name}</span>
        {f.linked && <LinkedMark partners={f.partners} />}
        <span className="muted">{f.steps === 0 ? 'no steps yet' : plural(f.steps, 'step')}</span>
        {f.tags.length > 0 && <span className="flow-tags">{f.tags.map(t => <TagWord key={tagKey(t)} tag={t} />)}</span>}
      </button>
      <RowCompareButton flow={f.id} compare={compare} />
    </div>
  )
  return (
    <>
      <SearchField value={query} label="Find a flow" onChange={setQuery}
        onKeyDown={e => {
          if (e.key === 'Escape' && query !== '') {
            setQuery('')
            e.stopPropagation()
          }
        }} />
      {list.tags.length > 0 && <TagBar tags={list.tags} picked={alive} onToggle={toggleTag} />}
      <div className="navscroll">
        {dragging !== undefined && (
          <div className={classes('flow-top', marked(''))} {...drop('')}>
            <Folder size={15} />
            <span className="name">Top level</span>
          </div>
        )}
        {filtering && list.shown > 0 && <p className="muted navnote">{list.shown} of {plural(list.total, 'flow')}</p>}
        {nested(list.rows, row, folder => (
          <button key={folder.key} className={classes('group-head', 'folder', marked(folder.path))} aria-expanded={folder.open} style={{ paddingLeft: 6 + INDENT * folder.depth }} onClick={() => toggleFolder(folder.path)} {...drop(folder.path)}>
            <ChevronRight size={14} />
            <Folder size={15} />
            <span className="name">{folder.name}</span>
            <span className="muted">{folder.flows}</span>
          </button>
        ))}
        {filtering && list.total > 0 && list.shown === 0 && <p className="muted navnote">{query.trim() !== '' ? `No flow matches “${query.trim()}”.` : 'No flow has these tags.'}</p>}
        {list.total === 0 && (editing
          ? <p className="muted navnote">No flows yet. New flow in the bar starts one.</p>
          : <p className="muted navnote">No flows yet.{canEdit && " Edit to add one."}</p>)}
      </div>
      {flows.some(f => f.linked) && <LinkedKey />}
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
  /** The Compare button on a flow's row. */
  compare: RowCompare
}

/**
 * The whole documentation as a tree: a summary line, a filter, and the rows (see core/outline.ts), drawn a window at a time so a model of
 * thousands of shapes stays smooth. It keeps the row you are on in view as you zoom on the canvas, but not while you are using the tree.
 */
export function Explorer({ model, problems, editing, expanded, onToggle, here, selected, playing, onPick, onOpen, compare }: ExplorerProps) {
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
    if (e.target !== e.currentTarget && e.key === 'Enter') return // a Compare button on a row takes its own Enter
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
  const counts = (r: OutlineRow) => (r.kind === 'flow' ? plural(r.steps ?? 0, 'step') : rowCount(r))
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
        {rows.length === 0 && <p className="muted navnote">{filter.trim() === '' ? 'No shapes yet.' : `Nothing matches “${filter.trim()}”.`}</p>}
        <div className="tree-rows" style={{ height: rows.length * ROW }}>
          {rows.slice(start, end).map((r, k) => (
            <div key={r.key} id={`nav-${r.key}`} role="treeitem" aria-level={r.depth + 1} aria-expanded={r.expandable ? r.expanded : undefined} aria-selected={r.key === current}
              className={classes('tree-row', r.kind === 'flow' && 'flow', r.key === current && 'sel', r.key === focus && 'focus', !r.match && 'dim')}
              style={{ top: (start + k) * ROW, paddingLeft: 6 + r.depth * 16 }}
              onClick={() => { setFocus(r.key); onPick(r) }} onDoubleClick={() => onOpen(r)}>
              {r.expandable
                ? <span className="twist" aria-hidden="true" onClick={e => { e.stopPropagation(); onToggle(r.id, !r.expanded) }}><ChevronRight size={14} /></span>
                : <span className="twist" aria-hidden="true" />}
              {icon(r)}
              <span className="name">{r.name}</span>
              {r.linked && <LinkedMark partners={r.partners ?? []} />}
              {r.problem && <span className="dot" title="A problem in here" />}
              <span className="count" title={rowCountWords(r) || undefined}>
                <span aria-hidden="true">{counts(r)}</span>
                <span className="visually-hidden">{rowCountWords(r) || counts(r)}</span>
              </span>
              {r.kind === 'flow' && <RowCompareButton flow={r.id} compare={compare} />}
            </div>
          ))}
        </div>
      </div>
      {rows.some(r => r.linked) && <LinkedKey />}
    </>
  )
}
