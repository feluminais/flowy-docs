/**
 * The Content-Security-Policy of the canvas page, sent by the local server and written into an exported site's page. A model's text can
 * name any image address, so an outside one must not load (the desktop app and the VS Code panel already refuse it). Style attributes
 * stay allowed because the canvas positions its shapes with them.
 */
export const PAGE_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
  "base-uri 'none'", "form-action 'none'",
].join('; ')
