import { useState } from 'react'
import type { Connection, Model, Step } from '../../src/core/model.ts'
import { deletePayload, putPayload } from '../../src/core/ops.ts'
import type { PayloadInput } from '../../src/core/ops.ts'
import { payloadsOf, REPLY_KINDS } from '../../src/core/payloads.ts'
import { animationOf } from '../../src/core/animation.ts'
import { PayloadPicker } from './Pickers.tsx'
import type { Carried, CodeBlock as Block, Shown } from '../../src/core/payloads.ts'
import { isBlankCode } from '../../src/core/snippets.ts'
import { isMap } from '../../src/core/text.ts'
import { Description } from './Box.tsx'
import { CodeBlock, CopyButton, LanguagePicker, languageFor } from './Code.tsx'
import { Field } from './forms.tsx'
import type { SaveEdit } from './forms.tsx'
import { ArrowLeft, ArrowRight, Plus, Trash } from './icons.tsx'

/** One of a payload's code blocks: what it is (Shape or Example), the language it is shown in, a button that copies it, and the code at a capped height. */
function BlockView({ title, block }: { title: 'Shape' | 'Example'; block: Block }) {
  const { language } = languageFor(block)
  return (
    <figure className="code-snippet">
      <figcaption>
        <span className="code-title">{title}</span>
        {language && <span className="code-lang">{language.name}</span>}
        <CopyButton text={block.text} />
      </figcaption>
      <CodeBlock text={block.text} language={language?.id} label={title} />
    </figure>
  )
}

/**
 * One payload, as a row that folds out: the way it goes and its name; open, what it is about, then its shape and its example. `title` says where it comes from when
 * only flow steps send it.
 */
export function PayloadRow({ shown, back, open, title }: { shown: Shown; back?: boolean; open?: boolean; title?: string }) {
  const Arrow = back ? ArrowLeft : ArrowRight
  return (
    <details className="payload" open={open} title={title}>
      <summary><span className="dirn" aria-hidden="true"><Arrow size={14} /></span>{shown.name}{back && <span className="visually-hidden">, comes back</span>}</summary>
      <div className="payload-body">
        {shown.about && <Description text={shown.about} />}
        {shown.shape && <BlockView title="Shape" block={shown.shape} />}
        {shown.example && <BlockView title="Example" block={shown.example} />}
      </div>
    </details>
  )
}

/** Where a payload only flow steps send comes from, as the row's tooltip: "Customer places an order, step 2 reply; ...". */
export function fromSteps(model: Model, carried: Carried): string | undefined {
  if (carried.own || carried.steps.length === 0) return undefined
  return carried.steps.map(s => `${model.flows[s.flow]?.name || s.flow}, step ${s.step + 1}${s.reply ? ' reply' : ''}`).join('; ')
}

/** What a line carries, a row each; the first open when `firstOpen`. Nothing when it carries nothing. */
export function CarriedRows({ model, carried, firstOpen }: { model: Model; carried: Carried[]; firstOpen?: boolean }) {
  if (carried.length === 0) return null
  return (
    <div className="payloads">
      {carried.map((c, i) => <PayloadRow key={`${i}:${c.payload.id ?? c.payload.name}`} shown={c.payload} back={c.back} open={firstOpen && i === 0} title={fromSteps(model, c)} />)}
    </div>
  )
}

/** A shape or an example as a card: its language and its code, saved when you leave the box; Remove takes it off. Without one, a button adds it. */
function BlockField({ title, block, onSave }: { title: 'Shape' | 'Example'; block?: Block; onSave: (block: Block | null) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false)
  if (!block && !adding) {
    return <button type="button" onClick={() => setAdding(true)}><Plus size={16} />{title === 'Shape' ? 'Add a shape' : 'Add an example'}</button>
  }
  const shown: Block = block ?? { text: '' }
  const save = async (next: Block) => {
    if (isBlankCode(next.text)) return false
    const done = await onSave(next)
    if (done) setAdding(false)
    return done
  }
  return (
    <div className="card code-card">
      <LanguagePicker snippet={shown} onPick={language => void save({ ...shown, ...(language === '' ? { language: undefined } : { language }) })} />
      <label>
        {title}
        <textarea key={shown.text} className="code-edit" defaultValue={shown.text} rows={6} spellCheck={false} wrap="off"
          onBlur={e => { if (e.currentTarget.value !== shown.text) void save({ ...shown, text: e.currentTarget.value }) }} />
      </label>
      <button type="button" className="danger" onClick={() => (block ? void onSave(null) : setAdding(false))}><Trash size={16} />Remove</button>
    </div>
  )
}

/**
 * The edit form of one payload, folded away under its name: Name, About, Shape and Example, each saved when you leave it, and Delete. Delete takes it off the line
 * the form is under (`offLine`) and then out of the model; when another line or a step still names it, the refusal says which, and nothing is written.
 */
export function PayloadForm({ model, id, run, offLine }: { model: Model; id: string; run: SaveEdit; offLine: (m: Model) => Model }) {
  const [refused, setRefused] = useState<string>()
  const p = payloadsOf(model)[id]
  if (!p) return null
  const put = (fields: Omit<PayloadInput, 'id'>) => run(m => putPayload(m, { id, ...fields }))
  const block = (v: unknown): Block | undefined => (isMap(v) && typeof v.text === 'string' ? { text: v.text, ...(typeof v.language === 'string' ? { language: v.language } : {}) } : undefined)
  const remove = () => {
    try {
      deletePayload(offLine(model), id)
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e))
      return
    }
    void run(m => deletePayload(offLine(m), id))
  }
  return (
    <details className="payload payload-form">
      <summary>{typeof p.name === 'string' && p.name !== '' ? p.name : id}</summary>
      <div className="form payload-body">
        <Field label="Name" value={typeof p.name === 'string' ? p.name : ''} onSave={name => put({ name })} />
        <Field label="About (Markdown)" value={typeof p.about === 'string' ? p.about : ''} multiline onSave={about => put({ about })} />
        <BlockField title="Shape" block={block(p.shape)} onSave={shape => put({ shape: shape === null ? null : { text: shape.text, ...(shape.language ? { language: shape.language } : {}) } })} />
        <BlockField title="Example" block={block(p.example)} onSave={example => put({ example: example === null ? null : { text: example.text, ...(example.language ? { language: example.language } : {}) } })} />
        <button type="button" className="danger" onClick={remove}><Trash size={16} />Delete payload</button>
        {refused && <p className="refused" role="alert">{refused}</p>}
      </div>
    </details>
  )
}

/** A payload made from a name in the picker, not saved until it says something: the first About saved makes it and puts it on the line. */
export function NewPayload({ name, onSave }: { name: string; onSave: (about: string) => Promise<boolean> }) {
  return (
    <div className="card payload-new">
      <p><strong>{name}</strong></p>
      <Field label="About (Markdown)" value="" multiline onSave={onSave} />
    </div>
  )
}

/** Every payload of the model as the pickers list them: its id and the name a reader knows it by. */
export const payloadChoices = (model: Model): { id: string; name: string }[] =>
  Object.entries(payloadsOf(model)).map(([id, p]) => ({ id, name: typeof p.name === 'string' && p.name.trim() !== '' ? p.name : id }))

/** The ids a connection or a step names, without the payloads written in place. */
export const idsOf = (list: unknown): string[] => (Array.isArray(list) ? list.filter((r): r is string => typeof r === 'string') : typeof list === 'string' ? [list] : [])

/** What a step sends and gets back, as two pickers: the payloads its line carries first, then the rest. A reply is greyed out on a step that gets no answer. */
export function StepPayloads({ model, step, onSet }: { model: Model; step: Step; onSet: (key: 'payload' | 'reply', value: string | undefined) => void }) {
  const onLine = new Set(model.connections.filter((c: Connection) => (c.from === step.from && c.to === step.to) || (c.from === step.to && c.to === step.from)).flatMap(c => idsOf(c.payloads)))
  const all = payloadChoices(model)
  const choices = [...all.filter(p => onLine.has(p.id)), ...all.filter(p => !onLine.has(p.id))]
  if (choices.length === 0) return null
  const answers = REPLY_KINDS.some(k => k === animationOf(step)?.kind)
  return (
    <>
      <PayloadPicker label="Payload" all={choices} chosen={idsOf(step.payload)} many={false} off={step.to === undefined && animationOf(step)?.kind !== 'recurse' ? 'A payload needs a step that goes to another shape' : undefined}
        onSet={next => onSet('payload', next[0])} />
      <PayloadPicker label="Reply" all={choices} chosen={idsOf(step.reply)} many={false} off={answers ? undefined : 'A reply needs a call, a callback or a recurse'}
        onSet={next => onSet('reply', next[0])} />
    </>
  )
}
