import { dataShown } from '../../src/core/data.ts'
import type { DataShown } from '../../src/core/data.ts'
import { serializeData } from '../../src/core/model.ts'
import type { FlowyObject } from '../../src/core/model.ts'
import { Section } from './Chrome.tsx'
import { Clock, Table } from './icons.tsx'

/** A table, key set or topic: column headings over the sample rows. A mark after a name says a key; a dot says the column has a note below. */
function Grid({ entry }: { entry: DataShown }) {
  return (
    <div className="data-grid" tabIndex={0} role="region" aria-label={`${entry.name} rows`}>
      <table>
        <thead>
          <tr>
            {entry.columns.map((c, i) => (
              <th key={i}>
                {c.name}
                {c.key === 'primary' && <abbr className="data-mark" title="Primary key">PK</abbr>}
                {c.to && <abbr className="data-mark" title={`Foreign key to ${c.to}`}>FK {c.to}</abbr>}
                {c.note && <span className="data-dot" aria-hidden="true" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entry.rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j} title={cell || undefined}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A document: one sample, a field to a line, nesting shown by indent. */
function Doc({ entry }: { entry: DataShown }) {
  return (
    <div className="data-doc" tabIndex={0} role="region" aria-label={`${entry.name} sample`}>
      {entry.lines.map((line, i) => (
        <div key={i} className="data-line" style={{ paddingLeft: (line.depth - 1) * 14 }}>
          <span className="data-key">{line.key}</span>
          {line.value !== '' && <span className="data-val">{line.value}</span>}
          {line.noted && <span className="data-dot" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}

/** One entry: open, it shows its name, its limits, its note, the data and the notes under it; closed, one line with how much there is. */
function Entry({ entry, open }: { entry: DataShown; open: boolean }) {
  return (
    <details className="data-entry" open={open}>
      <summary>
        <span className="data-name">{entry.name}</span>
        {entry.kind && <span className="data-kind">{entry.kind}</span>}
        <span className="data-count">{entry.summary}</span>
        {entry.limits && <span className="data-limits"><Clock size={12} />{entry.limits}</span>}
      </summary>
      {entry.note && <p className="data-note">{entry.note}</p>}
      {entry.lines.length > 0 ? <Doc entry={entry} /> : <Grid entry={entry} />}
      {entry.notes.length > 0 && (
        <ul className="data-notes">
          {entry.notes.map((n, i) => <li key={i}><code>{n.name}</code>{n.text}</li>)}
        </ul>
      )}
    </details>
  )
}

/** What a store holds, in its panel: nothing for any other kind of shape, and nothing for a store with no data. The first entry is open. */
export function DataSection({ object }: { object: FlowyObject }) {
  const entries = object.type === 'store' ? dataShown(object) : []
  if (entries.length === 0) return null
  return (
    <section className="data">
      <Section icon={Table} title="Data" count={entries.length} />
      {entries.map((entry, i) => <Entry key={`${i}:${entry.name}`} entry={entry} open={i === 0} />)}
    </section>
  )
}

/**
 * A store's data as the text of its edit box: the lines the file holds, saved when you leave the box. Unlike a one-line field it keeps what
 * you typed when the save is refused, so a slip in a long table is fixed in place and not typed again.
 */
export function DataField({ object, onSave }: { object: FlowyObject; onSave: (text: string) => Promise<boolean> }) {
  const value = serializeData(object.data)
  // Keyed by the saved text, so the box shows the new text after every reload.
  return (
    <label>
      Data
      <textarea
        key={value} className="data-yaml" defaultValue={value} rows={10} spellCheck={false}
        placeholder={'- name: orders\n  columns: [id, total]\n  rows:\n    - [o_1042, 2490]'}
        onBlur={e => { if (e.currentTarget.value !== value) void onSave(e.currentTarget.value) }}
      />
    </label>
  )
}
