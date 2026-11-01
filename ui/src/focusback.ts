import { useEffect, useRef } from 'react'

type Spot = Element | null | undefined

/** Whether focus is nowhere: the element that had it was removed, and the page falls back to its body. */
export const focusLost = (): boolean => {
  const at = document.activeElement
  return at === null || at === document.body || at === document.documentElement
}

/** Whether focus can land on this: still in the page, shown, and not disabled. */
export const usable = (el: Spot): el is HTMLElement =>
  el instanceof HTMLElement && el !== document.body && el.isConnected && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0

/** Focuses `el` if it can take it, without scrolling the page to it. Says whether it did. */
export const focusIf = (el: Spot): boolean => {
  if (!usable(el)) return false
  el.focus({ preventScroll: true })
  return true
}

/** Focuses `el` only when focus has been lost, so a press somewhere else, made on purpose, keeps the focus it took. */
export const focusIfLost = (el: Spot): boolean => focusLost() && focusIf(el)

/**
 * For a layer that comes and goes (a dialog, a popover, a panel, a prompt): remembers what had the focus when it opened, and when it closes puts the focus back there if it is
 * still on the page, shown and enabled; else on `fallback`, which is looked up as the layer closes. Focus that is somewhere else by then was put there on purpose and stays.
 * The put-back waits a tick, so a layer that closes only to be drawn again in the same render (Strict Mode, a panel swapped for another) gives nothing back.
 */
export function useFocusBack(fallback?: () => Spot) {
  const opener = useRef<Element | null>(null)
  const alive = useRef(true)
  const next = useRef(fallback)
  next.current = fallback
  if (opener.current === null) opener.current = document.activeElement // the one that was pressed to open this; read before the layer takes the focus
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      setTimeout(() => {
        if (alive.current || !focusLost()) return
        if (!focusIf(opener.current)) focusIf(next.current?.())
      })
    }
  }, [])
}

/** `useFocusBack` for a layer that is drawn in a condition: render this inside it. */
export function FocusBack({ fallback }: { fallback?: () => Spot }) {
  useFocusBack(fallback)
  return null
}

const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]'

/** Keeps Tab and Shift+Tab inside `box`, going round from its last stop to its first: for a layer that stays open until it is closed. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, box: HTMLElement | null) {
  if (e.key !== 'Tab' || box === null) return
  const stops = [...box.querySelectorAll<HTMLElement>(TABBABLE)].filter(el => el.tabIndex >= 0 && usable(el))
  if (stops.length === 0) return e.preventDefault()
  const at = stops.indexOf(document.activeElement as HTMLElement)
  const to = e.shiftKey ? (at <= 0 ? stops[stops.length - 1] : undefined) : at === stops.length - 1 ? stops[0] : undefined
  if (at === -1) stops[e.shiftKey ? stops.length - 1 : 0].focus({ preventScroll: true })
  else if (to) to.focus({ preventScroll: true })
  else return
  e.preventDefault()
}
