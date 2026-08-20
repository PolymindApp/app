import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { VitePWA } from 'vite-plugin-pwa'

function developmentRobotsPlugin(mode: string): Plugin {
  return {
    name: 'development-robots',
    apply: 'build',
    generateBundle() {
      if (mode !== 'dev') return

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: 'User-agent: *\nDisallow: /\n',
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    developmentRobotsPlugin(mode),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,jpeg,webmanifest,mp3}'],
      },
    }),
  ],
  server: {
    port: 5183,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8090',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        inline: [/vuetify/],
      },
    },
  },
}))
