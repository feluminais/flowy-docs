#!/bin/sh
# Starts Flowy Docs on the repo you are standing in. Takes the same flags as `npx flowy-docs`.
# Builds on first run. After a git pull, delete dist/ to rebuild.
here=$(cd "$(dirname "$0")" && pwd)
if [ ! -f "$here/dist/cli.js" ]; then
  npm --prefix "$here" install && npm --prefix "$here" run build || exit 1
fi
exec node "$here/dist/cli.js" "$@"
