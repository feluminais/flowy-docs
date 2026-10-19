import { useEffect } from 'react'
import { revealOf } from '../../src/core/host.ts'
import type { Target } from '../../src/core/host.ts'
import { vscode } from './host.ts'

const listeners = new Set<(target: Target) => void>()
/** What the host asked to show before anything was listening: the page is still loading its model. Only the newest matters. */
let waiting: Target | undefined

// The host may ask to show something the moment the page opens, before the canvas has a model to show it in.
// This listener starts with the page, so nothing asked in that gap is lost.
if (vscode) {
  window.addEventListener('message', e => {
    const target = revealOf(e.data)
    if (!target) return
    if (listeners.size === 0) waiting = target
    else listeners.forEach(listener => listener(target))
  })
}

/**
 * Calls `onReveal` when the host (VS Code) asks the page to show a shape or a flow, and once for what was asked
 * while nothing listened. Added again on every render, like the keys in App, so it always sees the current model.
 */
export function useReveal(onReveal: (target: Target) => void): void {
  useEffect(() => {
    listeners.add(onReveal)
    const early = waiting
    waiting = undefined
    if (early) onReveal(early)
    return () => void listeners.delete(onReveal)
  })
}
