import { Fragment } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Model } from '../../src/core/model.ts'
import { LINE_STYLES } from '../../src/core/model.ts'
import type { LineStyle } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import { tidyLayout } from '../../src/core/ops.ts'
import { chain, nameOf } from '../../src/core/views.ts'
import { Dropdown } from './Dropdown.tsx'
import type { SaveEdit } from './forms.tsx'
import { Alert, ChevronRight, Copy, Grid, Home, Keyboard, Pencil, Plus, Redo, Route, Search as SearchIcon, Undo } from './icons.tsx'
import { LINE_NAMES } from './lines.ts'
import { ModelPicker } from './ModelPicker.tsx'
import type { ModelList } from './models.ts'
import type { Side } from './side.ts'

/** "N problems": a list that opens from the top bar. Picking one shows where it is. */
function Problems({ problems, onPick }: { problems: Problem[]; onPick: (p: Problem) => void }) {
  if (problems.length === 0) return null
  return (
    <details className="problems">
      <summary><Alert size={14} />{problems.length} problem{problems.length === 1 ? '' : 's'}</summary>
      <ul>
        {problems.map((p, i) => (
          <li key={i}>
            <button onClick={e => {
              e.currentTarget.closest('details')!.open = false
              onPick(p)
            }}><span className="muted">{p.file}</span> {p.message}</button>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** The bar over the canvas: the models, the breadcrumb of levels, the edit buttons, the problems, the line style, search, Mermaid, shortcuts and the Edit switch. */
export function TopBar({ model, view, editing, live, readOnly, problems, models, onModels, lines, searching, shortcuts, onJump, onProblem, onShow, onUndo, onRedo, onTidy, onLines, onSearching, onMermaid, onShortcuts, onEdit, run }: {
  model: Model; view: string; editing: boolean; live: boolean; readOnly: boolean; problems: Problem[]; models: ModelList | undefined; onModels: Dispatch<SetStateAction<ModelList | undefined>>
  lines: LineStyle; searching: boolean; shortcuts: boolean; onJump: (id: string) => void; onProblem: (p: Problem) => void; onShow: (s: Side) => void
  onUndo: () => void; onRedo: () => void; onTidy: () => void; onLines: (value: string) => void; onSearching: (searching: boolean) => void; onMermaid: () => void
  onShortcuts: (open: boolean) => void; onEdit: () => void; run: SaveEdit
}) {
  return (
    <header className="bar">
      {models && <ModelPicker list={models} onList={onModels} />}
      <nav className="crumbs" aria-label="Zoom level">
        {chain(model, view).reverse().map((id, i) => (
          <Fragment key={id}>
            {i > 0 && <ChevronRight size={14} />}
            <button aria-current={id === view ? 'page' : undefined} onClick={id === view ? undefined : () => onJump(id)}>{i === 0 && <Home size={16} />}{nameOf(model, id)}</button>
          </Fragment>
        ))}
      </nav>
      {editing && <button onClick={() => onShow({ kind: 'flow', id: '', name: '' })}><Route size={16} />New flow</button>}
      {editing && <button onClick={() => onShow({ kind: 'add' })}><Plus size={16} />Add</button>}
      {editing && <button className="icon" aria-label="Undo" title="Undo the last change (Ctrl+Z)" onClick={onUndo}><Undo size={16} /></button>}
      {editing && <button className="icon" aria-label="Redo" title="Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)" onClick={onRedo}><Redo size={16} /></button>}
      {editing && (
        <button title="Lay this view out again" onClick={() => void run(m => tidyLayout(m, view)).then(saved => {
          if (!saved) return
          onTidy()
        })}>
          <Grid size={16} />Tidy
        </button>
      )}
      <span className="grow" />
      {/* first of the right-hand group: its count changes its width, and what sits to its left only ever moves for words, never for an icon */}
      <Problems problems={problems} onPick={onProblem} />
      <Dropdown label="Line style" value={lines} options={LINE_STYLES.map(s => [s, `Lines: ${LINE_NAMES[s]}`])} onChange={onLines}
        title={editing ? 'How lines look for everyone (saved in model.yaml)' : 'How lines look on this screen'} />
      {/* mousedown would blur the open field, closing it, and the click would open it again */}
      <button title="Find a shape (Ctrl+K or /)" aria-pressed={searching} onMouseDown={e => searching && e.preventDefault()} onClick={() => onSearching(!searching)}><SearchIcon size={16} />Search</button>
      <button title="Copy this view, or the flow playing, as a Mermaid diagram" onClick={onMermaid}><Copy size={16} />Mermaid</button>
      <button className="icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-pressed={shortcuts} onClick={() => onShortcuts(!shortcuts)}><Keyboard size={16} /></button>
      {live && <button className="toggle" aria-pressed={editing} disabled={readOnly} title="Edit mode (E)" onClick={onEdit}><Pencil size={16} />Edit</button>}
    </header>
  )
}
