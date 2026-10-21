import { useState } from 'react'
import type { FocusEvent, FormEvent, ReactNode } from 'react'
import { isRepoPath, isWebAddress, typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import type { DataInput } from '../../src/core/data.ts'
import { getObject, isExternal, linksOf, parseData, ROOT } from '../../src/core/model.ts'
import type { Connection, FlowyObject, Group, Link, Model, ObjectType, Step } from '../../src/core/model.ts'
import { ANIMATION_KINDS, animationWith, KIND_SKETCHES, NAME_MAX, OUTCOME_SKETCHES, OUTCOMES, outcomeBlock, REASON_MAX } from '../../src/core/animation.ts'
import type { AnimationKey } from '../../src/core/animation.ts'
import { deleteFlow, deleteObject, groupSteps, OpError, putFlow, putGroup, putObject, relabel, removeConnection, removeGroup, removeStep, setGroupKind, setStepAnimation, setStepGroup, updateFlow } from '../../src/core/ops.ts'
import type { ObjectInput } from '../../src/core/ops.ts'
import type { StateMark, StateName } from '../../src/core/states.ts'
import { nameOf, parentOf } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { CodeFields, CodeSection } from './Code.tsx'
import { DataField, DataSection } from './Data.tsx'
import { connectionsOf, linesOf, newId, pickStepState, problemsOf, stateOf, stepStateShapes, withKey } from './edit.ts'
import type { BoxLine } from './edit.ts'
import { lineId } from './graph.ts'
import { StateGlyph, stateClasses, stateWord } from './states.tsx'
import { openInBrowser, openInEditor, vscode } from './host.ts'
import { opensEditor, repoLink } from './repolink.ts'
import { Chip, kindClass, lookVars, ObjectTile, Section, TypeTile } from './Chrome.tsx'
import { ColorPicker, ExternalToggle, IconPicker, KindPicker, OpacityPicker, ShapePicker, SketchPicker, StatePicker, TypePicker } from './Pickers.tsx'
import type { Sketch } from './Pickers.tsx'
import { Alert, ArrowDown, ArrowLeft, ArrowUp, ArrowRight, ArrowsSplit, Check, Cloud, Code, File, Folder, GitFork, iconOf, Link as LinkIcon, Pencil, Play, Plus, Repeat, Route, Sparkles, Table, Text, Trash, Close } from './icons.tsx'

/** Runs one edit and resolves to true once it's saved. Whatever went wrong shows as a notice. */
export type Run = (op: (model: Model) => Model) => Promise<boolean>

function Panel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside className="panel">
      <button className="close" aria-label="Close" onClick={onClose}><Close size={16} /></button>
      {children}
    </aside>
  )
}

/** What Details shows at the top level when nothing is picked: how much there is, and where to go next. */
export function OverviewPanel({ totals, onClose }: { totals: { shapes: number; flows: number; problems: number }; onClose: () => void }) {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return (
    <Panel onClose={onClose}>
      <h2>Overview</h2>
      <p className="muted">{count(totals.shapes, 'shape')} · {count(totals.flows, 'flow')}{totals.problems > 0 && ` · ${count(totals.problems, 'problem')}`}</p>
      <p>Pick a shape to read about it. Press O for the Explorer.</p>
    </Panel>
  )
}

function ProblemList({ problems }: { problems: Problem[] }) {
  return problems.length === 0 ? null : (
    <div className="problem-box">
      <Alert size={16} />
      <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
    </div>
  )
}

/** The top of a shape's panel: its tile, its name, and chips for its type, its tech, whether it is outside, and what is wrong with it. Tinted in the shape's colour. */
function ObjectHeader({ model, id, object, problems, state }: { model: Model; id: string; object: FlowyObject; problems: number; state?: StateMark }) {
  const external = isExternal(object)
  return (
    <header className={`hero ${kindClass(object.type, external)}`} style={lookVars({ color: object.color })}>
      <ObjectTile model={model} object={object} size={48} />
      <div>
        <h2>{object.name || id}</h2>
        <div className="chips">
          <Chip kind={kindClass(object.type)} icon={iconOf(object.type)}>{object.type || 'shape'}</Chip>
          {object.tech && <Chip icon={Code}>{object.tech}</Chip>}
          {external && <Chip kind="t-external" icon={Cloud}>external</Chip>}
          {problems > 0 && <Chip kind="warn" icon={Alert}>{problems} problem{problems === 1 ? '' : 's'}</Chip>}
        </div>
        {state && <p className={`stateline ${stateClasses(state)}`}><span className="muted">State</span><StateGlyph mark={state} />{stateWord(state)}</p>}
      </div>
    </header>
  )
}

/** A text field that saves when you leave it or press Enter, and shows the saved text again if saving fails. */
export function Field({ label, value, multiline, list, placeholder, disabled, title, onSave }: { label: ReactNode; value: string; multiline?: boolean; list?: string; placeholder?: string; disabled?: boolean; title?: string; onSave: (value: string) => Promise<boolean> }) {
  const save = async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = e.currentTarget
    if (input.value !== value && !(await onSave(input.value))) input.value = value
  }
  // Keyed by the saved value, so the field shows the new text after every reload.
  return (
    <label title={title}>
      {label}
      {multiline
        ? <textarea key={value} defaultValue={value} rows={8} disabled={disabled} onBlur={save} />
        : <input key={value} defaultValue={value} list={list} placeholder={placeholder} disabled={disabled} onBlur={save} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />}
    </label>
  )
}

type Common = { model: Model; run: Run; onClose: () => void }

/**
 * A path in the repo, as the link its text is. In VS Code it opens in the editor (with Ctrl or Cmd held, the repo host's page
 * instead, when there is one, as its tooltip says). Anywhere else it is the repo host's page when the repo is on GitHub or GitLab, and plain text otherwise.
 */
function RepoPath({ path, codeBase, children }: { path: string; codeBase?: string; children: ReactNode }) {
  const link = repoLink(path, codeBase, vscode !== undefined)
  if (!link) return <span>{children}</span>
  return (
    <a href={link.anchor} target={link.editor ? undefined : '_blank'} rel="noreferrer" title={link.title}
      onClick={link.editor ? e => {
        e.preventDefault()
        if (opensEditor(link, e)) openInEditor(path)
        else if (link.href) openInBrowser(link.href)
      } : undefined}>
      {children}
    </a>
  )
}

/** The paths an object's `code` lists, as links to the editor in VS Code and to the repo host when it is GitHub or GitLab. Anything else in `code` is left to the problem list. */
function CodeList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const paths = Array.isArray(object.code) ? object.code.filter((p): p is string => typeof p === 'string') : []
  if (paths.length === 0) return null
  return (
    <>
      <Section icon={Folder} title="Source" count={paths.length} />
      <ul className="code-list" aria-label="Source">
        {paths.map((p, i) => (
          <li key={i}>
            {p.endsWith('/') ? <Folder size={16} /> : <File size={16} />}
            <RepoPath path={p} codeBase={codeBase}><code>{p}</code></RepoPath>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The links an object lists. A web address opens in a new tab. A path in the repo opens in the editor in VS Code, links to the repo
 * host when the origin is GitHub or GitLab, and is plain text otherwise; check() reports one that doesn't exist. Anything else in `links` is left to the problem list.
 */
function LinkList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const links = linksOf(object)
  if (links.length === 0) return null
  return (
    <section className="link-list" aria-label="Links">
      <Section icon={LinkIcon} title="Links" count={links.length} />
      <ul>
        {links.map((l, i) => {
          const web = isWebAddress(l.url)
          const text = l.title || l.url
          return (
            <li key={i}>
              <LinkIcon size={16} />
              {web ? <a href={l.url} target="_blank" rel="noreferrer">{text}</a> : isRepoPath(l.url) ? <RepoPath path={l.url} codeBase={codeBase}>{text}</RepoPath> : <span>{text}</span>}
              {!web && l.title && <code className="muted">{l.url}</code>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const linkLine = (l: Link) => (l.title ? `${l.title} | ${l.url}` : l.url)

/**
 * One link per line, as "Title | address" or just an address. The last " | " splits, so a title may hold a bar and an address may
 * too. A link keeps the extra keys it had, found by its address.
 */
function parseLinks(text: string, old: Link[]): Link[] {
  const byUrl = new Map(old.map(l => [l.url, l]))
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const cut = line.lastIndexOf(' | ')
    const title = cut === -1 ? '' : line.slice(0, cut).trim()
    const url = (cut === -1 ? line : line.slice(cut + 3)).trim()
    const { title: _title, url: _url, ...extra } = byUrl.get(url) ?? { url }
    return { ...(title ? { title } : {}), url, ...extra }
  })
}

/** A connection's ends, when they're boxes inside the line's ends rather than the ends themselves. */
const inside = (model: Model, c: Connection, line: BoxLine) =>
  c.from === line.from && c.to === line.to ? undefined : `${nameOf(model, c.from)} → ${nameOf(model, c.to)}`

/**
 * Every line touching a box, out and in, so the panel shows its connections without clicking each
 * line. A line that stands for several connections opens to list them. The other box's name opens its
 * panel, and pointing at a row lights its line on the canvas.
 */
function LineList({ model, id, onPick, onHover }: { model: Model; id: string; onPick: (id: string) => void; onHover: (line?: string) => void }) {
  const { out, in: incoming } = linesOf(model, id)
  if (out.length + incoming.length === 0) return null
  const label = (c: Connection) => c.label || <span className="muted">no label</span>
  const row = (line: BoxLine, Arrow: typeof ArrowRight) => {
    const other = getObject(model, line.other)
    return (
    <li key={lineId(line.from, line.to)} className="row" onMouseEnter={() => onHover(lineId(line.from, line.to))} onMouseLeave={() => onHover(undefined)}>
      <span className="dirn" aria-hidden="true"><Arrow size={14} /></span>
      <div>
        <div className="other">
          <ObjectTile model={model} object={other} size={22} />
          <button type="button" className="link" onClick={() => onPick(line.other)}>{nameOf(model, line.other)}</button>
        </div>
        {line.connections.length === 1 ? (
          <>
            <div>{label(line.connections[0])}</div>
            {inside(model, line.connections[0], line) && <div className="muted">{inside(model, line.connections[0], line)}</div>}
          </>
        ) : (
          <details>
            <summary>{line.connections.length} connections</summary>
            <ul>
              {line.connections.map((c, i) => <li key={i}><div>{label(c)}</div><div className="muted">{inside(model, c, line)}</div></li>)}
            </ul>
          </details>
        )}
      </div>
    </li>
    )
  }
  return (
    <section className="lines-of" aria-label="Connections">
      {out.length > 0 && <><Section icon={ArrowRight} title="Out" count={out.length} /><ul>{out.map(l => row(l, ArrowRight))}</ul></>}
      {incoming.length > 0 && <><Section icon={ArrowLeft} title="In" count={incoming.length} /><ul>{incoming.map(l => row(l, ArrowLeft))}</ul></>}
    </section>
  )
}

type Lines = { onPick: (id: string) => void; onHover: (line?: string) => void }

/** An object's description, code, links, source and connections, or in edit mode a form for its name, type, tech, description, code, source and links. */
export function ObjectPanel({ model, id, editing, problems, codeBase, state, run, onClose, onPick, onHover }: Common & Lines & { id: string; editing: boolean; problems: Problem[]; codeBase?: string; state?: StateMark }) {
  const object = getObject(model, id)
  if (!object) return null
  const save = (fields: Omit<ObjectInput, 'id'>) => run(m => putObject(m, { id, ...fields }))
  const ours = problemsOf(model, problems, id)
  const mine = <ProblemList problems={ours} />
  const header = <ObjectHeader model={model} id={id} object={object} problems={ours.length} state={state} />
  if (!editing) return (
    <Panel onClose={onClose}>
      {header}
      {mine}
      <Section icon={Text} title="Description" />
      <div className="prose">{object.description ? <Description text={object.description} /> : <p className="muted">No description yet.</p>}</div>
      <DataSection object={object} />
      <CodeSection object={object} />
      <LinkList object={object} codeBase={codeBase} />
      <CodeList object={object} codeBase={codeBase} />
      <LineList model={model} id={id} onPick={onPick} onHover={onHover} />
    </Panel>
  )
  // A type the nesting rules don't allow here stays in the list, so the form shows what the file says.
  const types = [...new Set([...typesIn(model, parentOf(model, id)), object.type])].filter(Boolean)
  return (
    <Panel onClose={onClose}>
      {header}
      {mine}
      <form key={id} className="form" onSubmit={e => e.preventDefault()}>
        <Section icon={Pencil} title="Details" />
        <div className="card">
          <Field label="Name" value={object.name ?? ''} onSave={name => save({ name })} />
          <TypePicker types={types} value={object.type} onPick={type => void save({ type })} />
          <ExternalToggle on={isExternal(object)} onToggle={external => void save({ external })} />
          <Field label="Tech" value={object.tech ?? ''} onSave={tech => save({ tech })} />
        </div>
        <Section icon={Sparkles} title="Look" />
        <div className="card">
          <ShapePicker object={object} onPick={shape => void save({ shape })} />
          <ColorPicker object={object} onSave={color => save({ color })} />
          <OpacityPicker object={object} onSave={opacity => save({ opacity })} />
          <IconPicker model={model} object={object} onPick={icon => void save({ icon })} />
        </div>
        <Section icon={Text} title="Description" />
        <Field label="Description" value={object.description ?? ''} multiline onSave={description => save({ description })} />
        {(object.type === 'store' || object.data !== undefined) && (
          <>
            <Section icon={Table} title="Data" />
            <DataField object={object} onSave={text => run(m => putObject(m, { id, data: parseData(text) as DataInput[] }))} />
          </>
        )}
        <Section icon={Code} title="Code" />
        <CodeFields object={object} onSave={snippets => save({ snippets })} />
        <Section icon={Folder} title="Source" />
        <Field label="Files and folders (one per line)" value={Array.isArray(object.code) ? object.code.join('\n') : ''} multiline
          onSave={text => save({ code: text.split('\n').map(line => line.trim()).filter(Boolean) })} />
        <Section icon={LinkIcon} title="Links" />
        <Field label="Links (one per line: title | address)" value={linksOf(object).map(linkLine).join('\n')} multiline
          onSave={text => save({ links: parseLinks(text, linksOf(object)) })} />
      </form>
      <LineList model={model} id={id} onPick={onPick} onHover={onHover} />
      <p className="muted">id: {id}</p>
      <button className="danger" onClick={() => void run(m => deleteObject(m, id)).then(saved => saved && onClose())}><Trash size={16} />Delete</button>
    </Panel>
  )
}

/** The connections one line stands for (a zoomed-out line can merge several), each with its label. */
export function LinePanel({ model, view, from, to, editing, problems, run, onClose }: Common & { view: string; from: string; to: string; editing: boolean; problems: Problem[] }) {
  const lines = connectionsOf(model, view, from, to)
  if (lines.length === 0) return null
  return (
    <Panel onClose={onClose}>
      <header className="hero ends">
        {[from, to].flatMap((end, i) => {
          const o = getObject(model, end)
          const name = (
            <div key={end + i} className="end">
              <ObjectTile model={model} object={o} size={40} />
              <strong>{nameOf(model, end)}</strong>
            </div>
          )
          return i === 0 ? [name, <ArrowRight key="arrow" size={22} />] : [name]
        })}
      </header>
      <h2 className="visually-hidden">{nameOf(model, from)} → {nameOf(model, to)}</h2>
      <Section icon={Route} title={lines.length === 1 ? 'Connection' : 'Connections'} count={lines.length} />
      {lines.map(({ index, connection: c }) => {
        const which = { from: c.from, to: c.to, label: c.label ?? '' }
        return (
          <section key={index} className="line card">
            {(c.from !== from || c.to !== to) && <p className="muted">{nameOf(model, c.from)} → {nameOf(model, c.to)}</p>}
            {editing ? (
              <form className="form" onSubmit={e => e.preventDefault()}>
                <Field label="Label" value={c.label ?? ''} onSave={label => run(m => relabel(m, which, label))} />
                <button type="button" className="danger" onClick={() => void run(m => removeConnection(m, which))}><Trash size={16} />Delete</button>
              </form>
            ) : <p>{c.label || <span className="muted">No label</span>}</p>}
            <ProblemList problems={problems.filter(p => p.connection === index)} />
          </section>
        )
      })}
    </Panel>
  )
}

/** A new object in the current view, with only the types the nesting rules allow there. */
export function AddPanel({ model, view, run, onAdded, onClose }: Common & { view: string; onAdded: (id: string) => void }) {
  const types = typesIn(model, view)
  const [chosen, choose] = useState<string>()
  const type = (chosen && types.includes(chosen as ObjectType) ? chosen : types[0] ?? '') as ObjectType
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name')).trim()
    if (!name) return
    let id = ''
    const saved = await run(m => {
      id = newId(name, Object.keys(m.objects), type) // from the fresh model, so it never lands on an existing object
      return putObject(m, { id, type, name, in: view === ROOT ? undefined : view })
    })
    if (saved) onAdded(id)
  }
  return (
    <Panel onClose={onClose}>
      <h2 className="iconhead"><span className="badge"><Plus size={14} /></span>Add to {nameOf(model, view)}</h2>
      <form className="form" onSubmit={add}>
        <TypePicker types={types} value={type} onPick={choose} />
        <label>Name<input name="name" autoFocus /></label>
        <button className="primary"><Plus size={16} />Add</button>
      </form>
    </Panel>
  )
}

/** The flow being recorded. While `id` is "", it still needs a name. `from` and `to` are the step being picked. */
export type Recording = { id: string; name: string; from?: string; to?: string }

/** The step with this detail, or with none when it's blank. */
function withDescription(step: Step, description: string): Step {
  const { description: _, ...rest } = step
  return description.trim() ? { ...rest, description } : rest
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
/** How a step travels and how its request ends, as sketches to pick from. A step on one shape does not travel, so nothing but None is open to it. */
const KIND_CHOICES: Sketch[] = [{ id: '', name: 'None', sketch: KIND_SKETCHES.none }, ...ANIMATION_KINDS.map(k => ({ id: k, name: cap(k), sketch: KIND_SKETCHES[k] }))]
const OUTCOME_CHOICES: Sketch[] = [{ id: '', name: 'Arrives', sketch: OUTCOME_SKETCHES.none }, ...OUTCOMES.map(o => ({ id: o, name: cap(o), sketch: OUTCOME_SKETCHES[o] }))]
const isTable = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * How a step plays: the way it travels, the way its request ends, and what goes with an outcome (a share of the requests, a reason, and for an interception
 * who takes it). Each pick or field is one edit. What the step cannot have is greyed out with the reason in its tooltip, so the form never changes shape.
 */
function StepAnimation({ step, takers, onSet }: { step: Step; takers: { id: string; type: string; name: string; end: boolean }[]; onSet: (key: AnimationKey, value: string) => Promise<boolean> }) {
  const raw = step.animation
  const map = isTable(raw) ? raw : typeof raw === 'string' ? { kind: raw } : {}
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
  const kind = text(map.kind)
  const outcome = text(map.outcome)
  const travels = typeof step.to === 'string' && step.to !== '' && step.to !== step.from
  const kinds = KIND_CHOICES.map(c => ({ ...c, block: c.id !== '' && !travels ? 'Needs two shapes' : undefined }))
  const outcomes = OUTCOME_CHOICES.map(c => ({ ...c, block: outcomeBlock(kind, c.id) }))
  const ended = outcome !== ''
  const taken = text(map.by)
  const named = isTable(map.by) ? text(map.by.name) : ''
  const intercepted = outcome === 'intercepted'
  const off = (why: string, on: boolean) => (on ? undefined : why)
  return (
    <details className="more" open={kind !== '' || undefined}>
      <summary>Animation</summary>
      <div className="form">
        <SketchPicker label="Travels as" choices={kinds} value={kind} onPick={id => void onSet('kind', id)} />
        <SketchPicker label="Ends as" choices={outcomes} value={outcome} onPick={id => void onSet('outcome', id)} />
        <Field label="Share of requests (1 to 100)" value={text(map.share)} placeholder="e.g. 30" disabled={!ended} title={off('Pick an outcome first', ended)} onSave={v => onSet('share', v)} />
        <Field label={`Reason (${REASON_MAX} characters)`} value={text(map.reason)} placeholder="e.g. Rate limit" disabled={!ended} title={off('Pick an outcome first', ended)} onSave={v => onSet('reason', v)} />
        <div className="pick-field" title={off('Only for Intercepted', intercepted)}>
          <div className="pick-head"><span>Taken by</span><span className="pick-value">{named !== '' ? named : takers.find(t => t.id === taken)?.name ?? (taken !== '' ? `${taken} · no such shape` : '')}</span></div>
          <div className="pick-grid shapes-list" role="radiogroup" aria-label="Taken by a shape">
            {takers.map(t => (
              <button key={t.id} type="button" role="radio" aria-checked={t.id === taken} disabled={!intercepted || t.end} className="pick taker" title={!intercepted ? 'Only for Intercepted' : t.end ? 'An end of the step' : t.name} onClick={() => t.id !== taken && void onSet('by', t.id)}>
                <TypeTile type={t.type} size={22} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        <Field label={`Or a name (${NAME_MAX} characters)`} value={named} placeholder="e.g. Café wifi proxy" disabled={!intercepted} title={off('Only for Intercepted', intercepted)} onSave={v => onSet('byName', v)} />
      </div>
    </details>
  )
}

const KIND_NAMES: Record<string, string> = { repeat: 'Repeat', branch: 'Branch', parallel: 'Parallel' }
const KIND_ICONS: Record<string, typeof Repeat> = { repeat: Repeat, branch: GitFork, parallel: ArrowsSplit }
const KINDS = Object.entries(KIND_NAMES).map(([id, name]) => ({ id, name, Icon: KIND_ICONS[id] }))
/** A value of a table by a key from a file: only the table's own keys count, so a kind called "constructor" is not on it. */
const own = <T,>(table: Record<string, T>, key: unknown): T | undefined => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined)
const hasLanes = (group?: Group) => group?.kind === 'branch' || group?.kind === 'parallel'

/** The group a step is in, the lane it starts and the flow that tells the rest of its story. Each choice is one edit, which keeps the file valid or says why not. */
function StepStructure({ step, self, groups, others, onGroup, onLane, onFlow }: {
  step: Step; self: string; groups: Record<string, Group>; others: [string, string][]
  onGroup: (group: string) => Promise<boolean>; onLane: (lane: string) => Promise<boolean>; onFlow: (flow: string) => Promise<boolean>
}) {
  const gid = typeof step.group === 'string' ? step.group.trim() : ''
  const target = typeof step.flow === 'string' ? step.flow.trim() : ''
  const ids = Object.keys(groups)
  return (
    <details className="more" open={gid !== '' || target !== '' || undefined}>
      <summary>Group and flow</summary>
      <div className="form">
        <label>
          Group
          <select value={gid} onChange={e => void onGroup(e.target.value)}>
            <option value="">None</option>
            {ids.map(g => <option key={g} value={g}>{g} · {own(KIND_NAMES, groups[g]?.kind) ?? 'no kind'}</option>)}
            {gid !== '' && !ids.includes(gid) && <option value={gid}>{gid} · not declared</option>}
          </select>
        </label>
        {hasLanes(groups[gid]) && <Field label="Lane (a new lane starts here)" value={String(step.lane ?? '')} placeholder="e.g. The card is declined" onSave={onLane} />}
        <label>
          Opens flow
          <select value={target} onChange={e => void onFlow(e.target.value)}>
            <option value="">None</option>
            {others.map(([id, name]) => <option key={id} value={id}>{name || id}</option>)}
            {target !== '' && !others.some(([id]) => id === target) && <option value={target}>{target === self ? 'This flow' : `${target} · no such flow`}</option>}
          </select>
        </label>
      </div>
    </details>
  )
}

/** A state for each end of a step, as drawn tiles. A pick is one edit, and None takes the state out. A shape the model no longer has is left out; the checks report it. */
function StepStates({ model, step, onPick }: { model: Model; step: Step; onPick: (shape: string, state: StateName | '') => Promise<boolean> }) {
  const shapes = stepStateShapes(step).filter(id => getObject(model, id) !== undefined)
  if (shapes.length === 0) return null
  return (
    <details className="more" open={shapes.some(id => stateOf(step, id) !== undefined) || undefined}>
      <summary>State</summary>
      <div className="form">
        {shapes.map(id => <StatePicker key={id} label={nameOf(model, id)} value={stateOf(step, id)} onPick={state => void onPick(id, state)} />)}
      </div>
    </details>
  )
}

/** The groups of the flow being recorded: how each one behaves, and a form that puts a stretch of its steps in a new one. */
function GroupsSection({ flowId, steps, groups, edit }: { flowId: string; steps: Step[]; groups: Record<string, Group>; edit: Run }) {
  const ids = Object.keys(groups)
  const [kind, setKind] = useState('repeat')
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const text = String(data.get('text')).trim()
    const id = newId(text || kind, ids, 'group')
    const saved = await edit(m => {
      const grouped = groupSteps(m, flowId, id, kind, Number(data.get('first')), Number(data.get('last')))
      return text ? putGroup(grouped, flowId, id, { ...grouped.flows[flowId].groups![id], text }) : grouped
    })
    if (saved) {
      form.reset()
      setKind('repeat')
    }
  }
  const range = (name: string) => (
    <select name={name} defaultValue={steps.length - 1}>{steps.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select>
  )
  return (
    <>
      <Section icon={Repeat} title="Groups" count={ids.length} />
      {ids.length > 0 && (
        <ul className="groups">
          {ids.map(gid => {
            const g = groups[gid]
            const KindIcon = own(KIND_ICONS, g.kind) ?? Repeat
            // The group as it is saved now, not as it was drawn: another edit may have changed it since.
            const save = (key: 'times' | 'until' | 'text', value: string) => edit(m => putGroup(m, flowId, gid, { ...(m.flows[flowId]?.groups?.[gid] ?? g), [key]: value }))
            return (
              <li key={gid} className="form">
                <div className="group-head">
                  <KindIcon size={16} />
                  <strong>{gid}</strong>
                  <button className="danger" aria-label={`Remove group ${gid}`} title="Remove the group. Its steps stay" onClick={() => void edit(m => removeGroup(m, flowId, gid))}><Trash size={16} /></button>
                </div>
                <KindPicker kinds={KINDS} value={own(KIND_NAMES, g.kind) === undefined ? '' : String(g.kind)} onPick={kind => void edit(m => setGroupKind(m, flowId, gid, kind))} />
                {g.kind === 'repeat' && (
                  <>
                    <Field label="Times (2 to 99)" value={String(g.times ?? '')} onSave={value => save('times', value.trim())} />
                    <Field label="Until (instead of a count)" value={String(g.until ?? '')} onSave={value => save('until', value)} />
                  </>
                )}
                <Field label="Text the player shows" value={String(g.text ?? '')} onSave={value => save('text', value)} />
              </li>
            )
          })}
        </ul>
      )}
      {steps.length > 0 && (
        <form className="form" key={steps.length} onSubmit={add}>
          <label>Put steps in a new group<input name="text" placeholder="What it is, e.g. Retry the charge" /></label>
          <KindPicker kinds={KINDS} value={kind} onPick={setKind} />
          <div className="pair"><label>From step{range('first')}</label><label>To step{range('last')}</label></div>
          <button className="primary"><Plus size={16} />Group these steps</button>
        </form>
      )}
    </>
  )
}

/** The step list beside the canvas while recording a flow: click two boxes, type what happens, press Enter. */
export function Recorder({ model, view, rec, onChange, run, onClose }: Common & { view: string; rec: Recording; onChange: (rec: Recording) => void }) {
  if (!rec.id) return (
    <Panel onClose={onClose}>
      <h2 className="iconhead"><span className="badge"><Route size={14} /></span>New flow</h2>
      <form className="form" onSubmit={e => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get('name')).trim()
        if (name) onChange({ id: newId(name, Object.keys(model.flows), 'flow'), name })
      }}>
        <label>Name<input name="name" autoFocus placeholder="e.g. Customer checks out" /></label>
        <button className="primary"><Play size={16} />Start recording</button>
      </form>
    </Panel>
  )
  const flow = Object.hasOwn(model.flows, rec.id) ? model.flows[rec.id] : undefined
  const stepsIn = (m: Model) => (Object.hasOwn(m.flows, rec.id) ? m.flows[rec.id].steps : [])
  const steps = stepsIn(model)
  // Step numbers come from the list on screen. If the saved steps differ from it (a quick second
  // click, or someone else's edit), refuse rather than change the step that moved into that place.
  const onScreen = (m: Model) => {
    if (JSON.stringify(stepsIn(m)) !== JSON.stringify(steps)) throw new OpError('The steps just changed. Check them and try again.')
    return stepsIn(m)
  }
  const change = (edit: (steps: Step[]) => Step[]) => run(m => updateFlow(m, rec.id, { steps: edit(onScreen(m)) }))
  // An edit that counts steps (put one in a group, delete one) is checked against the list on screen as well.
  const edit: Run = op => run(m => { onScreen(m); return op(m) })
  const groups: Record<string, Group> = flow && typeof flow.groups === 'object' && flow.groups !== null && !Array.isArray(flow.groups) ? flow.groups : {}
  const others = Object.entries(model.flows).filter(([id]) => id !== rec.id).map(([id, f]): [string, string] => [id, f.name])
  // A step with no "to", or one recorded by clicking the same box twice, is that box acting on its own.
  const ends = (from: string, to?: string) => (to === undefined || to === from ? `${nameOf(model, from)}, on its own` : `${nameOf(model, from)} → ${nameOf(model, to)}`)
  const addStep = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = String(new FormData(e.currentTarget).get('text')).trim()
    if (!text || !rec.from || !rec.to) return
    const step: Step = rec.to === rec.from ? { from: rec.from, text } : { from: rec.from, to: rec.to, text }
    // The first step creates the file: a flow with no steps is a problem, so it can't be saved before.
    const saved = await run(m => (Object.hasOwn(m.flows, rec.id)
      ? updateFlow(m, rec.id, { steps: [...onScreen(m), step] })
      : putFlow(m, { id: rec.id, name: rec.name, view, steps: [step] })))
    if (saved) onChange({ id: rec.id, name: rec.name })
  }
  return (
    <Panel onClose={onClose}>
      {flow
        ? <form className="form" onSubmit={e => e.preventDefault()}><Section icon={Route} title="Flow" /><Field label="Flow" value={flow.name} onSave={name => run(m => updateFlow(m, rec.id, { name }))} /></form>
        : <h2 className="iconhead"><span className="badge"><Route size={14} /></span>{rec.name}</h2>}
      <ol className="steps form">
        {steps.map((s, i) => (
          <li key={i}>
            <Field label={ends(s.from, s.to)} value={s.text} onSave={text => change(all => all.with(i, { ...all[i], text }))} />
            <details className="more" open={Boolean(s.description) || undefined}>
              <summary>More</summary>
              {/* An empty field removes the detail, so the step's file stays as short as it can be. */}
              <Field label="More (Markdown)" value={String(s.description ?? '')} multiline onSave={description => change(all => all.with(i, withDescription(all[i], description)))} />
            </details>
            <StepAnimation
              step={s} takers={Object.entries(model.objects).map(([id, o]) => ({ id, type: o.type, name: o.name || id, end: id === s.from || id === s.to }))}
              onSet={(key, value) => run(m => {
                const now = stepsIn(m)[i]
                onScreen(m)
                return setStepAnimation(m, rec.id, i, animationWith(now.animation, key, value))
              })}
            />
            <StepStructure
              step={s} self={rec.id} groups={groups} others={others}
              onGroup={group => edit(m => setStepGroup(m, rec.id, i, group))}
              onLane={lane => change(all => all.with(i, withKey(all[i], 'lane', lane)))}
              onFlow={target => change(all => all.with(i, withKey(all[i], 'flow', target)))}
            />
            <StepStates model={model} step={s} onPick={(shape, state) => edit(m => pickStepState(m, rec.id, i, shape, state))} />
            <div className="step-buttons">
              <button aria-label="Move up" disabled={i === 0} onClick={() => void change(all => all.with(i - 1, all[i]).with(i, all[i - 1]))}><ArrowUp size={16} /></button>
              <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => void change(all => all.with(i + 1, all[i]).with(i, all[i + 1]))}><ArrowDown size={16} /></button>
              <button className="danger" aria-label="Delete step" onClick={() => void edit(m => removeStep(m, rec.id, i))}><Trash size={16} /></button>
            </div>
          </li>
        ))}
      </ol>
      {rec.from && rec.to ? (
        <form className="form" onSubmit={addStep}>
          <label>
            {ends(rec.from, rec.to)}
            <input name="text" autoFocus placeholder="What happens? Press Enter" onKeyDown={e => e.key === 'Escape' && onChange({ id: rec.id, name: rec.name })} />
          </label>
        </form>
      ) : (
        <p className="muted card">{rec.from ? `From ${nameOf(model, rec.from)}. Click where it goes, or the same shape if it acts alone.` : 'Click the shape where the next step starts.'}</p>
      )}
      {flow && <GroupsSection flowId={rec.id} steps={steps} groups={groups} edit={edit} />}
      <div className="panel-buttons">
        {flow && <button className="danger" onClick={() => void run(m => deleteFlow(m, rec.id)).then(saved => saved && onClose())}><Trash size={16} />Delete flow</button>}
        <button className="primary" onClick={onClose}><Check size={16} />Done</button>
      </div>
    </Panel>
  )
}
