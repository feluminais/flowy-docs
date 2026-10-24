import { useState } from 'react'
import type { FormEvent } from 'react'
import { folderOf, FOLDER_RULE, folderPaths, getObject, isValidFolder, tagsOf } from '../../src/core/model.ts'
import type { Group, Model, Step } from '../../src/core/model.ts'
import { ANIMATION_KINDS, animationFields, animationWith, CHANNEL_KINDS, CHANNEL_SKETCHES, END_SKETCHES, KIND_SKETCHES, NAME_MAX, OUTCOME_SKETCHES, OUTCOMES, outcomeBlock, REASON_MAX } from '../../src/core/animation.ts'
import type { AnimationKey, ChannelKind } from '../../src/core/animation.ts'
import { CHANNEL_LABELS, closableAt } from '../../src/core/channels.ts'
import { compareOf } from '../../src/core/compare.ts'
import { deleteFlow, groupSteps, moveFlow, OpError, putFlow, putGroup, removeGroup, removeStep, setCompare, setFlowTags, setGroupKind, setStepAnimation, setStepGroup, swapSteps, updateFlow } from '../../src/core/ops.ts'
import type { StateName } from '../../src/core/states.ts'
import { declaredGroups, hasLanes, stopsOf, takesOption } from '../../src/core/structure.ts'
import { flowList } from '../../src/core/outline.ts'
import { nameOf } from '../../src/core/views.ts'
import { flowTile, partnerChoices, removeNeedsConfirm, taggedBy, tagWith } from './compare.ts'
import { newId, pickStepState, stateOf, stepStateShapes, withKey } from './edit.ts'
import { Dropdown } from './Dropdown.tsx'
import { Field, Panel } from './forms.tsx'
import type { Common, SaveEdit } from './forms.tsx'
import { Section, TypeTile } from './Chrome.tsx'
import { KindPicker, PartnerPicker, SketchPicker, StatePicker, TagPicker } from './Pickers.tsx'
import type { PartnerTile, Sketch } from './Pickers.tsx'
import { ArrowDown, ArrowUp, ArrowsSplit, Check, Columns, GitFork, Play, Plus, Repeat, Route, Text, Trash } from './icons.tsx'

/** The flow being recorded. While `id` is "", it still needs a name. `from` and `to` are the step being picked. */
export type Recording = { id: string; name: string; folder?: string; from?: string; to?: string }

/** The step with this detail, or with none when it's blank. */
function withDescription(step: Step, description: string): Step {
  const { description: _, ...rest } = step
  return description.trim() ? { ...rest, description } : rest
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
/** How a step travels and how its request ends, as sketches to pick from. A step on one shape does not travel, so nothing but None is open to it. */
const KIND_CHOICES: Sketch[] = [{ id: '', name: 'None', sketch: KIND_SKETCHES.none }, ...ANIMATION_KINDS.map(k => ({ id: k, name: cap(k), sketch: KIND_SKETCHES[k] }))]
const OPENS_CHOICES: Sketch[] = [{ id: '', name: 'Nothing', sketch: CHANNEL_SKETCHES.none }, ...CHANNEL_KINDS.map(k => ({ id: k, name: CHANNEL_LABELS[k], sketch: CHANNEL_SKETCHES[k] }))]
const TOWARDS_CHOICES: Sketch[] = [{ id: '', name: 'Usual end', sketch: END_SKETCHES.none }, { id: 'from', name: 'From', sketch: END_SKETCHES.from }, { id: 'to', name: 'To', sketch: END_SKETCHES.to }]
const OUTCOME_CHOICES: Sketch[] = [{ id: '', name: 'Arrives', sketch: OUTCOME_SKETCHES.none }, ...OUTCOMES.map(o => ({ id: o, name: cap(o), sketch: OUTCOME_SKETCHES[o] }))]

/**
 * How a step plays: the way it travels, the way its request ends, and what goes with an outcome (a share of the requests, a reason, and for an interception
 * who takes it). Each pick or field is one edit. What the step cannot have is greyed out with the reason in its tooltip, so the form never changes shape.
 */
function StepAnimation({ step, takers, closable, onSet }: {
  step: Step; takers: { id: string; type: string; name: string; end: boolean }[]; closable: { name: string; kind: ChannelKind }[]; onSet: (key: AnimationKey, value: string) => Promise<boolean>
}) {
  const { kind, outcome, share, reason, by: taken, byName: named, opens, name, towards, closes } = animationFields(step)
  const travels = typeof step.to === 'string' && step.to !== '' && step.to !== step.from
  const kinds = KIND_CHOICES.map(c => ({ ...c, block: c.id !== '' && !travels ? 'Needs two shapes' : undefined }))
  const ended = outcome !== ''
  // A request that arrives is what leaves a channel open or closes one, so an outcome and a channel exclude each other, each greyed out with why.
  const channelled = opens !== '' || closes !== ''
  const outcomes = OUTCOME_CHOICES.map(c => ({ ...c, block: outcomeBlock(kind, c.id) ?? (c.id !== '' && channelled ? 'Not while it opens or closes something' : undefined) }))
  const leaves = OPENS_CHOICES.map(c => ({ ...c, block: c.id === '' ? undefined : !travels ? 'Needs two shapes' : kind === '' ? 'Pick how it travels first' : ended ? 'Not while it ends as something else' : closes !== '' ? 'Not while it closes something' : undefined }))
  const points = TOWARDS_CHOICES.map(c => ({ ...c, block: opens === '' ? 'Pick what it leaves open first' : undefined }))
  const closing: Sketch[] = [
    { id: '', name: 'Nothing', sketch: CHANNEL_SKETCHES.none },
    ...closable.map(c => ({ id: c.name, name: c.name, sketch: CHANNEL_SKETCHES[c.kind], block: !travels ? 'Needs two shapes' : kind === '' ? 'Pick how it travels first' : ended ? 'Not while it ends as something else' : opens !== '' ? 'Not while it leaves something open' : undefined })),
    ...(closes !== '' && !closable.some(c => c.name === closes) ? [{ id: closes, name: `${closes} · not open`, sketch: CHANNEL_SKETCHES.none }] : []),
  ]
  const intercepted = outcome === 'intercepted'
  const off = (why: string, on: boolean) => (on ? undefined : why)
  return (
    <details className="more" open={kind !== '' || undefined}>
      <summary>Animation</summary>
      <div className="form">
        <SketchPicker label="Travels as" choices={kinds} value={kind} onPick={id => void onSet('kind', id)} />
        <SketchPicker label="Ends as" choices={outcomes} value={outcome} onPick={id => void onSet('outcome', id)} />
        <Field label="Share of requests (1 to 100)" value={share} placeholder="e.g. 30" disabled={!ended} title={off('Pick an outcome first', ended)} onSave={v => onSet('share', v)} />
        <Field label={`Reason (${REASON_MAX} characters)`} value={reason} placeholder="e.g. Rate limit" disabled={!ended} title={off('Pick an outcome first', ended)} onSave={v => onSet('reason', v)} />
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
        <SketchPicker label="Leaves open" choices={leaves} value={opens} onPick={id => void onSet('opens', id)} />
        <Field label={`Name (${NAME_MAX} characters)`} value={name} placeholder="e.g. Orders" disabled={opens === ''} title={off('Pick what it leaves open first', opens !== '')} onSave={v => onSet('name', v)} />
        <SketchPicker label="Points at" choices={points} value={towards} onPick={id => void onSet('towards', id)} />
        <SketchPicker label="Closes" choices={closing} value={closes} onPick={id => void onSet('closes', id)} />
      </div>
    </details>
  )
}

const KIND_NAMES: Record<string, string> = { repeat: 'Repeat', branch: 'Branch', parallel: 'Parallel' }
const KIND_ICONS: Record<string, typeof Repeat> = { repeat: Repeat, branch: GitFork, parallel: ArrowsSplit }
const KINDS = Object.entries(KIND_NAMES).map(([id, name]) => ({ id, name, Icon: KIND_ICONS[id] }))
/** A value of a table by a key from a file: only the table's own keys count, so a kind called "constructor" is not on it. */
const own = <T,>(table: Record<string, T>, key: unknown): T | undefined => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined)

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
          <Dropdown value={gid} onChange={v => void onGroup(v)} options={[
            ['', 'None'],
            ...ids.map((g): [string, string] => [g, `${g} · ${own(KIND_NAMES, groups[g]?.kind) ?? 'no kind'}`]),
            ...(gid !== '' && !ids.includes(gid) ? [[gid, `${gid} · not declared`] as [string, string]] : []),
          ]} />
        </label>
        {hasLanes(groups[gid]?.kind) && <Field label="Lane (a new lane starts here)" value={String(step.lane ?? '')} placeholder="e.g. The card is declined" onSave={onLane} />}
        <label>
          Opens flow
          <Dropdown value={target} onChange={v => void onFlow(v)} options={[
            ['', 'None'],
            ...others.map(([id, name]): [string, string] => [id, name || id]),
            ...(target !== '' && !others.some(([id]) => id === target) ? [[target, target === self ? 'This flow' : `${target} · no such flow`] as [string, string]] : []),
          ]} />
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
function GroupsSection({ flowId, steps, groups, edit }: { flowId: string; steps: Step[]; groups: Record<string, Group>; edit: SaveEdit }) {
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
    <Dropdown name={name} defaultValue={String(steps.length - 1)} options={steps.map((_, i) => [String(i), String(i + 1)])} />
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
                {takesOption(g.kind, 'times') && (
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

/**
 * Which flow this one is compared with, and the flows that compare with it. A pick or a removal is one edit, so undo and the history take it like any other, and the note
 * of the link stays when the partner changes. `off` greys the section out with its reason while the flow has no file yet.
 */
function CompareSection({ model, flowId, run, off, onOpen }: { model: Model; flowId: string; run: SaveEdit; off?: string; onOpen: (id: string) => void }) {
  const tag = off === undefined && Object.hasOwn(model.flows, flowId) ? compareOf(model.flows[flowId].compare) : undefined
  const partner: PartnerTile | undefined = tag && (tag.with !== flowId && Object.hasOwn(model.flows, tag.with) ? flowTile(model, tag.with) : { id: tag.with, name: tag.with, view: '', missing: true })
  return (
    <>
      <Section icon={Columns} title="Compare with" />
      <PartnerPicker partner={partner} choices={partnerChoices(model, flowId)} comparedBy={off === undefined ? taggedBy(model, flowId) : []} hasNote={removeNeedsConfirm(tag)} off={off}
        onPick={id => void run(m => setCompare(m, flowId, tagWith(m, flowId, id)))}
        onRemove={() => void run(m => setCompare(m, flowId, undefined))}
        onOpen={onOpen} />
    </>
  )
}

/** The folders flows are in, for a field to suggest from. */
function FolderList({ model }: { model: Model }) {
  return <datalist id="flow-folders">{folderPaths(model).map(f => <option key={f} value={f} />)}</datalist>
}

/** The step list beside the canvas while recording a flow: click two boxes, type what happens, press Enter. */
export function Recorder({ model, view, rec, onChange, onOpenFlow, run, onClose }: Common & { view: string; rec: Recording; onChange: (rec: Recording) => void; onOpenFlow: (id: string) => void }) {
  if (!rec.id) return (
    <Panel onClose={onClose}>
      <h2 className="iconhead"><span className="badge"><Route size={14} /></span>New flow</h2>
      <form className="form" onSubmit={e => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        const name = String(data.get('name')).trim()
        const folder = String(data.get('folder')).replaceAll('\\', '/').split('/').map(n => n.trim()).filter(n => n !== '').join('/')
        if (!isValidFolder(folder)) {
          // The folder is first used when the first step is saved, so a name that can't be one is said now, on the field, while it can still be fixed.
          const field = form.elements.namedItem('folder') as HTMLInputElement
          field.setCustomValidity(`Not a folder Flowy can use: ${FOLDER_RULE}`)
          field.reportValidity()
          return
        }
        if (name) onChange({ id: newId(name, Object.keys(model.flows), 'flow'), name, ...(folder === '' ? {} : { folder }) })
      }}>
        <label>Name<input name="name" autoFocus placeholder="e.g. Customer checks out" /></label>
        <label>Folder<input name="folder" list="flow-folders" placeholder="e.g. payments/refunds" onInput={e => e.currentTarget.setCustomValidity('')} /></label>
        <FolderList model={model} />
        <button className="primary"><Play size={16} />Start recording</button>
      </form>
      <CompareSection model={model} flowId="" run={run} off="Name the flow first" onOpen={onOpenFlow} />
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
  const edit: SaveEdit = op => run(m => { onScreen(m); return op(m) })
  const groups = declaredGroups(flow)
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
      : putFlow(m, { id: rec.id, name: rec.name, view, steps: [step], ...(rec.folder === undefined ? {} : { folder: rec.folder }) })))
    if (saved) onChange({ id: rec.id, name: rec.name, ...(rec.folder === undefined ? {} : { folder: rec.folder }) })
  }
  return (
    <Panel onClose={onClose}>
      {flow
        ? (
          <form className="form" onSubmit={e => e.preventDefault()}>
            <Section icon={Route} title="Flow" />
            <Field label="Flow" value={flow.name} onSave={name => run(m => updateFlow(m, rec.id, { name }))} />
            <Field label="Folder" value={folderOf(model, rec.id)} list="flow-folders" placeholder="e.g. payments/refunds" onSave={folder => run(m => moveFlow(m, rec.id, folder))} />
            <FolderList model={model} />
            <TagPicker tags={tagsOf(flow)} used={flowList(model, { editing: true }).tags.map(t => t.tag)} onSet={tags => run(m => setFlowTags(m, rec.id, tags))} />
          </form>
        )
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
              closable={flow ? closableAt(flow, stopsOf(flow), i) : []}
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
              <button aria-label="Move up" disabled={i === 0} onClick={() => void edit(m => swapSteps(m, rec.id, i, i - 1))}><ArrowUp size={16} /></button>
              <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => void edit(m => swapSteps(m, rec.id, i, i + 1))}><ArrowDown size={16} /></button>
              <button className="danger" aria-label="Delete step" onClick={() => void edit(m => removeStep(m, rec.id, i))}><Trash size={16} /></button>
            </div>
          </li>
        ))}
      </ol>
      {rec.from && rec.to ? (
        <form className="form" onSubmit={addStep}>
          <label>
            {ends(rec.from, rec.to)}
            <input name="text" autoFocus placeholder="What happens? Press Enter" onKeyDown={e => e.key === 'Escape' && onChange({ id: rec.id, name: rec.name, ...(rec.folder === undefined ? {} : { folder: rec.folder }) })} />
          </label>
        </form>
      ) : (
        <p className="muted card">{rec.from ? `From ${nameOf(model, rec.from)}. Click where it goes, or the same shape if it acts alone.` : 'Click the shape where the next step starts.'}</p>
      )}
      {flow && <GroupsSection flowId={rec.id} steps={steps} groups={groups} edit={edit} />}
      <CompareSection key={rec.id} model={model} flowId={rec.id} run={run} off={flow ? undefined : 'Record a step first'} onOpen={onOpenFlow} />
      <div className="panel-buttons">
        {flow && <button className="danger" onClick={() => void run(m => deleteFlow(m, rec.id)).then(saved => saved && onClose())}><Trash size={16} />Delete flow</button>}
        <button className="primary" onClick={onClose}><Check size={16} />Done</button>
      </div>
    </Panel>
  )
}
