import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { syncServerPlugin } from './sync-server.js'

export default defineConfig({
  plugins: [react(), syncServerPlugin()],
  server: {
    port: 3000,
    strictPort: false,
    host: '127.0.0.1',
    open: false,
    allowedHosts: false,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  },
  optimizeDeps: {
    force: false,
    include: [
      'react',
      'react-dom',
      'recharts',
      'lucide-react',
      'xlsx'
    ]
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/]
    }
  }
})
