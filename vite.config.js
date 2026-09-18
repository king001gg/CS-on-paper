import { defineConfig } from 'vite'

// 「纸上交锋 · PAPER STRIKE」
// 本地开发与预览都只监听 127.0.0.1，运行期不访问任何外部 CDN。
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false, open: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  }
})
