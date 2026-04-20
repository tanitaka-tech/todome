import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev の backend は start.sh で :3002 固定。TODOME_BACKEND_PORT で上書き可。
const backendPort = process.env.TODOME_BACKEND_PORT || '3002'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${backendPort}`,
        ws: true,
      },
    },
  },
})
