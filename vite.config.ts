import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** Keeps the strict CSP in production while permitting Vite's dev client and HMR. */
function cspModePlugin(mode: 'development' | 'production') {
  return {
    name: 'mykhata-csp-mode',
    transformIndexHtml(html: string) {
      return html.replace(
        /<!-- csp:(dev|prod) -->[\s\S]*?<!-- \/csp:\1 -->/g,
        (block: string, blockMode: string) => {
          const keep = (blockMode === 'dev' && mode === 'development')
            || (blockMode === 'prod' && mode === 'production');
          return keep ? block.replace(/<!-- \/?csp:(?:dev|prod) -->\s*/g, '') : '';
        },
      );
    },
  };
}

export default defineConfig(({ command }) => {
  const mode: 'development' | 'production' = command === 'serve' ? 'development' : 'production';
  return {
    plugins: [react(), cspModePlugin(mode)],
    build: {
      outDir: 'dist',
      // Source maps are only useful in development; never ship them to users.
      sourcemap: command === 'serve',
      chunkSizeWarningLimit: 1200,
    },
    optimizeDeps: {
      exclude: ['sql.js', '@capacitor-community/sqlite'],
    },
    test: {
      environment: 'node',
      globals: true,
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
