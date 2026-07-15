import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-v2.svg'],
      manifest: {
        name: 'TimeLogger',
        short_name: 'TimeLogger',
        id: './',
        description: '個人用ライフログ・タイムトラッカー',
        lang: 'ja',
        theme_color: '#0e1014',
        background_color: '#0e1014',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'pwa-icon-v2.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-icon-v2.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/data/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.includes('/api/') || url.pathname.includes('/data/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: command === 'serve' ? '/' : process.env.VITE_BASE_PATH || '/timelogger/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/data': 'http://127.0.0.1:8080',
    },
  },
}))
