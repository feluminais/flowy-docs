import type { Model } from '../../src/core/model.ts'
import type { Carried, CodeBlock as Block, Shown } from '../../src/core/payloads.ts'
import { Description } from './Box.tsx'
import { CodeBlock, CopyButton, languageFor } from './Code.tsx'
import { ArrowLeft, ArrowRight } from './icons.tsx'

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
