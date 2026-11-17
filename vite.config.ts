import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Builds the Chrome extension into dist/.
// - sidepanel.html: the extension UI (hosts the Firebase AI Logic models)
// - background.js: the MV3 service worker (context menu + side panel wiring)
// Static files in public/ (manifest.json) are copied as-is.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome139',
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: `${root}sidepanel.html`,
        background: `${root}src/background.ts`,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
