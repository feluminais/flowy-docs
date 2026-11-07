import { useEffect, useRef, useState } from 'react'
import { Close, Sketch } from './icons.tsx'
import { groupsOf, heirOf, isSketchTab, readTabs, saveTabs, tabAddress, tabName, withTab } from './doctabs.ts'
import { modelOfPage } from './models.ts'

/**
 * The row of tabs over the top bar: a tab for each model and sketch opened in this browser tab, a model and its sketches inside one outline. It shows from two tabs on: with one there is
 * nothing to go between, and the browser's own tab already names the page.
 */
export function DocTabs({ name, of, where }: { name: string; of: string | undefined; where: string | undefined }) {
  const id = modelOfPage() ?? ''
  const here = { id, name, ...(of === undefined ? {} : { of }), ...(where === undefined ? {} : { where }), hash: '' }
  const [tabs, setTabs] = useState(() => withTab(readTabs(), here))
  useEffect(() => {
    setTabs(now => withTab(now, here))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `here` is new each render; these are what it is made of
  }, [id, name, of, where])
  useEffect(() => saveTabs(tabs), [tabs])
  // Going to another tab loads another page: this one notes where it was left, which is what its tab goes back to.
  useEffect(() => {
    const leave = () => saveTabs(readTabs().map(t => (t.id === id ? { ...t, hash: location.hash } : t)))
    addEventListener('pagehide', leave)
    return () => removeEventListener('pagehide', leave)
  }, [id])
  // A long row scrolls: the tab on show starts in view.
  const row = useRef<HTMLElement>(null)
  useEffect(() => {
    row.current?.querySelector('.doctab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])
  if (tabs.length < 2) return null

  const close = (closing: string) => {
    const left = tabs.filter(t => t.id !== closing)
    if (closing === id) {
      saveTabs(left)
      const heir = heirOf(tabs, closing)
      if (heir) location.assign(tabAddress(heir))
    } else setTabs(left)
  }
  return (
    <nav ref={row} className="doctabs" aria-label="Open tabs">
      {groupsOf(tabs).map(group => (
        <div className="docgroup" key={group[0]!.id}>
          {group.map(tab => {
            const label = tabName(tab, tabs)
            return (
              <span key={tab.id} className={tab.id === id ? 'doctab active' : 'doctab'}>
                <a href={tabAddress(tab)} aria-current={tab.id === id ? 'page' : undefined} title={tab.of === undefined ? tab.where : `Sketch of ${tab.of}`}
                  onClick={e => {
                    if (tab.id === id) e.preventDefault()
                  }}>
                  {isSketchTab(tab) && <Sketch size={14} />}<span className="name">{label}</span>
                </a>
                <button type="button" className="docclose" aria-label={`Close ${tab.name}`} title="Close tab" onClick={() => close(tab.id)}><Close size={12} /></button>
              </span>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
