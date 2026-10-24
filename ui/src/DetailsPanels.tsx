import type { Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { StateMark } from '../../src/core/states.ts'
import type { Outline } from '../../src/core/outline.ts'
import type { SaveEdit } from './forms.tsx'
import { PickedBar } from './PickedBar.tsx'
import { AddPanel, LinePanel, ObjectPanel, OverviewPanel } from './Panel.tsx'
import type { Delete } from './Panel.tsx'
import { Recorder } from './Recorder.tsx'
import type { FlowSide, Side } from './side.ts'
import { UsedBy } from './UsedBy.tsx'

/**
 * What the right-hand side and the foot of the canvas hold for the picked shapes, line or flow: Details, the Used by panel of a delete, the bar of several shapes, Add and the
 * recorder. `open` is whether the Details side is out.
 */
export function DetailsPanels({ model, view, side, open, comparing, editing, recording, problems, codeBase, run, stateMarks, totals, setSide, onClose, onDelete, onRemove, onFlag, announce, onHover, onOpenFlow }: {
  model: Model; view: string; side: Side | undefined; open: boolean; comparing: boolean; editing: boolean; recording: FlowSide | undefined; problems: Problem[]; codeBase: string | undefined
  run: SaveEdit; stateMarks: Record<string, StateMark>; totals: Outline['totals']; setSide: (side: Side | undefined) => void; onClose: () => void; onDelete: Delete; onRemove: () => void
  onFlag: (ids: string[]) => void; announce: (text: string) => void; onHover: (id: string | undefined) => void; onOpenFlow: (id: string) => void
}) {
  return (
    <>
      {open && (side?.kind === 'object' || (side === undefined && view !== ROOT && !comparing)) && (
        <ObjectPanel model={model} id={side?.kind === 'object' ? side.id : view} editing={editing} problems={problems} codeBase={codeBase} run={run} onClose={onClose} onDelete={onDelete} state={side?.kind === 'object' && Object.hasOwn(stateMarks, side.id) ? stateMarks[side.id] : undefined}
          onPick={id => setSide({ kind: 'object', id })} onHover={onHover} />
      )}
      {open && side === undefined && view === ROOT && !comparing && <OverviewPanel model={model} totals={totals} editing={editing} run={run} onClose={onClose} />}
      {open && side?.kind === 'line' && (
        <LinePanel model={model} view={side.view ?? view} from={side.from} to={side.to} editing={editing} problems={problems} run={run} onClose={onClose} onDelete={onDelete} />
      )}
      {editing && side?.kind === 'usedby' && (
        <UsedBy model={model} targets={side.targets} run={run} onFlag={onFlag}
          onDone={text => {
            announce(text)
            setSide(undefined)
          }}
          onCancel={() => setSide(side.back)} />
      )}
      {editing && side?.kind === 'objects' && <PickedBar count={side.ids.length} onDelete={onRemove} onClear={onClose} />}
      {open && editing && side?.kind === 'add' && (
        <AddPanel model={model} view={view} run={run} onAdded={id => setSide({ kind: 'object', id })} onClose={onClose} />
      )}
      {open && recording && (
        <Recorder model={model} view={view} rec={recording} onChange={rec => setSide({ kind: 'flow', ...rec })} onOpenFlow={onOpenFlow} run={run} onClose={onClose} />
      )}
    </>
  )
}
