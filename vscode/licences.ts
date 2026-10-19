import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** The folder of the package a file under node_modules belongs to (the innermost, scoped or not), or undefined for a file that isn't in one. */
export function packageRoot(file: string): string | undefined {
  const parts = file.split(/[\\/]/)
  const at = parts.lastIndexOf('node_modules')
  if (at < 0) return undefined
  const end = at + (parts[at + 1]?.startsWith('@') ? 3 : 2)
  return parts.length > end ? parts.slice(0, end).join(sep) : undefined
}

/**
 * The notices for the packages the files in `files` come from (paths as an esbuild metafile lists them, relative to `cwd`):
 * each package once, by name, with its licence text. Their licences ask that the text goes along with what is built from them.
 */
export async function licencesOf(files: string[], cwd: string): Promise<string> {
  const roots = new Set(files.map(packageRoot).filter((root): root is string => root !== undefined).map(root => resolve(cwd, root)))
  const found: { heading: string; text: string }[] = []
  for (const root of roots) {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name: string; version: string; license?: string }
    const file = (await readdir(root)).find(name => /^licen[sc]e(\.|$)/i.test(name))
    found.push({
      heading: `${manifest.name} ${manifest.version} (${manifest.license ?? 'no licence named'})`,
      text: file ? (await readFile(join(root, file), 'utf8')).trim() : 'No licence file came with this package.',
    })
  }
  found.sort((a, b) => a.heading.localeCompare(b.heading))
  return [
    '# Third-party notices for the extension',
    '',
    "The extension's own code bundles these packages. The canvas in `media/` lists its own in `media/THIRD-PARTY-LICENSES.md`.",
    '',
    ...found.flatMap(({ heading, text }) => [`## ${heading}`, '', text, '']),
  ].join('\n')
}
