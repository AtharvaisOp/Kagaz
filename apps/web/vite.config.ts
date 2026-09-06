import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // PDF.js is intentionally loaded only after a document is selected.
    chunkSizeWarningLimit: 700,
  },
});
