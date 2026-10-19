import { useEffect, useRef, useState } from 'react'
import type { FocusEvent, FormEvent, ReactNode } from 'react'
import { encodePath, isRepoPath, isWebAddress, typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { ICON_GROUPS } from '../../src/core/icons.ts'
import { COLOR_NAMES, colorPair, customIcons, fillOpacity, iconData, isColorName, SHAPES, shapeOf } from '../../src/core/look.ts'
import type { Shape } from '../../src/core/look.ts'
import { getObject, isExternal, linksOf, ROOT } from '../../src/core/model.ts'
import type { Connection, FlowyObject, Link, Model, ObjectType, Step } from '../../src/core/model.ts'
import { deleteFlow, deleteObject, OpError, putFlow, putObject, relabel, removeConnection, updateFlow } from '../../src/core/ops.ts'
import type { ObjectInput } from '../../src/core/ops.ts'
import { nameOf, parentOf } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { connectionsOf, linesOf, newId, problemsOf } from './edit.ts'
import type { BoxLine } from './edit.ts'
import { lineId } from './graph.ts'
import { Chip, kindClass, lookVars, ObjectTile, Section, TypeTile } from './Chrome.tsx'
import { Alert, ArrowDown, ArrowLeft, ArrowUp, ArrowRight, Check, Cloud, Code, File, Folder, iconOf, Link as LinkIcon, Pencil, Play, Plus, Route, Sparkles, Text, Trash, Close } from './icons.tsx'

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

function ProblemList({ problems }: { problems: Problem[] }) {
  return problems.length === 0 ? null : (
    <div className="problem-box">
      <Alert size={16} />
      <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
    </div>
  )
}

/** The top of a shape's panel: its tile, its name, and chips for its type, its tech, whether it is outside, and what is wrong with it. Tinted in the shape's colour. */
function ObjectHeader({ model, id, object, problems }: { model: Model; id: string; object: FlowyObject; problems: number }) {
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
      </div>
    </header>
  )
}

/** A text field that saves when you leave it or press Enter, and shows the saved text again if saving fails. */
function Field({ label, value, multiline, list, placeholder, onSave }: { label: ReactNode; value: string; multiline?: boolean; list?: string; placeholder?: string; onSave: (value: string) => Promise<boolean> }) {
  const save = async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = e.currentTarget
    if (input.value !== value && !(await onSave(input.value))) input.value = value
  }
  // Keyed by the saved value, so the field shows the new text after every reload.
  return (
    <label>
      {label}
      {multiline
        ? <textarea key={value} defaultValue={value} rows={8} onBlur={save} />
        : <input key={value} defaultValue={value} list={list} placeholder={placeholder} onBlur={save} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />}
    </label>
  )
}

/**
 * A colour from the names, or any colour the browser's picker makes. The picker reports every move of the cursor as an input
 * event and only its closing as a change, so it is saved on the change.
 */
function ColorField({ color, onSave }: { color?: string; onSave: (color: string) => Promise<boolean> }) {
  const named = isColorName(color)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = picker.current
    const save = () => void onSave(el!.value)
    el?.addEventListener('change', save)
    return () => el?.removeEventListener('change', save)
  })
  return (
    <label>
      Color
      <span className="select-row">
        <select value={named ? color : color ? 'custom' : ''} onChange={e => e.target.value !== 'custom' && void onSave(e.target.value)}>
          <option value="">Default (the type's)</option>
          {COLOR_NAMES.map(c => <option key={c}>{c}</option>)}
          {color && !named && <option value="custom">{color}</option>}
        </select>
        <input key={color} ref={picker} type="color" defaultValue={colorPair(color)?.[0] ?? '#888888'} aria-label="Pick any colour" />
      </span>
    </label>
  )
}

type Common = { model: Model; run: Run; onClose: () => void }

/** The paths an object's `code` lists, as links when the repo is on GitHub or GitLab. Anything else in `code` is left to the problem list. */
function CodeList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const paths = Array.isArray(object.code) ? object.code.filter((p): p is string => typeof p === 'string') : []
  if (paths.length === 0) return null
  return (
    <>
      <Section icon={Code} title="Code" count={paths.length} />
      <ul className="code-list" aria-label="Code">
        {paths.map((p, i) => (
          <li key={i}>
            {p.endsWith('/') ? <Folder size={16} /> : <File size={16} />}
            {codeBase ? <a href={codeBase + encodePath(p)} target="_blank" rel="noreferrer"><code>{p}</code></a> : <code>{p}</code>}
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The links an object lists. A web address opens in a new tab. A path in the repo links to the repo host when the origin is
 * GitHub or GitLab, and is plain text otherwise; check() reports one that doesn't exist. Anything else in `links` is left to the problem list.
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
          const href = web ? l.url : codeBase && isRepoPath(l.url) ? codeBase + encodePath(l.url) : undefined
          const text = l.title || l.url
          return (
            <li key={i}>
              <LinkIcon size={16} />
              {href ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <span>{text}</span>}
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

/** An object's description, links, code and connections, or in edit mode a form for its name, type, tech, description, code and links. */
export function ObjectPanel({ model, id, editing, problems, codeBase, run, onClose, onPick, onHover }: Common & Lines & { id: string; editing: boolean; problems: Problem[]; codeBase?: string }) {
  const object = getObject(model, id)
  if (!object) return null
  const save = (fields: Omit<ObjectInput, 'id'>) => run(m => putObject(m, { id, ...fields }))
  const ours = problemsOf(model, problems, id)
  const mine = <ProblemList problems={ours} />
  const header = <ObjectHeader model={model} id={id} object={object} problems={ours.length} />
  if (!editing) return (
    <Panel onClose={onClose}>
      {header}
      {mine}
      <Section icon={Text} title="Description" />
      <div className="card">{object.description ? <Description text={object.description} /> : <p className="muted">No description yet.</p>}</div>
      <LinkList object={object} codeBase={codeBase} />
      <CodeList object={object} codeBase={codeBase} />
      <LineList model={model} id={id} onPick={onPick} onHover={onHover} />
    </Panel>
  )
  // A type the nesting rules don't allow here stays in the list, so the form shows what the file says.
  const types = [...new Set([...typesIn(model, parentOf(model, id)), object.type])].filter(Boolean)
  const iconNames = [...ICON_GROUPS.flatMap(g => g.names), ...Object.keys(customIcons(model.meta))]
  return (
    <Panel onClose={onClose}>
      {header}
      {mine}
      <form key={id} className="form" onSubmit={e => e.preventDefault()}>
        <Section icon={Pencil} title="Details" />
        <div className="card">
          <Field label="Name" value={object.name ?? ''} onSave={name => save({ name })} />
          <label>
            Type
            <span className="select-row">
              <TypeTile type={object.type} size={28} />
              <select value={object.type} onChange={e => void save({ type: e.target.value as ObjectType })}>
                {types.map(t => <option key={t}>{t}</option>)}
              </select>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={isExternal(object)} onChange={e => void save({ external: e.target.checked })} />
            Outside service (drawn grey)
          </label>
          <Field label="Tech" value={object.tech ?? ''} onSave={tech => save({ tech })} />
        </div>
        <Section icon={Sparkles} title="Look" />
        <div className="card">
          <label>
            Shape
            <select value={object.shape ?? ''} onChange={e => void save({ shape: e.target.value as Shape | '' })}>
              <option value="">Default ({shapeOf({ type: object.type })})</option>
              {SHAPES.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <ColorField color={object.color} onSave={color => save({ color })} />
          <Field label="Opacity of the colour, 0 to 100" value={object.opacity ?? ''} placeholder={String(fillOpacity(object))}
            onSave={text => save({ opacity: text.trim() === '' ? '' : Number(text) })} />
          <label>
            Icon
            <span className="select-row">
              <TypeTile type={object.type} external={isExternal(object)} size={28} d={iconData(model, object)} style={lookVars(object)} />
              <input key={object.icon ?? ''} list="flowy-icons" defaultValue={object.icon ?? ''} placeholder="Default (the type's)"
                onBlur={e => e.currentTarget.value !== (object.icon ?? '') && void save({ icon: e.currentTarget.value.trim() })}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
            </span>
            <datalist id="flowy-icons">{iconNames.map(n => <option key={n} value={n} />)}</datalist>
          </label>
        </div>
        <Section icon={Text} title="Description" />
        <Field label="Description" value={object.description ?? ''} multiline onSave={description => save({ description })} />
        <Section icon={Code} title="Code" />
        <Field label="Code (one path per line)" value={Array.isArray(object.code) ? object.code.join('\n') : ''} multiline
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
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const type = form.get('type') as ObjectType
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
        <label>
          Type
          <span className="select-row">
            <TypeTile type={chosen && types.includes(chosen as ObjectType) ? chosen : types[0] ?? ''} size={28} />
            <select name="type" onChange={e => choose(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select>
          </span>
        </label>
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
              <Field label="Detail a reader can open (markdown)" value={String(s.description ?? '')} multiline onSave={description => change(all => all.with(i, withDescription(all[i], description)))} />
            </details>
            <div className="step-buttons">
              <button aria-label="Move up" disabled={i === 0} onClick={() => void change(all => all.with(i - 1, all[i]).with(i, all[i - 1]))}><ArrowUp size={16} /></button>
              <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => void change(all => all.with(i + 1, all[i]).with(i, all[i + 1]))}><ArrowDown size={16} /></button>
              <button className="danger" aria-label="Delete step" onClick={() => void change(all => all.filter((_, j) => j !== i))}><Trash size={16} /></button>
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
        <p className="muted card">{rec.from ? `From ${nameOf(model, rec.from)}. Now click the shape it goes to, or the same shape for a step it does on its own.` : 'Click the shape where the next step starts.'}</p>
      )}
      <div className="panel-buttons">
        {flow && <button className="danger" onClick={() => void run(m => deleteFlow(m, rec.id)).then(saved => saved && onClose())}><Trash size={16} />Delete flow</button>}
        <button className="primary" onClick={onClose}><Check size={16} />Done</button>
      </div>
    </Panel>
  )
}
