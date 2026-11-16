import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const web = (file: string) => path.resolve(__dirname, 'src/renderer/cloud-web/shims', file);

/**
 * The cloud client modules this build shares with Main import two Node-only pieces:
 * `node:crypto` for request IDs, and the loopback receiver for OAuth callbacks. The
 * browser build uses Web Crypto and the manual callback entry instead.
 */
function browserShims(): Plugin {
  return {
    name: 'cindy-cloud-web-shims',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'node:crypto') return web('nodeCrypto.ts');
      if (source === './authorizationCallback' && importer?.includes(`${path.sep}cloud-settings-client${path.sep}`))
        return web('authorizationCallback.ts');
      return null;
    },
  };
}

/** Static browser build of the cloud pages that CIS serves. No Electron, no preload. */
export default defineConfig({
  // The page is the output root, so CIS can serve it from one directory.
  root: path.resolve(__dirname, 'src/renderer/cloud-web'),
  publicDir: false,
  envDir: __dirname,
  base: './',
  plugins: [browserShims(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@cindy/auth-client/fixtures': path.resolve(
        __dirname,
        '../../packages/auth-client/fixtures/loginScenarios.production-stub.ts',
      ),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '.vite/cloud-web'),
    emptyOutDir: true,
    sourcemap: false,
    // Fonts ship as files: the CIS page policy allows `font-src 'self'` only.
    assetsInlineLimit: 0,
    rollupOptions: { input: path.resolve(__dirname, 'src/renderer/cloud-web/index.html') },
  },
});
