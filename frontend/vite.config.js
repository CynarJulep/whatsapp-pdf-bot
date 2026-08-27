import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Repo root .env (mismo que Docker) — inyecta token SAC como hace Netlify sac-proxy.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const sacToken = rootEnv.SAC_AUTOMATION_TOKEN || process.env.SAC_AUTOMATION_TOKEN || ''
  const apiTarget = process.env.VITE_API_PROXY || 'http://127.0.0.1:3001'

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        // /api/* → PAI local. /api/sac/* recibe x-sac-automation-token (no va al browser).
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const url = req.url || ''
              if (!sacToken) return
              if (url.includes('/sac') || proxyReq.path?.includes('/sac')) {
                proxyReq.setHeader('x-sac-automation-token', sacToken)
              }
            })
          },
        },
      },
    },
  }
})
