import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies /api to ssa_server (default http://localhost:8080; override with SSA_API).
// With no server running, the app falls back to the in-browser WebAssembly engine.
const api = process.env.SSA_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173, proxy: { '/api': { target: api, changeOrigin: true } } },
});
