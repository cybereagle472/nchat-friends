import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { execSync } from 'child_process';

// Bakes the current commit + build time into the bundle (Settings → About
// shows it). This exists purely so it's possible to tell, from inside the
// running app, whether a given deployment is actually serving the commit
// you think it is — e.g. that a Cloudflare build didn't reuse a stale
// build-output cache, or that the browser isn't showing a cached old
// bundle — instead of guessing from asset filenames or trusting that a
// "Success" build log means the content you expect is actually live.
function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(getCommitHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: false,
    host: true,
    allowedHosts: true,
  },
  preview: {
    port: 3000,
  },
});
