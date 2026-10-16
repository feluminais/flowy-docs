import type { ReactNode } from 'react'
import type { Problem } from '../../src/core/check.ts'
import { getObject } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { Description } from './Box.tsx'
import { connectionsOf, nameOf, problemsOf } from './edit.ts'

function Panel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside className="panel">
      <button className="close" aria-label="Close" onClick={onClose}>×</button>
      {children}
    </aside>
  )
}

function ProblemList({ problems }: { problems: Problem[] }) {
  return problems.length === 0 ? null : <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
}

type Common = { model: Model; problems: Problem[]; onClose: () => void }

/** An object's name, type and full description, with its problems. */
export function ObjectPanel({ model, id, problems, onClose }: Common & { id: string }) {
  const object = getObject(model, id)
  if (!object) return null
  return (
    <Panel onClose={onClose}>
      <h2>{object.name || id}</h2>
      <p className="muted">{object.type}{object.tech ? ` · ${object.tech}` : ''}</p>
      <ProblemList problems={problemsOf(model, problems, id)} />
      {object.description ? <Description text={object.description} /> : <p className="muted">No description yet.</p>}
    </Panel>
  )
}

/** The connections one line stands for (a zoomed-out line can merge several), each with its label. */
export function LinePanel({ model, view, from, to, problems, onClose }: Common & { view: string; from: string; to: string }) {
  const lines = connectionsOf(model, view, from, to)
  if (lines.length === 0) return null
  return (
    <Panel onClose={onClose}>
      <h2>{nameOf(model, from)} → {nameOf(model, to)}</h2>
      {lines.map(({ index, connection: c }) => (
        <section key={index} className="line">
          {(c.from !== from || c.to !== to) && <p className="muted">{nameOf(model, c.from)} → {nameOf(model, c.to)}</p>}
          <p>{c.label || <span className="muted">No label</span>}</p>
          <ProblemList problems={problems.filter(p => p.connection === index)} />
        </section>
      ))}
    </Panel>
  )
}
