import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// Read package.json to get version
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

export default defineConfig({
  plugins: [
    svelte(),
    wasm(),
    nodePolyfills({
      include: [
        'path',
        'util',
        'buffer',
        'process',
        'events',
        'crypto',
        'os',
        'stream',
        'string_decoder',
        'readable-stream',
        'safe-buffer'
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    })
  ],
  resolve: {
    alias: {
      path: 'path-browserify',
      'node:path': 'path-browserify',
      buffer: 'buffer/',
      'safe-buffer': 'safe-buffer'
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      format: 'esm',
      plugins: [],
    },
    include: ['path-browserify']
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      external: [
        'fs',
        'node:fs/promises',
        'node:fs',
        'vm',
        'os'
      ]
    }
  }
});
