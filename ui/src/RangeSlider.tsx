import { useEffect, useRef, useState } from 'react'

/** Longest the page waits to be told of a move when the browser gives no animation frame (a tab in the background, or a pane that is not drawn). */
const FRAME_FALLBACK_MS = 34

/**
 * The slider of the load of a run. The thumb follows the pointer at once, from a value of its own while it is held. What the page is told is the latest value and once a frame at
 * most (a mouse can make a thousand input events a second, and each change of load works out the run again and draws the lines again), so a drag costs the same however fast it
 * goes. On letting go the thumb goes to where the page put it, which is a tested level when it was close to one.
 */
export function RangeSlider({ value, min, max, label, text, onMove, onTouch }: {
  value: number
  min: number
  max: number
  label: string
  /** The load in words, for a screen reader. */
  text: string
  /** The latest value the thumb was dragged to, at most once a frame. */
  onMove: (value: number) => void
  /** The slider was pressed or focused. */
  onTouch?: () => void
}) {
  const [held, setHeld] = useState<number>()
  const latest = useRef(value)
  const move = useRef(onMove)
  move.current = onMove
  const pending = useRef<{ frame: number; timer: ReturnType<typeof setTimeout> }>(undefined)
  const flush = () => {
    if (!pending.current) return
    cancelAnimationFrame(pending.current.frame)
    clearTimeout(pending.current.timer)
    pending.current = undefined
    move.current(latest.current)
  }
  useEffect(() => () => {
    if (!pending.current) return
    cancelAnimationFrame(pending.current.frame)
    clearTimeout(pending.current.timer)
  }, [])
  const release = () => {
    flush() // the last place the thumb was at is told before it lets go
    setHeld(undefined)
  }
  return (
    <input type="range" min={min} max={max} step="any" value={held ?? value} aria-label={label} aria-valuetext={text}
      onFocus={onTouch}
      onPointerDown={() => {
        onTouch?.()
        window.addEventListener('pointerup', release, { once: true })
        window.addEventListener('pointercancel', release, { once: true })
      }}
      onKeyUp={release}
      onBlur={release}
      onChange={e => {
        latest.current = Number(e.target.value)
        setHeld(latest.current)
        if (!pending.current) pending.current = { frame: requestAnimationFrame(flush), timer: setTimeout(flush, FRAME_FALLBACK_MS) }
      }} />
  )
}
