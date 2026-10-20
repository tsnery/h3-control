import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const PRODUCTION_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"
const DEV_CSP = `${PRODUCTION_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")}; connect-src 'self' ws://localhost:*`

const relaxCspForDevServer: Plugin = {
  name: 'relax-csp-for-dev-server',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace(PRODUCTION_CSP, DEV_CSP),
}

export default defineConfig({
  main: {},
  preload: { build: { externalizeDeps: { exclude: ['zod'] } } },
  renderer: {
    plugins: [react(), relaxCspForDevServer],
  },
})
