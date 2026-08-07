import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Deployed as a static site: the planner is pure computation and the routing
  // matrix ships as data, so there is nothing to talk to at run time.
  base: './',
  build: {
    rollupOptions: {
      output: {
        // Split the libraries from the app so a visitor who comes back only
        // re-downloads what changed. It does not shrink the first load, and
        // saying otherwise would be pretending.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return 'react'
          // antd's own components plus the rc-component primitives it is built
          // from, which are the larger half of it.
          if (/node_modules[/\\](antd|@rc-component|rc-)/.test(id)) return 'antd'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
