import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { DataInput } from '../../src/core/data.ts'
import { lineKey } from '../../src/core/failures.ts'
import { getObject, isExternal, linksOf, projectAbout, projectName, ROOT } from '../../src/core/model.ts'
import { parseData } from '../../src/core/data.ts'
import type { Connection, FlowyObject, Group, Link, Model, ObjectType, Step } from '../../src/core/model.ts'
import { encodePath, isRepoPath, isWebAddress } from '../../src/core/paths.ts'
import { ANIMATION_KINDS, animationFields, animationWith, KIND_SKETCHES, NAME_MAX, OUTCOME_SKETCHES, OUTCOMES, outcomeBlock, REASON_MAX } from '../../src/core/animation.ts'
import type { AnimationKey } from '../../src/core/animation.ts'
import { deleteFlow, groupSteps, OpError, putFlow, putGroup, putObject, relabel, removeGroup, removeStep, setGroupKind, setProject, setStepAnimation, setStepGroup, updateFlow } from '../../src/core/ops.ts'
import type { ObjectInput } from '../../src/core/ops.ts'
import type { Target } from '../../src/core/dependents.ts'
import type { StateMark, StateName } from '../../src/core/states.ts'
import { declaredGroups, hasLanes, takesOption } from '../../src/core/structure.ts'
import { nameOf, parentOf } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { CodeFields, CodeSection } from './Code.tsx'
import { DataField, DataSection } from './Data.tsx'
import { connectionsOf, linesOf, newId, pickStepState, problemsOf, stateOf, stepStateShapes, withKey } from './edit.ts'
import type { BoxLine } from './edit.ts'
import { StateGlyph, stateClasses, stateWord } from './states.tsx'
import { Field, Panel } from './forms.tsx'
import type { Common, SaveEdit } from './forms.tsx'
import { openInEditor, vscode } from './host.ts'
import { Chip, kindClass, lookVars, ObjectTile, Section, TypeTile } from './Chrome.tsx'
import { ColorPicker, ExternalToggle, IconPicker, KindPicker, OpacityPicker, ShapePicker, SketchPicker, StatePicker, TypePicker } from './Pickers.tsx'
import type { Sketch } from './Pickers.tsx'
import { Alert, ArrowDown, ArrowLeft, ArrowUp, ArrowRight, ArrowsLeftRight, ArrowsSplit, Check, Cloud, Code, File, Folder, GitFork, iconOf, Link as LinkIcon, Pencil, Play, Plus, Repeat, Route, Sparkles, Table, Text, Trash, Close } from './icons.tsx'
import { CodeList, LinkList, linkLine, parseLinks, RepoPath } from './ObjectLinks.tsx'

/**
 * What Details shows at the top level when nothing is picked: the system's name and what it is (the
 * `name:` and `about:` of model.yaml), how much there is, and where to go next. In edit mode a form for the two.
 */
export function OverviewPanel({ model, totals, editing, run, onClose }: Common & { totals: { shapes: number; flows: number; problems: number }; editing: boolean }) {
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const [name, about] = [projectName(model), projectAbout(model)]
  return (
    <Panel onClose={onClose}>
      <h2>{name || 'Overview'}</h2>
      <p className="muted">{count(totals.shapes, 'shape')} · {count(totals.flows, 'flow')}{totals.problems > 0 && ` · ${count(totals.problems, 'problem')}`}</p>
      {about && !editing && <div className="prose"><Description text={about} /></div>}
      {editing ? (
        <form className="form" onSubmit={e => e.preventDefault()}>
          <Section icon={Pencil} title="Details" />
          <div className="card">
            <Field label="Name" value={name} onSave={value => run(m => setProject(m, { name: value }))} />
          </div>
          <Field label="About (Markdown)" value={about} multiline onSave={value => run(m => setProject(m, { about: value }))} />
        </form>
      ) : !about && <p className="muted">Click a shape.</p>}
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
    <li key={lineKey(line.from, line.to)} className="row" onMouseEnter={() => onHover(lineKey(line.from, line.to))} onMouseLeave={() => onHover(undefined)}>
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

/** How a panel deletes: the app looks at what depends on the targets, and either deletes at once or asks (see UsedBy). `then` runs once they are gone. */
export type Delete = (targets: Target[], then?: () => void) => void

/** An object's description, code, links, source and connections, or in edit mode a form for its name, type, tech, description, code, source and links. */
export function ObjectPanel({ model, id, editing, problems, codeBase, state, run, onClose, onPick, onHover, onDelete }: Common & Lines & { onDelete: Delete; id: string; editing: boolean; problems: Problem[]; codeBase?: string; state?: StateMark }) {
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
        <Field label="Description (Markdown)" value={object.description ?? ''} multiline onSave={description => save({ description })} />
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
      <button className="danger" onClick={() => onDelete([{ object: id }], onClose)}><Trash size={16} />Delete</button>
    </Panel>
  )
}

/**
 * The connections one line stands for (a zoomed-out line can merge several), each with its label. A view draws one line between two shapes,
 * so when connections run both ways they are listed under one heading per way.
 */
export function LinePanel({ model, view, from, to, editing, problems, run, onClose, onDelete }: Common & { onDelete: Delete; view: string; from: string; to: string; editing: boolean; problems: Problem[] }) {
  const lines = connectionsOf(model, view, from, to)
  if (lines.length === 0) return null
  const ahead = lines.filter(l => !l.back)
  const back = lines.filter(l => l.back)
  const both = ahead.length > 0 && back.length > 0
  const card = ({ index, connection: c }: (typeof lines)[number], a: string, b: string) => {
    const which = { from: c.from, to: c.to, label: c.label ?? '' }
    return (
      <section key={index} className="line card">
        {(c.from !== a || c.to !== b) && <p className="muted">{nameOf(model, c.from)} → {nameOf(model, c.to)}</p>}
        {editing ? (
          <form className="form" onSubmit={e => e.preventDefault()}>
            <Field label="Label" value={c.label ?? ''} onSave={label => run(m => relabel(m, which, label))} />
            <button type="button" className="danger" onClick={() => onDelete([{ line: which }])}><Trash size={16} />Delete</button>
          </form>
        ) : <p>{c.label || <span className="muted">No label</span>}</p>}
        <ProblemList problems={problems.filter(p => p.connection === index)} />
      </section>
    )
  }
  // A line whose connections all run against the way it was given reads the way they run.
  const [a, b] = ahead.length === 0 ? [to, from] : [from, to]
  return (
    <Panel onClose={onClose}>
      <header className="hero ends">
        {[a, b].flatMap((end, i) => {
          const o = getObject(model, end)
          const name = (
            <div key={end + i} className="end">
              <ObjectTile model={model} object={o} size={40} />
              <strong>{nameOf(model, end)}</strong>
            </div>
          )
          return i === 0 ? [name, both ? <ArrowsLeftRight key="arrow" size={22} /> : <ArrowRight key="arrow" size={22} />] : [name]
        })}
      </header>
      <h2 className="visually-hidden">{nameOf(model, a)} {both ? '↔' : '→'} {nameOf(model, b)}</h2>
      {both ? (
        <>
          <Section icon={ArrowRight} title={`${nameOf(model, from)} → ${nameOf(model, to)}`} count={ahead.length} />
          {ahead.map(l => card(l, from, to))}
          <Section icon={ArrowLeft} title={`${nameOf(model, to)} → ${nameOf(model, from)}`} count={back.length} />
          {back.map(l => card(l, to, from))}
        </>
      ) : (
        <>
          <Section icon={Route} title={lines.length === 1 ? 'Connection' : 'Connections'} count={lines.length} />
          {lines.map(l => card(l, a, b))}
        </>
      )}
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
      {types.length === 0 ? <p className="muted">Nothing can go inside {nameOf(model, view)}.</p> : (
        <form className="form" onSubmit={add}>
          <TypePicker types={types} value={type} onPick={choose} />
          <label>Name<input name="name" autoFocus /></label>
          <button className="primary"><Plus size={16} />Add</button>
        </form>
      )}
    </Panel>
  )
}
