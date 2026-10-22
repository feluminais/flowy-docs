import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { needsDecision } from '../../src/core/dependents.ts'
import type { Action, Dependent, Target } from '../../src/core/dependents.ts'
import { getObject, ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { deleteWith } from '../../src/core/ops.ts'
import { isView, parentOf } from '../../src/core/views.ts'
import { Chip, ObjectTile } from './Chrome.tsx'
import { Panel } from './forms.tsx'
import type { SaveEdit } from './forms.tsx'
import { Alert, Close, Route, Trash } from './icons.tsx'
import { letter, takesEnter } from './keys.ts'
import { ACTION_LABELS, alongText, defaultChoice, doneText, planOf, removeAll, rerouteAll, resolutionsOf, rowText, settles, shapesLeft } from './usedby.ts'
import type { Choice, Choices, Plan } from './usedby.ts'

/** What an action points at, when it does: a shape that takes the place over, or a place to put it. */
const POINTS: Partial<Record<Action, 'shape' | 'place'>> = { reroute: 'shape', repoint: 'shape', changeView: 'place', changeScope: 'place', moveOut: 'place' }

const nameOf = (model: Model, id: string): string => (id === ROOT ? 'Top level' : getObject(model, id)?.name || id)

/** A list of shapes to pick one from, with a field to narrow it. `top` adds the top level as a choice. */
function ShapeChooser({ model, ids, top, onPick, onClose }: { model: Model; ids: string[]; top: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const [find, setFind] = useState('')
  const q = find.trim().toLowerCase()
  const shown = [...(top ? [ROOT] : []), ...ids].filter(id => q === '' || nameOf(model, id).toLowerCase().includes(q) || id.toLowerCase().includes(q))
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.stopPropagation()
      if (shown[0] !== undefined) onPick(shown[0])
    }
  }
  return (
    <div className="chooser">
      <input autoFocus placeholder="Find a shape" aria-label="Find a shape" value={find} onChange={e => setFind(e.target.value)} onKeyDown={keys} />
      <ul>
        {shown.slice(0, 40).map(id => (
          <li key={id}>
            <button type="button" onClick={() => onPick(id)}>
              <ObjectTile model={model} object={getObject(model, id)} size={22} />
              <span>{nameOf(model, id)}</span>
              {id !== ROOT && parentOf(model, id) !== ROOT && <span className="muted">{nameOf(model, parentOf(model, id))}</span>}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">No shapes</li>}
      </ul>
    </div>
  )
}

/** The mark at the start of a row: a flow, an analysis, or the shape inside. */
function RowMark({ model, row }: { model: Model; row: Dependent }) {
  if (row.kind === 'child') return <ObjectTile model={model} object={getObject(model, row.child as string)} size={28} />
  const Icon = row.analysis === undefined ? Route : Alert
  return <span className={`usedby-mark ${row.analysis === undefined ? 'flow' : 'mode'}`} aria-hidden="true"><Icon size={16} /></span>
}

type Picking = { key: string } | 'all'

/**
 * What is waiting on the shapes or lines about to be deleted: a row for each, with the ways to settle it, and Delete once every row is.
 * The choices are made here and applied together by deleteWith, so the whole delete is one edit and one undo.
 */
export function UsedBy({ model, targets, run, onFlag, onDone, onCancel }: {
  model: Model; targets: Target[]; run: SaveEdit; onFlag: (ids: string[]) => void; onDone: (text: string) => void; onCancel: () => void
}) {
  const [choices, setChoices] = useState<Choices>({})
  const [active, setActive] = useState<string>()
  const [picking, setPicking] = useState<Picking>()
  const root = useRef<HTMLDivElement>(null)
  const plan: Plan = planOf(model, targets, choices)
  const rows = plan.rows.filter(needsDecision)
  const withFlow = (r: Dependent) => r.flow !== undefined && plan.flows.has(r.flow) && choices[r.key]?.action !== 'deleteFlow'
  const going = plan.targets.flatMap(t => ('object' in t ? [t.object] : []))
  const reason = plan.open.length === 0 ? undefined : `Choose for ${plan.open.length} more`

  // Focus is taken a moment after the button that opened this goes: a click's own focus change would otherwise take it back.
  useEffect(() => {
    const t = setTimeout(() => root.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])
  const activeRow = rows.find(r => r.key === active)
  useEffect(() => {
    onFlag(activeRow ? rowText(model, activeRow).shapes : [])
    return () => onFlag([])
  }, [active, model])

  // When a list of shapes closes, its field goes with it: the keys of the panel are wanted again.
  useEffect(() => {
    if (picking === undefined) root.current?.focus()
  }, [picking])
  const choose = (row: Dependent, choice: Choice) => setChoices(c => ({ ...c, [row.key]: choice }))
  const pick = (row: Dependent, action: Action) => {
    setActive(row.key)
    if (POINTS[action] === undefined) return choose(row, { action })
    // A place defaults to the top level until another is picked; a shape has to be picked.
    if (POINTS[action] === 'place') choose(row, { action })
    setPicking({ key: row.key })
  }
  const pickedFor = (key: string, id: string) => {
    const row = rows.find(r => r.key === key)
    const action = choices[key]?.action
    if (!row) return
    const wanted = action !== undefined && POINTS[action] !== undefined ? action : row.actions.find(a => POINTS[a] === 'shape') ?? row.actions[0]
    choose(row, { action: wanted, to: id })
    setPicking(undefined)
  }
  const apply = async () => {
    const text = doneText(model, plan, choices, targets)
    const saved = await run(m => deleteWith(m, targets, resolutionsOf(plan, choices)))
    if (saved) onDone(text)
  }
  const everything = () => {
    if (plan.open.length > 0) return setChoices(removeAll(model, targets, choices))
    void apply()
  }

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape') {
      stop()
      return picking ? setPicking(undefined) : onCancel()
    }
    if (e.key === 'Enter' && !takesEnter(e.target as Element)) {
      stop()
      return everything()
    }
    const rowKeys = rows.filter(r => !withFlow(r)).map(r => r.key)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop()
      const i = active === undefined ? -1 : rowKeys.indexOf(active)
      return setActive(rowKeys[Math.max(0, Math.min(rowKeys.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))])
    }
    const key = letter(e)
    if (key === 'x' && activeRow && !withFlow(activeRow)) {
      stop()
      return choose(activeRow, defaultChoice(activeRow))
    }
    if (key === 'r') {
      stop()
      if (!activeRow) return setPicking('all')
      const action = activeRow.actions.find(a => POINTS[a] === 'shape')
      if (action) pick(activeRow, action)
    }
  }

  const left = shapesLeft(model, plan)
  const places = left.filter(id => isView(model, id))
  const choosing = picking === undefined ? undefined : picking === 'all' ? { top: false, ids: left } : (() => {
    const row = rows.find(r => r.key === picking.key)
    const place = row !== undefined && POINTS[choices[row.key]?.action ?? row.actions[0]] === 'place'
    return { top: place, ids: place ? (choices[picking.key]?.action === 'moveOut' ? left : places) : left }
  })()
  const onChosen = (id: string) => {
    if (picking === 'all') {
      setChoices(rerouteAll(model, targets, choices, id))
      return setPicking(undefined)
    }
    if (picking) pickedFor(picking.key, id)
  }
  const along = alongText(plan.along)
  const names = going.length === 1 ? nameOf(model, going[0]) : going.length > 1 ? `${going.length} shapes` : 'A line'

  return (
    <Panel onClose={onCancel}>
      <div className="usedby" ref={root} tabIndex={-1} onKeyDown={keys} aria-label="Used by">
        <h2>Used by</h2>
        <p className="muted">{names}</p>
        <ul className="usedby-rows">
          {rows.map(row => {
            const text = rowText(model, row)
            const choice = choices[row.key]
            const joined = withFlow(row)
            const done = joined || settles(row, choice)
            const chooser = choosing && picking !== 'all' && picking?.key === row.key ? choosing : undefined
            return (
              <li key={row.key} className={['usedby-row', done ? 'done' : 'open', row.key === active ? 'active' : ''].filter(Boolean).join(' ')} aria-current={row.key === active}>
                <button type="button" className="usedby-main" onClick={() => setActive(row.key)}>
                  <RowMark model={model} row={row} />
                  <span className="usedby-text"><strong>{text.title}</strong><span className="muted">{text.where}</span></span>
                </button>
                {row.emptiesFlow && <Chip kind="warn">Last steps</Chip>}
                {joined ? <span className="muted usedby-with">With the flow</span> : (
                  <div className="usedby-actions" role="radiogroup" aria-label={`${text.title}, ${text.where}`}>
                    {row.actions.map(a => (
                      <button key={a} type="button" role="radio" aria-checked={choice?.action === a} className={['pick', a === 'deleteFlow' || a === 'removeStep' || a === 'removeMode' || a === 'deleteWith' ? 'remove' : ''].filter(Boolean).join(' ')} onClick={() => pick(row, a)}>
                        {ACTION_LABELS[a]}
                      </button>
                    ))}
                  </div>
                )}
                {!joined && choice?.to !== undefined && <span className="usedby-to"><ObjectTile model={model} object={getObject(model, choice.to)} size={20} />{nameOf(model, choice.to)}</span>}
                {chooser && <ShapeChooser model={model} ids={chooser.ids} top={chooser.top} onPick={onChosen} onClose={() => setPicking(undefined)} />}
              </li>
            )
          })}
        </ul>
        {along !== '' && <p className="usedby-along"><span className="muted">Goes too</span> {along}</p>}
        {picking === 'all' && choosing && <ShapeChooser model={model} ids={choosing.ids} top={false} onPick={onChosen} onClose={() => setPicking(undefined)} />}
        <div className="usedby-foot">
          <button type="button" onClick={everything}><Trash size={16} />Remove all</button>
          <button type="button" onClick={() => setPicking('all')}><Route size={16} />Reroute all to…</button>
          <button type="button" onClick={onCancel}><Close size={16} />Cancel</button>
          <span className="spacer" title={reason}>
            <button type="button" className="danger" disabled={reason !== undefined} aria-describedby={reason ? 'usedby-reason' : undefined} onClick={() => void apply()}><Trash size={16} />Delete</button>
          </span>
          {reason && <span id="usedby-reason" className="muted">{reason}</span>}
        </div>
        <p className="hint"><span><kbd>↑</kbd><kbd>↓</kbd> Row</span> <span><kbd>X</kbd> Remove</span> <span><kbd>R</kbd> Reroute</span> <span><kbd>Enter</kbd> {plan.open.length > 0 ? 'Remove all' : 'Delete'}</span> <span><kbd>Esc</kbd> Cancel</span></p>
      </div>
    </Panel>
  )
}
