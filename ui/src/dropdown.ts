/** What a Dropdown needs to work out that is not drawing: which row a key lands on. */

/** The row `by` places on from `at`, kept inside the list. */
export const stepRow = (at: number, by: number, count: number): number => Math.max(0, Math.min(count - 1, at + by))

/**
 * The row typing `typed` goes to: the next one after `at` that starts with it (so a letter pressed again goes on to the next row with that letter), else the first that does.
 * -1 when none does.
 */
export function typedRow(texts: readonly string[], typed: string, at: number): number {
  const wanted = typed.toLowerCase()
  const starts = (i: number) => texts[i].toLowerCase().startsWith(wanted)
  // One letter repeated goes round the rows that start with it; several letters narrow to the first row that starts with all of them.
  const from = wanted.length === 1 || [...wanted].every(c => c === wanted[0]) ? at + 1 : at
  for (let i = from; i < texts.length; i++) if (starts(i)) return i
  for (let i = 0; i < Math.min(from, texts.length); i++) if (starts(i)) return i
  return -1
}

/** Whether a key press types a character into a list (a letter, a digit or a space inside a word), not one that is a command. */
export const typesCharacter = (e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean =>
  e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
