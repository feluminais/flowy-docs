import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { PLAYER_ROOM, roomForCard } from './graph.ts'

/**
 * How much room a fit leaves at the foot of `canvas` for the flow player's card: as tall as the card is (see roomForCard), the usual PLAYER_ROOM while there is no card. The card is drawn
 * a little after the flow starts, and it can change size, so this looks for it after every render and watches it (and the canvas) once found.
 */
export function useCardRoom(canvas: RefObject<HTMLElement | null>, playing: boolean): number {
  const [room, setRoom] = useState(PLAYER_ROOM)
  const watching = useRef<{ card: Element; seen: ResizeObserver } | undefined>(undefined)
  useEffect(() => {
    const host = canvas.current
    const card = playing ? host?.querySelector<HTMLElement>('.player') ?? undefined : undefined
    if (card === watching.current?.card) return
    watching.current?.seen.disconnect()
    watching.current = undefined
    if (!host || !card) {
      setRoom(PLAYER_ROOM)
      return
    }
    const measure = () => setRoom(roomForCard(card.offsetHeight, host.clientHeight))
    measure()
    const seen = new ResizeObserver(measure)
    seen.observe(card)
    seen.observe(host)
    watching.current = { card, seen }
  })
  useEffect(() => () => watching.current?.seen.disconnect(), [])
  return room
}
