import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-v3.svg', 'apple-touch-icon-v3.png'],
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
            src: 'pwa-icon-v3-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-icon-v3-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-icon-v3-512.png',
            sizes: '512x512',
            type: 'image/png',
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
  base: command === 'serve' ? '/' : process.env.VITE_BASE_PATH || '/timelogger/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/data': 'http://127.0.0.1:8080',
    },
  },
}))
