/** A path in the repo as `code` takes it: relative, with / between folders, and no "." or ".." parts. A trailing / is a folder. */
export const isRepoPath = (path: string): boolean =>
  !/^\/|\\|:/.test(path) && path.split('/').every((part, i, all) => (part !== '' || (i === all.length - 1 && i > 0)) && part !== '.' && part !== '..')

/** A web address as a link takes it: http or https, then a host. Checks.cs spells the same pattern out character for character, so the two never disagree about a parse. */
export const isWebAddress = (url: string): boolean => /^https?:\/\/[^\t\n\v\f\r \/?#][^\t\n\v\f\r ]*$/i.test(url)

/** A path made safe for a URL one part at a time, so a # or ? in a name stays part of the name. */
export const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/')
