import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL_KINDS, DEFAULT_END, isChannelKind } from '../../src/core/animation.ts'
import { CHANNEL_LABELS, channelProblems, channelsAt, closableAt, kindsOf, usesChannels } from '../../src/core/channels.ts'
import { modelOf } from '../../src/core/state.ts'
import { stopBefore, stopsOf } from '../../src/core/structure.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The case with a flow for every rule (open, close, open again, unnamed, a branch lane, a parallel stop, a repeat, every mistake), then the demo and the showcase. Only flows that open or close a channel are dumped. */
const FOLDERS = ['desktop/fixtures/cases/channels/flowy', 'docs/demo/flowy', 'docs/showcase/flowy']

/** Values `isChannelKind` is asked about: the three words, and what a file could hold instead. */
const KIND_WORDS: unknown[] = ['stream', 'listener', 'job', 'Stream', 'pipe', '', ' stream', 3, null, ['stream']]

/**
 * The words of the three kinds, where each points by default, and for every flow that opens or closes a channel: its problems, the channels open at every
 * stop (with whether each is opening or closing), the kinds on screen at every stop, which stop each stop follows, and what a `k` that is no stop gives.
 * The C# tests (ChannelsTests) compare their own with this.
 */
export async function dumpChannels(): Promise<unknown> {
  const folders = []
  for (const folder of FOLDERS) {
    const state = await loadState(join(root, folder))
    if ('parseError' in state) throw new Error(`${folder} can't be read`)
    const model = modelOf(state)
    const flows = Object.entries(model.flows).filter(([, flow]) => usesChannels(flow)).map(([id, flow]) => {
      const stops = stopsOf(flow)
      const at = stops.map((_, k) => channelsAt(flow, stops, k))
      return {
        id,
        problems: channelProblems(flow, stops),
        at,
        kinds: at.map(channels => kindsOf(channels)),
        closable: flow.steps.map((_, i) => closableAt(flow, stops, i)),
        before: stops.map((_, k) => stopBefore(stops, k) ?? null),
        outside: [-1, stops.length, stops.length + 5].map(k => ({ k, channels: channelsAt(flow, stops, k) })),
      }
    })
    folders.push({ folder, flows })
  }
  return {
    kinds: [...CHANNEL_KINDS],
    labels: CHANNEL_KINDS.map(k => CHANNEL_LABELS[k]),
    defaultEnd: CHANNEL_KINDS.map(k => DEFAULT_END[k]),
    isKind: KIND_WORDS.map(value => ({ value, is: isChannelKind(value) })),
    folders,
  }
}
