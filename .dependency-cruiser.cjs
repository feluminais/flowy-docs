// Layering rules, checked by `npm run check:layers`. src/core is the part the browser, the server and the desktop app's twin all
// agree on, so it stays free of Node and of everything built on top of it.
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', comment: 'A cycle makes the load order depend on which file is read first.', from: {}, to: { circular: true } },
    { name: 'core-stands-alone', severity: 'error', comment: 'src/core is imported by the page and the server; it must not import either.', from: { path: '^src/core' }, to: { path: '^(src/node|src/cli|ui/|vscode/|desktop/)' } },
    { name: 'core-uses-no-node', severity: 'error', comment: 'src/core also runs in the browser, where Node built-ins do not exist.', from: { path: '^src/core' }, to: { dependencyTypes: ['core'] } },
    { name: 'page-not-server', severity: 'error', comment: 'The page is built for the browser; the server code is not.', from: { path: '^ui/src' }, to: { path: '^src/(node|cli)' } },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(docs|desktop|dist|site|example|example-site|flowy|reports|\.worktrees|\.claude)' },
  },
}
