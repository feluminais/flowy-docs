/** `path` on the local server at `base`, asking for `model` when the server shows several (see /api/models). */
export const apiUrl = (base: string, path: string, model?: string) =>
  `${base}${path}${model === undefined ? '' : `${path.includes('?') ? '&' : '?'}model=${encodeURIComponent(model)}`}`
