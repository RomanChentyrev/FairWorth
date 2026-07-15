import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: mode === 'test' ? [] : [react()],
  test: { include: ['src/**/*.test.{js,jsx}'], environment: 'jsdom', setupFiles: ['./src/test/setup.js'] },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
}))
