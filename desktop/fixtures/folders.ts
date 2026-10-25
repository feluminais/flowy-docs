import { FILE_KINDS, folderUnder, idOfPath, isAllowedPath, pathOf } from '../../src/core/filekinds.ts'
import { FOLDER_RULE, folderOf, folderPaths, isValidFolder, isValidTag, MAX_FILE_BYTES, MAX_TAG_LENGTH, SUGGESTED_TAGS, tagKey, tagsOf, tooBig } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'

// What the native reader must agree on about where flows are filed and how they are tagged: the rules a folder name and a tag follow, the paths of flow files, the
// size past which a file is not read and the words that say so, and the small helpers over a model's folders. The edits, the loader and the Flows list have their own dumps (ops, the folder cases, outline).

const FOLDERS = [
  '', 'payments', 'payments/refunds', 'Pay & refund', 'a b', 'v1.2', 'é', '日本語', 'a-b_c (d)', "it's", 'x'.repeat(64),
  '/a', 'a/', 'a//b', '.hidden', 'a/.b', 'a.', 'a ', ' a', 'a:b', 'a*', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a#b', 'a%b', 'a\\b', 'nul', 'NUL', 'Com1', 'lpt9', 'nul.txt', 'console',
  'a/b/c/d/e/f', 'a/b/c/d/e/f/g', 'x'.repeat(65), 'a\u0001b', 'a\tb', 'a\nb', ' a',
]

const TAGS = ['happy path', 'x', 'x'.repeat(MAX_TAG_LENGTH), 'x'.repeat(MAX_TAG_LENGTH + 1), '', ' a', 'a ', ' ', 'a\nb', 'a\tb', 'é', 'Error Path', 'a, b', '[a]']

const TAG_LISTS: unknown[] = [
  [], ['happy path'], ['happy path', 'Happy Path', 'HAPPY PATH'], ['a', ' b', 'c ', '', 'd'], ['x'.repeat(40), 'ok'], ['Error path', 'error path', 'recovery'],
  'happy path', '', null, 7, { a: 1 },
]

const FOLDER_MAPS: Record<string, string>[] = [
  {}, { a: 'x' }, { a: 'x/y/z', b: 'x', c: 'w' }, { a: 'B', b: 'a', c: 'B/c', d: 'A' }, { a: 'payments/refunds', b: 'payments/refunds', c: 'payments' },
]

// Sizes in bytes around the limit and the roundings of the words: just over, a whole number of MB, a tenth past one, and far past.
const SIZES = [MAX_FILE_BYTES + 1, 6 * 1024 * 1024, 6 * 1024 * 1024 + 1, 7_654_321, 200 * 1024 * 1024]

const PATHS = [
  'flows/a.yaml', 'flows/x/a.yaml', 'flows/x/y/z/a.yaml', 'flows/Pay & refund/a.yaml', 'flows/a.yaml.tmp', 'flows/a.yml', 'flows/x/a.yml', 'flows/.yaml', 'flows/x/.yaml', 'flows/x/',
  'flows/x/A.yaml', 'flows/x/root.yaml', 'flows/x/-a.yaml', 'flows/.hidden/a.yaml', 'flows/a:b/a.yaml', 'flows/a#b/a.yaml', 'flows/ a/a.yaml', 'flows/a./a.yaml', 'flows/a//a.yaml',
  'flows/nul/a.yaml', 'flows/a/b/c/d/e/f/a.yaml', 'flows/a/b/c/d/e/f/g/a.yaml', 'flows/a\\b.yaml',
  'failures/a.yaml', 'failures/x/a.yaml', 'perf/a.yaml', 'perf/x/a.yaml', 'model.yaml', 'layout.yaml', 'other/a.yaml', 'x/flows/a.yaml', '../flows/a.yaml', 'flows',
]

/** The rules for a folder of flows and a tag, the paths of flow files, and the helpers over a model's folders, as tables the C# tests rebuild. */
export function dumpFolderRules(): unknown {
  const kind = FILE_KINDS.flow
  return {
    folderRule: FOLDER_RULE,
    maxTagLength: MAX_TAG_LENGTH,
    maxFileBytes: MAX_FILE_BYTES,
    tooBig: SIZES.map(bytes => ({ bytes, text: tooBig(bytes) })),
    suggestedTags: [...SUGGESTED_TAGS],
    folders: FOLDERS.map(folder => ({ folder, valid: isValidFolder(folder) })),
    tags: TAGS.map(tag => ({ tag, valid: isValidTag(tag), key: tagKey(tag) })),
    tagLists: TAG_LISTS.map(raw => ({ raw, tags: tagsOf({ tags: raw }) })),
    folderMaps: FOLDER_MAPS.map(folders => {
      const model = { folders } as Pick<Model, 'folders'>
      return { folders, paths: folderPaths(model), of: Object.keys(folders).concat('missing', '__proto__', 'constructor').map(id => ({ id, folder: folderOf(model, id) })) }
    }),
    paths: PATHS.map(path => ({ path, id: idOfPath(kind, path) ?? null, folder: folderUnder(kind, path), allowed: isAllowedPath(path) })),
    pathOf: [['a', ''], ['a', 'x'], ['a', 'x/y'], ['a', 'Pay & refund']].map(([id, sub]) => ({ id, sub, path: pathOf(kind, id, sub) })),
  }
}
