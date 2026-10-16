import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // src/node/server.ts serves this folder. One bundle loaded from localhost, so its size doesn't matter.
  // `license` writes the MIT notices of the bundled packages next to the bundle, which their licences require.
  build: { outDir: '../dist/ui', emptyOutDir: true, chunkSizeWarningLimit: 2000, license: { fileName: 'THIRD-PARTY-LICENSES.md' } },
  // `npm run dev:ui` talks to a `flowy` already running on the default port. changeOrigin sends
  // Host: 127.0.0.1:4321, which the server's Host check expects.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4321', changeOrigin: true } } },
})
