import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { syncServerPlugin } from './sync-server.js'

export default defineConfig({
  plugins: [react(), syncServerPlugin()],
  server: {
    port: 3000,
    strictPort: false,
    host: '0.0.0.0',
    open: true,
    allowedHosts: ['all', 'gumdrop-viral-effects.ngrok-free.dev']
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
