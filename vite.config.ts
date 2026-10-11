import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': '/src' } },
  // harfbuzzjs uses top-level await and loads its .wasm via import.meta.url.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
