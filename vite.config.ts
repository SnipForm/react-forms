import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      // React is a peer - never bundle it. libphonenumber-js is a dependency,
      // loaded lazily by the phone rule.
      external: ['react', 'react-dom', 'react/jsx-runtime', /^libphonenumber-js(\/|$)/],
    },
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
});
