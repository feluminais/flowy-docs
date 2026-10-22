import type { FlowDiff } from '../../src/core/flowdiff.ts'
import { CHANGE_NAMES, keyItems } from './compare.ts'
import { KeyItem, KeyRow } from './legend.tsx'

/**
 * What the change marks on the two panes mean: a swatch for each kind that is on screen, drawn as the outline it marks a shape with (the same data-change rules in style.css
 * give both their colour and dash), and its name. Flows with nothing in common have no marks, so the key says that instead; two flows that match step for step say there is nothing to mark.
 */
export function CompareKey({ diff }: { diff: FlowDiff }) {
  const { items, related } = keyItems(diff)
  return (
    <KeyRow>
      {items.map(kind => <KeyItem key={kind} swatch={<svg className="sw change" data-change={kind} width="24" height="14" viewBox="0 0 24 14"><rect x="1.5" y="1.5" width="21" height="11" rx="4" /></svg>}>{CHANGE_NAMES[kind]}</KeyItem>)}
      {!related && <li>Nothing in common</li>}
      {related && items.length === 0 && <li>No changes</li>}
    </KeyRow>
  )
}
