import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.ECHOLOOP_BACKEND_PORT || '43180'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
        timeout: 60 * 60 * 1000,
        proxyTimeout: 60 * 60 * 1000,
      },
    },
  },
})
