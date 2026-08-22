import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 5174,
    open: false,
    // The catalog/moves/formations XML live under the sibling poc's src/assets;
    // allow serving them (and reading them via ?raw / import.meta.glob).
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
