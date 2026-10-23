import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run dev` (api mode) proxies /api to a running `npm run dev:api` (wrangler pages dev on :8788),
// so you get Vite HMR on :5173 against the real Pages Functions + local D1.
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:8788'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // The API rejects cross-origin writes; present the proxied request as same-origin.
        configure: (proxy) => proxy.on('proxyReq', (req) => { if (req.getHeader('origin')) req.setHeader('origin', API_TARGET) }),
      },
    },
  },
})
