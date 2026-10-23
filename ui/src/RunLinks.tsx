import type { Model } from '../../src/core/model.ts'
import { compareOf } from '../../src/core/compare.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { Section } from './Chrome.tsx'
import { ComparePicker } from './ComparePicker.tsx'
import { linkedRuns } from './compare.ts'
import { Link } from './icons.tsx'

/**
 * The Performance tab while editing: each run with Link with and Unlink, which write the `compare` field of its file (the only thing Flowy writes into a run). The numbers and the
 * canvas wait for editing to end, as the tab's own panel does, so only the links are here. Both buttons are greyed out with the reason as their tooltip when the page can't save.
 */
export function RunLinks({ model, runs, linkOff, picking, onPicking, onLink }: {
  model: Model
  runs: Record<string, Run>
  /** Why a link can't be written or taken away (the page can't save), or undefined. */
  linkOff: string | undefined
  /** The run whose Link with picker is open, if one is. */
  picking: string | undefined
  onPicking: (id: string | undefined) => void
  /** Link a run to another, or take its link away (`other` undefined). */
  onLink: (id: string, other: string | undefined) => void
}) {
  const ids = Object.keys(runs)
  const linked = linkedRuns(runs)
  return (
    <div className="perf">
      <Section icon={Link} title="Runs" count={ids.length} />
      {ids.length === 0 && <p className="muted">No runs yet.</p>}
      {ids.map(id => {
        // Unlink takes away the line this run holds. A run that only others link to has none: the line to remove is on the other run.
        const holds = compareOf(runs[id].compare) !== undefined
        const unlinkOff = linkOff ?? (holds ? undefined : linked.has(id) ? 'The other run holds the link' : 'Not linked')
        const toggle = `data-link-run-${id}`
        return (
          <div key={id} className="run-link">
            <div className="run-link-name">
              <span>{runs[id].name}</span>
              {linked.has(id) && <span className="linked"><Link size={13} />Linked</span>}
            </div>
            <div className="run-actions">
              <button {...{ [toggle]: '' }} aria-pressed={picking === id} disabled={linkOff !== undefined} title={linkOff ?? 'Link this run with another'} onClick={() => onPicking(picking === id ? undefined : id)}><Link size={14} />Link with</button>
              <button disabled={unlinkOff !== undefined} title={unlinkOff ?? 'Take away the link'} onClick={() => onLink(id, undefined)}>Unlink</button>
              {picking === id && (
                <ComparePicker model={model} runs={runs} kind="run" id={id} label="Link with" toggle={toggle}
                  onPick={other => {
                    onPicking(undefined)
                    onLink(id, other)
                  }}
                  onClose={() => onPicking(undefined)} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
