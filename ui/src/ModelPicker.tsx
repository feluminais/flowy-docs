import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { folderTree } from '../../src/core/modellist.ts'
import type { FolderNode, ModelInfo, ModelList } from '../../src/core/modellist.ts'
import { Alert, ChevronDown, ChevronRight, Cube, Folder, Search as SearchIcon } from './icons.tsx'
import { addressOf, fetchModels, modelOfPage, scanDeeper, stopScan } from './models.ts'

const POLL_MS = 400
const TOGGLE = 'data-models-toggle'

/** The folders and the models of the project flowy was started in, as a tree like a file explorer's with only the folders that lead to a model. */
export function ModelPicker({ list, onList }: { list: ModelList; onList: (list: ModelList) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set()) // folders the reader folded; all are open to begin with
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const current = modelOfPage() ?? list.models[0]?.id
  const here = list.models.find(m => m.id === current)
  const tree = useMemo(() => folderTree(list.models, query), [list.models, query])
  const searching = query.trim() !== ''

  // While a search runs the page asks how far it has got; what it has found so far is listed as it goes.
  useEffect(() => {
    if (list.state !== 'scanning') return
    const timer = setInterval(() => void fetchModels().then(next => next && onList(next)), POLL_MS)
    return () => clearInterval(timer)
  }, [list.state, onList])

  // Esc is this popover's while it is open, ahead of the keys of the page; a press outside it closes it (the button toggles it itself).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !box.current?.contains(e.target) && e.target.closest(`[${TOGGLE}]`) === null) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const fold = (path: string) => setClosed(c => (c.has(path) ? new Set([...c].filter(p => p !== path)) : new Set([...c, path])))
  const go = (id: string) => location.assign(addressOf(id))
  // Up and Down walk the field and then the rows; Enter on a row opens it (a button does that itself).
  const walk = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const stops = [...(box.current?.querySelectorAll<HTMLElement>('input, [data-row]') ?? [])]
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next = stops[Math.max(0, Math.min(stops.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    next?.focus()
    e.preventDefault()
  }

  const row = (node: FolderNode, depth: number) => {
    const folded = !searching && closed.has(node.path)
    const parent = node.children.length > 0
    return (
      <li key={node.path || '.'} role="treeitem" aria-level={depth + 1} aria-expanded={parent ? !folded : undefined} aria-selected={node.model?.id === current}>
        <div className={`mrow${node.model?.id === current ? ' here' : ''}`} style={{ paddingLeft: 6 + depth * 16 }}>
          <button className="mfold" data-row tabIndex={-1} aria-label={folded ? 'Open folder' : 'Close folder'} disabled={!parent || searching} onClick={() => fold(node.path)}>
            {parent && (folded ? <ChevronRight size={14} /> : <ChevronDown size={14} />)}
          </button>
          {node.model ? (
            <button className="mname model" data-row title={node.model.where} onClick={() => go(node.model!.id)}>
              <Cube size={16} />{node.name}
            </button>
          ) : (
            <button className="mname" data-row onClick={() => fold(node.path)} disabled={searching}>
              <Folder size={16} />{node.name}
            </button>
          )}
        </div>
        {parent && !folded && <ul role="group">{node.children.map(c => row(c, depth + 1))}</ul>}
      </li>
    )
  }

  const place = button.current?.getBoundingClientRect()
  const popover = open && place && (
    <div className="mpick" ref={box} role="dialog" aria-label="Models" onKeyDown={walk}
      style={{ left: Math.max(12, Math.min(place.left, window.innerWidth - 432)), top: place.bottom + 6, maxHeight: window.innerHeight - place.bottom - 20 }}>
      <label className="cpick-find">
        <SearchIcon size={16} />
        <input autoFocus value={query} placeholder="Find a model" aria-label="Find a model" onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.key !== 'Enter') return
            const first = firstModel(tree)
            if (first) go(first.id)
            e.preventDefault()
          }} />
      </label>
      <ul className="mpick-tree" role="tree" aria-label="Models">{tree.map(n => row(n, 0))}</ul>
      {tree.length === 0 && <p className="muted mpick-empty">{searching ? 'Nothing called that' : 'No models in this folder'}</p>}
      <Footer list={list} onList={onList} />
    </div>
  )

  return (
    <>
      <button ref={button} className="modelpick" aria-haspopup="dialog" aria-expanded={open} aria-label={`Model: ${here?.name ?? 'none'}`} title={here?.where ? `${here.where}` : 'Models'} {...{ [TOGGLE]: '' }}
        onClick={() => setOpen(o => !o)}>
        <Cube size={16} />{here?.name ?? 'Models'}<ChevronDown size={14} />
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  )
}

/** A folder's path up to and including its last separator, so the folder's own name can stay in view when the rest is cut short. */
const dirOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1)

/** The first model in the order the tree shows them. */
const firstModel = (nodes: FolderNode[]): ModelInfo | undefined => {
  for (const n of nodes) {
    const found = n.model ?? firstModel(n.children)
    if (found) return found
  }
  return undefined
}

/** Where the search looked and how far it got, with a way to look deeper (or stop) when that matters. */
function Footer({ list, onList }: { list: ModelList; onList: (list: ModelList) => void }) {
  const { scope, state, looked, stoppedBy } = list
  const folders = `${looked.toLocaleString()} ${looked === 1 ? 'folder' : 'folders'}`
  const deeper = async () => {
    const next = await scanDeeper()
    if (next) onList(next)
  }
  const stop = async () => {
    const next = await stopScan()
    if (next) onList(next)
  }
  return (
    <div className="mpick-foot">
      {scope ? (
        <div className="mscope" title={scope.root}>
          <Folder size={14} />
          <span className="mpath"><span className="mdir">{dirOf(scope.root)}</span><span className="mleaf">{scope.root.slice(dirOf(scope.root).length)}</span></span>
          <span className="muted">{scope.depth} levels</span>
        </div>
      ) : (
        <div className="mscope muted">Chosen when flowy started</div>
      )}
      {scope?.broad && (
        <div className="mwarn"><Alert size={14} />{scope.broad === 'drive' ? 'A whole drive' : 'The home folder'}</div>
      )}
      {scope && (
        <div className="mstate">
          {state === 'scanning' ? <span>Looking, {folders}</span> : stoppedBy ? <span>Stopped at {folders}</span> : <span>Looked in {folders}</span>}
          {state === 'scanning' && <button onClick={() => void stop()}>Stop</button>}
          {state === 'done' && list.canDeepen && <button onClick={() => void deeper()}>Scan deeper</button>}
        </div>
      )}
      <div className="mhint"><kbd>↑</kbd><kbd>↓</kbd> Move <kbd>Enter</kbd> Open</div>
    </div>
  )
}
