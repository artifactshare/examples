import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Artifact Share serves a static site from a version-scoped origin, so every
// asset path is relative. Output stays .js: folder uploads do not accept .mjs.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
