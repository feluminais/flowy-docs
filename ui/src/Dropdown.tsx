import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { stepRow, typedRow, typesCharacter } from './dropdown.ts'
import { ChevronDown } from './icons.tsx'

/** How long typed letters count as one word to jump to. */
const TYPING_MS = 700
/** The gap to the edge of the window the list keeps. */
const EDGE = 8

type Props = {
  /** Value and the words that name it. */
  options: [string, string][]
  /** The chosen value, when the page holds it. Left out, the dropdown holds it itself, from `defaultValue`. */
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** The accessible name, for one that has no label beside it. */
  label?: string
  title?: string
  /** A field of a form that is read from its FormData. */
  name?: string
  disabled?: boolean
}

/**
 * A choice from a short list, in place of a native select. A native select keeps the keyboard focus after its list closes (Esc, or the same row again), and while it has it
 * the arrow keys change its value instead of stepping a run or nudging a shape, and every shortcut is held back. This one gives the focus up when it was used with
 * the mouse: after a pick, after Esc, and after a click away. Used with the keyboard it keeps the focus, as a button does, and a button leaves the page's keys alone.
 */
export function Dropdown({ options, value, defaultValue, onChange, label, title, name, disabled }: Props) {
  const [held, setHeld] = useState(defaultValue ?? options[0]?.[0] ?? '')
  const chosen = value ?? held
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [place, setPlace] = useState<{ left: number; top: number; minWidth: number }>()
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const byMouse = useRef(false) // the list was opened with the mouse, so closing it lets go of the focus
  const typed = useRef({ text: '', timer: undefined as ReturnType<typeof setTimeout> | undefined })
  const id = useId()
  const rowId = (i: number) => `${id}-${i}`
  const shown = options.find(([v]) => v === chosen)?.[1] ?? ''

  const show = () => {
    const i = options.findIndex(([v]) => v === chosen)
    setAt(i < 0 ? 0 : i)
    setPlace(undefined)
    setOpen(true)
  }
  /** Closes the list. `letGo` is for a close the mouse made. */
  const close = (letGo: boolean) => {
    setOpen(false)
    if (letGo) button.current?.blur()
  }
  const pick = (i: number, letGo: boolean) => {
    const next = options[i]?.[0]
    close(letGo)
    if (next === undefined) return
    setHeld(next)
    if (next !== chosen) onChange?.(next)
  }

  // The list hangs under the button, or over it when there is no room, and keeps inside the window.
  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return
    const b = button.current.getBoundingClientRect()
    const { offsetWidth: w, offsetHeight: h } = list.current
    const below = window.innerHeight - b.bottom - EDGE
    const top = below >= h || below >= b.top - EDGE ? b.bottom + 4 : Math.max(EDGE, b.top - 4 - h)
    setPlace({ left: Math.max(EDGE, Math.min(b.left, window.innerWidth - w - EDGE)), top, minWidth: b.width })
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    // A press outside closes it, and has put the focus where it was aimed. Anything that moves the page under the list closes it as well.
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && (button.current?.contains(e.target) || list.current?.contains(e.target))) return
      close(false)
    }
    const onMove = (e: Event) => {
      if (!(e.target instanceof Node && list.current?.contains(e.target))) close(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(rowId(at))?.scrollIntoView({ block: 'nearest' })
  }, [open, at, place])

  useEffect(() => () => clearTimeout(typed.current.timer), [])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.nativeEvent.isComposing || disabled) return
    const mine = () => {
      e.preventDefault()
      e.stopPropagation() // the page's keys (arrows that step a run, P, Esc that closes a panel) are not for it while it is being used
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        mine()
        byMouse.current = false
        show()
      }
      return // the other keys, the arrows left and right among them, stay the page's
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setAt(stepRow(at, e.key === 'ArrowDown' ? 1 : -1, options.length))
    else if (e.key === 'Home' || e.key === 'End') setAt(e.key === 'Home' ? 0 : options.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') pick(at, byMouse.current)
    else if (e.key === 'Escape') close(byMouse.current)
    else if (e.key === 'Tab') return setOpen(false) // the focus moves on by itself
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') undefined // nothing to do in a list, and not the page's while it is open
    else if (typesCharacter(e)) {
      clearTimeout(typed.current.timer)
      typed.current.text += e.key
      typed.current.timer = setTimeout(() => { typed.current.text = '' }, TYPING_MS)
      const hit = typedRow(options.map(([, text]) => text), typed.current.text, at)
      if (hit >= 0) setAt(hit)
    } else return
    mine()
  }

  return (
    <>
      <button ref={button} type="button" className="dd" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-activedescendant={open ? rowId(at) : undefined} aria-label={label} title={title} disabled={disabled}
        onKeyDown={onKeyDown}
        // A click from the keyboard has no position and its key was handled above, so only the mouse's clicks reach here.
        onClick={e => {
          if (e.detail === 0) return
          if (open) return close(true)
          byMouse.current = true
          show()
        }}>
        <span className="dd-text">{shown}</span>
        <ChevronDown size={14} />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={chosen} />}
      {open && createPortal(
        // The mouse works the list without taking the focus off the button, so a press on a row does not close it before the click lands.
        <ul ref={list} id={id} className="dd-list" role="listbox" aria-label={label} onPointerDown={e => e.preventDefault()}
          style={place ?? { left: 0, top: 0, visibility: 'hidden' }}>
          {options.map(([v, text], i) => (
            <li key={v} id={rowId(i)} role="option" aria-selected={v === chosen} className={i === at ? 'at' : undefined}
              onPointerEnter={() => setAt(i)} onClick={() => pick(i, true)}>
              {text}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
